/**
 * OpenAI speech to text — POST https://api.openai.com/v1/audio/transcriptions
 *
 * Wire notes (audited 2026-08-13 against
 * https://developers.openai.com/api/docs/api-reference/audio/createTranscription
 * and https://developers.openai.com/api/docs/guides/speech-to-text, with the
 * OpenAPI-generated openai@7.4.0 `resources/audio/transcriptions.d.ts` as a
 * cross-check):
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated params (including the `file` Blob) — do NOT
 *   JSON.stringify them. The raw-fetch path is `.request.url` +
 *   `toFormData(validated)` as the body; fetch derives the multipart
 *   content-type (with boundary) from the FormData, which is why
 *   `.request.headers` is empty.
 * - Repeated array fields (`include[]`, `timestamp_granularities[]`,
 *   `known_speaker_names[]`, `known_speaker_references[]`, `keywords[]`,
 *   `languages[]`) are appended once per element with a `[]` suffix;
 *   `chunking_strategy` rides as JSON when it is a VAD object.
 * - Uploads are capped at 25 MB (guide). The documented `file` allowlist is a
 *   list of FILE EXTENSIONS (flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav,
 *   webm); a Blob only carries a MIME type, which does not map 1:1 onto that
 *   list, so unmodel enforces the byte cap and leaves format to the API.
 * - Billing is per minute of audio. A Blob's duration cannot be read from
 *   bytes, so declare it via
 *   `options.media = [{ path: ["file"], durationSeconds }]` to get a `costUSD`
 *   estimate (and `maxCostUSD` enforcement).
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD } from "../../core/cost";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";
import { transcriptionModels } from "./audio-models";
import { transcriptionConstraints, transcriptionFamilyRules } from "./constraints";

export const AUDIO_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

const TRANSCRIPTION_DOCS =
  "https://developers.openai.com/api/docs/api-reference/audio/createTranscription";

/**
 * "Required when using `gpt-4o-transcribe-diarize` for inputs longer than 30
 * seconds." Only enforceable when the duration is declared out-of-band.
 */
export const DIARIZE_CHUNKING_THRESHOLD_SECONDS = 30;

/** "Up to 4 speakers are supported." */
export const MAX_KNOWN_SPEAKERS = 4;

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per documented model id, carrying exactly the
// params and `response_format` values that model supports. Params a model
// rejects are typed `never` so they fail at compile time.
// ---------------------------------------------------------------------------

/** Manual VAD chunking configuration. */
export interface TranscriptionVadConfig {
  type: "server_vad";
  prefix_padding_ms?: number;
  silence_duration_ms?: number;
  threshold?: number;
}

export type TranscriptionChunkingStrategy = "auto" | TranscriptionVadConfig | null;

export type TranscriptionResponseFormat =
  | "json"
  | "text"
  | "srt"
  | "verbose_json"
  | "vtt"
  | "diarized_json";

interface TranscriptionBodyCommon {
  /** The audio file to transcribe (flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm; < 25 MB). */
  file: Blob;
  /** ISO-639-1 code of the input audio; improves accuracy and latency. */
  language?: string;
  /** Sampling temperature, 0–1. */
  temperature?: number;
  /** How the audio is cut into chunks before transcription. */
  chunking_strategy?: TranscriptionChunkingStrategy;
}

/**
 * whisper-1: the only model with `timestamp_granularities`, and the only one
 * that does NOT stream ("Streaming is not supported for the `whisper-1` model
 * and will be ignored").
 */
export interface Whisper1Body extends TranscriptionBodyCommon {
  model: "whisper-1";
  prompt?: string;
  response_format?: "json" | "text" | "srt" | "verbose_json" | "vtt";
  /** Requires `response_format: "verbose_json"`. */
  timestamp_granularities?: Array<"word" | "segment">;
  stream?: never;
  include?: never;
  keywords?: never;
  languages?: never;
  known_speaker_names?: never;
  known_speaker_references?: never;
}

/** gpt-transcribe adds `keywords` / `languages` ("Supported by `gpt-transcribe`"). */
export interface GptTranscribeBody extends TranscriptionBodyCommon {
  model: "gpt-transcribe";
  prompt?: string;
  response_format?: TranscriptionResponseFormat;
  stream?: boolean | null;
  /** Words or phrases to guide transcription. */
  keywords?: string[];
  /** Possible languages of the input audio (ISO-639-1). */
  languages?: string[];
  include?: never;
  timestamp_granularities?: never;
  known_speaker_names?: never;
  known_speaker_references?: never;
}

/** gpt-4o-transcribe family: `json` only, `include: ["logprobs"]` supported. */
interface Gpt4oTranscribeCommon extends TranscriptionBodyCommon {
  prompt?: string;
  /** "the only supported format is `json`". */
  response_format?: "json";
  stream?: boolean | null;
  /** "`logprobs` only works with response_format set to `json`". */
  include?: Array<"logprobs">;
  timestamp_granularities?: never;
  keywords?: never;
  languages?: never;
  known_speaker_names?: never;
  known_speaker_references?: never;
}

export interface Gpt4oTranscribeBody extends Gpt4oTranscribeCommon {
  model: "gpt-4o-transcribe";
}

export interface Gpt4oMiniTranscribeBody extends Gpt4oTranscribeCommon {
  model: "gpt-4o-mini-transcribe";
}

export interface Gpt4oMiniTranscribeSnapshotBody extends Gpt4oTranscribeCommon {
  model: "gpt-4o-mini-transcribe-2025-12-15";
}

/** gpt-4o-transcribe-diarize: speaker annotations, no prompt, no logprobs. */
export interface Gpt4oTranscribeDiarizeBody extends TranscriptionBodyCommon {
  model: "gpt-4o-transcribe-diarize";
  /** "`diarized_json` required to receive speaker annotations". */
  response_format?: "json" | "text" | "diarized_json";
  stream?: boolean | null;
  /** Up to 4 short speaker identifiers, matching known_speaker_references[]. */
  known_speaker_names?: string[];
  /** Data-URL audio samples, 2–10 seconds each. */
  known_speaker_references?: string[];
  prompt?: never;
  include?: never;
  timestamp_granularities?: never;
  keywords?: never;
  languages?: never;
}

/** Escape hatch for models unmodel doesn't know yet (unknown_model warning). */
export interface UnknownTranscriptionModelBody<Model extends string> {
  model: FutureModelId<Model, keyof TranscriptionBodyByModel>;
  file: Blob;
  [key: string]: unknown;
}

/**
 * Closed over documented models by default. Supply a future model literal to
 * opt into the loose arm: `TranscriptionBody<"whisper-9">`.
 */
export type TranscriptionBody<FutureModel extends string = never> =
  | Whisper1Body
  | GptTranscribeBody
  | Gpt4oTranscribeBody
  | Gpt4oMiniTranscribeBody
  | Gpt4oMiniTranscribeSnapshotBody
  | Gpt4oTranscribeDiarizeBody
  | UnknownTranscriptionModelBody<FutureModel>;

interface TranscriptionBodyByModel {
  "whisper-1": Whisper1Body;
  "gpt-transcribe": GptTranscribeBody;
  "gpt-4o-transcribe": Gpt4oTranscribeBody;
  "gpt-4o-mini-transcribe": Gpt4oMiniTranscribeBody;
  "gpt-4o-mini-transcribe-2025-12-15": Gpt4oMiniTranscribeSnapshotBody;
  "gpt-4o-transcribe-diarize": Gpt4oTranscribeDiarizeBody;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type TranscriptionArm<M extends string> = M extends keyof TranscriptionBodyByModel
  ? TranscriptionBodyByModel[M]
  : UnknownTranscriptionModelBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnyTranscriptionBody = TranscriptionBody<string>;
type TranscriptionModelInput = keyof TranscriptionBodyByModel | (string & {});

// ---------------------------------------------------------------------------
// Schema — loose; per-model narrowing happens in constraints.ts (runtime) and
// the Tier-A arms (types).
// ---------------------------------------------------------------------------

const transcriptionSchema = z.looseObject({
  model: z.string(),
  file: z.instanceof(Blob),
  language: z.string().optional(),
  languages: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  prompt: z.string().optional(),
  response_format: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  timestamp_granularities: z.array(z.enum(["word", "segment"])).optional(),
  include: z.array(z.string()).optional(),
  stream: z.boolean().nullable().optional(),
  chunking_strategy: z
    .union([
      z.literal("auto"),
      z.looseObject({
        type: z.literal("server_vad"),
        prefix_padding_ms: z.number().optional(),
        silence_duration_ms: z.number().optional(),
        threshold: z.number().optional(),
      }),
    ])
    .nullable()
    .optional(),
  known_speaker_names: z.array(z.string()).optional(),
  known_speaker_references: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type LooseParams = AnyTranscriptionBody & {
  response_format?: unknown;
  timestamp_granularities?: unknown;
  include?: unknown;
  known_speaker_names?: unknown;
  known_speaker_references?: unknown;
  chunking_strategy?: unknown;
};

/** Documented field-pairing rules the API enforces server-side. */
function checkPairings(
  params: AnyTranscriptionBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const p = params as LooseParams;

  // "`response_format` must be set `verbose_json` to use timestamp
  // granularities."
  if (Array.isArray(p.timestamp_granularities) && p.timestamp_granularities.length > 0) {
    if (p.response_format !== "verbose_json") {
      ctx.report({
        code: "invalid_shape",
        path: ["timestamp_granularities"],
        model: params.model,
        message: `\`timestamp_granularities\` requires \`response_format: "verbose_json"\`; got ${JSON.stringify(p.response_format ?? undefined)}.`,
        meta: { source: TRANSCRIPTION_DOCS },
      });
    }
  }

  // "`logprobs` only works with response_format set to `json`."
  if (Array.isArray(p.include) && p.include.length > 0) {
    if (p.response_format !== undefined && p.response_format !== "json") {
      ctx.report({
        code: "invalid_shape",
        path: ["include"],
        model: params.model,
        message: `\`include: ["logprobs"]\` only works with \`response_format: "json"\`; got ${JSON.stringify(p.response_format)}.`,
        meta: { source: TRANSCRIPTION_DOCS },
      });
    }
  }

  // "Optional list of speaker names that correspond to the audio samples
  // provided in `known_speaker_references[]`. ... Up to 4 speakers."
  const names = Array.isArray(p.known_speaker_names) ? p.known_speaker_names : undefined;
  const references = Array.isArray(p.known_speaker_references)
    ? p.known_speaker_references
    : undefined;
  if (names !== undefined && names.length > MAX_KNOWN_SPEAKERS) {
    ctx.report({
      code: "invalid_shape",
      path: ["known_speaker_names"],
      model: params.model,
      message: `\`known_speaker_names\` carries ${names.length} entries; at most ${MAX_KNOWN_SPEAKERS} speakers are supported.`,
      meta: { limit: MAX_KNOWN_SPEAKERS, source: TRANSCRIPTION_DOCS },
    });
  }
  if (names !== undefined && references !== undefined && names.length !== references.length) {
    ctx.report({
      code: "invalid_shape",
      path: ["known_speaker_references"],
      model: params.model,
      message: `\`known_speaker_names\` (${names.length}) and \`known_speaker_references\` (${references.length}) must have the same number of entries — each name corresponds to one reference sample.`,
      meta: { source: TRANSCRIPTION_DOCS },
    });
  }
  if ((names === undefined) !== (references === undefined)) {
    ctx.report({
      code: "invalid_shape",
      path: [names === undefined ? "known_speaker_names" : "known_speaker_references"],
      model: params.model,
      message:
        "`known_speaker_names` and `known_speaker_references` must be provided together — each name corresponds to one reference sample.",
      meta: { source: TRANSCRIPTION_DOCS },
    });
  }
}

/**
 * "Required when using `gpt-4o-transcribe-diarize` for inputs longer than 30
 * seconds." The duration is only known when declared via options.media.
 */
function checkDiarizeChunking(
  params: AnyTranscriptionBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model !== "gpt-4o-transcribe-diarize") return;
  const p = params as LooseParams;
  if (p.chunking_strategy != null) return;
  const seconds = findMediaDeclaration(ctx.options.media, ["file"])?.durationSeconds;
  if (seconds === undefined || seconds <= DIARIZE_CHUNKING_THRESHOLD_SECONDS) return;
  ctx.report({
    code: "invalid_shape",
    path: ["chunking_strategy"],
    model: params.model,
    message: `\`chunking_strategy\` is required for gpt-4o-transcribe-diarize when the input is longer than ${DIARIZE_CHUNKING_THRESHOLD_SECONDS} seconds (declared: ${seconds}s); set it to "auto" or a server_vad config.`,
    meta: { durationSeconds: seconds, source: TRANSCRIPTION_DOCS },
  });
}

/**
 * Upload limits (25 MB). The `formats` allowlist on the family rule is a list
 * of file EXTENSIONS, and a Blob carries only a MIME type, so no `sniffed`
 * facts are passed — reportMediaIssues then checks bytes only and never
 * false-positives on format.
 */
function checkUpload(
  params: AnyTranscriptionBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const file = (params as { file?: unknown }).file;
  if (!(file instanceof Blob)) return;
  const declaration = findMediaDeclaration(ctx.options.media, ["file"]);
  for (const rule of transcriptionFamilyRules) {
    const audio = rule.media?.audio;
    if (audio === undefined) continue;
    reportMediaIssues(ctx, {
      kind: "audio",
      rule: { ...audio, formats: undefined },
      path: ["file"],
      model: params.model,
      encodedBytes: file.size,
      ...(declaration !== undefined && { declaration }),
      source: TRANSCRIPTION_DOCS,
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — billed per minute of audio (catalog cost.perAudioMinute). The
// duration cannot be read from Blob bytes, so it comes from the out-of-band
// declaration options.media = [{ path: ["file"], durationSeconds }].
// ---------------------------------------------------------------------------

function estimate(
  params: AnyTranscriptionBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const seconds =
    findMediaDeclaration(ctx.options.media, ["file"])?.durationSeconds ??
    ctx.options.media?.find((d) => d.durationSeconds !== undefined)?.durationSeconds;
  if (seconds === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, seconds / 60);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Multipart body
// ---------------------------------------------------------------------------

/** Array fields the API reads as repeated `name[]` parts. */
const REPEATED_FIELDS = new Set([
  "include",
  "timestamp_granularities",
  "known_speaker_names",
  "known_speaker_references",
  "keywords",
  "languages",
]);

/**
 * Builds the multipart body for `POST /v1/audio/transcriptions`. Null values
 * are dropped — null means "use the provider default", which multipart
 * expresses by omission.
 */
export function toFormData(params: TranscriptionBody<string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value instanceof Blob) {
      form.append(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      const field = REPEATED_FIELDS.has(key) ? `${key}[]` : key;
      for (const item of value) {
        form.append(field, typeof item === "string" ? item : JSON.stringify(item));
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

/**
 * SDK targets for `openai.transcribe`. The `openai` SDK's
 * `audio.transcriptions.create` params are wire-shaped, so the single
 * `"openai"` formatter is the identity. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type TranscriptionSdkTargets<B> = { openai: () => B };

function finalize(params: AnyTranscriptionBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: AUDIO_TRANSCRIPTIONS_URL,
      method: "POST",
      // Deliberately NOT application/json: fetch must derive the multipart
      // boundary from the FormData body itself.
      headers: {},
    },
    { sdk: { openai: () => body } },
  );
}

const validator = createValidator<AnyTranscriptionBody, unknown>({
  endpoint: "openai.transcribe",
  schema: transcriptionSchema,
  modelId: (params) => params.model,
  catalog: transcriptionModels,
  constraints: transcriptionConstraints,
  familyRules: transcriptionFamilyRules,
  checks: [checkPairings, checkDiarizeChunking, checkUpload],
  estimate,
  finalize,
});

/**
 * Validates params for POST /v1/audio/transcriptions. Known models get their
 * exact per-model surface at compile time (e.g. `timestamp_granularities` is a
 * compile error outside whisper-1, `response_format: "verbose_json"` is a
 * compile error for gpt-4o-transcribe, and `prompt` is a compile error for
 * gpt-4o-transcribe-diarize); unknown models fall back to a loose arm with a
 * runtime unknown_model warning.
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the `file` Blob), and the raw-fetch path is
 * `.request.url` + `toFormData(validated)` as the body — never
 * `JSON.stringify`. `.toSdk("openai")` returns the same object (the OpenAI SDK's
 * `audio.transcriptions.create` params are wire-shaped).
 *
 * Declare the audio duration via
 * `options.media = [{ path: ["file"], durationSeconds }]` to get a cost
 * estimate and `maxCostUSD` enforcement.
 */
export const transcribe = validator as unknown as {
  <M extends TranscriptionModelInput, T extends TranscriptionArm<M>>(
    params: T & TranscriptionArm<M> & { model: M } & ExactKeys<T, TranscriptionArm<M>>,
    options?: ValidateOptions,
  ): Validated<T & { model: M }, TranscriptionSdkTargets<T & { model: M }>>;
  safe<M extends TranscriptionModelInput, T extends TranscriptionArm<M>>(
    params: T & TranscriptionArm<M> & { model: M } & ExactKeys<T, TranscriptionArm<M>>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T & { model: M }, TranscriptionSdkTargets<T & { model: M }>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
