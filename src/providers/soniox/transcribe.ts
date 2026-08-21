import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions, MediaDeclaration } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import { models, ASYNC_MODEL_IDS, type SonioxAsyncModelId } from "./models";

export const TRANSCRIPTIONS_URL = "https://api.soniox.com/v1/transcriptions";
/** Multipart upload endpoint that yields the `file_id` used by transcriptions. */
export const FILES_URL = "https://api.soniox.com/v1/files";

const CREATE_TRANSCRIPTION_DOCS =
  "https://soniox.com/docs/api-reference/stt/transcriptions/create_transcription";
const MODELS_DOCS = "https://soniox.com/docs/stt/models";

/** "Both models support audio up to 5 hours" per request (MODELS_DOCS). */
export const MAX_AUDIO_DURATION_SECONDS = 5 * 60 * 60;

// ---------------------------------------------------------------------------
// Wire types — mirror POST /v1/transcriptions exactly (verified against
// CREATE_TRANSCRIPTION_DOCS on 2026-08-13). Realtime STT runs over the
// WebSocket API; its session configuration lives in ./realtime.
// ---------------------------------------------------------------------------

export interface SonioxTranslationOneWay {
  type: "one_way";
  /** Language everything is translated into, e.g. "fr". */
  target_language: string;
}

export interface SonioxTranslationTwoWay {
  type: "two_way";
  language_a: string;
  language_b: string;
}

export type SonioxTranslation = SonioxTranslationOneWay | SonioxTranslationTwoWay;

/** Structured context; the wire also accepts a plain string. */
export interface SonioxContextObject {
  /** General context items, e.g. { key: "Domain", value: "medicine" }. */
  general?: Array<{ key: string; value: string }> | null;
  /** Free-form text context. */
  text?: string | null;
  /** Terms that might occur in speech. */
  terms?: string[] | null;
  /** Hints how to translate specific terms; ignored if translation is off. */
  translation_terms?: Array<{ source: string; target: string }> | null;
}

export interface TranscriptionsBody {
  /** Async model id, e.g. "stt-async-v5" (max 32 chars). */
  model: SonioxAsyncModelId | (string & {});
  /** HTTPS/HTTP URL of the audio file (max 4096 chars); exclusive with `file_id`. */
  audio_url?: string;
  /** Id from a POST /v1/files upload; exclusive with `audio_url`. */
  file_id?: string;
  /** Expected languages; auto-detected when omitted. */
  language_hints?: string[];
  /** When true, the model relies more on `language_hints`. */
  language_hints_strict?: boolean;
  enable_speaker_diarization?: boolean;
  /** When true, language is detected for each part of the transcription. */
  enable_language_identification?: boolean;
  translation?: SonioxTranslation | null;
  context?: string | SonioxContextObject | null;
  /** Notified on completion or failure (max 256 chars). */
  webhook_url?: string;
  webhook_auth_header_name?: string;
  webhook_auth_header_value?: string;
  /** Optional tracking identifier, not required to be unique (max 256 chars). */
  client_reference_id?: string;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// ---------------------------------------------------------------------------

const URL_PATTERN = /^https?:\/\/\S+$/;

const schema = z
  .looseObject({
    model: z.string().min(1).max(32),
    audio_url: z
      .string()
      .max(4096)
      .regex(URL_PATTERN, "audio_url must be an http(s) URL without whitespace.")
      .optional(),
    file_id: z.string().optional(),
    language_hints: z.array(z.string()).optional(),
    language_hints_strict: z.boolean().optional(),
    enable_speaker_diarization: z.boolean().optional(),
    enable_language_identification: z.boolean().optional(),
    translation: z
      .union([
        z.looseObject({ type: z.literal("one_way"), target_language: z.string() }),
        z.looseObject({ type: z.literal("two_way"), language_a: z.string(), language_b: z.string() }),
      ])
      .nullable()
      .optional(),
    context: z.union([z.string(), z.looseObject({})]).nullable().optional(),
    webhook_url: z
      .string()
      .max(256)
      .regex(URL_PATTERN, "webhook_url must be an http(s) URL without whitespace.")
      .optional(),
    webhook_auth_header_name: z.string().max(256).optional(),
    webhook_auth_header_value: z.string().max(256).optional(),
    client_reference_id: z.string().max(256).optional(),
  })
  .superRefine((params, ctx) => {
    // Exactly one audio source: "Either audio_url or file_id must be
    // provided"; they are mutually exclusive (CREATE_TRANSCRIPTION_DOCS).
    const hasUrl = params.audio_url !== undefined;
    const hasFile = params.file_id !== undefined;
    if (hasUrl && hasFile) {
      ctx.addIssue({
        code: "custom",
        path: ["audio_url"],
        message: "`audio_url` and `file_id` are mutually exclusive; provide exactly one audio source.",
      });
    } else if (!hasUrl && !hasFile) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "either `audio_url` or `file_id` is required; the request has no audio source.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Checks + estimation
// ---------------------------------------------------------------------------

function audioPath(params: TranscriptionsBody): Array<string | number> {
  return params.audio_url !== undefined ? ["audio_url"] : ["file_id"];
}

/**
 * The wire body only references audio (URL/file id), so duration is taken
 * from options.media declarations: an exact-path match on the audio param
 * wins, else the first declaration carrying durationSeconds.
 */
function declaredDurationSeconds(
  media: MediaDeclaration[] | undefined,
  preferredPath: Array<string | number>,
): number | undefined {
  const exact = findMediaDeclaration(media, preferredPath);
  if (exact?.durationSeconds !== undefined) return exact.durationSeconds;
  return media?.find((d) => d.durationSeconds !== undefined)?.durationSeconds;
}

function checkAudioDuration(
  params: TranscriptionsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const path = audioPath(params);
  const declared = declaredDurationSeconds(ctx.options.media, path);
  if (declared !== undefined && declared > MAX_AUDIO_DURATION_SECONDS) {
    ctx.report({
      code: "media_duration_exceeded",
      path,
      model: params.model,
      message: `audio is declared as ${declared}s; Soniox caps a single transcription at ${MAX_AUDIO_DURATION_SECONDS}s (5 hours) of audio.`,
      meta: { durationSeconds: declared, limit: MAX_AUDIO_DURATION_SECONDS, source: MODELS_DOCS },
    });
  }
}

/**
 * The catalog also holds the realtime (stt-rt-*) models so their metadata and
 * $0.12/hr rate are available; they resolve here and would otherwise pass
 * unremarked. POST /v1/transcriptions is the async API and cannot serve them.
 * Ids unknown to the catalog stay a warning — they may be new async models.
 */
function checkAsyncModel(
  params: TranscriptionsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.family !== "stt-rt") return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" is a realtime model served over the Soniox WebSocket API (configure it with \`realtimeTranscription\`); POST /v1/transcriptions accepts ${ASYNC_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...ASYNC_MODEL_IDS], source: MODELS_DOCS },
  });
}

/**
 * Cost = declared audio minutes x the catalog per-minute rate. Without a
 * duration declaration the estimate is empty (STT bills by audio length,
 * which the wire body cannot reveal).
 */
function estimateTranscription(
  params: TranscriptionsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const declared = declaredDurationSeconds(ctx.options.media, audioPath(params));
  if (declared === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, minutesFromSeconds(declared));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `soniox.transcribe`. Soniox publishes no official JS SDK
 * for this REST endpoint, so the single self-named `"soniox"` target returns
 * the wire body unchanged; naming it keeps the call site identical in shape to
 * every other endpoint's and leaves room for a real SDK formatter later. Type
 * alias, not interface — an interface cannot satisfy `SdkFormatters`.
 */
type TranscriptionsSdkTargets<B> = { soniox: () => B };

function finalize(
  params: TranscriptionsBody,
): Validated<TranscriptionsBody, TranscriptionsSdkTargets<TranscriptionsBody>> {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: TRANSCRIPTIONS_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { soniox: () => body } },
  );
}

const validator = createValidator<
  TranscriptionsBody,
  Validated<TranscriptionsBody, TranscriptionsSdkTargets<TranscriptionsBody>>
>({
  endpoint: "soniox.transcribe",
  schema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkAudioDuration, checkAsyncModel],
  estimate: estimateTranscription,
  finalize,
});

/**
 * Validates params for POST https://api.soniox.com/v1/transcriptions (async
 * STT). The result's enumerable properties are the exact fetch JSON body;
 * `.request` carries url/method/static headers (add your own
 * `authorization: Bearer <SONIOX_API_KEY>`). Soniox has no official JS SDK
 * for this REST endpoint, so `.toSdk("soniox")` returns the wire body
 * unchanged.
 *
 * Cost estimation: declare the audio length via
 * `options.media = [{ path: ["audio_url"], durationSeconds }]` (or
 * `["file_id"]`) to get a `costUSD` estimate and 5-hour cap enforcement.
 *
 * Realtime STT (stt-rt-v5) runs over the WebSocket API; validate that
 * session's configuration message with `realtimeTranscription` instead.
 */
export const transcribe = validator as unknown as {
  <T extends TranscriptionsBody>(
    params: T & ExactKeys<T, TranscriptionsBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TranscriptionsSdkTargets<T>>;
  safe<T extends TranscriptionsBody>(
    params: T & ExactKeys<T, TranscriptionsBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TranscriptionsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ---------------------------------------------------------------------------
// File upload helper — POST /v1/files is multipart/form-data
// (https://soniox.com/docs/api-reference/stt/files/upload_file): a required
// `file` part plus an optional `client_reference_id` (max 256 chars).
// ---------------------------------------------------------------------------

export interface SonioxFileUploadParams {
  /** The audio bytes; strings are appended as-is per FormData semantics. */
  file: Blob | string;
  /** Overrides the multipart filename ("Original file name will be used unless a custom filename is provided"). */
  filename?: string;
  /** Optional tracking identifier (max 256 chars). */
  client_reference_id?: string;
}

/**
 * Builds the multipart body for POST {@link FILES_URL}. Raw-fetch path:
 * `fetch(FILES_URL, { method: "POST", body: toUploadFormData(params), headers: { authorization } })`
 * — do NOT set a content-type header; fetch derives the multipart boundary.
 * The response's `id` is the `file_id` accepted by `transcriptions`.
 */
export function toUploadFormData(params: SonioxFileUploadParams): FormData {
  const form = new FormData();
  if (params.file instanceof Blob && params.filename !== undefined) {
    form.append("file", params.file, params.filename);
  } else {
    form.append("file", params.file);
  }
  if (params.client_reference_id !== undefined) {
    form.append("client_reference_id", params.client_reference_id);
  }
  return form;
}
