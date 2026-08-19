/**
 * Gladia pre-recorded (async) STT — POST https://api.gladia.io/v2/pre-recorded
 *
 * Wire notes (verified 2026-08-13 against the OpenAPI document embedded in
 * https://docs.gladia.io/api-reference/v2/pre-recorded/init, plus
 * https://docs.gladia.io/chapters/limits-and-specifications/supported-formats
 * and https://www.gladia.io/pricing):
 * - JSON endpoint. `audio_url` is the only required field: either an external
 *   URL or the `audio_url` returned by POST /v2/upload ({@link UPLOAD_URL},
 *   multipart with a single `audio` part — see {@link toUploadFormData}).
 * - Auth is an `x-gladia-key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 * - Every audio-intelligence add-on is a boolean toggle plus an optional
 *   `<toggle>_config` object; the config is read only "if `<toggle>` is
 *   enabled", so a config without its flag is reported as a silently-ignored
 *   param.
 * - `model` selects the transcription model. It is documented on the endpoint
 *   page ("Pass `model` to choose the transcription model … `"solaria-3"` /
 *   `"solaria-1"`") and in the quickstart, but is still missing from the
 *   OpenAPI `InitTranscriptionRequest` properties on that same page — the
 *   prose is the authority here.
 * - Billing is per minute of audio. The wire body only references audio by
 *   URL, so declare the length via
 *   `options.media = [{ path: ["audio_url"], durationSeconds }]` to get a
 *   `costUSD` estimate, `maxCostUSD` enforcement, and the 135-minute cap.
 *   Audio-intelligence add-ons are billed on top and are NOT estimated.
 * - Live transcription runs over the Gladia WebSocket API, which unmodel does
 *   not validate.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import { models, DEFAULT_MODEL, SOLARIA_3_LANGUAGES, type GladiaModelId } from "./models";

export const PRE_RECORDED_URL = "https://api.gladia.io/v2/pre-recorded";
/** Multipart upload endpoint returning the `audio_url` used below. */
export const UPLOAD_URL = "https://api.gladia.io/v2/upload";

const INIT_DOCS = "https://docs.gladia.io/api-reference/v2/pre-recorded/init";
const LIMITS_DOCS = "https://docs.gladia.io/chapters/limits-and-specifications/supported-formats";

/**
 * "The maximum length of audio that can be transcribed in a single request is
 * currently 135 minutes." (LIMITS_DOCS; enterprise plans reach 4h15.)
 */
export const MAX_AUDIO_DURATION_SECONDS = 135 * 60;

/** "Audio files must not exceed 1000 MB in size." (LIMITS_DOCS) */
export const MAX_AUDIO_BYTES = 1000 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Wire types — mirror InitTranscriptionRequest exactly (snake_case).
// ---------------------------------------------------------------------------

export interface GladiaCustomVocabularyEntry {
  value: string;
  /** 0–1. */
  intensity?: number;
  pronunciations?: string[];
  /** Language the entry is pronounced in; defaults to the transcription language. */
  language?: string;
}

export interface GladiaCustomVocabularyConfig {
  vocabulary: Array<string | GladiaCustomVocabularyEntry>;
  /** 0–1. */
  default_intensity?: number;
}

export interface GladiaCallbackConfig {
  url: string;
  /** "POST" (default) or "PUT". */
  method?: "POST" | "PUT";
}

export interface GladiaSubtitlesConfig {
  /** At least one of "srt" / "vtt"; defaults to ["srt"]. */
  formats?: Array<"srt" | "vtt">;
  /** Seconds, >= 0. */
  minimum_duration?: number;
  /** Seconds, 1–30. */
  maximum_duration?: number;
  /** >= 1. */
  maximum_characters_per_row?: number;
  /** 1–5. */
  maximum_rows_per_caption?: number;
  /** "default" or "compliance". */
  style?: "default" | "compliance";
}

export interface GladiaDiarizationConfig {
  /** Exact speaker count, >= 1. */
  number_of_speakers?: number;
  /** >= 0. */
  min_speakers?: number;
  /** >= 0. */
  max_speakers?: number;
}

export interface GladiaTranslationConfig {
  /** iso639-1 codes; at least one. */
  target_languages: string[];
  /** "base" (default), "batch" or "enhanced". */
  model?: "base" | "batch" | "enhanced";
  match_original_utterances?: boolean;
  lipsync?: boolean;
  context_adaptation?: boolean;
  context?: string;
  informal?: boolean;
}

export interface GladiaSummarizationConfig {
  /** "general" (default), "bullet_points" or "concise". */
  type?: "general" | "bullet_points" | "concise";
}

export interface GladiaCustomSpellingConfig {
  /** Correct spelling → list of spellings heard in the audio. */
  spelling_dictionary: Record<string, string[]>;
}

export interface GladiaAudioToLlmConfig {
  /** At least one prompt to run over the transcript. */
  prompts: string[];
  /** OpenRouter model id; defaults to openai/gpt-5.4-nano. */
  model?: string;
}

export interface GladiaPiiRedactionConfig {
  /** Entity types / bundles to redact, e.g. ["GDPR", "EMAIL_ADDRESS"]. */
  entity_types?: string[];
  /** "MARKER" or "MASK". */
  processed_text_type?: "MARKER" | "MASK";
}

export interface GladiaLanguageConfig {
  /** One language pins it; empty (default) auto-detects. */
  languages?: string[];
  /** Detect the language per utterance; ignored when one language is set. */
  code_switching?: boolean;
}

export interface PreRecordedBody {
  /** URL of a Gladia file (from /v2/upload) or an external audio/video file. */
  audio_url: string;
  /** Transcription model; defaults to solaria-1. */
  model?: GladiaModelId | (string & {});
  language_config?: GladiaLanguageConfig;
  /** [Beta] */
  custom_vocabulary?: boolean;
  custom_vocabulary_config?: GladiaCustomVocabularyConfig;
  /** @deprecated Use `callback` / `callback_config`. */
  callback_url?: string;
  callback?: boolean;
  callback_config?: GladiaCallbackConfig;
  subtitles?: boolean;
  subtitles_config?: GladiaSubtitlesConfig;
  diarization?: boolean;
  diarization_config?: GladiaDiarizationConfig;
  /** [Beta] */
  translation?: boolean;
  translation_config?: GladiaTranslationConfig;
  summarization?: boolean;
  summarization_config?: GladiaSummarizationConfig;
  /** [Alpha] */
  named_entity_recognition?: boolean;
  /** [Alpha] */
  custom_spelling?: boolean;
  custom_spelling_config?: GladiaCustomSpellingConfig;
  sentiment_analysis?: boolean;
  audio_to_llm?: boolean;
  audio_to_llm_config?: GladiaAudioToLlmConfig;
  pii_redaction?: boolean;
  pii_redaction_config?: GladiaPiiRedactionConfig;
  /** Arbitrary metadata echoed back on the transcription. */
  custom_metadata?: Record<string, unknown>;
  sentences?: boolean;
  /** [Alpha] */
  punctuation_enhanced?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// ---------------------------------------------------------------------------

const URL_PATTERN = /^https?:\/\/\S+$/;

const schema = z.looseObject({
  audio_url: z
    .string()
    .regex(URL_PATTERN, "audio_url must be an http(s) URL without whitespace."),
  model: z.string().min(1).optional(),
  language_config: z
    .looseObject({
      languages: z.array(z.string()).optional(),
      code_switching: z.boolean().optional(),
    })
    .optional(),
  custom_vocabulary: z.boolean().optional(),
  custom_vocabulary_config: z
    .looseObject({
      vocabulary: z.array(
        z.union([
          z.string(),
          z.looseObject({
            value: z.string(),
            intensity: z.number().min(0).max(1).optional(),
            pronunciations: z.array(z.string()).optional(),
            language: z.string().optional(),
          }),
        ]),
      ),
      default_intensity: z.number().min(0).max(1).optional(),
    })
    .optional(),
  callback_url: z.string().regex(URL_PATTERN, "callback_url must be an http(s) URL.").optional(),
  callback: z.boolean().optional(),
  callback_config: z
    .looseObject({
      url: z.string().regex(URL_PATTERN, "callback_config.url must be an http(s) URL."),
      method: z.enum(["POST", "PUT"]).optional(),
    })
    .optional(),
  subtitles: z.boolean().optional(),
  subtitles_config: z
    .looseObject({
      formats: z.array(z.enum(["srt", "vtt"])).min(1).optional(),
      minimum_duration: z.number().min(0).optional(),
      maximum_duration: z.number().min(1).max(30).optional(),
      maximum_characters_per_row: z.number().int().min(1).optional(),
      maximum_rows_per_caption: z.number().int().min(1).max(5).optional(),
      style: z.enum(["default", "compliance"]).optional(),
    })
    .optional(),
  diarization: z.boolean().optional(),
  diarization_config: z
    .looseObject({
      number_of_speakers: z.number().int().min(1).optional(),
      min_speakers: z.number().int().min(0).optional(),
      max_speakers: z.number().int().min(0).optional(),
    })
    .optional(),
  translation: z.boolean().optional(),
  translation_config: z
    .looseObject({
      target_languages: z
        .array(z.string())
        .min(1, "translation_config.target_languages needs at least one language."),
      model: z.enum(["base", "batch", "enhanced"]).optional(),
      match_original_utterances: z.boolean().optional(),
      lipsync: z.boolean().optional(),
      context_adaptation: z.boolean().optional(),
      context: z.string().optional(),
      informal: z.boolean().optional(),
    })
    .optional(),
  summarization: z.boolean().optional(),
  summarization_config: z
    .looseObject({ type: z.enum(["general", "bullet_points", "concise"]).optional() })
    .optional(),
  named_entity_recognition: z.boolean().optional(),
  custom_spelling: z.boolean().optional(),
  custom_spelling_config: z
    .looseObject({ spelling_dictionary: z.record(z.string(), z.array(z.string())) })
    .optional(),
  sentiment_analysis: z.boolean().optional(),
  audio_to_llm: z.boolean().optional(),
  audio_to_llm_config: z
    .looseObject({
      prompts: z.array(z.string()).min(1, "audio_to_llm_config.prompts needs at least one prompt."),
      model: z.string().optional(),
    })
    .optional(),
  pii_redaction: z.boolean().optional(),
  pii_redaction_config: z
    .looseObject({
      entity_types: z.array(z.string()).optional(),
      processed_text_type: z.enum(["MARKER", "MASK"]).optional(),
    })
    .optional(),
  custom_metadata: z.looseObject({}).optional(),
  sentences: z.boolean().optional(),
  punctuation_enhanced: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Every `<toggle>` / `<toggle>_config` pair the API documents. */
const TOGGLE_PAIRS: ReadonlyArray<[toggle: keyof PreRecordedBody, config: keyof PreRecordedBody]> = [
  ["custom_vocabulary", "custom_vocabulary_config"],
  ["callback", "callback_config"],
  ["subtitles", "subtitles_config"],
  ["diarization", "diarization_config"],
  ["translation", "translation_config"],
  ["summarization", "summarization_config"],
  ["custom_spelling", "custom_spelling_config"],
  ["audio_to_llm", "audio_to_llm_config"],
  ["pii_redaction", "pii_redaction_config"],
];

/**
 * Each `<x>_config` is documented as applying only "if `<x>` is enabled" (all
 * toggles default to false). A config without its flag is silently dropped by
 * the API — a warning, not an error, since the request still succeeds.
 */
function checkToggles(
  params: PreRecordedBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const record = params as unknown as Record<string, unknown>;
  for (const [toggle, config] of TOGGLE_PAIRS) {
    if (record[config] == null) continue;
    if (record[toggle] === true) continue;
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: [config],
      model: params.model,
      message: `\`${config}\` is only read when \`${toggle}: true\`; the API ignores it otherwise.`,
      meta: { requires: toggle, source: INIT_DOCS },
    });
  }
}

/** "**[Deprecated]** Use `callback`/`callback_config` instead." */
function checkCallbackUrl(
  params: PreRecordedBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.callback_url === undefined) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["callback_url"],
    model: params.model,
    message: "`callback_url` is deprecated; use `callback: true` with `callback_config` instead.",
    meta: { replacement: "callback_config", source: INIT_DOCS },
  });
}

/**
 * solaria-3 is "Async (pre-recorded) only", covers "English, French, German,
 * Spanish, Italian" and is "Single language only — pass exactly one language
 * in `language_config.languages` (no code switching)" (INIT_DOCS).
 */
function checkSolaria3(
  params: PreRecordedBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model !== "solaria-3") return;
  const languages = params.language_config?.languages;

  if (languages === undefined || languages.length !== 1) {
    ctx.report({
      code: "unsupported_capability",
      path: ["language_config", "languages"],
      model: "solaria-3",
      message: `solaria-3 is single-language: pass exactly one language in \`language_config.languages\`; got ${languages === undefined ? "none" : `${languages.length}`}.`,
      meta: { allowed: [...SOLARIA_3_LANGUAGES], source: INIT_DOCS },
    });
  } else {
    const language = languages[0];
    if (language !== undefined && !SOLARIA_3_LANGUAGES.includes(language)) {
      ctx.report({
        code: "invalid_enum_value",
        path: ["language_config", "languages", 0],
        model: "solaria-3",
        message: `solaria-3 covers ${SOLARIA_3_LANGUAGES.join(", ")}; got ${JSON.stringify(language)}. Use solaria-1 for the full 100+ language coverage.`,
        meta: { allowed: [...SOLARIA_3_LANGUAGES], value: language, source: INIT_DOCS },
      });
    }
  }

  if (params.language_config?.code_switching === true) {
    ctx.report({
      code: "unsupported_capability",
      path: ["language_config", "code_switching"],
      model: "solaria-3",
      message: "solaria-3 does not support code switching; use solaria-1 for multi-language audio.",
      meta: { source: INIT_DOCS },
    });
  }
}

/** Speaker-count bounds must be consistent with each other. */
function checkDiarizationBounds(
  params: PreRecordedBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const config = params.diarization_config;
  if (config === undefined) return;
  const { min_speakers: min, max_speakers: max } = config;
  if (min !== undefined && max !== undefined && min > max) {
    ctx.report({
      code: "invalid_shape",
      path: ["diarization_config", "min_speakers"],
      model: params.model,
      message: `\`min_speakers\` (${min}) is greater than \`max_speakers\` (${max}).`,
      meta: { source: INIT_DOCS },
    });
  }
}

function declaredDurationSeconds(ctx: PipelineContext): number | undefined {
  const exact = findMediaDeclaration(ctx.options.media, ["audio_url"]);
  if (exact?.durationSeconds !== undefined) return exact.durationSeconds;
  return ctx.options.media?.find((d) => d.durationSeconds !== undefined)?.durationSeconds;
}

/** 135-minute per-request cap and 1000 MB file cap (LIMITS_DOCS). */
function checkAudioLimits(
  params: PreRecordedBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const declaration = findMediaDeclaration(ctx.options.media, ["audio_url"]);
  const seconds = declaredDurationSeconds(ctx);
  if (seconds !== undefined && seconds > MAX_AUDIO_DURATION_SECONDS) {
    ctx.report({
      code: "media_duration_exceeded",
      path: ["audio_url"],
      model: params.model,
      message: `audio is declared as ${seconds}s; Gladia caps a single pre-recorded request at ${MAX_AUDIO_DURATION_SECONDS}s (135 minutes).`,
      meta: { durationSeconds: seconds, limit: MAX_AUDIO_DURATION_SECONDS, source: LIMITS_DOCS },
    });
  }
  const bytes = declaration?.bytes;
  if (bytes !== undefined && bytes > MAX_AUDIO_BYTES) {
    ctx.report({
      code: "media_too_large",
      path: ["audio_url"],
      model: params.model,
      message: `audio is ${bytes} bytes; Gladia caps audio files at ${MAX_AUDIO_BYTES} bytes (1000 MB).`,
      meta: { bytes, limit: MAX_AUDIO_BYTES, source: LIMITS_DOCS },
    });
  }
}

/**
 * Cost = declared audio minutes x the catalog per-minute rate. Without a
 * duration declaration the estimate is empty (the wire body cannot reveal it).
 */
function estimateTranscription(
  _params: PreRecordedBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const seconds = declaredDurationSeconds(ctx);
  if (seconds === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, seconds / 60);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `gladia.preRecorded`. Gladia's JS SDK takes wire-shaped
 * params, so the single `"gladia"` formatter is the identity. Type alias, not
 * interface: an interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type PreRecordedSdkTargets<B> = { gladia: () => B };

function finalize(params: PreRecordedBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: PRE_RECORDED_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { gladia: () => body } },
  );
}

const validator = createValidator<PreRecordedBody, unknown>({
  endpoint: "gladia.preRecorded",
  schema,
  // The documented default is solaria-1, so an omitted `model` still resolves
  // to a catalog entry (and a rate) instead of an unknown_model warning.
  modelId: (params) => params.model ?? DEFAULT_MODEL,
  catalog: models,
  checks: [checkToggles, checkCallbackUrl, checkSolaria3, checkDiarizationBounds, checkAudioLimits],
  estimate: estimateTranscription,
  finalize,
});

/**
 * Validates params for POST https://api.gladia.io/v2/pre-recorded (async STT).
 * The result's enumerable properties are the exact fetch JSON body;
 * `.request` carries url/method/static headers (add your own
 * `x-gladia-key: <GLADIA_API_KEY>`). Gladia's JS SDK takes wire-shaped params,
 * so `.toSdk("gladia")` returns the body unchanged.
 *
 * Cost estimation: declare the audio length via
 * `options.media = [{ path: ["audio_url"], durationSeconds }]` to get a
 * `costUSD` estimate and 135-minute cap enforcement.
 *
 * Live transcription runs over the Gladia WebSocket API and is not validated
 * by unmodel.
 */
export const preRecorded = validator as unknown as {
  <T extends PreRecordedBody>(
    params: T & ExactKeys<T, PreRecordedBody>,
    options?: ValidateOptions,
  ): Validated<T, PreRecordedSdkTargets<T>>;
  safe<T extends PreRecordedBody>(
    params: T & ExactKeys<T, PreRecordedBody>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, PreRecordedSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ---------------------------------------------------------------------------
// Upload helper — POST /v2/upload is multipart/form-data with a single
// `audio` part (https://docs.gladia.io/api-reference/v2/upload/audio-file).
// ---------------------------------------------------------------------------

export interface GladiaUploadParams {
  /** The audio/video bytes; strings are appended as-is per FormData semantics. */
  audio: Blob | string;
  /** Overrides the multipart filename. */
  filename?: string;
}

/**
 * Builds the multipart body for POST {@link UPLOAD_URL}. Raw-fetch path:
 * `fetch(UPLOAD_URL, { method: "POST", body: toUploadFormData(params), headers: { "x-gladia-key": key } })`
 * — do NOT set a content-type header; fetch derives the multipart boundary.
 * The response's `audio_url` is the value `preRecorded` expects.
 */
export function toUploadFormData(params: GladiaUploadParams): FormData {
  const form = new FormData();
  if (params.audio instanceof Blob && params.filename !== undefined) {
    form.append("audio", params.audio, params.filename);
  } else {
    form.append("audio", params.audio);
  }
  return form;
}
