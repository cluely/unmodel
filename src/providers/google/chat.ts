import { constraintsFor, createValidator, type PipelineContext } from "../../core/pipeline";
import {
  JSON_HEADERS,
  toValidated,
  type ExactKeys,
  type RequestMeta,
  type Validated,
} from "../../core/request";
import { createToApi } from "../../core/translate/retarget";
import { targetValidationFor } from "../../retarget/target-constraints";
import type { AiSdkChatResult } from "../../core/translate/ai-sdk";
import { createAiSdkChat } from "../../core/translate/ai-sdk";
import type { ChatIR } from "../../core/translate/ir";
import { geminiSdkParams } from "../../core/translate/sdk-shapes";
import { encodeGemini } from "./interop";
// Import-graph rule 3: an endpoint module may reach another provider's
// `interop.ts` and nothing else of theirs — one codec module plus its
// type-only wire imports, not openai-compatible's schema/catalog/checks.
import { decodeOpenAIChat } from "../openai-compatible/interop";
import { availability } from "../../catalog/availability/google.gen";
import type { GoogleAvailability } from "../../catalog/availability/google.gen";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints, MediaRule } from "../../core/constraint-types";
import { computeCostUSD } from "../../core/cost";
import { estimateToolDefinitionTokens, PER_MESSAGE_TOKEN_OVERHEAD } from "../../core/tokens";
import { toBytes } from "../../core/media/bytes";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";
import { sniffImage, type SniffedImage } from "../../core/media/image";
import { chatModels } from "./tts-models";
import {
  GEMINI_IMAGE_ASPECT_RATIOS,
  GEMINI_IMAGE_ASPECT_RATIO_ENUM_NAMES,
  GEMINI_IMAGE_CONFIG_VERTEX_ONLY_KEYS,
  GEMINI_IMAGE_GENERATION_DOCS_URL,
  GEMINI_IMAGE_MODEL_RULES,
  GEMINI_IMAGE_SIZES,
  GEMINI_IMAGE_SIZE_ENUM_NAMES,
  GEMINI_IMAGE_TOKENS,
  GEMINI_LOGPROBS_RANGE,
  GEMINI_MAX_STOP_SEQUENCES,
  GEMINI_MEDIA_RESOLUTIONS,
  GEMINI_RESPONSE_MODALITIES,
  GEMINI_TEMPERATURE_RANGE,
  GEMINI_THINKING_LEVELS,
  GEMINI_TTS_DOCS_URL,
  GEMINI_TTS_MAX_SPEAKERS,
  GEMINI_TTS_MODEL_IDS,
  GEMINI_TTS_VOICES,
  GENERATE_CONTENT_API_DOCS_URL,
  GOOGLE_MEDIA_DOC_URLS,
  INLINE_PDF_MAX_BYTES,
  chatConstraints,
  chatFamilyRules,
} from "./constraints";
import { generateContentSchema } from "./wire";
import type { GenerateContentBody, GoogleContent, GooglePart, GoogleVoiceConfig } from "./wire";

// The wire types and the zod schema live in ./wire.ts (a leaf that imports
// only zod), so translation machinery can reach the dialect without pulling
// in this validator. Re-exported here so the module's public surface is
// unchanged.
export type {
  GoogleRole,
  GoogleInlineData,
  GoogleFileData,
  GoogleFunctionCall,
  GoogleFunctionResponse,
  GoogleExecutableCode,
  GoogleCodeExecutionResult,
  GoogleVideoMetadata,
  GoogleToolCall,
  GoogleToolResponse,
  GooglePart,
  GoogleContent,
  GoogleFunctionDeclaration,
  GoogleTool,
  GoogleFunctionCallingConfig,
  GoogleToolConfig,
  GoogleHarmCategory,
  GoogleHarmBlockThreshold,
  GoogleSafetySetting,
  GoogleThinkingLevel,
  GoogleThinkingConfig,
  GoogleModality,
  GooglePrebuiltVoiceConfig,
  GoogleVoiceConfig,
  GoogleSpeakerVoiceConfig,
  GoogleMultiSpeakerVoiceConfig,
  GoogleSpeechConfig,
  GoogleImageAspectRatio,
  GoogleImageAspectRatioEnumName,
  GoogleImageSize,
  GoogleImageSizeEnumName,
  GoogleImageConfig,
  GoogleTextResponseFormat,
  GoogleAudioResponseFormat,
  GoogleImageResponseFormat,
  GoogleResponseFormatConfig,
  GoogleGenerationConfig,
  GoogleServiceTier,
  GenerateContentBody,
} from "./wire";

// ---------------------------------------------------------------------------
// SDK view — @google/genai's ai.models.generateContent({ model, contents,
// config }) merges generationConfig fields into the TOP level of `config`,
// alongside systemInstruction/tools/toolConfig/safetySettings/cachedContent.
// The type is mapped from the caller's params so only keys actually passed
// appear. Caveat: the SDK declares TS enums for a few leaves (safety harm
// categories, mediaResolution, …); wire strings are runtime-identical but
// need a cast at the SDK call site when those fields are present.
// ---------------------------------------------------------------------------

type SdkConfigPart<T, K extends string> = T extends Record<K, infer V> ? Record<K, V> : {};

export type GenerateContentSdkParams<T extends GenerateContentBody> = {
  model: T["model"];
  contents: T["contents"];
  // `store` is deliberately absent: @google/genai has no config equivalent.
  config?: (T extends { generationConfig: infer G } ? G : {}) &
    SdkConfigPart<T, "systemInstruction"> &
    SdkConfigPart<T, "tools"> &
    SdkConfigPart<T, "toolConfig"> &
    SdkConfigPart<T, "safetySettings"> &
    SdkConfigPart<T, "cachedContent"> &
    SdkConfigPart<T, "serviceTier">;
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type MediaKind = "image" | "audio" | "video" | "pdf";
type RuledKind = Exclude<MediaKind, "pdf">;

/**
 * Users copy "models/gemini-…" ids from listModels; the bare id is canonical
 * for the catalog, constraint tables, and the endpoint URL. Shared with
 * ./generate-videos (same URL scheme, same "models/{model}:<verb>" routes).
 */
export function stripModelsPrefix(model: string): string {
  return model.startsWith("models/") ? model.slice("models/".length) : model;
}

const GENERATE_CONTENT_RULES = {
  constraints: chatConstraints,
  familyRules: chatFamilyRules,
} as const;

function mediaKindOf(mimeType: string): MediaKind | undefined {
  const mime = mimeType.trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return undefined;
}

/** "image/jpg;foo=bar" → "jpeg". */
function formatOfMime(mimeType: string): string | undefined {
  const subtype = mimeType.trim().toLowerCase().split(";")[0]?.split("/")[1];
  if (subtype === undefined || subtype === "") return undefined;
  return subtype === "jpg" ? "jpeg" : subtype;
}

function mediaRulesFor(modelId: string): Partial<Record<RuledKind, MediaRule>> {
  const merged: Partial<Record<RuledKind, MediaRule>> = {};
  for (const constraints of constraintsFor(GENERATE_CONTENT_RULES, stripModelsPrefix(modelId))) {
    for (const kind of ["image", "audio", "video"] as const) {
      const rule = constraints.media?.[kind];
      if (rule === undefined) continue;
      // Earlier (more specific) rules win field-by-field.
      merged[kind] = { ...rule, ...merged[kind] };
    }
  }
  return merged;
}

function imageTokensFor(modelId: string): number {
  for (const constraints of constraintsFor(GENERATE_CONTENT_RULES, stripModelsPrefix(modelId))) {
    if (constraints.imageTokens !== undefined) return constraints.imageTokens;
  }
  return GEMINI_IMAGE_TOKENS;
}

function checkCapabilities(params: GenerateContentBody, info: ModelInfo | undefined, ctx: PipelineContext): void {
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
    if (config[key] !== undefined && !info.structuredOutput) {
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

// ---------------------------------------------------------------------------
// generationConfig — documented ranges/enums, and the two generative-modality
// sub-configs (image generation and speech generation). All of these live
// nested under `generationConfig`, which the pipeline's generic Layer-3 pass
// never reaches, so they are enforced here.
// ---------------------------------------------------------------------------

/** Modality enum values are compared case-insensitively (the guides mix cases). */
function normalizeModality(value: unknown): string | undefined {
  return typeof value === "string" ? value.toUpperCase() : undefined;
}

const MODALITY_TO_CATALOG: Readonly<Record<string, "text" | "image" | "audio">> = {
  TEXT: "text",
  IMAGE: "image",
  AUDIO: "audio",
};

function requestedModalities(params: GenerateContentBody): string[] {
  const requested = params.generationConfig?.responseModalities ?? [];
  return requested
    .map((value) => normalizeModality(value))
    .filter((value): value is string => value !== undefined);
}

function checkGenerationConfigRanges(
  params: GenerateContentBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const config = params.generationConfig;
  if (config === undefined) return;
  const model = params.model;
  const source = GENERATE_CONTENT_API_DOCS_URL;

  const { temperature, logprobs, responseLogprobs, stopSequences, mediaResolution } = config;

  if (
    temperature !== undefined &&
    (temperature < GEMINI_TEMPERATURE_RANGE.min || temperature > GEMINI_TEMPERATURE_RANGE.max)
  ) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["generationConfig", "temperature"],
      model,
      message: `\`generationConfig.temperature\` must be in [${GEMINI_TEMPERATURE_RANGE.min}, ${GEMINI_TEMPERATURE_RANGE.max}]; got ${temperature}.`,
      meta: { value: temperature, ...GEMINI_TEMPERATURE_RANGE, source },
    });
  }

  if (
    logprobs !== undefined &&
    (logprobs < GEMINI_LOGPROBS_RANGE.min || logprobs > GEMINI_LOGPROBS_RANGE.max)
  ) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["generationConfig", "logprobs"],
      model,
      message: `\`generationConfig.logprobs\` must be in [${GEMINI_LOGPROBS_RANGE.min}, ${GEMINI_LOGPROBS_RANGE.max}]; got ${logprobs}.`,
      meta: { value: logprobs, ...GEMINI_LOGPROBS_RANGE, source },
    });
  }

  // "Only valid if responseLogprobs=True."
  if (logprobs !== undefined && responseLogprobs !== true) {
    ctx.report({
      code: "unsupported_param",
      path: ["generationConfig", "logprobs"],
      model,
      message:
        "`generationConfig.logprobs` is only valid when `generationConfig.responseLogprobs` is true.",
      meta: { source },
    });
  }

  if (stopSequences !== undefined && stopSequences.length > GEMINI_MAX_STOP_SEQUENCES) {
    ctx.report({
      code: "invalid_shape",
      path: ["generationConfig", "stopSequences"],
      model,
      message: `\`generationConfig.stopSequences\` accepts up to ${GEMINI_MAX_STOP_SEQUENCES} sequences; got ${stopSequences.length}.`,
      meta: { limit: GEMINI_MAX_STOP_SEQUENCES, value: stopSequences.length, source },
    });
  }

  (config.responseModalities ?? []).forEach((value, i) => {
    const normalized = normalizeModality(value);
    if (
      normalized === undefined ||
      (normalized !== "MODALITY_UNSPECIFIED" &&
        !GEMINI_RESPONSE_MODALITIES.includes(normalized as (typeof GEMINI_RESPONSE_MODALITIES)[number]))
    ) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["generationConfig", "responseModalities", i],
        model,
        message: `\`generationConfig.responseModalities\` accepts ${GEMINI_RESPONSE_MODALITIES.join(", ")}; got ${JSON.stringify(value)}.`,
        meta: { value, allowed: [...GEMINI_RESPONSE_MODALITIES], source },
      });
    }
  });

  const thinkingLevel = config.thinkingConfig?.thinkingLevel;
  if (
    thinkingLevel !== undefined &&
    !GEMINI_THINKING_LEVELS.includes(
      thinkingLevel.toUpperCase() as (typeof GEMINI_THINKING_LEVELS)[number],
    )
  ) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["generationConfig", "thinkingConfig", "thinkingLevel"],
      model,
      message: `\`generationConfig.thinkingConfig.thinkingLevel\` must be one of ${GEMINI_THINKING_LEVELS.join(", ")}; got ${JSON.stringify(thinkingLevel)}.`,
      meta: { value: thinkingLevel, allowed: [...GEMINI_THINKING_LEVELS], source },
    });
  }

  if (
    mediaResolution !== undefined &&
    !GEMINI_MEDIA_RESOLUTIONS.includes(mediaResolution as (typeof GEMINI_MEDIA_RESOLUTIONS)[number])
  ) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["generationConfig", "mediaResolution"],
      model,
      message: `\`generationConfig.mediaResolution\` must be one of ${GEMINI_MEDIA_RESOLUTIONS.join(", ")}; got ${JSON.stringify(mediaResolution)}.`,
      meta: { value: mediaResolution, allowed: [...GEMINI_MEDIA_RESOLUTIONS], source },
    });
  }
}

/**
 * "The requested modalities … is an exact match to the modalities of the
 * response … If the requested modalities do not match any of the supported
 * combinations, an error will be returned."
 */
function checkResponseModalities(
  params: GenerateContentBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return;
  requestedModalities(params).forEach((normalized, i) => {
    const modality = MODALITY_TO_CATALOG[normalized];
    if (modality === undefined) return;
    if (info.modalities.output.includes(modality)) return;
    ctx.report({
      code: "unsupported_capability",
      path: ["generationConfig", "responseModalities", i],
      model: params.model,
      message: `"${params.model}" cannot return ${modality} output; its output modalities are ${info.modalities.output.join(", ")}.`,
      meta: {
        requested: modality,
        outputModalities: [...info.modalities.output],
        source: GENERATE_CONTENT_API_DOCS_URL,
      },
    });
  });
}

/**
 * Both first-party spellings of the image-generation knobs:
 * `generationConfig.imageConfig` (REST reference / Go + Java SDKs) and
 * `generationConfig.responseFormat.image` (the guide's REST samples).
 */
function imageConfigEntries(
  params: GenerateContentBody,
): Array<{ path: Array<string | number>; value: Record<string, unknown> }> {
  const config = params.generationConfig;
  const entries: Array<{ path: Array<string | number>; value: Record<string, unknown> }> = [];
  if (config?.imageConfig != null) {
    entries.push({
      path: ["generationConfig", "imageConfig"],
      value: config.imageConfig as unknown as Record<string, unknown>,
    });
  }
  if (config?.responseFormat?.image != null) {
    entries.push({
      path: ["generationConfig", "responseFormat", "image"],
      value: config.responseFormat.image as unknown as Record<string, unknown>,
    });
  }
  return entries;
}

/** A value passes if it is an allowed plain spelling or that spelling's proto enum name. */
function allowedSpellings(
  allowed: readonly string[],
  enumNames: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  for (const value of allowed) {
    out.push(value);
    const name = enumNames[value];
    if (name !== undefined) out.push(name);
  }
  return out;
}

function checkImageGeneration(
  params: GenerateContentBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const entries = imageConfigEntries(params);
  if (entries.length === 0) return;
  const model = params.model;
  const id = stripModelsPrefix(model);

  // "An error will be returned if this field is set for models that don't
  // support these config options."
  if (info !== undefined && !info.modalities.output.includes("image")) {
    for (const entry of entries) {
      ctx.report({
        code: "unsupported_capability",
        path: entry.path,
        model,
        message: `"${model}" does not generate images, so image output config is rejected; its output modalities are ${info.modalities.output.join(", ")}.`,
        meta: {
          outputModalities: [...info.modalities.output],
          source: GENERATE_CONTENT_API_DOCS_URL,
        },
      });
    }
    return;
  }

  const rule = Object.hasOwn(GEMINI_IMAGE_MODEL_RULES, id)
    ? GEMINI_IMAGE_MODEL_RULES[id]
    : undefined;

  for (const entry of entries) {
    for (const key of GEMINI_IMAGE_CONFIG_VERTEX_ONLY_KEYS) {
      if (entry.value[key] != null) {
        ctx.report({
          code: "unsupported_param",
          path: [...entry.path, key],
          model,
          message: `\`${key}\` is not supported by the Gemini API (it is a Vertex AI-only ImageConfig field); remove it.`,
          meta: { source: GENERATE_CONTENT_API_DOCS_URL },
        });
      }
    }

    // Unknown / uncataloged image models keep unknown_model semantics: no
    // per-model table means no aspect-ratio or size enforcement.
    if (rule === undefined) continue;

    const aspectRatio = entry.value["aspectRatio"];
    if (aspectRatio != null) {
      const allowed = allowedSpellings(rule.aspectRatios, GEMINI_IMAGE_ASPECT_RATIO_ENUM_NAMES);
      if (!allowed.includes(String(aspectRatio))) {
        ctx.report({
          code: "invalid_enum_value",
          path: [...entry.path, "aspectRatio"],
          model,
          message: `\`aspectRatio\` must be one of ${rule.aspectRatios.join(", ")} for "${model}"; got ${JSON.stringify(aspectRatio)}.`,
          meta: {
            value: aspectRatio,
            allowed: [...rule.aspectRatios],
            source: GEMINI_IMAGE_GENERATION_DOCS_URL,
          },
        });
      }
    }

    const imageSize = entry.value["imageSize"];
    if (imageSize == null) continue;
    if (rule.imageSizes === undefined) {
      ctx.report({
        code: "unsupported_param",
        path: [...entry.path, "imageSize"],
        model,
        message: `\`imageSize\` is not supported by "${model}": it generates a single fixed resolution per aspect ratio.`,
        meta: { source: GEMINI_IMAGE_GENERATION_DOCS_URL },
      });
      continue;
    }
    const allowedSizes = allowedSpellings(rule.imageSizes, GEMINI_IMAGE_SIZE_ENUM_NAMES);
    if (!allowedSizes.includes(String(imageSize))) {
      ctx.report({
        code: "invalid_enum_value",
        path: [...entry.path, "imageSize"],
        model,
        message: `\`imageSize\` must be one of ${rule.imageSizes.join(", ")} for "${model}"; got ${JSON.stringify(imageSize)}.`,
        meta: {
          value: imageSize,
          allowed: [...rule.imageSizes],
          documented: [...GEMINI_IMAGE_SIZES],
          source: GEMINI_IMAGE_GENERATION_DOCS_URL,
        },
      });
    }
  }
}

/**
 * Gemini TTS models. The docs name exactly three ids; the `-tts` suffix test
 * keeps newer snapshots of the same line covered instead of silently
 * unvalidated.
 */
function isGeminiTtsModel(id: string): boolean {
  return (
    GEMINI_TTS_MODEL_IDS.includes(id as (typeof GEMINI_TTS_MODEL_IDS)[number]) ||
    /(^|[-.])tts([-.]|$)/.test(id)
  );
}

function checkVoiceName(
  voiceConfig: GoogleVoiceConfig | undefined,
  path: Array<string | number>,
  model: string,
  enforceVoices: boolean,
  ctx: PipelineContext,
): void {
  const voiceName = voiceConfig?.prebuiltVoiceConfig?.voiceName;
  if (voiceName === undefined || !enforceVoices) return;
  if (GEMINI_TTS_VOICES.includes(voiceName as (typeof GEMINI_TTS_VOICES)[number])) return;
  ctx.report({
    code: "invalid_enum_value",
    path: [...path, "prebuiltVoiceConfig", "voiceName"],
    model,
    message: `\`voiceName\` must be one of the 30 prebuilt Gemini TTS voices; got ${JSON.stringify(voiceName)}.`,
    meta: { value: voiceName, allowed: [...GEMINI_TTS_VOICES], source: GEMINI_TTS_DOCS_URL },
  });
}

function checkSpeechGeneration(
  params: GenerateContentBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  const id = stripModelsPrefix(model);
  const isTts = isGeminiTtsModel(id);
  const speechConfig = params.generationConfig?.speechConfig;

  // "TTS models can only receive text inputs and generate audio outputs" —
  // and an empty/absent responseModalities "is equivalent to requesting only
  // text", which a TTS model cannot produce.
  if (isTts && info !== undefined) {
    const requested = requestedModalities(params);
    if (!requested.includes("AUDIO")) {
      ctx.report({
        code: "unsupported_capability",
        path: ["generationConfig", "responseModalities"],
        model,
        message: `"${model}" is a TTS model and only produces audio; set \`generationConfig.responseModalities\` to ["AUDIO"].`,
        meta: { requested, source: GEMINI_TTS_DOCS_URL },
      });
    }
  }

  if (speechConfig == null) return;

  if (info !== undefined && !info.modalities.output.includes("audio")) {
    ctx.report({
      code: "unsupported_capability",
      path: ["generationConfig", "speechConfig"],
      model,
      message: `"${model}" does not generate audio, so \`generationConfig.speechConfig\` is rejected; its output modalities are ${info.modalities.output.join(", ")}.`,
      meta: {
        outputModalities: [...info.modalities.output],
        source: GENERATE_CONTENT_API_DOCS_URL,
      },
    });
    return;
  }

  const multi = speechConfig.multiSpeakerVoiceConfig;
  // "It is mutually exclusive with the voiceConfig field."
  if (speechConfig.voiceConfig != null && multi != null) {
    ctx.report({
      code: "invalid_shape",
      path: ["generationConfig", "speechConfig"],
      model,
      message:
        "`speechConfig.voiceConfig` and `speechConfig.multiSpeakerVoiceConfig` are mutually exclusive; set exactly one.",
      meta: { source: GENERATE_CONTENT_API_DOCS_URL },
    });
  }

  checkVoiceName(
    speechConfig.voiceConfig,
    ["generationConfig", "speechConfig", "voiceConfig"],
    model,
    isTts,
    ctx,
  );

  if (multi == null) return;
  const speakers = multi.speakerVoiceConfigs ?? [];
  if (speakers.length > GEMINI_TTS_MAX_SPEAKERS) {
    ctx.report({
      code: "invalid_shape",
      path: ["generationConfig", "speechConfig", "multiSpeakerVoiceConfig", "speakerVoiceConfigs"],
      model,
      message: `multi-speaker TTS supports up to ${GEMINI_TTS_MAX_SPEAKERS} speakers; got ${speakers.length}.`,
      meta: { limit: GEMINI_TTS_MAX_SPEAKERS, value: speakers.length, source: GEMINI_TTS_DOCS_URL },
    });
  }
  speakers.forEach((entry, i) => {
    checkVoiceName(
      entry?.voiceConfig,
      [
        "generationConfig",
        "speechConfig",
        "multiSpeakerVoiceConfig",
        "speakerVoiceConfigs",
        i,
        "voiceConfig",
      ],
      model,
      isTts,
      ctx,
    );
  });
}

function checkPartMedia(
  part: GooglePart,
  path: Array<string | number>,
  params: GenerateContentBody,
  info: ModelInfo | undefined,
  rules: Partial<Record<RuledKind, MediaRule>>,
  ctx: PipelineContext,
): void {
  const inline = part.inlineData;
  const mimeType = inline?.mimeType ?? part.fileData?.mimeType;
  if (mimeType === undefined) return;
  const kind = mediaKindOf(mimeType);
  if (kind === undefined) return;
  const model = params.model;

  // Headline check: media kind vs the model's input modalities (catches e.g.
  // video sent to a text+image-only model).
  if (info !== undefined && !info.modalities.input.includes(kind)) {
    ctx.report({
      code: "unsupported_capability",
      path,
      model,
      message: `"${model}" does not accept ${kind} input ("${mimeType}"); its input modalities are ${info.modalities.input.join(", ")}.`,
      meta: { mimeType, kind, inputModalities: [...info.modalities.input] },
    });
    return;
  }

  if (kind === "pdf") {
    // PDFs carry no MediaRule (no formats/dimensions/duration) — only the
    // stricter inline byte cap. The cap is on request payload size, which
    // carries base64, so the encoded length is the right measure.
    if (inline !== undefined && inline.data.length > INLINE_PDF_MAX_BYTES) {
      ctx.report({
        code: "media_too_large",
        path,
        model,
        message: `inline pdf is ${inline.data.length} bytes encoded; "${model}" caps inline PDFs at ${INLINE_PDF_MAX_BYTES} bytes (use the Files API instead).`,
        meta: { bytes: inline.data.length, limit: INLINE_PDF_MAX_BYTES, source: "https://ai.google.dev/gemini-api/docs/files" },
      });
    }
    return;
  }

  const rule = rules[kind];
  if (rule === undefined) return;
  const source = GOOGLE_MEDIA_DOC_URLS[kind];
  const declaration = findMediaDeclaration(ctx.options.media, path);

  let sniffed: SniffedImage | undefined;
  if (inline !== undefined && kind === "image") {
    const bytes = toBytes(inline.data);
    if (bytes !== undefined) sniffed = sniffImage(bytes);
  }

  // Format by declared MIME, only when sniffing did not identify the real
  // format (sniffed truth overrides the label; reportMediaIssues covers it).
  const mimeFormat = formatOfMime(mimeType);
  if (
    sniffed === undefined &&
    mimeFormat !== undefined &&
    rule.formats !== undefined &&
    !rule.formats.includes(mimeFormat)
  ) {
    ctx.report({
      code: "media_unsupported_format",
      path,
      model,
      message: `${kind} format "${mimeFormat}" is not supported by "${model}"; supported formats: ${rule.formats.join(", ")}.`,
      meta: { format: mimeFormat, allowed: [...rule.formats], source },
    });
  }

  reportMediaIssues(ctx, {
    kind,
    // The inline byte cap only applies to inlineData; Files-API-hosted media
    // (fileData) may be up to 2GB, so declared bytes must not trip it.
    rule: inline === undefined ? { ...rule, maxBytes: undefined } : rule,
    path,
    model,
    sniffed,
    declaration,
    source,
    ...(inline !== undefined && { encodedBytes: inline.data.length }),
  });
}

function checkMedia(params: GenerateContentBody, info: ModelInfo | undefined, ctx: PipelineContext): void {
  const rules = mediaRulesFor(params.model);
  // "…videos up to 1 hour long at default media resolution or 3 hours long
  // at low media resolution" — GOOGLE_MEDIA_DOC_URLS.video. Scale the video
  // cap 3x when the request opts into low resolution.
  const video = rules.video;
  if (
    video?.maxDurationSeconds !== undefined &&
    params.generationConfig?.mediaResolution === "MEDIA_RESOLUTION_LOW"
  ) {
    rules.video = { ...video, maxDurationSeconds: video.maxDurationSeconds * 3 };
  }
  params.contents.forEach((content, i) => {
    content.parts.forEach((part, j) => {
      checkPartMedia(part, ["contents", i, "parts", j], params, info, rules, ctx);
    });
  });
}

/**
 * `displayName` on inlineData/fileData is a Vertex AI-only field — the
 * generativelanguage wire schema is exactly {mimeType, data} / {fileUri,
 * mimeType}, and the API rejects unknown fields with a 400. Top-level
 * unknown-key detection does not reach nested parts, so warn here.
 */
function checkVertexOnlyFields(
  params: GenerateContentBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  params.contents.forEach((content, i) => {
    content.parts.forEach((part, j) => {
      const record = part as unknown as Record<string, Record<string, unknown> | undefined>;
      for (const key of ["inlineData", "fileData"] as const) {
        if (record[key]?.["displayName"] !== undefined) {
          ctx.report({
            code: "unknown_param",
            path: ["contents", i, "parts", j, key, "displayName"],
            model: params.model,
            message: `\`${key}.displayName\` is a Vertex AI-only field; the Gemini API (generativelanguage) rejects unknown fields with a 400 — remove it.`,
          });
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

function estimate(params: GenerateContentBody, info: ModelInfo | undefined, ctx: PipelineContext) {
  const imageTokens = imageTokensFor(params.model);
  let inputTokens = 0;

  const countContent = (content: GoogleContent): void => {
    inputTokens += PER_MESSAGE_TOKEN_OVERHEAD;
    for (const part of content.parts) {
      if (part.text !== undefined) inputTokens += ctx.tokenizer.count(part.text);
      const mimeType = part.inlineData?.mimeType ?? part.fileData?.mimeType;
      if (mimeType !== undefined && mediaKindOf(mimeType) === "image") inputTokens += imageTokens;
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
// Finalize: wire body (model stripped — it lives in the URL) + .toSdk(target)
// + .request + .toApi(provider)
// ---------------------------------------------------------------------------

export const GENERATE_CONTENT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Endpoint URL for a model id. Accepts both the bare id ("gemini-2.5-flash")
 * and the REST-documented "models/gemini-2.5-flash" form users copy from
 * listModels — both yield the same URL.
 */
export function generateContentUrl(model: string): string {
  return `${GENERATE_CONTENT_BASE_URL}/${stripModelsPrefix(model)}:generateContent`;
}

/**
 * The shaping itself lives in `core/translate/sdk-shapes.ts` because a
 * retargeted `.toApi("google")` result must offer the *same* `toSdk("google")`
 * — and the retarget engine is forbidden from importing `src/providers/**`.
 * Sharing the function is what stops the two from drifting.
 * (`store` has no @google/genai config equivalent; it rides only in the wire body.)
 */
function buildSdkParams(model: string, body: Omit<GenerateContentBody, "model">): Record<string, unknown> {
  return geminiSdkParams(model, body);
}

/**
 * The SDK targets this endpoint declares: `@google/genai`'s
 * `ai.models.generateContent()`, whose params re-nest the wire body into
 * `{ model, contents, config }` (see `buildSdkParams`).
 */
export type ChatSdkTargets<T extends GenerateContentBody = GenerateContentBody> = {
  google: () => GenerateContentSdkParams<T>;
  "ai-sdk": () => AiSdkChatResult;
};

/**
 * `.toApi(provider)` for `google.chat`.
 *
 * The spec's `Body` is the *unstripped* params so `modelId` can read `model`
 * off it; `withModelId` then drops it again, because Gemini puts the model id
 * in the URL path (`models/{id}:generateContent`) and a `model` key on the
 * body would break the "enumerable properties are exactly the wire body"
 * invariant. The endpoint table interpolates the target's spelling into the
 * URL instead.
 *
 * One decoder, because the only same-dialect target in the generated data is
 * google-vertex — factory-configured, and therefore out of the one-argument
 * union — so every reachable edge (openrouter, vercel) crosses into the
 * OpenAI chat-completions dialect.
 */
const retargetGenerateContent = createToApi<GenerateContentBody, ChatIR>({
  from: "gemini",
  endpoint: "google.chat",
  modelId: (params) => stripModelsPrefix(params.model),
  availability,
  withModelId: ({ model: _model, ...body }) => body,
  encode: encodeGemini,
  decoders: { "openai-chat": decodeOpenAIChat },
  // Layers 1 + 3 against the TARGET (design-types §4.4).
  targetValidation: targetValidationFor,
});

/** `.toSdk("ai-sdk")`: the same encoder, decoded to `generateText` options. */
const toAiSdk = createAiSdkChat<GenerateContentBody>({
  endpoint: "google.chat",
  provider: "google",
  encode: encodeGemini,
});

function finalize(params: GenerateContentBody): unknown {
  const { model, ...body } = params;
  const request: RequestMeta = {
    url: generateContentUrl(model),
    method: "POST",
    headers: JSON_HEADERS,
  };
  return toValidated(body, request, {
    sdk: {
      google: () => buildSdkParams(model, body),
      // The AI SDK target needs the model id back on the body, because the
      // encoder reads it off there; it never reaches the emitted options.
      "ai-sdk": () => toAiSdk({ model, ...body }),
    },
    // A fresh object, not the caller's `params`: `.toApi` is called later, and
    // must not observe mutations the caller makes to their own literal after
    // validating — the same reason `finalize` copies everywhere else.
    api: retargetGenerateContent({ model, ...body }),
  });
}

const validator = createValidator<GenerateContentBody, unknown>({
  endpoint: "google.chat",
  schema: generateContentSchema,
  modelId: (params) => stripModelsPrefix(params.model),
  catalog: chatModels,
  constraints: chatConstraints,
  familyRules: chatFamilyRules,
  checks: [
    checkCapabilities,
    checkGenerationConfigRanges,
    checkResponseModalities,
    checkImageGeneration,
    checkSpeechGeneration,
    checkMedia,
    checkVertexOnlyFields,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Gemini `models.{model}:generateContent`.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is stripped, because on the wire it lives only in the URL
 * (`.request.url` already has it interpolated). `.toSdk("google")` re-shapes
 * the body for `@google/genai`'s `ai.models.generateContent()`, and
 * `.toApi(provider)` offers exactly the providers the models.dev catalog says
 * serve this model. Auth is your job: add an `x-goog-api-key` header (or
 * `?key=`) when fetching.
 *
 * ```ts
 * const params = google.chat({ model: "gemini-2.5-flash", contents: [...] });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "x-goog-api-key": process.env.GEMINI_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const chat = validator as unknown as {
  <T extends GenerateContentBody>(
    params: T & ExactKeys<T, GenerateContentBody>,
    options?: ValidateOptions,
  ): Validated<
    Omit<T, "model">,
    ChatSdkTargets<T>,
    GoogleAvailability,
    T["model"] & string
  >;
  safe<T extends GenerateContentBody>(
    params: T & ExactKeys<T, GenerateContentBody>,
    options?: ValidateOptions,
  ): ValidateResult<
    Validated<Omit<T, "model">, ChatSdkTargets<T>, GoogleAvailability, T["model"] & string>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};
