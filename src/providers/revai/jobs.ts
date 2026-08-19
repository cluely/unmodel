/**
 * Rev AI asynchronous speech-to-text — POST https://api.rev.ai/speechtotext/v1/jobs
 *
 * Wire notes (verified 2026-08-13 against the OpenAPI bundle Rev AI publishes
 * at https://docs.rev.ai/_bundle/api/asynchronous/reference.yaml — the
 * `SubmitJobMediaUrlOptions` / `SubmitJobOptions` schemas — plus
 * https://docs.rev.ai/api/asynchronous/transcribers):
 * - Two submission shapes share one endpoint. This validator models the JSON
 *   one: `source_config` (or the deprecated `media_url`) plus the job options
 *   at the TOP LEVEL of the body. For a local file, the request is
 *   multipart/form-data with a `media` part and an `options` part carrying the
 *   same object as JSON — {@link toFormData} builds it from a validated body
 *   (it strips `source_config`/`media_url`, which are ignored when submitting
 *   from a file).
 * - Auth is `Authorization: Bearer <REV_AI_ACCESS_TOKEN>` — unmodel never
 *   touches keys.
 * - There is no `model` field: `transcriber` selects the engine
 *   (machine | human | low_cost | fusion) and is what the catalog is keyed by.
 * - Billing is per minute of audio ("Rounded up to the nearest second,
 *   15 second minimum"). The body only references media by URL, so declare the
 *   length via `options.media = [{ path: ["source_config", "url"], durationSeconds }]`
 *   (or `["media"]` for a file upload) to get a `costUSD` estimate and
 *   `maxCostUSD` enforcement. The rate depends on `language`, not only on
 *   `transcriber` — see {@link estimateJob}. Human add-ons (rush, verbatim) are
 *   NOT estimated; the per-channel multiplier of `speaker_channels_count` is.
 * - Streaming STT runs over the Rev AI WebSocket API, which unmodel does not
 *   validate.
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
import {
  models,
  DEFAULT_TRANSCRIBER,
  MINIMUM_BILLED_SECONDS,
  FOREIGN_LANGUAGE_USD_PER_MINUTE,
  type RevaiTranscriber,
} from "./models";

export const JOBS_URL = "https://api.rev.ai/speechtotext/v1/jobs";

const REFERENCE_DOCS = "https://docs.rev.ai/api/asynchronous/reference";
const TRANSCRIBERS_DOCS = "https://docs.rev.ai/api/asynchronous/transcribers";

/**
 * "Most languages support media files with duration up to 17 hours, with the
 * exception for Telugu (`te`) which has a limit of 6 hours."
 */
export const MAX_MEDIA_DURATION_SECONDS = 17 * 60 * 60;
export const TELUGU_MAX_MEDIA_DURATION_SECONDS = 6 * 60 * 60;

/** "Limited to files less than 2GB in size" for the multipart `media` part. */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

/** "Segments must be at least 1 minute in length and cannot overlap." */
export const MIN_SEGMENT_SECONDS = 60;

/** `delete_after_seconds` ranges from 0 to 2592000 (30 days). */
export const MAX_DELETE_AFTER_SECONDS = 2_592_000;

// ---------------------------------------------------------------------------
// Wire types — mirror SubmitJobMediaUrlOptions exactly.
// ---------------------------------------------------------------------------

/** Only the `Authorization` header may be passed, as `<scheme> <token>`. */
export interface RevaiAuthHeaders {
  Authorization?: string;
  [header: string]: string | undefined;
}

export interface RevaiSourceConfig {
  /** Direct download media url (max 2048 chars). */
  url: string;
  auth_headers?: RevaiAuthHeaders;
}

export interface RevaiNotificationConfig {
  /** Callback url invoked on completion (max 2048 chars). */
  url: string;
  auth_headers?: RevaiAuthHeaders;
}

export interface RevaiSegment {
  /** Seconds from the start of the audio (centisecond precision). */
  start: number;
  end: number;
}

export interface RevaiSpeakerName {
  /** Max 50 characters. */
  display_name: string;
}

export interface RevaiCustomVocabulary {
  /** 1–6000 phrases; a phrase holds up to 12 words of up to 34 characters. */
  phrases: string[];
}

export interface RevaiSummarizationConfig {
  /** "standard" (default) or "premium". */
  model?: "standard" | "premium";
  /** "paragraph" (default) or "bullets"; mutually exclusive with `prompt`. */
  type?: "paragraph" | "bullets";
  /** Custom prompt; mutually exclusive with `type`. */
  prompt?: string | null;
}

export interface RevaiTranslationTarget {
  language: string;
  /** "standard" (default) or "premium". */
  model?: "standard" | "premium";
}

export interface RevaiTranslationConfig {
  /** 1–5 target languages. */
  target_languages: RevaiTranslationTarget[];
}

export interface JobsBody {
  /** Media source; mutually exclusive with the deprecated `media_url`. */
  source_config?: RevaiSourceConfig;
  /** @deprecated Use `source_config` (auth headers + encrypted storage). */
  media_url?: string;
  /** Free-form job metadata, max 512 characters. */
  metadata?: string;
  /** @deprecated Use `notification_config`. */
  callback_url?: string;
  notification_config?: RevaiNotificationConfig;
  /** Auto-delete delay after completion, 0–2592000 seconds. */
  delete_after_seconds?: number;
  /** Engine to transcribe with; defaults to "machine" (Reverb). */
  transcriber?: RevaiTranscriber | (string & {});
  /** Transcribe every syllable; defaults true for machine, false for human. */
  verbatim?: boolean;
  /** Human only: higher priority (+$1.25/min). */
  rush?: boolean;
  /** Human only: mock a job without transcribing or charging. */
  test_mode?: boolean;
  /** Human only: which sections to transcribe (>= 1 minute, non-overlapping). */
  segments_to_transcribe?: RevaiSegment[];
  /** Human only: up to 100 speaker names, 50 characters each. */
  speaker_names?: RevaiSpeakerName[];
  skip_diarization?: boolean;
  /** English and Spanish only: skip ITN, casing and punctuation. */
  skip_postprocessing?: boolean;
  skip_punctuation?: boolean;
  /** Machine only: drop 'ums' and 'uhs' (also drops atmospherics). */
  remove_disfluencies?: boolean;
  /** Machine only: drop `<laugh>`, `<affirmative>` and friends. */
  remove_atmospherics?: boolean;
  filter_profanity?: boolean;
  /** English/Spanish/French, machine only: unique speaker channels, 1–8. */
  speaker_channels_count?: number;
  /** English/Spanish/French, machine only: known number of speakers, >= 1. */
  speakers_count?: number;
  /** "standard" (default) or "premium"; not available for human or low_cost. */
  diarization_type?: "standard" | "premium";
  /** Beta: id of a pre-completed custom vocabulary; excludes `custom_vocabularies`. */
  custom_vocabulary_id?: string;
  /** 1–50 vocabulary objects; excludes `custom_vocabulary_id`. */
  custom_vocabularies?: RevaiCustomVocabulary[];
  /** Use exact phrases only; enabled by default. */
  strict_custom_vocabulary?: boolean;
  /** Machine only. */
  summarization_config?: RevaiSummarizationConfig;
  /** Machine only. */
  translation_config?: RevaiTranslationConfig;
  /** Mixed-language identification; only meaningful with `language: "auto"`. */
  enable_multilingual?: boolean;
  /** ISO 639-1 code (plus en-us, en-gb, en/es, cmn); defaults to "en". */
  language?: string;
  /** Improved per-word timestamps; not available in the low-cost environment. */
  forced_alignment?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// ---------------------------------------------------------------------------

const URL_PATTERN = /^https?:\/\/\S+$/;

const authHeaders = z.looseObject({ Authorization: z.string().optional() });

const schema = z
  .looseObject({
    source_config: z
      .looseObject({
        url: z.string().max(2048).regex(URL_PATTERN, "source_config.url must be an http(s) URL."),
        auth_headers: authHeaders.optional(),
      })
      .optional(),
    media_url: z
      .string()
      .max(2048)
      .regex(URL_PATTERN, "media_url must be an http(s) URL.")
      .optional(),
    metadata: z.string().max(512).optional(),
    callback_url: z.string().max(1024).optional(),
    notification_config: z
      .looseObject({
        url: z
          .string()
          .max(2048)
          .regex(URL_PATTERN, "notification_config.url must be an http(s) URL."),
        auth_headers: authHeaders.optional(),
      })
      .optional(),
    delete_after_seconds: z.number().int().min(0).max(MAX_DELETE_AFTER_SECONDS).optional(),
    transcriber: z.string().optional(),
    verbatim: z.boolean().optional(),
    rush: z.boolean().optional(),
    test_mode: z.boolean().optional(),
    segments_to_transcribe: z
      .array(z.looseObject({ start: z.number().min(0), end: z.number().min(0) }))
      .optional(),
    speaker_names: z
      .array(z.looseObject({ display_name: z.string().min(1).max(50) }))
      .max(100, "speaker_names accepts at most 100 names.")
      .optional(),
    skip_diarization: z.boolean().optional(),
    skip_postprocessing: z.boolean().optional(),
    skip_punctuation: z.boolean().optional(),
    remove_disfluencies: z.boolean().optional(),
    remove_atmospherics: z.boolean().optional(),
    filter_profanity: z.boolean().optional(),
    speaker_channels_count: z.number().int().min(1).max(8).optional(),
    speakers_count: z.number().int().min(1).optional(),
    diarization_type: z.enum(["standard", "premium"]).optional(),
    custom_vocabulary_id: z.string().optional(),
    custom_vocabularies: z
      .array(
        z.looseObject({
          phrases: z
            .array(z.string())
            .min(1, "custom_vocabularies[].phrases needs at least one phrase.")
            .max(6000, "custom_vocabularies[].phrases accepts at most 6000 phrases."),
        }),
      )
      .min(1)
      .max(50, "custom_vocabularies accepts at most 50 entries.")
      .optional(),
    strict_custom_vocabulary: z.boolean().optional(),
    summarization_config: z
      .looseObject({
        model: z.enum(["standard", "premium"]).optional(),
        type: z.enum(["paragraph", "bullets"]).optional(),
        prompt: z.string().nullable().optional(),
      })
      .optional(),
    translation_config: z
      .looseObject({
        target_languages: z
          .array(
            z.looseObject({
              language: z.string().min(1),
              model: z.enum(["standard", "premium"]).optional(),
            }),
          )
          .min(1, "translation_config.target_languages needs at least one language.")
          .max(5, "translation_config.target_languages accepts at most 5 languages."),
      })
      .optional(),
    enable_multilingual: z.boolean().optional(),
    language: z.string().optional(),
    forced_alignment: z.boolean().optional(),
  })
  .superRefine((params, ctx) => {
    // "Only one of `source_config` and `media_url` may be set." A file upload
    // carries neither, so absence is not an error here — toFormData covers it.
    if (params.source_config !== undefined && params.media_url !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["source_config"],
        message:
          "`source_config` and `media_url` are mutually exclusive; provide at most one media source.",
      });
    }
    // "Cannot be set if `callback_url` is set."
    if (params.notification_config !== undefined && params.callback_url !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["notification_config"],
        message: "`notification_config` cannot be set together with the deprecated `callback_url`.",
      });
    }
    // "You cannot use both `custom_vocabulary_id` and `custom_vocabularies` at
    // the same time, and doing so will result in a 400 response."
    if (params.custom_vocabulary_id !== undefined && params.custom_vocabularies !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["custom_vocabulary_id"],
        message:
          "`custom_vocabulary_id` and `custom_vocabularies` cannot both be set; the API answers 400.",
      });
    }
    // "`prompt` and `type` parameters are mutually exclusive."
    const summarization = params.summarization_config;
    if (summarization?.type !== undefined && summarization.prompt != null) {
      ctx.addIssue({
        code: "custom",
        path: ["summarization_config", "prompt"],
        message: "`summarization_config.prompt` and `summarization_config.type` are mutually exclusive.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function transcriberOf(params: JobsBody): string {
  return params.transcriber ?? DEFAULT_TRANSCRIBER;
}

/** Params documented as "Only available for `human` transcriber option". */
const HUMAN_ONLY: ReadonlyArray<keyof JobsBody> = [
  "rush",
  "test_mode",
  "segments_to_transcribe",
  "speaker_names",
];

/** Params documented as "not available for human transcription jobs". */
const MACHINE_ONLY: ReadonlyArray<keyof JobsBody> = [
  "remove_disfluencies",
  "remove_atmospherics",
  "speaker_channels_count",
  "speakers_count",
  "diarization_type",
  "summarization_config",
  "translation_config",
];

function checkTranscriberScope(
  params: JobsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const transcriber = transcriberOf(params);
  const record = params as unknown as Record<string, unknown>;
  const isHuman = transcriber === "human";

  for (const key of HUMAN_ONLY) {
    if (record[key] == null) continue;
    if (isHuman) continue;
    ctx.report({
      code: "unsupported_param",
      path: [key],
      model: transcriber,
      message: `\`${String(key)}\` is only available for \`transcriber: "human"\`; got "${transcriber}".`,
      meta: { source: REFERENCE_DOCS },
    });
  }

  if (!isHuman) return;
  for (const key of MACHINE_ONLY) {
    if (record[key] == null) continue;
    ctx.report({
      code: "unsupported_param",
      path: [key],
      model: transcriber,
      message: `\`${String(key)}\` is not available for human transcription jobs.`,
      meta: { source: REFERENCE_DOCS },
    });
  }
}

/**
 * "This option is not available for human transcription jobs and low-cost
 * environment" (`diarization_type`) and "This option is not available in
 * low-cost environment" (`forced_alignment`).
 */
function checkLowCost(params: JobsBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  if (transcriberOf(params) !== "low_cost") return;
  if (params.diarization_type != null) {
    ctx.report({
      code: "unsupported_param",
      path: ["diarization_type"],
      model: "low_cost",
      message: "`diarization_type` is not available in the low-cost environment.",
      meta: { source: REFERENCE_DOCS },
    });
  }
  if (params.forced_alignment != null) {
    ctx.report({
      code: "unsupported_param",
      path: ["forced_alignment"],
      model: "low_cost",
      message: "`forced_alignment` is not available in the low-cost environment.",
      meta: { source: REFERENCE_DOCS },
    });
  }
}

/**
 * "the following parameters may **not** be used with non-English languages:
 * `skip_punctuation`, `remove_disfluencies`, `filter_profanity`,
 * `speaker_channels_count`, `custom_vocabulary_id`."
 *
 * Rev AI's English codes are `en`, `en-us`, `en-gb`; `en/es` is the
 * multilingual English/Spanish pack, which is not plain English.
 */
const ENGLISH_LANGUAGES: readonly string[] = ["en", "en-us", "en-gb"];
const ENGLISH_ONLY_PARAMS: ReadonlyArray<keyof JobsBody> = [
  "skip_punctuation",
  "remove_disfluencies",
  "filter_profanity",
  "speaker_channels_count",
  "custom_vocabulary_id",
];

/** `language` defaults to "en", so an absent language is an English job. */
function isEnglishJob(params: JobsBody): boolean {
  const language = params.language;
  return language === undefined || ENGLISH_LANGUAGES.includes(language);
}

function checkLanguageScope(
  params: JobsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const language = params.language;
  if (isEnglishJob(params)) return;
  const record = params as unknown as Record<string, unknown>;
  for (const key of ENGLISH_ONLY_PARAMS) {
    if (record[key] == null) continue;
    ctx.report({
      code: "unsupported_param",
      path: [key],
      model: transcriberOf(params),
      message: `\`${String(key)}\` may not be used with non-English languages; \`language\` is "${language}".`,
      meta: { language, source: REFERENCE_DOCS },
    });
  }

  // "The `transcriber` option is ignored for non-English transcription
  // requests." (TRANSCRIBERS_DOCS) — worth knowing, but the request succeeds.
  if (params.transcriber !== undefined) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["transcriber"],
      model: params.transcriber,
      message: `\`transcriber\` is ignored for non-English transcription requests; \`language\` is "${language}".`,
      meta: { ignored: true, language, source: TRANSCRIBERS_DOCS },
    });
  }
}

/** "Segments must be at least 1 minute in length and cannot overlap." */
function checkSegments(params: JobsBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const segments = params.segments_to_transcribe;
  if (!Array.isArray(segments) || segments.length === 0) return;

  segments.forEach((segment, i) => {
    if (segment.end - segment.start < MIN_SEGMENT_SECONDS) {
      ctx.report({
        code: "invalid_shape",
        path: ["segments_to_transcribe", i],
        model: transcriberOf(params),
        message: `segment ${segment.start}–${segment.end} is ${segment.end - segment.start}s; segments must be at least ${MIN_SEGMENT_SECONDS}s long.`,
        meta: { limit: MIN_SEGMENT_SECONDS, source: TRANSCRIBERS_DOCS },
      });
    }
  });

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous === undefined || current === undefined) continue;
    if (current.start < previous.end) {
      ctx.report({
        code: "invalid_shape",
        path: ["segments_to_transcribe"],
        model: transcriberOf(params),
        message: `segments overlap: ${previous.start}–${previous.end} and ${current.start}–${current.end}; segments cannot overlap.`,
        meta: { source: TRANSCRIBERS_DOCS },
      });
      break;
    }
  }
}

/** Media paths a declaration may be attached to, most specific first. */
const MEDIA_PATHS: ReadonlyArray<Array<string | number>> = [
  ["source_config", "url"],
  ["media_url"],
  ["media"],
];

function declaredMedia(
  ctx: PipelineContext,
): { path: Array<string | number>; durationSeconds?: number; bytes?: number } | undefined {
  for (const path of MEDIA_PATHS) {
    const found = findMediaDeclaration(ctx.options.media, path);
    if (found !== undefined) return { ...found, path };
  }
  return ctx.options.media?.find((d) => d.durationSeconds !== undefined || d.bytes !== undefined);
}

function checkMediaLimits(
  params: JobsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const declaration = declaredMedia(ctx);
  const seconds = declaration?.durationSeconds;
  const limit =
    params.language === "te" ? TELUGU_MAX_MEDIA_DURATION_SECONDS : MAX_MEDIA_DURATION_SECONDS;
  if (seconds !== undefined && seconds > limit) {
    ctx.report({
      code: "media_duration_exceeded",
      path: declaration?.path ?? ["source_config", "url"],
      model: transcriberOf(params),
      message: `media is declared as ${seconds}s; Rev AI caps a job at ${limit}s (${limit / 3600} hours)${params.language === "te" ? ' for Telugu ("te")' : ""}.`,
      meta: { durationSeconds: seconds, limit, source: REFERENCE_DOCS },
    });
  }

  const bytes = findMediaDeclaration(ctx.options.media, ["media"])?.bytes;
  if (bytes !== undefined && bytes >= MAX_MEDIA_BYTES) {
    ctx.report({
      code: "media_too_large",
      path: ["media"],
      model: transcriberOf(params),
      message: `the uploaded \`media\` part is ${bytes} bytes; Rev AI limits it to files "less than 2GB" — submit larger media via \`source_config.url\`.`,
      meta: { bytes, limit: MAX_MEDIA_BYTES, source: REFERENCE_DOCS },
    });
  }
}

/**
 * USD per audio MINUTE for this job (the unit of `ModelCost.perAudioMinute`).
 *
 * Non-English audio is not billed at the transcriber's catalog rate: it bills
 * at "Reverb Foreign Language Transcription $0.30 per hour" — 1.5x Reverb's
 * $0.20/hr and 3x Reverb Turbo's $0.10/hr (https://www.rev.ai/pricing) —
 * because "The `transcriber` option is ignored for non-English transcription
 * requests" (TRANSCRIBERS_DOCS; {@link checkLanguageScope} warns about it).
 * Human transcription is a separate product billed at its own, higher
 * per-minute rate, so the catalog rate wins whenever it is above the
 * foreign-language one — an estimate is never talked down by `language`.
 */
function audioMinuteRateUSD(params: JobsBody, info: ModelInfo | undefined): number | undefined {
  const catalogRate = info?.cost?.perAudioMinute;
  if (isEnglishJob(params)) return catalogRate;
  return Math.max(FOREIGN_LANGUAGE_USD_PER_MINUTE, catalogRate ?? 0);
}

/**
 * Cost = declared audio minutes (floored at the documented 15-second minimum)
 * x the per-minute rate for the job ({@link audioMinuteRateUSD} — the catalog
 * rate for English, the foreign-language rate otherwise), multiplied by
 * `speaker_channels_count` when set ("The amount charged will be the duration
 * of the file multiplied by the number of channels specified"). Human add-ons
 * are not included.
 */
function estimateJob(
  params: JobsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const seconds = declaredMedia(ctx)?.durationSeconds;
  if (seconds === undefined) return {};
  const billed = Math.max(seconds, MINIMUM_BILLED_SECONDS);
  const channels = params.speaker_channels_count ?? 1;
  const costUSD = computeAudioMinutesCostUSD(
    { perAudioMinute: audioMinuteRateUSD(params, info) },
    (billed / 60) * channels,
  );
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `revai.jobs`. Rev AI's JS SDK takes wire-shaped job options,
 * so the single `"revai"` formatter is the identity. Type alias, not
 * interface: an interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type JobsSdkTargets<B> = { revai: () => B };

function finalize(params: JobsBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: JOBS_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { revai: () => body } },
  );
}

const validator = createValidator<JobsBody, unknown>({
  endpoint: "revai.jobs",
  schema,
  // Rev AI has no `model` field; `transcriber` selects the engine and is what
  // the catalog is keyed by. The documented default is "machine".
  modelId: transcriberOf,
  catalog: models,
  checks: [
    checkTranscriberScope,
    checkLowCost,
    checkLanguageScope,
    checkSegments,
    checkMediaLimits,
  ],
  estimate: estimateJob,
  finalize,
});

/**
 * Validates params for POST https://api.rev.ai/speechtotext/v1/jobs
 * (asynchronous STT). The result's enumerable properties are the exact fetch
 * JSON body; `.request` carries url/method/static headers (add your own
 * `authorization: Bearer <REV_AI_ACCESS_TOKEN>`). Rev AI's JS SDK takes
 * wire-shaped job options, so `.toSdk("revai")` returns the body unchanged.
 *
 * For a local file, POST the same object as the `options` part of a multipart
 * request built with {@link toFormData} instead of JSON.
 *
 * Cost estimation: declare the media length via
 * `options.media = [{ path: ["source_config", "url"], durationSeconds }]`.
 *
 * Streaming STT runs over the Rev AI WebSocket API and is not validated by
 * unmodel.
 */
export const jobs = validator as unknown as {
  <T extends JobsBody>(
    params: T & ExactKeys<T, JobsBody>,
    options?: ValidateOptions,
  ): Validated<T, JobsSdkTargets<T>>;
  safe<T extends JobsBody>(
    params: T & ExactKeys<T, JobsBody>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, JobsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ---------------------------------------------------------------------------
// Multipart body
// ---------------------------------------------------------------------------

export interface RevaiJobUpload {
  /** The media bytes; "Limited to files less than 2GB in size". */
  media: Blob | string;
  /** Overrides the multipart filename of the `media` part. */
  filename?: string;
  /** Job options; `source_config` / `media_url` are dropped (file wins). */
  options?: JobsBody;
}

/**
 * Builds the multipart body for a file submission to {@link JOBS_URL}: a
 * `media` part plus an `options` part carrying the job options as JSON.
 * `source_config` and `media_url` are stripped — the reference documents them
 * as "Ignored if submitting job from file", and sending both is misleading.
 *
 * Raw-fetch path:
 * `fetch(JOBS_URL, { method: "POST", body: toFormData({ media, options: validated }), headers: { authorization } })`
 * — do NOT set a content-type header; fetch derives the multipart boundary.
 */
export function toFormData(upload: RevaiJobUpload): FormData {
  const form = new FormData();
  if (upload.media instanceof Blob && upload.filename !== undefined) {
    form.append("media", upload.media, upload.filename);
  } else {
    form.append("media", upload.media);
  }
  if (upload.options !== undefined) {
    const { source_config: _source, media_url: _url, ...options } = upload.options;
    if (Object.keys(options).length > 0) form.append("options", JSON.stringify(options));
  }
  return form;
}
