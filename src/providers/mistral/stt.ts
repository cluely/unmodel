/**
 * Mistral speech to text — POST https://api.mistral.ai/v1/audio/transcriptions
 *
 * Wire notes (verified 2026-08-13 against the OpenAPI document Mistral
 * publishes at https://docs.mistral.ai/openapi.yaml — the
 * `AudioTranscriptionRequest` schema — plus
 * https://docs.mistral.ai/studio/audio/speech_to_text/offline_transcription):
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated params (including the `file` Blob) — do NOT
 *   JSON.stringify them. The raw-fetch path is `.request.url` +
 *   {@link toFormData}(validated) as the body; fetch derives the multipart
 *   content-type (with boundary) from the FormData, which is why
 *   `.request.headers` is empty.
 * - Auth is `Authorization: Bearer <MISTRAL_API_KEY>` — unmodel never touches
 *   keys.
 * - The audio comes from exactly one of `file` (bytes), `file_url` (remote
 *   URL, max 2083 chars) or `file_id` (an id from POST /v1/files).
 * - `timestamp_granularities` is repeated once per value in the form (the
 *   docs' curl uses `-F "timestamp_granularities=segment"`), as is
 *   `context_bias`.
 * - `stream` is pinned to `false` here: the SSE variant is a separate
 *   operation (`AudioTranscriptionRequestStream`, `stream: true`), and live
 *   transcription runs over the realtime WebSocket API, which unmodel does not
 *   validate.
 * - Billing is per minute of audio. A Blob's duration cannot be read from
 *   bytes, so declare it via
 *   `options.media = [{ path: ["file"], durationSeconds }]` (or
 *   `["file_url"]` / `["file_id"]`) to get a `costUSD` estimate, `maxCostUSD`
 *   enforcement, and the per-model audio-length cap.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import {
  transcriptionModels,
  TRANSCRIPTION_MAX_AUDIO_SECONDS,
  TRANSCRIPTION_MODEL_IDS,
  REALTIME_MODEL_IDS,
} from "./audio-models";

export const AUDIO_TRANSCRIPTIONS_URL = "https://api.mistral.ai/v1/audio/transcriptions";
/** Multipart upload endpoint that yields the `file_id` accepted below. */
export const FILES_URL = "https://api.mistral.ai/v1/files";

const TRANSCRIPTION_DOCS =
  "https://docs.mistral.ai/studio/audio/speech_to_text/offline_transcription";

/**
 * "context_bias: Provide up to 100 words or phrases to guide the model toward
 * correct spellings of names, technical terms, or domain-specific vocabulary."
 */
export const MAX_CONTEXT_BIAS_TERMS = 100;

/** `file_url` is documented with `maxLength: 2083`. */
export const MAX_FILE_URL_LENGTH = 2083;

// ---------------------------------------------------------------------------
// Wire types — mirror AudioTranscriptionRequest exactly.
// ---------------------------------------------------------------------------

export type MistralTimestampGranularity = "segment" | "word";

export interface TranscriptionBody {
  /** Transcription model id, e.g. "voxtral-mini-latest". */
  model: string;
  /** The audio bytes; exclusive with `file_url` and `file_id`. */
  file?: Blob;
  /** URL of the audio to transcribe (max 2083 chars). */
  file_url?: string;
  /** Id of a file uploaded to POST /v1/files. */
  file_id?: string;
  /** Two-letter language code, e.g. "en"; boosts accuracy when known. */
  language?: string | null;
  temperature?: number | null;
  /** This endpoint is the non-streaming operation. */
  stream?: false;
  /** Keep track of who is talking. */
  diarize?: boolean;
  /** Up to 100 words/phrases (no commas or whitespace inside a term). */
  context_bias?: string[];
  /** Timestamps to include in the response. */
  timestamp_granularities?: MistralTimestampGranularity[];
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// ---------------------------------------------------------------------------

const URL_PATTERN = /^https?:\/\/\S+$/;

const schema = z
  .looseObject({
    model: z.string().min(1),
    file: z.instanceof(Blob).optional(),
    file_url: z
      .string()
      .max(MAX_FILE_URL_LENGTH)
      .regex(URL_PATTERN, "file_url must be an http(s) URL without whitespace.")
      .optional(),
    file_id: z.string().min(1).optional(),
    // The documented pattern is ^\w{2}$ — a two-letter code such as "en".
    language: z
      .string()
      .regex(/^\w{2}$/, "language must be a two-letter code such as \"en\".")
      .nullable()
      .optional(),
    temperature: z.number().nullable().optional(),
    stream: z
      .literal(false, "`stream: true` is a different operation; unmodel validates the non-streaming transcription endpoint.")
      .optional(),
    diarize: z.boolean().optional(),
    context_bias: z
      .array(
        z
          .string()
          .regex(/^[^,\s]+$/, "context_bias terms cannot contain commas or whitespace."),
      )
      .max(
        MAX_CONTEXT_BIAS_TERMS,
        `context_bias accepts at most ${MAX_CONTEXT_BIAS_TERMS} words or phrases.`,
      )
      .optional(),
    timestamp_granularities: z.array(z.enum(["segment", "word"])).optional(),
  })
  .superRefine((params, ctx) => {
    // Exactly one audio source: `file`, `file_url` or `file_id`.
    const sources = (["file", "file_url", "file_id"] as const).filter(
      (key) => params[key] !== undefined,
    );
    if (sources.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: [sources[1] ?? "file_url"],
        message: `\`${sources.join("`, `")}\` are mutually exclusive; provide exactly one audio source.`,
      });
    } else if (sources.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "either `file`, `file_url` or `file_id` is required; the request has no audio source.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Where the audio lives in the params, for media declarations and messages. */
function audioPath(params: TranscriptionBody): Array<string | number> {
  if (params.file !== undefined) return ["file"];
  if (params.file_url !== undefined) return ["file_url"];
  return ["file_id"];
}

/**
 * "timestamp_granularities is currently not compatible with language, please
 * use either one or the other." (TRANSCRIPTION_DOCS)
 */
function checkTimestampLanguage(
  params: TranscriptionBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const granularities = params.timestamp_granularities;
  if (!Array.isArray(granularities) || granularities.length === 0) return;
  if (params.language == null) return;
  ctx.report({
    code: "invalid_shape",
    path: ["timestamp_granularities"],
    model: params.model,
    message: `\`timestamp_granularities\` is not compatible with \`language\` (${JSON.stringify(params.language)}); use one or the other.`,
    meta: { source: TRANSCRIPTION_DOCS },
  });
}

/**
 * The realtime model is served over the WebSocket API, not by this endpoint.
 * Ids unknown to the catalog stay a warning — they may be new transcribe
 * models.
 */
function checkTranscriptionModel(
  params: TranscriptionBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (REALTIME_MODEL_IDS.includes(params.model)) {
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message: `"${params.model}" is a realtime model served over the Mistral realtime WebSocket API, which unmodel does not validate; POST /v1/audio/transcriptions accepts ${TRANSCRIPTION_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
      meta: { allowed: [...TRANSCRIPTION_MODEL_IDS], source: TRANSCRIPTION_DOCS },
    });
    return;
  }
  // A catalogued model that is not a transcription model (a text/TTS id) can
  // never serve this endpoint.
  if (info === undefined) return;
  if (TRANSCRIPTION_MODEL_IDS.includes(params.model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" is not a Mistral transcription model; POST /v1/audio/transcriptions accepts ${TRANSCRIPTION_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...TRANSCRIPTION_MODEL_IDS], source: TRANSCRIPTION_DOCS },
  });
}

function declaredDurationSeconds(
  ctx: PipelineContext,
  preferredPath: Array<string | number>,
): number | undefined {
  const exact = findMediaDeclaration(ctx.options.media, preferredPath);
  if (exact?.durationSeconds !== undefined) return exact.durationSeconds;
  return ctx.options.media?.find((d) => d.durationSeconds !== undefined)?.durationSeconds;
}

/** Per-model audio-length caps (≈15 minutes / ≈3 hours). */
function checkAudioDuration(
  params: TranscriptionBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = TRANSCRIPTION_MAX_AUDIO_SECONDS[params.model];
  if (limit === undefined) return;
  const path = audioPath(params);
  const seconds = declaredDurationSeconds(ctx, path);
  if (seconds === undefined || seconds <= limit) return;
  ctx.report({
    code: "media_duration_exceeded",
    path,
    model: params.model,
    message: `audio is declared as ${seconds}s; "${params.model}" transcribes about ${limit}s (${limit / 60} minutes) per request.`,
    meta: { durationSeconds: seconds, limit, source: TRANSCRIPTION_DOCS },
  });
}

/**
 * Cost = declared audio minutes x the catalog per-minute rate. Without a
 * duration declaration the estimate is empty (bytes cannot reveal duration).
 */
function estimateTranscription(
  params: TranscriptionBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const seconds = declaredDurationSeconds(ctx, audioPath(params));
  if (seconds === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, minutesFromSeconds(seconds));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Multipart body
// ---------------------------------------------------------------------------

/**
 * Builds the multipart body for POST {@link AUDIO_TRANSCRIPTIONS_URL}. Null
 * values are dropped — null means "use the provider default", which multipart
 * expresses by omission. Array fields (`timestamp_granularities`,
 * `context_bias`) are repeated under their PLAIN name, with no `[]` suffix:
 * the docs' curl sends `-F "timestamp_granularities=segment"`.
 */
export function toFormData(params: TranscriptionBody): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value instanceof Blob) {
      form.append(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        form.append(key, typeof item === "string" ? item : JSON.stringify(item));
      }
      continue;
    }
    if (typeof value === "object") {
      form.append(key, JSON.stringify(value));
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `mistral.stt`. `@mistralai/mistralai`'s
 * `audio.transcriptions.complete` params are wire-shaped (except that it takes
 * `file` as `{ content, fileName }`), so the single `"mistral"` formatter is
 * the identity. Type alias, not interface: an interface has no implicit index
 * signature and cannot satisfy `SdkFormatters`.
 */
type TranscriptionSdkTargets<B> = { mistral: () => B };

function finalize(params: TranscriptionBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: AUDIO_TRANSCRIPTIONS_URL,
      method: "POST",
      // Deliberately NOT application/json: fetch must derive the multipart
      // boundary from the FormData body itself.
      headers: {},
      body: "form",
    },
    { sdk: { mistral: () => body } },
  );
}

const validator = createValidator<TranscriptionBody, unknown>({
  endpoint: "mistral.stt",
  schema,
  modelId: (params) => params.model,
  catalog: transcriptionModels,
  checks: [checkTimestampLanguage, checkTranscriptionModel, checkAudioDuration],
  estimate: estimateTranscription,
  finalize,
});

/**
 * Validates params for POST https://api.mistral.ai/v1/audio/transcriptions.
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the `file` Blob), and the raw-fetch path is
 * `.request.url` + `toFormData(validated)` as the body — never
 * `JSON.stringify`. `.toSdk("mistral")` returns the same object (the Mistral SDK's
 * `audio.transcriptions.complete` params are wire-shaped, except that it takes
 * `file` as `{ content, fileName }`).
 *
 * Declare the audio duration via
 * `options.media = [{ path: ["file"], durationSeconds }]` to get a cost
 * estimate, `maxCostUSD` enforcement, and the per-model audio-length cap.
 *
 * Live transcription (voxtral-mini-transcribe-realtime-2602) runs over the
 * realtime WebSocket API and is not validated by unmodel.
 */
export const stt = validator as unknown as {
  <T extends TranscriptionBody>(
    params: T & ExactKeys<T, TranscriptionBody>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, TranscriptionSdkTargets<T>>;
  safe<T extends TranscriptionBody>(
    params: T & ExactKeys<T, TranscriptionBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, TranscriptionSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
