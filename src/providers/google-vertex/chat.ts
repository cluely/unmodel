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
import type { GoogleContent, GoogleThinkingLevel, GoogleTool } from "../google/wire";
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
// checkCapabilities runs the same catalog-flag rules as google/chat.ts's
// (private there; see the schema note in ./wire.ts) but is not a copy of it:
// its tool and output bounds read the Vertex tables below, and its
// temperature rule defers to the per-model sampling tables.
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
    checkBuiltinTools(params.tools, model, ctx);
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

  const id = stripModelPath(model);
  if (Object.hasOwn(GEMINI_4_LONG_DECODE_GUIDES, id)) {
    checkLongDecodeOutput(
      config.maxOutputTokens,
      info.limit.output,
      model,
      GEMINI_4_LONG_DECODE_GUIDES[id as keyof typeof GEMINI_4_LONG_DECODE_GUIDES],
      ctx,
    );
    return;
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

/**
 * `tools` on a model without function calling. An id with no
 * SUPPORTED_BUILTIN_TOOLS row refuses `tools` outright; an id with one refuses
 * every tool key its page does not mark Supported, one issue per key.
 */
function checkBuiltinTools(tools: readonly GoogleTool[], model: string, ctx: PipelineContext): void {
  const id = stripModelPath(model);
  if (!Object.hasOwn(SUPPORTED_BUILTIN_TOOLS, id)) {
    ctx.report({
      code: "unsupported_capability",
      path: ["tools"],
      model,
      message: `"${model}" does not support tool/function calling; remove \`tools\`.`,
    });
    return;
  }
  const rule = SUPPORTED_BUILTIN_TOOLS[id as keyof typeof SUPPORTED_BUILTIN_TOOLS];
  const supported: readonly string[] = rule.tools;
  tools.forEach((tool, i) => {
    for (const [key, value] of Object.entries(tool)) {
      if (value === undefined || supported.includes(key)) continue;
      ctx.report({
        code: "unsupported_capability",
        path: ["tools", i, key],
        model,
        message:
          key === "functionDeclarations"
            ? `"${model}" does not support function calling; remove \`tools[${i}].functionDeclarations\`. Of the tools, it supports only ${supported.join(", ")}.`
            : `\`tools[${i}].${key}\` is not supported by "${model}" on Vertex; of the tools, it supports only ${supported.join(", ")}.`,
        meta: { supported: [...supported], source: rule.source },
      });
    }
  });
}

/**
 * Gemini 4 `maxOutputTokens`: an error only above the long-decode ceiling, and
 * a warning between one segment's output and that ceiling, because the URL
 * this module builds is /v1/ and long decode is v1beta1-only.
 */
function checkLongDecodeOutput(
  maxOutputTokens: number | undefined,
  segmentLimit: number | undefined,
  model: string,
  source: string,
  ctx: PipelineContext,
): void {
  if (maxOutputTokens === undefined) return;
  if (maxOutputTokens > GEMINI_4_MAX_OUTPUT_TOKENS) {
    ctx.report({
      code: "over_output_limit",
      path: ["generationConfig", "maxOutputTokens"],
      model,
      message: `\`generationConfig.maxOutputTokens\` (${maxOutputTokens}) exceeds the ${GEMINI_4_MAX_OUTPUT_TOKENS}-token long-decode ceiling of "${model}"; Vertex returns HTTP 400 above it.`,
      meta: { limit: GEMINI_4_MAX_OUTPUT_TOKENS, value: maxOutputTokens, source },
    });
    return;
  }
  if (segmentLimit === undefined || segmentLimit <= 0 || maxOutputTokens <= segmentLimit) return;
  ctx.report({
    code: "over_output_limit",
    severity: "warning",
    path: ["generationConfig", "maxOutputTokens"],
    model,
    message:
      `\`generationConfig.maxOutputTokens\` (${maxOutputTokens}) is above the catalog's ${segmentLimit}-token per-segment output for "${model}". ` +
      `Output past one segment takes long decode, and \`continuation_token\` is supported only in the v1beta1 API, while \`.request.url\` targets /v1/. ` +
      `Send it through \`.toSdk("google-vertex")\` (the Gen AI SDK uses v1beta1 by default) or a /v1beta1/ REST path. The request is accepted as written.`,
    meta: { limit: segmentLimit, ceiling: GEMINI_4_MAX_OUTPUT_TOKENS, value: maxOutputTokens, source },
  });
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

/** The Vertex developer guides, one per Gemini 4 id: `${VERTEX_GUIDES_DOCS_URL}/<id>`. */
const VERTEX_GUIDES_DOCS_URL = "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides";

/**
 * Built-in tools a model page marks Supported although function calling is
 * not (the catalog's `toolCall: false`). Retrieved 2026-11-13. Every other
 * tool key stays refused on these ids, `functionDeclarations` included, and a
 * `toolCall: false` id with no row here refuses `tools` outright.
 *
 * - `gemini-nano-banana-2.1` (`/nano-banana-2-1`): "Grounding Google Search,
 *   Image search Supported"; "Function calling Not supported", "Code
 *   execution Not supported", "URL context Not supported". Image search is
 *   not a separate key: the grounding guide enables it as `{ "googleSearch":
 *   { "searchTypes": { "imageSearch": {}, "webSearch": {} } } }`
 *   (…/models/grounding/grounding-with-google-search).
 * - `gemini-3-pro-image` (`/3-pro-image`) and `gemini-3.1-flash-image`
 *   (`/3-1-flash-image`): "Grounding Google Search Supported"; function
 *   calling, code execution and URL context "Not supported".
 *
 * `gemini-2.5-flash-image` has no row on purpose: its page reads "Grounding
 * Not supported", like every other tool on it.
 */
const SUPPORTED_BUILTIN_TOOLS = {
  "gemini-nano-banana-2.1": { tools: ["googleSearch"], source: `${VERTEX_GEMINI_DOCS_URL}/nano-banana-2-1` },
  "gemini-3-pro-image": { tools: ["googleSearch"], source: `${VERTEX_GEMINI_DOCS_URL}/3-pro-image` },
  "gemini-3.1-flash-image": { tools: ["googleSearch"], source: `${VERTEX_GEMINI_DOCS_URL}/3-1-flash-image` },
} as const satisfies Record<string, { tools: readonly (keyof GoogleTool)[]; source: string }>;

/**
 * Gemini 4 long decode: the `maxOutputTokens` ceiling, above the catalog's
 * per-segment `limit.output` (which stays the figure `estimate()` bills when
 * no `maxOutputTokens` is sent). Retrieved 2026-11-13.
 *
 * - All three model pages: "Maximum output tokens 1,048,576", and "you can
 *   extend output up to 1,048,576 tokens (minus your input tokens) using long
 *   decodes".
 * - All three developer guides (`${VERTEX_GUIDES_DOCS_URL}/gemini-4-<name>`):
 *   "setting `max_output_tokens` greater than `1,048,576` returns an HTTP
 *   `400` error." Argon's and Carbon's: "Set `max_output_tokens` greater than
 *   65,536 (streaming) or 32,768 (non-streaming) up to 1,048,576"; Hydrogen's:
 *   "set `max_output_tokens` greater than 65,536 (up to 1,048,576) for
 *   streaming or non-streaming requests." Carbon's guide samples send
 *   `maxOutputTokens` 131072 (REST, `/v1beta1/…:generateContent`) and 256000
 *   (Gen AI SDK).
 * - The catch every model page names: "known issue: `continuation_token` is
 *   supported only in the `v1beta1` API, which the Google Gen AI SDK uses by
 *   default". `.request.url` is a /v1/ URL, and what /v1/ does with a value
 *   past one segment is undocumented, so that range warns and never refuses.
 */
const GEMINI_4_MAX_OUTPUT_TOKENS = 1_048_576;

/** The guide that states {@link GEMINI_4_MAX_OUTPUT_TOKENS}, per Gemini 4 id. */
const GEMINI_4_LONG_DECODE_GUIDES = {
  "gemini-4-argon": `${VERTEX_GUIDES_DOCS_URL}/gemini-4-argon#long-decodes`,
  "gemini-4-carbon": `${VERTEX_GUIDES_DOCS_URL}/gemini-4-carbon#long-decodes`,
  "gemini-4-hydrogen": `${VERTEX_GUIDES_DOCS_URL}/gemini-4-hydrogen#long-decodes`,
} as const satisfies Record<string, string>;

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
// Substrate signpost — the catalog rows this endpoint does not serve
//
// The google-vertex catalog is Vertex's whole model garden as models.dev files
// it, so `GoogleVertexTextModelId` carries Claude, Mistral, Grok and the
// `-maas` open models beside Gemini, and each of them validated clean into a
// `publishers/google/models/{model}:generateContent` URL. Vertex serves them
// on other routes.
//
// A WARNING, not an error, for the reason openai's `checkChatCompletionsRoute`
// gives: wire-truth (docs/decisions.md §1) says the substrate never refuses
// what the API might fulfil, and a caller who knows better must be able to
// send. The table holds only the families the package already records:
// SURFACE_RULES in scripts/availability.ts (`-maas`, `xai/`, `claude`) and the
// google-vertex deny list in data/availability-overrides.json (`claude`,
// `mistral-`, `codestral-`). ./index.test.ts pins it against the generated
// availability data and that deny list. Pages retrieved 2026-11-13.
// ---------------------------------------------------------------------------

interface NonGeminiRoute {
  match: RegExp;
  /** The route Vertex documents for these ids. */
  route: string;
  source: string;
}

/** `POST …/endpoints/openapi/chat/completions`, as the MaaS page writes it. */
const OPENAPI_CHAT_ROUTE = "POST …/locations/{location}/endpoints/openapi/chat/completions (OpenAI-compatible)";

const NON_GEMINI_ROUTES: readonly NonGeminiRoute[] = [
  {
    // "https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/endpoints/openapi/chat/completions"
    match: /-maas$/,
    route: OPENAPI_CHAT_ROUTE,
    source: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/call-open-model-apis",
  },
  {
    // "Grok models use the OpenAI-compatible chat completions and Responses
    // APIs, so the request path uses `endpoints/openapi`."
    match: /^xai\//,
    route: OPENAPI_CHAT_ROUTE,
    source: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/use-partner-models",
  },
  {
    // The Claude sample: "/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/anthropic/models/${MODEL_ID}:rawPredict",
    // its body `messages` + `max_tokens` + "anthropic_version": "vertex-2023-10-16".
    match: /claude/,
    route: "POST …/publishers/anthropic/models/{model}:rawPredict (Anthropic Messages body)",
    source: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/use-partner-models",
  },
  {
    // "…/publishers/mistralai/models/MODEL:rawPredict" and ":streamRawPredict"
    match: /^(?:mistral-|codestral-)/,
    route: "POST …/publishers/mistralai/models/{model}:rawPredict (or :streamRawPredict)",
    source: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/mistral",
  },
];

/**
 * Names the route a non-Gemini id is actually served on. Reads the bare id
 * only, never the catalog row, so an id the catalog does not carry yet
 * (`xai/grok-5`) is answered too.
 */
function checkPartnerRoute(
  params: VertexGenerateContentBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const id = stripModelPath(params.model);
  const entry = NON_GEMINI_ROUTES.find((candidate) => candidate.match.test(id));
  if (entry === undefined) return;
  ctx.report({
    code: "unsupported_capability",
    severity: "warning",
    path: ["model"],
    model: params.model,
    message:
      `"${params.model}" is not a Gemini model: Vertex serves it on ${entry.route}, not on the ` +
      `publishers/google/models/{model}:generateContent URL in \`.request.url\`, so this request is expected to fail there. ` +
      `unmodel has no validator for that route. The request is sent as written all the same.`,
    meta: { route: entry.route, source: entry.source },
  });
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
    checks: [
      checkPartnerRoute,
      checkCapabilities,
      checkMediaModalities,
      checkGemini4Thinking,
      checkSamplingParams,
    ],
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
