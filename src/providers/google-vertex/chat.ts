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
import type { GoogleContent } from "../google/wire";
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
// Checks — catalog-driven only. The google module's hand-written media
// constraint tables (formats/durations/inline caps) are sourced from Gemini
// API docs (ai.google.dev) and are deliberately NOT applied here: the Vertex
// docs were not re-verified for those limits, and unproven facts stay out.
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

  if (config.temperature !== undefined && info.temperature === false) {
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
    checks: [checkCapabilities, checkMediaModalities],
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
