/**
 * Speechmatics Batch transcription — POST https://{region}.asr.api.speechmatics.com/v2/jobs
 *
 * Wire notes (verified 2026-08-13 against
 * https://docs.speechmatics.com/speech-to-text/batch/input (the `JobConfig`
 * schema), https://docs.speechmatics.com/api-ref/batch/create-a-new-job,
 * https://docs.speechmatics.com/speech-to-text/models and
 * https://docs.speechmatics.com/speech-to-text/batch/limits):
 * - This is a multipart/form-data endpoint with two parts: `config` (the
 *   JobConfig JSON, serialized as a string) and `data_file` (the media
 *   bytes). What unmodel validates is the CONFIG — `transcribe(config)` returns the
 *   exact JSON object to serialize into the `config` part, and
 *   {@link toFormData} assembles the request body. Media can also be fetched
 *   server-side via `fetch_data.url`, in which case there is no `data_file`
 *   part at all.
 * - Auth is `Authorization: Bearer <SPEECHMATICS_API_KEY>` — unmodel never
 *   touches keys. `.request.headers` is deliberately empty: fetch must derive
 *   the multipart content-type (with boundary) from the FormData body.
 * - The region is the endpoint: a job belongs to the endpoint that created it,
 *   and every follow-up request must use the same host. {@link jobsUrl} builds
 *   the URL for a region; {@link JOBS_URL} defaults to EU1.
 * - Billing is per minute of audio. Neither the config nor a Blob reveals the
 *   duration, so declare it via
 *   `options.media = [{ path: ["data_file"], durationSeconds }]` (or
 *   `["fetch_data", "url"]`) to get a `costUSD` estimate and `maxCostUSD`
 *   enforcement. Speech-intelligence bolt-ons (translation, summaries,
 *   chapters, sentiment, topics) are billed on top and are NOT estimated.
 * - Realtime transcription runs over the Speechmatics WebSocket API
 *   (`wss://eu.rt.speechmatics.com/v2`), which unmodel does not validate.
 * - Alignment jobs (`type: "alignment"` + `alignment_config`) are a different
 *   product and are out of scope here; this validator models transcription.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import { models, BATCH_HOSTS, type SpeechmaticsRegion } from "./models";

const MODELS_DOCS = "https://docs.speechmatics.com/speech-to-text/models";
const LIMITS_DOCS = "https://docs.speechmatics.com/speech-to-text/batch/limits";

/** Builds the /v2/jobs URL for a Batch SaaS region. */
export function jobsUrl(region: SpeechmaticsRegion = "eu1"): string {
  return `https://${BATCH_HOSTS[region]}/v2/jobs`;
}

/** Default POST target (EU1); use {@link jobsUrl} for another region. */
export const JOBS_URL = jobsUrl("eu1");

/**
 * "the file must be less than 1 GB in size or the job will be rejected"
 * (LIMITS_DOCS). Files above this must be submitted via `fetch_data.url`.
 */
export const MAX_DATA_FILE_BYTES = 1_000_000_000;

/** "the `standard` model is used" when `model` is not set (MODELS_DOCS). */
export const DEFAULT_MODEL = "standard";

/**
 * File extensions the Batch API accepts — "The list above is exhaustive - any
 * file format outside the list above is explicitly not supported"
 * (https://docs.speechmatics.com/speech-to-text/batch/input). A Blob carries
 * only a MIME type, which does not map 1:1 onto extensions, so this is
 * exported for callers to check rather than enforced here.
 */
export const SUPPORTED_FILE_TYPES = [
  "wav",
  "mp3",
  "aac",
  "ogg",
  "mpeg",
  "amr",
  "m4a",
  "mp4",
  "flac",
] as const;

// ---------------------------------------------------------------------------
// Wire types — mirror the documented JobConfig schema exactly.
// ---------------------------------------------------------------------------

export interface SpeechmaticsFetchConfig {
  url: string;
  /** Extra headers for the fetch (e.g. an OAuth2 bearer token). */
  auth_headers?: string[];
}

export interface SpeechmaticsAdditionalVocabEntry {
  content: string;
  sounds_like?: string[];
}

export interface SpeechmaticsPunctuationOverrides {
  /** 0–1; higher produces more punctuation. Default 0.5. */
  sensitivity?: number;
  /** Accepted marks, or the special value "all" (the default). */
  permitted_marks?: string[];
}

export interface SpeechmaticsAudioFilteringConfig {
  /** 0–100; higher cuts out increasing amounts of quiet sound. */
  volume_threshold?: number;
}

export interface SpeechmaticsReplacement {
  from: string;
  to: string;
}

export interface SpeechmaticsTranscriptFilteringConfig {
  /** true removes disfluencies; false (default) tags them. */
  remove_disfluencies?: boolean;
  replacements?: SpeechmaticsReplacement[];
}

export interface SpeechmaticsSpeaker {
  /** Must not collide with the internal format (S1, S2, …). */
  label: string;
  /** Speaker identifiers; at least one, max 50 across all speakers. */
  speaker_identifiers: string[];
}

export interface SpeechmaticsSpeakerDiarizationConfig {
  prefer_current_speaker?: boolean;
  /** 0–1; higher keeps similar speakers apart. Default 0.5. */
  speaker_sensitivity?: number;
  /** Return speaker identifiers at the end of the transcript. */
  get_speakers?: boolean;
  /** Speaker labels linked to their identifiers (speaker identification). */
  speakers?: SpeechmaticsSpeaker[];
}

export interface SpeechmaticsTranscriptionConfig {
  /** ISO language code; `multi` for Melia 1, `auto` for language ID. */
  language: string;
  /** Specialized variant of `language`, e.g. "medical" (Enhanced only). */
  domain?: string;
  /** Locale for the transcription output, e.g. "en-US". */
  output_locale?: string;
  /** Model to transcribe with; defaults to "standard". */
  model?: "standard" | "enhanced" | "melia-1" | (string & {});
  /** @deprecated Use `model`; kept for backward compatibility. */
  operating_point?: "standard" | "enhanced" | "melia-1" | (string & {});
  /** Custom dictionary. */
  additional_vocab?: SpeechmaticsAdditionalVocabEntry[];
  punctuation_overrides?: SpeechmaticsPunctuationOverrides;
  /** "none" (default), "speaker", or "channel". */
  diarization?: "none" | "speaker" | "channel";
  /** Labels used when collating separate input channels. */
  channel_diarization_labels?: string[];
  /** Include 'entity' objects (dates, numbers) with spoken/written forms. */
  enable_entities?: boolean;
  /** Flexible endpointing: "fixed" or "flexible". */
  max_delay_mode?: "fixed" | "flexible";
  audio_filtering_config?: SpeechmaticsAudioFilteringConfig;
  transcript_filtering_config?: SpeechmaticsTranscriptFilteringConfig;
  speaker_diarization_config?: SpeechmaticsSpeakerDiarizationConfig;
  /**
   * Languages to bias multilingual detection toward (Melia 1). Documented in
   * the "Language hints" section of
   * https://docs.speechmatics.com/speech-to-text/batch/input rather than in
   * the JobConfig table.
   */
  language_hints?: string[];
}

export interface SpeechmaticsNotificationConfig {
  url: string;
  contents?: Array<
    "jobinfo" | "transcript" | "transcript.json-v2" | "transcript.txt" | "transcript.srt" | "data" | "text"
  >;
  /** "post" (default) or "put". */
  method?: "post" | "put";
  auth_headers?: string[];
}

export interface SpeechmaticsTracking {
  title?: string;
  reference?: string;
  tags?: string[];
  /** Customer-defined JSON structure. */
  details?: Record<string, unknown>;
}

export interface SpeechmaticsOutputConfig {
  srt_overrides?: {
    max_line_length?: number;
    max_lines?: number;
  };
}

export interface SpeechmaticsTranslationConfig {
  /** At most 5 target languages. */
  target_languages: string[];
}

export interface SpeechmaticsLanguageIdentificationConfig {
  expected_languages?: string[];
  low_confidence_action?: "allow" | "reject" | "use_default_language";
  default_language?: string;
}

export interface SpeechmaticsSummarizationConfig {
  content_type?: "auto" | "informative" | "conversational";
  /** "brief" (default) or "detailed". */
  summary_length?: "brief" | "detailed";
  summary_type?: "paragraphs" | "bullets";
}

export interface SpeechmaticsTopicDetectionConfig {
  topics?: string[];
}

export interface SpeechmaticsAudioEventsConfig {
  types?: string[];
}

/** The `config` part of POST /v2/jobs for a transcription job. */
export interface JobConfig {
  type: "transcription";
  transcription_config: SpeechmaticsTranscriptionConfig;
  /** Fetch the media server-side instead of attaching `data_file`. */
  fetch_data?: SpeechmaticsFetchConfig;
  fetch_text?: SpeechmaticsFetchConfig;
  notification_config?: SpeechmaticsNotificationConfig[];
  tracking?: SpeechmaticsTracking;
  output_config?: SpeechmaticsOutputConfig;
  translation_config?: SpeechmaticsTranslationConfig;
  language_identification_config?: SpeechmaticsLanguageIdentificationConfig;
  summarization_config?: SpeechmaticsSummarizationConfig;
  sentiment_analysis_config?: Record<string, unknown>;
  topic_detection_config?: SpeechmaticsTopicDetectionConfig;
  auto_chapters_config?: Record<string, unknown>;
  audio_events_config?: SpeechmaticsAudioEventsConfig;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  type: z.literal("transcription"),
  transcription_config: z.looseObject({
    language: z.string().min(1),
    domain: z.string().optional(),
    output_locale: z.string().optional(),
    model: z.string().optional(),
    operating_point: z.string().optional(),
    additional_vocab: z
      .array(z.looseObject({ content: z.string(), sounds_like: z.array(z.string()).optional() }))
      .optional(),
    punctuation_overrides: z
      .looseObject({
        sensitivity: z.number().min(0).max(1).optional(),
        permitted_marks: z.array(z.string()).optional(),
      })
      .optional(),
    diarization: z.enum(["none", "speaker", "channel"]).optional(),
    channel_diarization_labels: z
      .array(z.string().regex(/^[A-Za-z0-9._]+$/, "channel_diarization_labels must match ^[A-Za-z0-9._]+$."))
      .optional(),
    enable_entities: z.boolean().optional(),
    max_delay_mode: z.enum(["fixed", "flexible"]).optional(),
    audio_filtering_config: z
      .looseObject({ volume_threshold: z.number().min(0).max(100).optional() })
      .optional(),
    transcript_filtering_config: z
      .looseObject({
        remove_disfluencies: z.boolean().optional(),
        replacements: z.array(z.looseObject({ from: z.string(), to: z.string() })).optional(),
      })
      .optional(),
    speaker_diarization_config: z
      .looseObject({
        prefer_current_speaker: z.boolean().optional(),
        speaker_sensitivity: z.number().min(0).max(1).optional(),
        get_speakers: z.boolean().optional(),
        speakers: z
          .array(
            z.looseObject({
              label: z.string().min(1),
              speaker_identifiers: z.array(z.string()).min(1),
            }),
          )
          .optional(),
      })
      .optional(),
    language_hints: z.array(z.string()).optional(),
  }),
  fetch_data: z
    .looseObject({ url: z.string().min(1), auth_headers: z.array(z.string()).optional() })
    .optional(),
  fetch_text: z
    .looseObject({ url: z.string().min(1), auth_headers: z.array(z.string()).optional() })
    .optional(),
  notification_config: z
    .array(
      z.looseObject({
        url: z.string().min(1),
        contents: z
          .array(
            z.enum([
              "jobinfo",
              "transcript",
              "transcript.json-v2",
              "transcript.txt",
              "transcript.srt",
              "data",
              "text",
            ]),
          )
          .optional(),
        method: z.enum(["post", "put"]).optional(),
        auth_headers: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  tracking: z.looseObject({}).optional(),
  output_config: z.looseObject({}).optional(),
  translation_config: z
    .looseObject({
      target_languages: z
        .array(z.string())
        .max(5, "translation_config.target_languages accepts at most 5 languages."),
    })
    .optional(),
  language_identification_config: z
    .looseObject({
      expected_languages: z.array(z.string()).optional(),
      low_confidence_action: z.enum(["allow", "reject", "use_default_language"]).optional(),
      default_language: z.string().optional(),
    })
    .optional(),
  summarization_config: z
    .looseObject({
      content_type: z.enum(["auto", "informative", "conversational"]).optional(),
      summary_length: z.enum(["brief", "detailed"]).optional(),
      summary_type: z.enum(["paragraphs", "bullets"]).optional(),
    })
    .optional(),
  sentiment_analysis_config: z.looseObject({}).optional(),
  topic_detection_config: z.looseObject({ topics: z.array(z.string()).optional() }).optional(),
  auto_chapters_config: z.looseObject({}).optional(),
  audio_events_config: z.looseObject({ types: z.array(z.string()).optional() }).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Resolves the effective model id: `model`, else `operating_point`, else the documented default. */
export function resolveModel(config: JobConfig): string {
  const tc = config.transcription_config as SpeechmaticsTranscriptionConfig | undefined;
  return tc?.model ?? tc?.operating_point ?? DEFAULT_MODEL;
}

/**
 * "`operating_point` is deprecated. It maps to `model` and accepts the same
 * `enhanced` and `standard` values." (MODELS_DOCS). Warn on use, and fail when
 * the two disagree — only one of them can win, and which one is undocumented.
 */
function checkOperatingPoint(
  config: JobConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const tc = config.transcription_config;
  if (tc?.operating_point === undefined) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["transcription_config", "operating_point"],
    model: resolveModel(config),
    message:
      "`transcription_config.operating_point` is deprecated and kept only for backward compatibility; use `transcription_config.model` instead.",
    meta: { replacement: "model", source: MODELS_DOCS },
  });
  if (tc.model !== undefined && tc.model !== tc.operating_point) {
    ctx.report({
      code: "invalid_shape",
      path: ["transcription_config", "operating_point"],
      model: tc.model,
      message: `\`transcription_config.model\` is "${tc.model}" but the deprecated \`operating_point\` is "${tc.operating_point}"; set only one.`,
      meta: { source: MODELS_DOCS },
    });
  }
}

/** Config keys Melia 1 does not support, with the doc's own wording. */
const MELIA_UNSUPPORTED: ReadonlyArray<{ path: Array<string | number>; feature: string }> = [
  { path: ["transcription_config", "additional_vocab"], feature: "custom dictionary" },
  {
    path: ["transcription_config", "transcript_filtering_config"],
    feature: "find and replace / profanity tagging",
  },
  { path: ["transcription_config", "enable_entities"], feature: "entity detection" },
  { path: ["transcription_config", "audio_filtering_config"], feature: "audio filtering" },
  { path: ["translation_config"], feature: "translation" },
  { path: ["summarization_config"], feature: "summarization" },
  { path: ["auto_chapters_config"], feature: "chapters" },
  { path: ["topic_detection_config"], feature: "topics" },
  { path: ["sentiment_analysis_config"], feature: "sentiment" },
  { path: ["audio_events_config"], feature: "audio events" },
];

function readPath(root: unknown, path: Array<string | number>): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}

/**
 * Melia 1's documented gaps (MODELS_DOCS): it "does not yet support" custom
 * vocabulary/formatting, entity detection, audio filtering, speaker
 * identification and every speech-intelligence add-on, and it requires
 * `language: "multi"` — "Melia 1 does not support the `auto` language value,
 * which returns an error."
 */
function checkMelia(config: JobConfig, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  if (resolveModel(config) !== "melia-1") return;
  const tc = config.transcription_config;

  if (tc?.language !== undefined && tc.language !== "multi") {
    ctx.report({
      code: tc.language === "auto" ? "invalid_enum_value" : "invalid_shape",
      path: ["transcription_config", "language"],
      model: "melia-1",
      message: `melia-1 is a multilingual model and requires \`language: "multi"\`; got ${JSON.stringify(tc.language)}${tc.language === "auto" ? ' — "auto" returns an error for this model' : ""}.`,
      meta: { allowed: ["multi"], value: tc.language, source: MODELS_DOCS },
    });
  }

  for (const { path, feature } of MELIA_UNSUPPORTED) {
    if (readPath(config, path) == null) continue;
    ctx.report({
      code: "unsupported_capability",
      path,
      model: "melia-1",
      message: `\`${path.join(".")}\` (${feature}) is not supported by melia-1 yet; use "standard" or "enhanced".`,
      meta: { source: MODELS_DOCS },
    });
  }

  // Diarization itself works on Melia; SPEAKER IDENTIFICATION (labelled
  // speakers / returned identifiers) does not.
  const diarization = tc?.speaker_diarization_config;
  const identification =
    diarization?.speakers !== undefined || diarization?.get_speakers !== undefined;
  if (identification) {
    ctx.report({
      code: "unsupported_capability",
      path: ["transcription_config", "speaker_diarization_config"],
      model: "melia-1",
      message:
        "speaker identification (`speakers` / `get_speakers`) is not supported by melia-1 yet; plain speaker diarization is.",
      meta: { source: MODELS_DOCS },
    });
  }
}

/**
 * "The Enhanced Medical model" is an Enhanced variant: `domain: "medical"` is
 * documented only alongside `model: "enhanced"` (MODELS_DOCS).
 */
function checkMedicalDomain(
  config: JobConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const domain = config.transcription_config?.domain;
  if (domain !== "medical") return;
  const model = resolveModel(config);
  if (model === "enhanced") return;
  ctx.report({
    code: "unsupported_capability",
    path: ["transcription_config", "domain"],
    model,
    message: `\`domain: "medical"\` selects the Enhanced Medical model and requires \`model: "enhanced"\`; got "${model}".`,
    meta: { source: MODELS_DOCS },
  });
}

/** Audio paths a media declaration may be attached to, most specific first. */
const AUDIO_PATHS: ReadonlyArray<Array<string | number>> = [["data_file"], ["fetch_data", "url"]];

function declaredAudio(
  ctx: PipelineContext,
): { path: Array<string | number>; durationSeconds?: number; bytes?: number } | undefined {
  for (const path of AUDIO_PATHS) {
    const found = findMediaDeclaration(ctx.options.media, path);
    if (found !== undefined) return { ...found, path };
  }
  return ctx.options.media?.find((d) => d.durationSeconds !== undefined || d.bytes !== undefined);
}

/** 1 GB body cap (LIMITS_DOCS); larger media must go through `fetch_data`. */
function checkDataFileSize(
  config: JobConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const declaration = findMediaDeclaration(ctx.options.media, ["data_file"]);
  const bytes = declaration?.bytes;
  if (bytes === undefined || bytes < MAX_DATA_FILE_BYTES) return;
  ctx.report({
    code: "media_too_large",
    path: ["data_file"],
    model: resolveModel(config),
    message: `the \`data_file\` part is ${bytes} bytes; Speechmatics rejects bodies of ${MAX_DATA_FILE_BYTES} bytes (1 GB) or more — submit larger media via \`fetch_data.url\`.`,
    meta: { bytes, limit: MAX_DATA_FILE_BYTES, source: LIMITS_DOCS },
  });
}

/**
 * Cost = declared audio minutes x the catalog per-minute rate. Without a
 * duration declaration the estimate is empty (the config cannot reveal it).
 */
function estimateJob(
  _config: JobConfig,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const seconds = declaredAudio(ctx)?.durationSeconds;
  if (seconds === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, seconds / 60);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `speechmatics.transcribe`. Speechmatics publishes no official JS
 * SDK for this REST endpoint, so the single self-named `"speechmatics"` target
 * returns the config unchanged; naming it keeps the call site shaped like
 * every other endpoint's and leaves room for a real SDK formatter later. Type
 * alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type JobsSdkTargets<B> = { speechmatics: () => B };

function finalize(config: JobConfig): unknown {
  const body = { ...config };
  return toValidated(
    body,
    {
      url: JOBS_URL,
      method: "POST",
      // Deliberately empty: fetch derives the multipart boundary from FormData.
      headers: {},
    },
    { sdk: { speechmatics: () => body } },
  );
}

const validator = createValidator<JobConfig, unknown>({
  endpoint: "speechmatics.transcribe",
  schema,
  modelId: resolveModel,
  catalog: models,
  checks: [checkOperatingPoint, checkMelia, checkMedicalDomain, checkDataFileSize],
  estimate: estimateJob,
  finalize,
});

/**
 * Validates the `config` object of POST /v2/jobs (Speechmatics Batch
 * transcription). The result's enumerable properties are the exact JobConfig
 * to serialize into the multipart `config` part; `.request` carries the
 * default EU1 url/method (swap in {@link jobsUrl} for another region and add
 * your own `authorization: Bearer <SPEECHMATICS_API_KEY>` header).
 *
 * Build the request body with {@link toFormData}:
 * `fetch(JOBS_URL, { method: "POST", body: toFormData({ config: validated, data_file: blob }), headers: { authorization } })`
 * — do NOT set a content-type header; fetch derives the multipart boundary.
 * Speechmatics has no official JS SDK for this REST endpoint, so
 * `.toSdk("speechmatics")` returns the config unchanged.
 *
 * Cost estimation: declare the audio length via
 * `options.media = [{ path: ["data_file"], durationSeconds }]` (or
 * `["fetch_data", "url"]`).
 */
export const transcribe = validator as unknown as {
  <T extends JobConfig>(
    config: T & ExactKeys<T, JobConfig>,
    options?: ValidateOptions,
  ): Validated<T, JobsSdkTargets<T>>;
  safe<T extends JobConfig>(
    config: T & ExactKeys<T, JobConfig>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, JobsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ---------------------------------------------------------------------------
// Multipart body
// ---------------------------------------------------------------------------

export interface SpeechmaticsJobUpload {
  /** The validated JobConfig; serialized into the `config` part as JSON. */
  config: JobConfig;
  /**
   * The media bytes. Omit when the job uses `fetch_data.url`. A string is
   * appended as-is per FormData semantics (useful for tests).
   */
  data_file?: Blob | string;
  /** Overrides the multipart filename of the `data_file` part. */
  filename?: string;
  /** Plain-text transcript for alignment-style flows that also send text. */
  text_file?: Blob | string;
}

/**
 * Builds the multipart body for POST {@link JOBS_URL}: a `config` part
 * carrying `JSON.stringify(config)` plus the optional `data_file` /
 * `text_file` parts
 * (https://docs.speechmatics.com/speech-to-text/batch/input).
 */
export function toFormData(upload: SpeechmaticsJobUpload): FormData {
  const form = new FormData();
  form.append("config", JSON.stringify(upload.config));
  appendFile(form, "data_file", upload.data_file, upload.filename);
  appendFile(form, "text_file", upload.text_file);
  return form;
}

function appendFile(form: FormData, field: string, value?: Blob | string, filename?: string): void {
  if (value === undefined) return;
  if (value instanceof Blob && filename !== undefined) form.append(field, value, filename);
  else form.append(field, value);
}
