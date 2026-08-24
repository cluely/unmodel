import { models } from "../../catalog/anthropic.gen";
import { createValidator, constraintsFor as constraintsForModel } from "../../core/pipeline";
import type { PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS } from "../../core/request";
import type { Validated, ExactKeys, RequestMeta } from "../../core/request";
import { createToApi } from "../../core/translate/retarget";
import { targetValidationFor } from "../../retarget/target-constraints";
import type { AiSdkChatResult } from "../../core/translate/ai-sdk";
import { createAiSdkChat } from "../../core/translate/ai-sdk";
import type { ChatIR } from "../../core/translate/ir";
import { encodeAnthropic } from "./interop";
// Rule 3 of the import graph in action: an endpoint module may reach another
// provider's `interop.ts` and NOTHING else of theirs. This pulls in the
// openai-chat codec and its type-only wire imports — not openai-compatible's
// zod schema, catalog or checks.
import { decodeOpenAIChat } from "../openai-compatible/interop";
import { availability } from "../../catalog/availability/anthropic.gen";
import type { AnthropicAvailability } from "../../catalog/availability/anthropic.gen";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo, ModelsWhereFalse } from "../../core/catalog-types";
import type { EndpointConstraints, MediaRule } from "../../core/constraint-types";
import { PER_MESSAGE_TOKEN_OVERHEAD, estimateToolDefinitionTokens } from "../../core/tokens";
import { computeCostUSD } from "../../core/cost";
import { toBytes } from "../../core/media/bytes";
import { sniffImage } from "../../core/media/image";
import type { SniffedImage } from "../../core/media/image";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";
import type { MediaDeclaration } from "../../core/options";
import { chatConstraints, chatFamilyRules, THINKING_DOCS, VISION_DOCS } from "./constraints";
import { messagesSchema } from "./wire";
import type { MessagesBody } from "./wire";
import type {
  ValidatorProviderCarrier,
  ValidatorResultKind,
  ValidatorResultKindCarrier,
} from "../../core/validator-result-kind";

// The wire types and the zod schema live in ./wire.ts (a leaf that imports
// only zod), so translation machinery can reach the dialect without pulling
// in this validator. Re-exported here so the module's public surface is
// unchanged.
export type {
  CacheControlEphemeral,
  TextBlock,
  ImageMediaType,
  Base64ImageSource,
  UrlImageSource,
  FileImageSource,
  ImageSource,
  ImageBlock,
  DocumentSource,
  DocumentBlock,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
  ContentBlock,
  MessageParam,
  CustomTool,
  ServerTool,
  Tool,
  ToolChoice,
  ThinkingConfig,
  MessagesBody,
} from "./wire";

export const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
/** Required `anthropic-version` header value. */
export const ANTHROPIC_VERSION = "2023-06-01";

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const constraintSpec = { constraints: chatConstraints, familyRules: chatFamilyRules };

/** True when `modelId` is `base` or a dated/suffixed snapshot of it. */
function isModelOrSnapshot(modelId: string, base: string): boolean {
  return modelId === base || modelId.startsWith(`${base}-`);
}

type BlockVisitor = (block: Record<string, unknown>, path: Array<string | number>) => void;

/** Visits every content block, including blocks nested in tool_result content. */
function eachBlock(params: MessagesBody, visit: BlockVisitor): void {
  const visitList = (blocks: unknown[], prefix: Array<string | number>): void => {
    blocks.forEach((block, index) => {
      if (typeof block !== "object" || block === null) return;
      const record = block as Record<string, unknown>;
      visit(record, [...prefix, index]);
      if (record["type"] === "tool_result" && Array.isArray(record["content"])) {
        visitList(record["content"], [...prefix, index, "content"]);
      }
    });
  };
  params.messages.forEach((message, i) => {
    if (Array.isArray(message.content)) visitList(message.content, ["messages", i, "content"]);
  });
}

export function checkCapabilities(
  params: MessagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model;

  if (params.tools !== undefined && params.tools.length > 0 && !info.toolCall) {
    // Named, not just counted: a request assembled from a tool registry can
    // carry tools the call site never mentions.
    const names = params.tools.map((tool) => tool.name);
    ctx.report({
      code: "unsupported_capability",
      path: ["tools"],
      model,
      message: `"${model}" does not support tool calling, and ${names.length} tool(s) were supplied (${names.join(", ")}); remove \`tools\`.`,
      meta: { tools: names },
    });
  }

  if (params.thinking !== undefined && params.thinking.type !== "disabled" && !info.reasoning) {
    ctx.report({
      code: "unsupported_capability",
      path: ["thinking"],
      model,
      message: `"${model}" does not support thinking; remove \`thinking\`.`,
    });
  }

  // Sampling params were removed on `temperature: false` model generations,
  // but the documented DEFAULTS remain accepted for backwards compatibility:
  // temperature 1.0 and top_p >= 0.99 pass, everything else returns a 400
  // (API reference deprecation notes). top_k rejects ANY value and is
  // enforced via the constraints deny table.
  if (params.temperature !== undefined && params.temperature !== 1 && info.temperature === false) {
    ctx.report({
      code: "unsupported_param",
      path: ["temperature"],
      model,
      message: `\`temperature\` is not supported by "${model}": sampling parameters were removed on this model generation; only the default 1.0 is accepted for backwards compatibility, other values return a 400.`,
      meta: { source: THINKING_DOCS },
    });
  }

  if (params.top_p !== undefined && params.top_p < 0.99 && info.temperature === false) {
    ctx.report({
      code: "unsupported_param",
      path: ["top_p"],
      model,
      message: `\`top_p\` is not supported by "${model}": sampling parameters were removed on this model generation; only values >= 0.99 are accepted for backwards compatibility, other values return a 400.`,
      meta: { source: THINKING_DOCS },
    });
  }

  const outputLimit = info.limit.output ?? 0;
  if (outputLimit > 0 && params.max_tokens > outputLimit) {
    ctx.report({
      code: "over_output_limit",
      path: ["max_tokens"],
      model,
      message: `max_tokens ${params.max_tokens} exceeds the ${outputLimit}-token output limit of "${model}".`,
      meta: { requested: params.max_tokens, limit: outputLimit },
    });
  }

  if (!info.modalities.input.includes("image")) {
    eachBlock(params, (block, path) => {
      if (block["type"] !== "image") return;
      ctx.report({
        code: "unsupported_capability",
        path,
        model,
        message: `"${model}" does not accept image input; remove the image block.`,
      });
    });
  }

  if (!info.modalities.input.includes("pdf")) {
    eachBlock(params, (block, path) => {
      if (block["type"] !== "document") return;
      const source = block["source"];
      const sourceType =
        typeof source === "object" && source !== null
          ? (source as Record<string, unknown>)["type"]
          : undefined;
      // text/content document sources carry plain text, not PDF input.
      if (sourceType !== "base64" && sourceType !== "url" && sourceType !== "file") return;
      ctx.report({
        code: "unsupported_capability",
        path,
        model,
        message: `"${model}" does not accept PDF (document) input; remove the document block.`,
      });
    });
  }
}

/**
 * Thinking compatibility rules: while thinking is on, `temperature` and
 * `top_k` are rejected and `top_p` must be within [0.95, 1]; manual extended
 * thinking additionally rejects forced tool use (`tool_choice` any/tool).
 * Model-specific rules: thinking cannot be turned off on Claude Fable 5, and
 * cannot be turned off at effort xhigh/max on Claude Opus 5.
 */
export function checkThinkingCompatibility(
  params: MessagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const thinking = params.thinking;
  if (thinking === undefined) return;
  const model = params.model;

  if (thinking.type === "disabled") {
    if (isModelOrSnapshot(model, "claude-fable-5")) {
      ctx.report({
        code: "unsupported_param",
        path: ["thinking"],
        model,
        message: `thinking cannot be turned off on "${model}"; remove \`thinking: {type: "disabled"}\`.`,
        meta: { source: THINKING_DOCS },
      });
    }
    const effort = params.output_config?.effort;
    if (isModelOrSnapshot(model, "claude-opus-5") && (effort === "xhigh" || effort === "max")) {
      ctx.report({
        code: "unsupported_param",
        path: ["thinking"],
        model,
        message: `thinking cannot be turned off at output_config.effort "${effort}" on "${model}"; use effort "high" or below, or remove \`thinking: {type: "disabled"}\`.`,
        meta: { source: THINKING_DOCS },
      });
    }
    return;
  }

  // On sampling-removed generations (catalog temperature: false) the
  // temperature/top_p rules are value-dependent and enforced by
  // checkCapabilities regardless of thinking; skip them here to avoid
  // duplicate issues on the same path.
  const samplingRemoved = info?.temperature === false;

  if (params.temperature !== undefined && !samplingRemoved) {
    ctx.report({
      code: "unsupported_param",
      path: ["temperature"],
      model,
      message: "`temperature` cannot be modified while thinking is on; Anthropic rejects the request.",
      meta: { source: THINKING_DOCS },
    });
  }

  // Skip when the constraints deny table already rejects top_k outright on
  // this model, to avoid a duplicate issue on the same path.
  const topKDenied = constraintsForModel(constraintSpec, model).some(
    (c) => c.deny?.["top_k"] !== undefined,
  );
  if (params.top_k !== undefined && !topKDenied) {
    ctx.report({
      code: "unsupported_param",
      path: ["top_k"],
      model,
      message: "`top_k` cannot be modified while thinking is on; Anthropic rejects the request.",
      meta: { source: THINKING_DOCS },
    });
  }

  if (
    params.top_p !== undefined &&
    !samplingRemoved &&
    (params.top_p < 0.95 || params.top_p > 1)
  ) {
    ctx.report({
      code: "unsupported_param",
      path: ["top_p"],
      model,
      message: `\`top_p\` must be between 0.95 and 1 while thinking is on; got ${params.top_p}.`,
      meta: { source: THINKING_DOCS },
    });
  }

  const choice = params.tool_choice?.type;
  if (thinking.type === "enabled" && (choice === "any" || choice === "tool")) {
    ctx.report({
      code: "unsupported_param",
      path: ["tool_choice"],
      model,
      message: `tool_choice "${choice}" forces tool use, which is incompatible with manual extended thinking; use "auto"/"none" or adaptive thinking.`,
      meta: { source: THINKING_DOCS },
    });
  }
}

/** Stricter per-image dimension cap once a request carries more than 20 images (vision docs). */
const MANY_IMAGE_THRESHOLD = 20;
const MANY_IMAGE_MAX_DIMENSION = 2000;

interface ImagePart {
  path: Array<string | number>;
  sniffed?: SniffedImage;
  encodedBytes?: number;
  declaration?: MediaDeclaration;
}

/**
 * Enforces the image media rules (format allowlist, size, dimensions) via the
 * shared reporter. Base64 sources are sniffed; URL/file sources are checked
 * against `options.media` declarations. Also enforces the request-level
 * vision limits: the stricter 2000px per-dimension cap on requests with more
 * than 20 images, and the per-request image count cap (100 for 200k-context
 * models, 600 otherwise).
 */
export function checkImageMedia(
  params: MessagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const rules = constraintsForModel(constraintSpec, params.model)
    .map((c) => c.media?.image)
    .filter((rule): rule is MediaRule => rule !== undefined);
  if (rules.length === 0) return;

  const parts: ImagePart[] = [];
  eachBlock(params, (block, path) => {
    if (block["type"] !== "image") return;
    const source = block["source"];
    if (typeof source !== "object" || source === null) return;
    const record = source as Record<string, unknown>;
    const declaration = findMediaDeclaration(ctx.options.media, path);

    let sniffed: SniffedImage | undefined;
    let encodedBytes: number | undefined;
    if (record["type"] === "base64" && typeof record["data"] === "string") {
      // Anthropic's 10MB per-image limit applies to the BASE64-ENCODED
      // payload, so the byte fact carried into the shared reporter is the
      // encoded length, not the decoded size.
      encodedBytes = record["data"].length;
      const bytes = toBytes(record["data"]);
      const raw = bytes !== undefined ? sniffImage(bytes) : undefined;
      sniffed = raw === undefined ? undefined : { ...raw, bytes: encodedBytes };
    }

    parts.push({
      path,
      ...(sniffed !== undefined && { sniffed }),
      ...(encodedBytes !== undefined && { encodedBytes }),
      ...(declaration !== undefined && { declaration }),
    });
  });
  if (parts.length === 0) return;

  for (const part of parts) {
    for (const rule of rules) {
      reportMediaIssues(ctx, {
        kind: "image",
        rule,
        path: part.path,
        model: params.model,
        ...(part.sniffed !== undefined && { sniffed: part.sniffed }),
        ...(part.encodedBytes !== undefined && { encodedBytes: part.encodedBytes }),
        ...(part.declaration !== undefined && { declaration: part.declaration }),
        source: VISION_DOCS,
      });
    }
  }

  if (parts.length > MANY_IMAGE_THRESHOLD) {
    for (const part of parts) {
      const dims = part.sniffed ?? part.declaration;
      const width = dims?.width;
      const height = dims?.height;
      const tooWide = width !== undefined && width > MANY_IMAGE_MAX_DIMENSION;
      const tooTall = height !== undefined && height > MANY_IMAGE_MAX_DIMENSION;
      if (!tooWide && !tooTall) continue;
      ctx.report({
        code: "media_dimensions_exceeded",
        path: part.path,
        model: params.model,
        message: `Image is ${width ?? "?"}x${height ?? "?"} px in a request with ${parts.length} images; requests with more than ${MANY_IMAGE_THRESHOLD} images cap each image at ${MANY_IMAGE_MAX_DIMENSION}px per dimension.`,
        meta: {
          ...(width !== undefined && { width }),
          ...(height !== undefined && { height }),
          maxWidth: MANY_IMAGE_MAX_DIMENSION,
          maxHeight: MANY_IMAGE_MAX_DIMENSION,
          images: parts.length,
          source: VISION_DOCS,
        },
      });
    }
  }

  if (info !== undefined && info.limit.context > 0) {
    const cap = info.limit.context <= 200_000 ? 100 : 600;
    if (parts.length > cap) {
      ctx.report({
        code: "invalid_shape",
        path: ["messages"],
        model: params.model,
        message: `Request contains ${parts.length} images; "${params.model}" accepts at most ${cap} images per request.`,
        meta: { images: parts.length, limit: cap, source: VISION_DOCS },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

const DEFAULT_IMAGE_TOKENS = 1568;

function imageTokensFor(modelId: string): number {
  for (const constraints of constraintsForModel(constraintSpec, modelId)) {
    if (constraints.imageTokens !== undefined) return constraints.imageTokens;
  }
  return DEFAULT_IMAGE_TOKENS;
}

function estimateMessages(
  params: MessagesBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const tokenizer = ctx.tokenizer;
  const imageTokens = imageTokensFor(params.model);
  let inputTokens = 0;

  const countText = (value: unknown): void => {
    if (typeof value === "string") inputTokens += tokenizer.count(value);
  };

  // The loose schema only validates block.type, so every payload field access
  // must be guarded: a malformed block (e.g. {type:"text"} without text)
  // contributes 0 tokens — estimation must never throw.
  const countBlocks = (blocks: unknown[]): void => {
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) continue;
      const record = block as Record<string, unknown>;
      switch (record["type"]) {
        case "text":
          countText(record["text"]);
          break;
        case "image":
          inputTokens += imageTokens;
          break;
        case "thinking":
          countText(record["thinking"]);
          break;
        case "tool_use":
          inputTokens += estimateToolDefinitionTokens(tokenizer, record["input"]);
          break;
        case "tool_result": {
          const content = record["content"];
          if (typeof content === "string") inputTokens += tokenizer.count(content);
          else if (Array.isArray(content)) countBlocks(content);
          break;
        }
        case "document": {
          const source = record["source"];
          if (typeof source === "object" && source !== null) {
            const sourceRecord = source as Record<string, unknown>;
            if (sourceRecord["type"] === "text") countText(sourceRecord["data"]);
          }
          break;
        }
        default:
          break;
      }
    }
  };

  if (typeof params.system === "string") {
    inputTokens += tokenizer.count(params.system) + PER_MESSAGE_TOKEN_OVERHEAD;
  } else if (Array.isArray(params.system)) {
    inputTokens += PER_MESSAGE_TOKEN_OVERHEAD;
    countBlocks(params.system);
  }

  for (const message of params.messages) {
    inputTokens += PER_MESSAGE_TOKEN_OVERHEAD;
    if (typeof message.content === "string") inputTokens += tokenizer.count(message.content);
    else if (Array.isArray(message.content)) countBlocks(message.content);
  }

  for (const tool of params.tools ?? []) {
    inputTokens += estimateToolDefinitionTokens(tokenizer, tool);
  }

  // Worst case: the model spends the whole max_tokens budget on output.
  const costUSD = computeCostUSD(info?.cost, { inputTokens, outputTokens: params.max_tokens });
  return costUSD === undefined ? { inputTokens } : { inputTokens, costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * The SDK targets this endpoint declares. The `@anthropic-ai/sdk`
 * `MessageCreateParams` are wire-shaped, so the formatter is the identity —
 * assignability is asserted in `test/types/anthropic.test-d.ts`, which is why
 * `src/` never imports the SDK.
 *
 * Written as a `type` (not an `interface`) and kept in lockstep with the
 * object literal in `finalize`: an `interface extends Record<string, …>` would
 * inherit a string index signature and collapse `keyof` to `string`, making
 * `.toSdk("anything")` type-check. See `SdkFormatters` in core/request.ts.
 */
export type ChatSdkTargets<T extends MessagesBody = MessagesBody> = {
  anthropic: () => T;
  "ai-sdk": () => AiSdkChatResult;
};

/**
 * `.toApi(provider)` for `anthropic.chat`, built once from the generated
 * availability table.
 *
 * Every static target anthropic's availability data names (openrouter,
 * vercel) speaks the OpenAI chat-completions dialect, so this endpoint
 * declares exactly one decoder — which is the flagship path:
 * `chat({ model: "claude-opus-5", … }).toApi("openrouter")` respells the
 * id to `anthropic/claude-opus-5`, translates the body to chat-completions,
 * and lists what the crossing cost on `.warnings`.
 *
 * `amazon-bedrock` is in the data too but is factory-configured (it needs a
 * region), so it is excluded from the one-argument `.toApi` union; the
 * bedrock-converse codec is deferred with it.
 */
const retargetMessages = createToApi<MessagesBody, ChatIR>({
  from: "anthropic-messages",
  endpoint: "anthropic.chat",
  modelId: (body) => body.model,
  availability,
  encode: encodeAnthropic,
  decoders: { "openai-chat": decodeOpenAIChat },
  // Layers 1 + 3 against the TARGET (design-types §4.4): a retargeted body
  // carrying a param the destination denies is a named error here rather than
  // a 400 on the wire. Layers 2 and 4 need the target's catalog and stay out.
  targetValidation: targetValidationFor,
});

/** `.toSdk("ai-sdk")`: the same encoder, decoded to `generateText` options. */
const toAiSdk = createAiSdkChat<MessagesBody>({
  endpoint: "anthropic.chat",
  provider: "anthropic",
  encode: encodeAnthropic,
});

function finalize(params: MessagesBody): Validated<MessagesBody, ChatSdkTargets> {
  const body = { ...params };
  const request: RequestMeta = {
    url: MESSAGES_URL,
    method: "POST",
    headers: { ...JSON_HEADERS, "anthropic-version": ANTHROPIC_VERSION },
  };
  return toValidated(body, request, {
    sdk: { anthropic: () => body, "ai-sdk": () => toAiSdk(body) },
    api: retargetMessages(body),
  });
}

const validator = createValidator<MessagesBody, Validated<MessagesBody, ChatSdkTargets>>({
  endpoint: "anthropic.chat",
  schema: messagesSchema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: chatConstraints,
  familyRules: chatFamilyRules,
  checks: [checkCapabilities, checkThinkingCompatibility, checkImageMedia],
  estimate: estimateMessages,
  promptPath: ["messages"],
  finalize,
});

// ---------------------------------------------------------------------------
// Per-model narrowing (Tier A)
//
// Three facts this endpoint already refuses at call time, moved to compile
// time. Each is DERIVED — from the deny table or from the catalog — so no
// hand-copied id list exists to drift, and `chat.test.ts` pins the resolved
// unions so a `bun run codegen` that flips a flag surfaces as a test diff
// rather than as a silent break in a caller's code.
//
// Deliberately NOT narrowed:
//
// - `top_p`. The rule is `>= 0.99`, and a numeric lower bound has no honest
//   literal type: `0.99 | 1` would refuse documented values.
// - `tools` / `thinking` off `toolCall: false` / `reasoning: false`. Both flags
//   are `false` for zero models in the Anthropic catalog today, so an arm keyed
//   on them would be dead code dressed as a guarantee.
//
// The one false positive worth knowing about: a shared base object widens
// `temperature: 1` to `number`, so `chat({ ...base, model: "claude-opus-5" })`
// needs `1 as const`. Accepted knowingly — the alternative is not catching the
// literal case either.
// ---------------------------------------------------------------------------

/**
 * The generation whose sampling params were removed. `keyof typeof
 * chatConstraints` rather than a second list: the deny table is already the
 * single source for `top_k`, and `checkCapabilities` is already the single
 * source for `temperature` via the catalog flag. Both resolve to the same five
 * ids today, and the test that pins them says so.
 */
type TopKRemovedModelId = Extract<keyof typeof chatConstraints, string>;

/** Models the catalog marks `temperature: false` — only the default 1.0 is accepted. */
type FixedSamplingModelId = ModelsWhereFalse<typeof models, "temperature">;

/**
 * `checkThinkingCompatibility` refuses `thinking: {type: "disabled"}` here: the
 * model always thinks. Snapshots (`claude-fable-5-20260601`) stay open through
 * `model`'s own `(string & {})` tail, exactly as `isModelOrSnapshot` allows.
 */
type ThinkingAlwaysOnModelId = "claude-fable-5";

/**
 * `MessagesBody` with the three per-model fields replaced for one model id.
 *
 * A **replacement**, not an intersection: intersecting `temperature?: 1` with
 * the base's `temperature?: number` gives `number`, which is the whole
 * narrowing discharged. Refusals are spelled `never` rather than omitted so
 * the spread/composition idiom (`{ ...base, model }`) keeps working — the key
 * still completes, it simply refuses every value.
 */
export type MessagesArm<M extends string> = Omit<
  MessagesBody,
  "model" | "temperature" | "top_k" | "thinking"
> & {
  model: M;
  temperature?: M extends FixedSamplingModelId ? 1 : number;
  top_k?: M extends TopKRemovedModelId ? never : number;
  thinking?: M extends ThinkingAlwaysOnModelId
    ? Exclude<NonNullable<MessagesBody["thinking"]>, { type: "disabled" }>
    : MessagesBody["thinking"];
};

/** Registry-instantiable form of this endpoint's generic result. */
export interface AnthropicChatResultKind extends ValidatorResultKind {
  // `& MessagesArm<…>` is what keeps the composition idiom compiling: without
  // it, a params object built by `unmodel/chat`'s registry no longer satisfies
  // the arm and the whole result collapses. Verified: 3 spurious errors → 0.
  readonly output: this["input"] extends MessagesBody
    ? Validated<
        this["input"] & MessagesArm<this["input"]["model"] & string>,
        ChatSdkTargets<this["input"]>,
        AnthropicAvailability,
        this["input"]["model"] & string
      >
    : never;
}

/**
 * Validates params for POST /v1/messages. The result's enumerable properties
 * are the exact fetch body; `.toSdk("anthropic")` returns the wire-shaped body
 * (the official SDK's params are wire-shaped — assignability is asserted in
 * test/types/anthropic.test-d.ts, so src never imports the SDK) and
 * `.request` carries url/method/static headers — including the required
 * `anthropic-version: 2023-06-01`, which `/v1/messages` rejects the request
 * without. Auth is your job: Anthropic takes the key in an `x-api-key` header,
 * bare (no `Bearer`), which is the header the OpenAI-shaped providers do *not*
 * use.
 *
 * `.toSdk("ai-sdk")` returns the Vercel AI SDK's `generateText` options
 * (no `model` — you supply the provider instance; wrap tool schemas with
 * `withJsonSchemaTools` from `unmodel/ai-sdk`).
 *
 * `.toApi(provider)` offers exactly the providers the models.dev catalog says
 * serve this model — `.toApi("openai")` on a Claude request is a compile
 * error — and translates the body into the target's dialect, listing what the
 * crossing cost on the non-enumerable `.warnings`.
 */
export const chat = validator as unknown as {
  <M extends MessagesBody["model"], T extends MessagesArm<M>>(
    params: T & { model: M } & ExactKeys<T, MessagesBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, ChatSdkTargets<T & { model: M }>, AnthropicAvailability, M & string>;
  safe<M extends MessagesBody["model"], T extends MessagesArm<M>>(
    params: T & { model: M } & ExactKeys<T, MessagesBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<T, ChatSdkTargets<T & { model: M }>, AnthropicAvailability, M & string>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
} & ValidatorResultKindCarrier<AnthropicChatResultKind> & ValidatorProviderCarrier<"anthropic">;
