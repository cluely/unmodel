import { createValidator, type PipelineContext } from "../../core/pipeline";
import {
  JSON_HEADERS,
  toValidated,
  type ExactKeys,
  type RequestMeta,
  type Validated,
} from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCostUSD } from "../../core/cost";
import { estimateToolDefinitionTokens, PER_MESSAGE_TOKEN_OVERHEAD } from "../../core/tokens";
import { GEMINI_IMAGE_TOKENS } from "../google";
import type { GoogleContent, GoogleThinkingLevel } from "../google/wire";
import { models } from "../../catalog/google-vertex.gen";
import { createToApi } from "../../core/translate/retarget";
import { targetValidationFor } from "../../retarget/target-constraints";
import type { AiSdkChatResult } from "../../core/translate/ai-sdk";
import { createAiSdkChat } from "../../core/translate/ai-sdk";
import { encodeGemini } from "../google/interop";
import type { GenerateContentBody } from "../google/wire";
import { availability } from "../../catalog/availability/google-vertex.gen";
import type { GoogleVertexAvailability } from "../../catalog/availability/google-vertex.gen";
import { vertexGenerateContentSchema } from "./wire";
import type { VertexGenerateContentBody } from "./wire";

// The wire type and the zod schema live in ./wire.ts (a leaf that imports
// only zod and the sibling Gemini wire leaf), so translation machinery can
// reach the dialect without pulling in this validator. Re-exported here so
// the module's public surface is unchanged.
export type { VertexGenerateContentBody } from "./wire";

// ---------------------------------------------------------------------------
// SDK view — @google/genai with `vertexai: true` takes the same
// { model, contents, config } params as the Gemini API client; `labels` is a
// GenerateContentConfig field ("Labels with user-defined metadata to break
// down billed charges", vertexai-only). Mirrors the google module's mapping.
// ---------------------------------------------------------------------------

type SdkConfigPart<T, K extends string> = T extends Record<K, infer V> ? Record<K, V> : {};

export type VertexGenerateContentSdkParams<T extends VertexGenerateContentBody> = {
  model: T["model"];
  contents: T["contents"];
  config?: (T extends { generationConfig: infer G } ? G : {}) &
    SdkConfigPart<T, "systemInstruction"> &
    SdkConfigPart<T, "tools"> &
    SdkConfigPart<T, "toolConfig"> &
    SdkConfigPart<T, "safetySettings"> &
    SdkConfigPart<T, "cachedContent"> &
    SdkConfigPart<T, "labels">;
};

// ---------------------------------------------------------------------------
// Checks — catalog-driven, plus the per-model rules a Vertex model page states
// itself (the tables below the capability checks). The google module's
// hand-written constraint tables (media formats/durations/inline caps, the
// thinking-level rules) are sourced from Gemini API docs (ai.google.dev) and
// are deliberately NOT applied here: the two surfaces differ where both were
// read (a lone `thinkingBudget` on Gemini 4 is an API warning there and a 400
// here), and unproven facts stay out.
// checkCapabilities is duplicated from google/chat.ts (private
// there; see the schema note in ./wire.ts).
// ---------------------------------------------------------------------------

type MediaKind = "image" | "audio" | "video" | "pdf";

/**
 * Users paste "models/gemini-…" ids or full resource paths like
 * "publishers/google/models/gemini-…"; the bare id is canonical for the
 * catalog and the endpoint URL.
 */
function stripModelPath(model: string): string {
  const marker = model.lastIndexOf("models/");
  return marker === -1 ? model : model.slice(marker + "models/".length);
}

function mediaKindOf(mimeType: string): MediaKind | undefined {
  const mime = mimeType.trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return undefined;
}

function checkCapabilities(
  params: VertexGenerateContentBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  const model = params.model;

  if (params.tools !== undefined && params.tools.length > 0 && !info.toolCall) {
    ctx.report({
      code: "unsupported_capability",
      path: ["tools"],
      model,
      message: `"${model}" does not support tool/function calling; remove \`tools\`.`,
    });
  }

  const config = params.generationConfig;
  if (config === undefined) return;

  for (const key of ["responseSchema", "responseJsonSchema"] as const) {
    // Tri-state, like every other structured-output check in the library:
    // absent means "the catalog has no answer" and must not fail a request.
    // Only an explicit `false` refuses.
    if (config[key] !== undefined && info.structuredOutput === false) {
      ctx.report({
        code: "unsupported_capability",
        path: ["generationConfig", key],
        model,
        message: `"${model}" does not support structured output; remove \`generationConfig.${key}\`.`,
      });
    }
  }

  // A per-model sampling rule below is the authority where one exists.
  if (
    config.temperature !== undefined &&
    info.temperature === false &&
    !hasSamplingRule(stripModelPath(model))
  ) {
    ctx.report({
      code: "unsupported_param",
      path: ["generationConfig", "temperature"],
      model,
      message: `\`generationConfig.temperature\` is not supported by "${model}".`,
    });
  }

  if (config.thinkingConfig !== undefined && info.reasoning === false) {
    ctx.report({
      code: "unsupported_capability",
      path: ["generationConfig", "thinkingConfig"],
      model,
      message: `"${model}" is not a reasoning model; remove \`generationConfig.thinkingConfig\`.`,
    });
  }

  const outputLimit = info.limit.output;
  if (
    config.maxOutputTokens !== undefined &&
    outputLimit !== undefined &&
    outputLimit > 0 &&
    config.maxOutputTokens > outputLimit
  ) {
    ctx.report({
      code: "over_output_limit",
      path: ["generationConfig", "maxOutputTokens"],
      model,
      message: `\`generationConfig.maxOutputTokens\` (${config.maxOutputTokens}) exceeds the ${outputLimit}-token output limit of "${model}".`,
      meta: { limit: outputLimit, value: config.maxOutputTokens },
    });
  }
}

/** Media kind vs the model's input modalities (e.g. video sent to a text+image model). */
function checkMediaModalities(
  params: VertexGenerateContentBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  params.contents.forEach((content, i) => {
    content.parts.forEach((part, j) => {
      const mimeType = part.inlineData?.mimeType ?? part.fileData?.mimeType;
      if (mimeType === undefined) return;
      const kind = mediaKindOf(mimeType);
      if (kind === undefined || info.modalities.input.includes(kind)) return;
      ctx.report({
        code: "unsupported_capability",
        path: ["contents", i, "parts", j],
        model: params.model,
        message: `"${params.model}" does not accept ${kind} input ("${mimeType}"); its input modalities are ${info.modalities.input.join(", ")}.`,
        meta: { mimeType, kind, inputModalities: [...info.modalities.input] },
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Per-model rules, each from the model's own Vertex page (retrieved
// 2026-11-12). Matched by bare id, so the `models/…` and
// `publishers/google/models/…` spellings are covered too.
// ---------------------------------------------------------------------------

/** The Vertex Gemini model pages, one per id: `${VERTEX_GEMINI_DOCS_URL}/<page>`. */
const VERTEX_GEMINI_DOCS_URL = "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini";

/**
 * Gemini 4: the thinking levels each page lists, and the rule all three pages
 * state in the same words — "Setting thinking_budget or
 * thinking_level="MINIMAL" returns an HTTP 400 validation error." Any
 * `thinkingBudget` is refused, alone or not, which is stricter than the Gemini
 * API (unmodel/google), where a lone budget maps to the nearest level with a
 * warning.
 *
 * - `gemini-4-argon` (`/4-argon`): "Supports thinking levels LOW , MEDIUM
 *   (default), and HIGH ."
 * - `gemini-4-carbon` (`/4-carbon`): "4 Carbon supports thinking levels LOW ,
 *   MEDIUM (default on gemini-4-carbon ), and HIGH"
 * - `gemini-4-hydrogen` (`/4-hydrogen`): "Hydrogen supports thinking levels
 *   LOW , MEDIUM , HIGH (default), and XHIGH ."
 *
 * `XHIGH` on argon or carbon is not refused: neither page says it errors. It
 * draws a warning, because neither page lists it.
 */
const GEMINI_4_THINKING_LEVELS = {
  "gemini-4-argon": { levels: ["LOW", "MEDIUM", "HIGH"], source: `${VERTEX_GEMINI_DOCS_URL}/4-argon` },
  "gemini-4-carbon": { levels: ["LOW", "MEDIUM", "HIGH"], source: `${VERTEX_GEMINI_DOCS_URL}/4-carbon` },
  "gemini-4-hydrogen": {
    levels: ["LOW", "MEDIUM", "HIGH", "XHIGH"],
    source: `${VERTEX_GEMINI_DOCS_URL}/4-hydrogen`,
  },
} as const satisfies Record<string, { levels: readonly GoogleThinkingLevel[]; source: string }>;

/** The `generationConfig` sampling fields a per-model rule can name. */
type SamplingParam = "temperature" | "topP" | "topK" | "seed" | "logprobs";

/**
 * Sampling fields a model page says return an API error.
 *
 * - `gemini-nano-banana-2.1` (`/nano-banana-2-1`): "The seed , topK , logprobs
 *   , temperature , and topP parameters aren't supported for Nano Banana 2.1.
 *   Setting any of these parameters returns an API error." `logprobs` is the
 *   integer field; `responseLogprobs` is not named, so it is not refused.
 */
const REFUSED_SAMPLING_PARAMS = {
  "gemini-nano-banana-2.1": {
    params: ["temperature", "topP", "topK", "seed", "logprobs"],
    source: `${VERTEX_GEMINI_DOCS_URL}/nano-banana-2-1`,
  },
} as const satisfies Record<string, { params: readonly SamplingParam[]; source: string }>;

/**
 * Sampling fields a model page says the API ignores: the request is fulfilled
 * and the model's fixed value replaces the one sent, so these warn and never
 * refuse. This overrides the generated rows' `temperature: false`, which would
 * otherwise refuse a request the API fulfils.
 *
 * - `gemini-4-argon`, `gemini-4-carbon`, `gemini-4-hydrogen` (`/4-argon`,
 *   `/4-carbon`, `/4-hydrogen`): "Custom values for sampling parameters (
 *   temperature , top_p , and top_k ) are ignored." Carbon and Hydrogen add
 *   "Temperature: 1.0 (fixed; custom values ignored) topP: 0.95 (fixed; custom
 *   values ignored) topK: 64 (fixed; custom values ignored)".
 */
const IGNORED_SAMPLING_PARAMS = {
  "gemini-4-argon": { params: ["temperature", "topP", "topK"], source: `${VERTEX_GEMINI_DOCS_URL}/4-argon` },
  "gemini-4-carbon": { params: ["temperature", "topP", "topK"], source: `${VERTEX_GEMINI_DOCS_URL}/4-carbon` },
  "gemini-4-hydrogen": {
    params: ["temperature", "topP", "topK"],
    source: `${VERTEX_GEMINI_DOCS_URL}/4-hydrogen`,
  },
} as const satisfies Record<string, { params: readonly SamplingParam[]; source: string }>;

/** True when a per-model sampling table owns the `temperature` decision for this id. */
function hasSamplingRule(id: string): boolean {
  return Object.hasOwn(REFUSED_SAMPLING_PARAMS, id) || Object.hasOwn(IGNORED_SAMPLING_PARAMS, id);
}

/**
 * Gemini 4 `thinkingConfig`: any `thinkingBudget`, and `thinkingLevel` MINIMAL,
 * are a 400; `XHIGH` where the page does not list it is a warning.
 */
function checkGemini4Thinking(
  params: VertexGenerateContentBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const thinking = params.generationConfig?.thinkingConfig;
  if (thinking === undefined) return;
  const id = stripModelPath(params.model);
  if (!Object.hasOwn(GEMINI_4_THINKING_LEVELS, id)) return;
  const { levels, source } = GEMINI_4_THINKING_LEVELS[id as keyof typeof GEMINI_4_THINKING_LEVELS];

  if (thinking.thinkingBudget !== undefined) {
    ctx.report({
      code: "unsupported_param",
      path: ["generationConfig", "thinkingConfig", "thinkingBudget"],
      model: params.model,
      message: `\`generationConfig.thinkingConfig.thinkingBudget\` is refused by "${params.model}" on Vertex (HTTP 400); set \`thinkingLevel\` to one of ${levels.join(", ")} instead.`,
      meta: { allowed: [...levels], source },
    });
  }

  const level = thinking.thinkingLevel;
  if (level !== undefined && level.toUpperCase() === "MINIMAL") {
    ctx.report({
      code: "invalid_enum_value",
      path: ["generationConfig", "thinkingConfig", "thinkingLevel"],
      model: params.model,
      message: `\`generationConfig.thinkingConfig.thinkingLevel: "${level}"\` is refused by "${params.model}" on Vertex (HTTP 400); it accepts ${levels.join(", ")}.`,
      meta: { value: level, allowed: [...levels], source },
    });
  }

  const documented: readonly string[] = levels;
  if (level !== undefined && level.toUpperCase() === "XHIGH" && !documented.includes("XHIGH")) {
    ctx.report({
      code: "invalid_enum_value",
      severity: "warning",
      path: ["generationConfig", "thinkingConfig", "thinkingLevel"],
      model: params.model,
      message:
        `\`generationConfig.thinkingConfig.thinkingLevel: "${level}"\` is documented on Vertex only for gemini-4-hydrogen; ` +
        `"${params.model}"'s page lists ${levels.join(", ")}. No page says it returns an error, so the request is not refused.`,
      meta: { value: level, documented: [...levels], source },
    });
  }
}

/** Sampling fields a model page says the API refuses (an error) or ignores (a warning). */
function checkSamplingParams(
  params: VertexGenerateContentBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const config = params.generationConfig;
  if (config === undefined) return;
  const id = stripModelPath(params.model);

  if (Object.hasOwn(REFUSED_SAMPLING_PARAMS, id)) {
    const rule = REFUSED_SAMPLING_PARAMS[id as keyof typeof REFUSED_SAMPLING_PARAMS];
    for (const param of rule.params) {
      if (config[param] === undefined) continue;
      ctx.report({
        code: "unsupported_param",
        path: ["generationConfig", param],
        model: params.model,
        message: `\`generationConfig.${param}\` is refused by "${params.model}" on Vertex (an API error); its sampling is fixed, so remove it.`,
        meta: { source: rule.source },
      });
    }
  }

  if (Object.hasOwn(IGNORED_SAMPLING_PARAMS, id)) {
    const rule = IGNORED_SAMPLING_PARAMS[id as keyof typeof IGNORED_SAMPLING_PARAMS];
    for (const param of rule.params) {
      if (config[param] === undefined) continue;
      ctx.report({
        code: "unsupported_param",
        severity: "warning",
        path: ["generationConfig", param],
        model: params.model,
        message: `\`generationConfig.${param}\` is ignored by "${params.model}" on Vertex: the request is accepted and the model's fixed value replaces the one sent.`,
        meta: { ignored: true, source: rule.source },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Estimation — mirrors google/chat.ts (private there), minus the
// per-model imageTokens constraint lookup: the flat GEMINI_IMAGE_TOKENS
// heuristic is used for every image part.
// ---------------------------------------------------------------------------

function estimate(params: VertexGenerateContentBody, info: ModelInfo | undefined, ctx: PipelineContext) {
  let inputTokens = 0;

  const countContent = (content: GoogleContent): void => {
    inputTokens += PER_MESSAGE_TOKEN_OVERHEAD;
    for (const part of content.parts) {
      if (part.text !== undefined) inputTokens += ctx.tokenizer.count(part.text);
      const mimeType = part.inlineData?.mimeType ?? part.fileData?.mimeType;
      if (mimeType !== undefined && mediaKindOf(mimeType) === "image") inputTokens += GEMINI_IMAGE_TOKENS;
      if (part.functionCall !== undefined) {
        inputTokens += estimateToolDefinitionTokens(ctx.tokenizer, part.functionCall);
      }
      if (part.functionResponse !== undefined) {
        inputTokens += estimateToolDefinitionTokens(ctx.tokenizer, part.functionResponse);
      }
    }
  };

  for (const content of params.contents) countContent(content);
  if (params.systemInstruction !== undefined) countContent(params.systemInstruction);
  for (const tool of params.tools ?? []) {
    inputTokens += estimateToolDefinitionTokens(ctx.tokenizer, tool);
  }

  // Worst case: the model produces the full requested/possible output.
  const outputTokens = params.generationConfig?.maxOutputTokens ?? info?.limit.output ?? 0;
  const costUSD = computeCostUSD(info?.cost, { inputTokens, outputTokens });
  return costUSD === undefined ? { inputTokens } : { inputTokens, costUSD };
}

// ---------------------------------------------------------------------------
// URL + finalize: wire body (model stripped — it lives in the URL path) +
// .toSdk(target) + .request + .toApi(provider)
// ---------------------------------------------------------------------------

/**
 * Endpoint URL for one project/location/model. Regional locations use the
 * `{location}-aiplatform.googleapis.com` host; `"global"` uses the global
 * `aiplatform.googleapis.com` host. Verified against
 * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference
 * (checked 2026-08-13).
 */
export function generateContentUrl(project: string, location: string, model: string): string {
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${stripModelPath(model)}:generateContent`;
}

function buildSdkParams(
  model: string,
  body: Omit<VertexGenerateContentBody, "model">,
): Record<string, unknown> {
  const config: Record<string, unknown> = { ...(body.generationConfig ?? {}) };
  if (body.systemInstruction !== undefined) config.systemInstruction = body.systemInstruction;
  if (body.tools !== undefined) config.tools = body.tools;
  if (body.toolConfig !== undefined) config.toolConfig = body.toolConfig;
  if (body.safetySettings !== undefined) config.safetySettings = body.safetySettings;
  if (body.cachedContent !== undefined) config.cachedContent = body.cachedContent;
  if (body.labels !== undefined) config.labels = body.labels;
  const sdk: Record<string, unknown> = { model, contents: body.contents };
  if (Object.keys(config).length > 0) sdk.config = config;
  return sdk;
}

export interface GoogleVertexConfig {
  /** Google Cloud project id, e.g. "my-project". */
  project: string;
  /** Vertex region, e.g. "us-central1" — or "global" for the global endpoint. */
  location: string;
}

/**
 * The SDK targets this endpoint declares: `@google/genai` constructed with
 * `vertexai: true`, whose params are the same `{ model, contents, config }`
 * shape as the Gemini API client's.
 */
export type VertexChatSdkTargets<
  T extends VertexGenerateContentBody = VertexGenerateContentBody,
> =
  {
    "google-vertex": () => VertexGenerateContentSdkParams<T>;
    "ai-sdk": () => AiSdkChatResult;
  };

/**
 * `.toSdk("ai-sdk")`: Vertex speaks the Gemini dialect, so it reuses that
 * codec — import-graph rule 3, an endpoint module may reach another
 * provider's `interop.ts` and nothing else of theirs. `providerOptions` is
 * keyed `vertex`, which is the AI SDK's name for this provider (not the
 * models.dev id).
 */
const toAiSdk = createAiSdkChat<VertexGenerateContentBody>({
  endpoint: "google-vertex.chat",
  provider: "google-vertex",
  encode: (body, warn) => encodeGemini(body as unknown as GenerateContentBody, warn),
});

/**
 * `.toApi(provider)` for `google-vertex.chat`.
 *
 * Unlike the other endpoints migrated in this phase, this one has a *working*
 * v1 edge: the generated availability data maps every Vertex Gemini id to
 * `google`, which speaks the same gemini dialect and has a provider-wide
 * static URL — so `retargetSameDialect` handles it with no codec, no IR and no
 * round-trip risk.
 *
 * As with `google.chat`, the spec's `Body` is the *unstripped*
 * params (so `modelId` can read `model`) and `withModelId` drops it again,
 * because the model id belongs in the URL path, not the body.
 */
const retargetGenerateContent = createToApi<VertexGenerateContentBody>({
  from: "gemini",
  endpoint: "google-vertex.chat",
  modelId: (params) => stripModelPath(params.model),
  availability,
  withModelId: ({ model: _model, ...body }) => body,
  // Layers 1 + 3 against the TARGET (design-types §4.4).
  targetValidation: targetValidationFor,
});

/**
 * The chat validator surface, with `model` narrowed to the
 * google-vertex catalog union.
 */
export type GoogleVertexChat = {
  <T extends VertexGenerateContentBody>(
    params: T & ExactKeys<T, VertexGenerateContentBody>,
    options?: ValidateOptions<T>,
  ): Validated<
    Omit<T, "model">,
    VertexChatSdkTargets<T>,
    GoogleVertexAvailability,
    T["model"] & string
  >;
  safe<T extends VertexGenerateContentBody>(
    params: T & ExactKeys<T, VertexGenerateContentBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<
      Omit<T, "model">,
      VertexChatSdkTargets<T>,
      GoogleVertexAvailability,
      T["model"] & string
    >
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/**
 * Builds the chat validator bound to one project + location.
 * Targets `publishers/google/models/{model}` — Gemini models only (partner
 * models like Claude on Vertex use different endpoints/dialects).
 */
export function createChat(config: GoogleVertexConfig): GoogleVertexChat {
  const validator = createValidator<VertexGenerateContentBody, unknown>({
    endpoint: "google-vertex.chat",
    schema: vertexGenerateContentSchema,
    modelId: (params) => stripModelPath(params.model),
    catalog: models,
    checks: [checkCapabilities, checkMediaModalities, checkGemini4Thinking, checkSamplingParams],
    estimate,
    promptPath: ["contents"],
    finalize: (params) => {
      const { model, ...body } = params;
      const request: RequestMeta = {
        url: generateContentUrl(config.project, config.location, model),
        method: "POST",
        headers: JSON_HEADERS,
      };
      return toValidated(body, request, {
        sdk: {
          "google-vertex": () => buildSdkParams(model, body),
          // The encoder reads the model id off the body; it never reaches the
          // emitted options (the AI SDK takes a provider instance instead).
          "ai-sdk": () => toAiSdk({ model, ...body }),
        },
        // A fresh object, not the caller's `params`: `.toApi` is called later
        // and must not observe mutations they make to their own literal.
        api: retargetGenerateContent({ model, ...body }),
      });
    },
  });
  return validator as unknown as GoogleVertexChat;
}
