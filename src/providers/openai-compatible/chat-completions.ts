import { constraintsFor, type PipelineContext } from "../../core/pipeline";
import { toValidated, type RequestMeta } from "../../core/request";
import type { AvailabilityMap } from "../../core/translate/availability-types";
import type { AiSdkChatResult } from "../../core/translate/ai-sdk";
import { createAiSdkChat } from "../../core/translate/ai-sdk";
import type { DialectId } from "../../core/translate/endpoints";
import type { ChatIR } from "../../core/translate/ir";
import { createToApi, type Decoder } from "../../core/translate/retarget";
import { targetValidationFor } from "../../retarget/target-constraints";
import { encodeOpenAIChat } from "./interop";
import type { EndpointConstraints, FamilyRule } from "../../core/constraint-types";
import type { Modality, ModelInfo } from "../../core/catalog-types";
import type { ValidateEstimate } from "../../core/result";
import { computeCostUSD } from "../../core/cost";
import {
  heuristicTokenizer,
  estimateToolDefinitionTokens,
  PER_MESSAGE_TOKEN_OVERHEAD,
  type Tokenizer,
} from "../../core/tokens";
import { toBytes } from "../../core/media/bytes";
import { sniffImage } from "../../core/media/image";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";
import type { ChatCompletionsBodyBase, ChatMessage, ChatTool } from "./wire";

// The wire types and the zod schemas live in ./wire.ts (a leaf that imports
// only zod), so translation machinery can reach the dialect without pulling
// in this module's checks/estimate/finalize machinery. Re-exported here so
// the module's public surface is unchanged.
export { textContentSchema, messagesSchema, createChatCompletionsSchema } from "./wire";
export type {
  ChatPromptCacheBreakpoint,
  ChatTextPart,
  ChatImagePart,
  ChatAudioPart,
  ChatFilePart,
  ChatRefusalPart,
  ChatUserContentPart,
  ChatSystemMessage,
  ChatDeveloperMessage,
  ChatUserMessage,
  ChatFunctionToolCall,
  ChatCustomToolCall,
  ChatToolCall,
  ChatAssistantMessage,
  ChatToolMessage,
  ChatFunctionMessage,
  ChatMessage,
  ChatFunctionTool,
  ChatCustomTool,
  ChatTool,
  ChatToolChoice,
  ChatResponseFormat,
  ChatCompletionsBodyBase,
} from "./wire";

// ---------------------------------------------------------------------------
// The shared Chat Completions core: the OpenAI-compatible dialect that Groq,
// Together, Fireworks, DeepSeek etc. all speak. Everything here is
// parameterizable — providers compose these pieces with their own catalog,
// URL, constraints, and provider-only params (see src/providers/openai/chat.ts
// for the reference composition, and ./index.ts for the generic factory).
//
// Dialect boundary (judgement calls, documented):
// - IN the base body: model, messages, sampling params, penalties, logprobs,
//   n, seed, stop, stream(+options), tools/tool_choice/parallel_tool_calls,
//   response_format, max_completion_tokens/max_tokens, logit_bias, user, and
//   the legacy functions/function_call pair (part of the classical dialect
//   most compatible servers still accept). `reasoning_effort` and
//   `service_tier` are in the base as open strings — many compat providers
//   accept them with provider-specific value sets; providers narrow the TS
//   type to their exact union.
// - OUT (OpenAI-only, live in openai/chat.ts): audio, modalities, moderation,
//   prediction, prompt_cache_key/options/retention, safety_identifier, store,
//   metadata, verbosity, web_search_options.
// - The content-part types keep the optional OpenAI `prompt_cache_breakpoint`
//   field rather than forking the whole message-type tree per provider; loose
//   wire schemas pass it through unvalidated everywhere, so it is wire-inert
//   on providers that ignore it.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Checks — all catalog-driven; no hardcoded model-name patterns. Constraint-
// dependent pieces take a `ChatConstraintSpec` so each provider's table wires
// in without copying logic.
// ---------------------------------------------------------------------------

export const DEFAULT_IMAGE_TOKENS = 1000;

/** A provider's hand-written constraint tables for its chat endpoint. */
export interface ChatConstraintSpec {
  constraints?: Readonly<Partial<Record<string, EndpointConstraints>>>;
  familyRules?: readonly FamilyRule[];
}

/**
 * The per-image token constant for a model, optionally narrowed by the
 * attachment's own resolution hint.
 *
 * `detail` is the canonical `ChatFilePart.detail` word, which reaches the wire
 * as `image_url.detail`. It only changes the answer where a constraint table
 * declares `imageTokensByDetail` — i.e. where a provider documents a fixed
 * number for that level. OpenAI's does not, and that is a recorded decision
 * rather than a gap: its vision guide is explicit that `low` does not always
 * use fewer tokens than `high` on current models, so the estimate stays on the
 * table's single number instead of inventing a per-level one.
 */
export function imageTokensFor(
  spec: ChatConstraintSpec,
  modelId: string,
  detail?: "auto" | "low" | "medium" | "high",
): number {
  for (const constraints of constraintsFor(spec, modelId)) {
    if (detail !== undefined && detail !== "auto") {
      const byDetail = constraints.imageTokensByDetail?.[detail];
      if (byDetail !== undefined) return byDetail;
    }
    if (constraints.imageTokens !== undefined) return constraints.imageTokens;
  }
  return DEFAULT_IMAGE_TOKENS;
}

export function checkToolSupport(
  params: ChatCompletionsBodyBase,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.toolCall) return;
  if (params.tools !== undefined && params.tools.length > 0) {
    // Naming the tools matters: a request assembled from a registry may carry
    // tools the call site never mentions, and "remove `tools`" alone does not
    // say which ones the model will silently never call.
    const names = params.tools.map((tool) =>
      tool.type === "function" ? tool.function.name : tool.custom.name,
    );
    ctx.report({
      code: "unsupported_capability",
      path: ["tools"],
      model: params.model,
      message: `"${params.model}" does not support tool calling, and ${names.length} tool(s) were supplied (${names.join(", ")}); remove \`tools\`.`,
      meta: { tools: names },
    });
  }
}

/** Input modality each non-text user content part kind requires. */
const PART_INPUT_MODALITY = {
  image_url: "image",
  input_audio: "audio",
  file: "pdf",
} as const satisfies Record<string, Modality>;

export function checkInputModalities(
  params: ChatCompletionsBodyBase,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  params.messages.forEach((message, messageIndex) => {
    if (message.role !== "user" || !Array.isArray(message.content)) return;
    message.content.forEach((part, partIndex) => {
      if (!(part.type in PART_INPUT_MODALITY)) return;
      const modality = PART_INPUT_MODALITY[part.type as keyof typeof PART_INPUT_MODALITY];
      if (info.modalities.input.includes(modality)) return;
      ctx.report({
        code: "unsupported_capability",
        path: ["messages", messageIndex, "content", partIndex],
        model: params.model,
        message: `"${params.model}" does not accept ${modality} input; remove this ${part.type} content part.`,
        meta: { modality, partType: part.type },
      });
    });
  });
}

export function checkStructuredOutput(
  params: ChatCompletionsBodyBase,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.structuredOutput !== false) return;
  if (params.response_format?.type === "json_schema") {
    ctx.report({
      code: "unsupported_capability",
      path: ["response_format"],
      model: params.model,
      message: `"${params.model}" does not support structured outputs (response_format json_schema).`,
    });
  }
}

/**
 * `reasoning_effort` on a model the catalog says cannot reason.
 *
 * The dialect leaves the value an open string because compatible servers
 * disagree about the ladder, but every one of them agrees on the shape of the
 * mistake: asking a non-reasoning model to think is a 400, not a soft ignore
 * (OpenAI rejects it on gpt-4o/gpt-4.1 outright). `null` restores the server
 * default and `"none"` explicitly asks for *no* reasoning — both are things a
 * non-reasoning model can honour, so neither is refused.
 *
 * Catalog-driven like its neighbours: an absent row (`info === undefined`)
 * skips, and only an explicit `reasoning: false` refuses.
 */
export function checkReasoningCapability(
  params: ChatCompletionsBodyBase,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.reasoning !== false) return;
  const effort = params.reasoning_effort;
  if (effort === undefined || effort === null || effort === "none") return;
  ctx.report({
    code: "unsupported_capability",
    path: ["reasoning_effort"],
    model: params.model,
    message: `"${params.model}" is not a reasoning model; remove \`reasoning_effort\` (or set it to "none").`,
    meta: { effort },
  });
}

export function checkSamplingParams(
  params: ChatCompletionsBodyBase,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.temperature !== false) return;
  for (const param of ["temperature", "top_p"] as const) {
    const value = params[param];
    // Fixed-sampling (reasoning) models still accept the documented default
    // explicitly: the API's own rejection reads "Unsupported value:
    // 'temperature' does not support 0.7 with this model. Only the default
    // (1) value is supported." — so 1 passes, anything else 400s.
    // https://community.openai.com/t/gpt-5-models-temperature/1337957
    if (value !== undefined && value !== null && value !== 1) {
      ctx.report({
        code: "unsupported_param",
        path: [param],
        model: params.model,
        message: `\`${param}\` is not supported by "${params.model}" (fixed sampling settings; only the default value 1 is accepted).`,
      });
    }
  }
}

export function checkOutputLimit(
  params: ChatCompletionsBodyBase,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.output;
  if (limit === undefined || limit <= 0) return;
  for (const param of ["max_completion_tokens", "max_tokens"] as const) {
    const value = params[param];
    if (typeof value === "number" && value > limit) {
      ctx.report({
        code: "over_output_limit",
        path: [param],
        model: params.model,
        message: `\`${param}\` (${value}) exceeds the ${limit}-token output limit of "${params.model}".`,
        meta: { limit, value },
      });
    }
  }
}

/** Inline (data:-URL) + declared media enforcement against the spec's image rules. */
export function createInlineImagesCheck(
  spec: ChatConstraintSpec,
): (params: ChatCompletionsBodyBase, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  return function checkInlineImages(params, _info, ctx) {
    const rules = constraintsFor(spec, params.model)
      .map((constraints) => constraints.media?.image)
      .filter((rule) => rule !== undefined);
    if (rules.length === 0) return;

    params.messages.forEach((message, messageIndex) => {
      if (message.role !== "user" || !Array.isArray(message.content)) return;
      message.content.forEach((part, partIndex) => {
        if (part.type !== "image_url") return;
        const path = ["messages", messageIndex, "content", partIndex];
        // Inline data: URLs are sniffed from bytes; URL-referenced images can
        // only be checked against the user's out-of-band declaration.
        const bytes = part.image_url.url.startsWith("data:") ? toBytes(part.image_url.url) : undefined;
        const sniffed = bytes === undefined ? undefined : sniffImage(bytes);
        const declaration = findMediaDeclaration(ctx.options.media, path);
        if (sniffed === undefined && declaration === undefined) return;
        for (const rule of rules) {
          reportMediaIssues(ctx, {
            kind: "image",
            rule,
            path,
            model: params.model,
            ...(sniffed !== undefined && { sniffed }),
            ...(declaration !== undefined && { declaration }),
          });
        }
      });
    });
  };
}

/** The standard Chat Completions check battery, wired to a provider's constraint tables. */
export function chatCompletionsChecks(
  spec: ChatConstraintSpec,
): ReadonlyArray<
  (params: ChatCompletionsBodyBase, info: ModelInfo | undefined, ctx: PipelineContext) => void
> {
  return [
    checkToolSupport,
    checkInputModalities,
    checkStructuredOutput,
    checkReasoningCapability,
    checkSamplingParams,
    checkOutputLimit,
    createInlineImagesCheck(spec),
  ];
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

/**
 * How an image part's token cost is resolved: a flat constant, or a function
 * of the part's own `image_url.detail`.
 *
 * The function form is what `createChatEstimate` passes, so a provider whose
 * table declares `imageTokensByDetail` prices a `detail: "low"` attachment at
 * that level's number instead of the model-wide one. Callers who pass a plain
 * number keep the old behaviour exactly, which is why the parameter is a union
 * rather than a fourth argument.
 */
export type ChatImageTokens =
  | number
  | ((detail: "auto" | "low" | "medium" | "high" | undefined) => number);

/**
 * Heuristic prompt-token estimate: text content plus a fixed per-message
 * overhead, tool definitions, tool-call arguments, and a per-image constant
 * that may vary with the part's own `detail` hint. Audio/file parts are not
 * counted.
 */
export function estimateChatTokens(
  params: { messages: ChatMessage[]; tools?: ChatTool[] },
  tokenizer: Tokenizer = heuristicTokenizer,
  imageTokens: ChatImageTokens = DEFAULT_IMAGE_TOKENS,
): number {
  const tokensForImage = (detail: unknown): number =>
    typeof imageTokens === "number"
      ? imageTokens
      : imageTokens(
          detail === "auto" || detail === "low" || detail === "medium" || detail === "high"
            ? detail
            : undefined,
        );
  let total = 0;
  for (const message of params.messages) {
    total += PER_MESSAGE_TOKEN_OVERHEAD;
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      total += tokenizer.count(content);
    } else if (Array.isArray(content)) {
      for (const part of content as Array<Record<string, unknown>>) {
        if (part.type === "text" && typeof part.text === "string") {
          total += tokenizer.count(part.text);
        } else if (part.type === "image_url") {
          total += tokensForImage((part.image_url as { detail?: unknown } | undefined)?.detail);
        } else if (part.type === "refusal" && typeof part.refusal === "string") {
          total += tokenizer.count(part.refusal);
        }
      }
    }
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) {
        total += tokenizer.count(call.type === "function" ? call.function.arguments : call.custom.input);
      }
    }
  }
  for (const tool of params.tools ?? []) {
    total += estimateToolDefinitionTokens(tokenizer, tool);
  }
  return total;
}

/**
 * The standard pipeline `estimate`: heuristic prompt tokens (per-model image
 * token constants from the spec) and worst-case cost — the model fills the
 * requested (or maximum) output budget.
 */
export function createChatEstimate(
  spec: ChatConstraintSpec,
): (
  params: ChatCompletionsBodyBase,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
) => ValidateEstimate {
  return (params, info, ctx) => {
    const inputTokens = estimateChatTokens(params, ctx.tokenizer, (detail) =>
      imageTokensFor(spec, params.model, detail),
    );
    const costUSD = computeCostUSD(info?.cost, {
      inputTokens,
      outputTokens: params.max_completion_tokens ?? params.max_tokens ?? info?.limit.output ?? 0,
    });
    return costUSD === undefined ? { inputTokens } : { inputTokens, costUSD };
  };
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

/**
 * The `.toSdk` targets every OpenAI-compatible chat endpoint offers.
 *
 * It is `"openai"` on the whole fleet, not the overlay's own provider id,
 * because this dialect's SDK params *are* the OpenAI SDK's params: you reach
 * Groq, Together, DeepSeek and the rest by pointing `new OpenAI({ baseURL })`
 * at them, and the vendors that do ship an own-branded client (`groq-sdk`,
 * `together-ai`) ship a fork of it with the same param shape. A per-overlay
 * `toSdk("openrouter")` would name an npm package that does not exist.
 * `Retargeted`'s `DialectSdkTargets<"openai-chat">` says the same thing, so a
 * retargeted result and a direct validation offer the same target.
 *
 * `"ai-sdk"` is the Vercel AI SDK's `generateText` / `streamText` options —
 * the stable subset of them, with no `model` (the caller supplies the
 * provider instance) and tool schemas as plain JSON Schema (wrap them with
 * `withJsonSchemaTools` from `unmodel/ai-sdk`). Note the naming collision it
 * invites: `toSdk("ai-sdk")` is the npm package, `toApi("vercel")` is the
 * Vercel AI Gateway's HTTP API.
 *
 * Must stay an object type with no index signature (derived from the `sdk`
 * literal in `createChatFinalize`), or `toSdk` would accept any string.
 */
export type ChatSdkTargets<Body> = {
  openai: () => Body;
  "ai-sdk": () => AiSdkChatResult;
};

/** What `createChatFinalize` needs to build a result for one chat endpoint. */
export interface ChatFinalizeSpec {
  /** `"<provider>.chat"` — the label on retarget warnings and errors. */
  endpoint: string;
  /**
   * models.dev provider id, e.g. `"groq"`. Used to key `providerOptions` in
   * the `"ai-sdk"` target. Defaults to the part of `endpoint` before the dot.
   */
  provider?: string;
  /** URL, method and static non-auth headers for this provider's chat route. */
  request: RequestMeta;
  /**
   * The provider's generated `src/catalog/availability/<id>.gen.ts` table.
   * Omitted → the endpoint ships no `.toApi` at all, at runtime and in the
   * type (`Avail = never`). No aggregator is imported: each overlay pays only
   * for its own table.
   */
  availability?: AvailabilityMap;
  /**
   * Decoders for the **other** dialects this endpoint's availability data can
   * reach, as a plain object literal at the call site so a bundler sees
   * exactly which codecs the overlay needs.
   *
   * Omitted on purpose for most of the fleet: 92.2% of the generated edges
   * are openai-chat → openai-chat, which is a model-id respell plus a URL
   * swap and never touches the IR. Only the gateway overlays whose data
   * actually names a Gemini or Anthropic target (openrouter, vercel) pay for
   * a codec, and a cross-dialect target without one throws a
   * `TranslationUnavailableError` naming the missing pair rather than
   * producing a wrong body.
   */
  decoders?: Readonly<Partial<Record<DialectId, Decoder<ChatIR>>>>;
}

/**
 * The standard pipeline `finalize`: a wire-pure body whose enumerable props
 * are the exact JSON body, with non-enumerable `toSdk("openai")` (identity —
 * this dialect's SDK params are wire-shaped), `.request` carrying the
 * endpoint's URL/method/static non-auth headers, and — when the provider
 * supplies its availability table — `.toApi(provider)` / `.toApiSafe(provider)`.
 *
 * An openai-chat → openai-chat hop is a model-id respell plus a URL swap
 * (92.2% of all edges in the generated data, and the path that never touches
 * the IR). Cross-dialect hops go through `encodeOpenAIChat` and whichever
 * decoders the endpoint declared in `spec.decoders`; a target whose dialect
 * is not declared throws a `TranslationUnavailableError` naming the missing
 * pair instead of producing a wrong body.
 *
 * `targetValidation` runs the **destination's** deny/enum tables (design-types
 * §4.4, validation layer 3), which is the case the whole feature exists for:
 * retarget a body carrying `logprobs` to Groq and you get a named error citing
 * Groq's compatibility doc instead of a 400 from the wire. The tables reach
 * this module through `src/retarget/target-constraints.ts` rather than by
 * importing another provider — an endpoint module may not do that (rule 6),
 * but `src/retarget/**` may reach provider `constraints.ts` leaves (rule 4),
 * so the leaf split is what makes the wiring legal. Both are enforced by
 * `test/import-graph.test.ts`.
 *
 * The schema half stays off deliberately: a same-dialect hop returns the
 * source body with one string replaced, and that body already passed this very
 * schema, so it would be a pure no-op with a zod parse's cost. The catalog
 * layers (2 and 4 — `unknown_model`, `over_context`, `over_budget`) stay off
 * too, since they need the target's full generated catalog; the documented
 * escape hatch for those is to compose with the destination's own validator.
 */
export function createChatFinalize(
  spec: ChatFinalizeSpec,
): (params: ChatCompletionsBodyBase) => unknown {
  const { availability, request } = spec;
  const provider = spec.provider ?? (spec.endpoint.split(".")[0] as string);
  const toApi =
    availability === undefined
      ? undefined
      : createToApi<ChatCompletionsBodyBase, ChatIR>({
          from: "openai-chat",
          endpoint: spec.endpoint,
          modelId: (body) => body.model,
          availability,
          encode: encodeOpenAIChat,
          ...(spec.decoders !== undefined && { decoders: spec.decoders }),
          targetValidation: targetValidationFor,
        });
  const toAiSdk = createAiSdkChat<ChatCompletionsBodyBase>({
    endpoint: spec.endpoint,
    provider,
    encode: encodeOpenAIChat,
  });
  return (params) => {
    const body = { ...params };
    return toValidated(body, request, {
      sdk: { openai: () => body, "ai-sdk": () => toAiSdk(body) },
      ...(toApi !== undefined && { api: toApi(body) }),
    });
  };
}
