/**
 * Fish Audio Text to Speech — POST https://api.fish.audio/v1/tts
 *
 * Wire reference:
 * https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 * (verified 2026-08-13).
 *
 * - `model` is a HEADER param, not a body field. It rides in the params
 *   object for ergonomics but is STRIPPED from the wire body and emitted as
 *   `.request.headers.model`. Sending it in the JSON body is a silent no-op:
 *   the docs say an omitted or unrecognized header "falls back to
 *   `s2.1-pro`", so a body-borne model silently synthesizes on the wrong
 *   model instead of erroring.
 * - CONTENT TYPE: the endpoint accepts `application/json` **or**
 *   `application/msgpack`. unmodel validates the JSON shape and finalizes to
 *   `content-type: application/json`. MessagePack takes the identical field
 *   set, so the same validated object serializes to msgpack unchanged —
 *   swap the header yourself. `references` (zero-shot cloning with inline
 *   audio) is documented as MessagePack-only, because its `audio` field is
 *   raw bytes; passing it with the JSON content type is flagged.
 * - BILLING UNIT: Fish Audio prices "$15.00 / M UTF-8 bytes", not per
 *   character. The estimate therefore feeds the catalog rate a UTF-8 byte
 *   count (`utf8ByteLength`), so CJK/emoji text is priced 3–4× an
 *   equal-length ASCII string, matching the invoice.
 * - The response is a chunked raw audio stream, not JSON, so there is no
 *   response checker.
 * - Auth is an `Authorization: Bearer <token>` header — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, TTS_MODEL_IDS, S2_MODEL_IDS, type FishAudioTtsModelId } from "./models";

export const TTS_URL = "https://api.fish.audio/v1/tts";

const TTS_DOCS = "https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech";
const MODELS_DOCS = "https://docs.fish.audio/developer-guide/models-pricing/models-overview";

/**
 * Server-side default for the `model` header — "If omitted or set to an
 * unrecognized value, the request falls back to `s2.1-pro`" (TTS_DOCS).
 * Model-dependent checks and pricing run against this when no model is given.
 */
export const DEFAULT_TTS_MODEL = "s2.1-pro";

/** `content-type` to send when serializing the body with MessagePack. */
export const MSGPACK_CONTENT_TYPE = "application/msgpack";

/** Documented `format` values; default "mp3". */
export const TTS_FORMATS = ["wav", "pcm", "mp3", "opus"] as const;
export type FishAudioFormat = (typeof TTS_FORMATS)[number];

/** Documented `latency` values; default "normal". */
export const TTS_LATENCIES = ["low", "normal", "balanced"] as const;
export type FishAudioLatency = (typeof TTS_LATENCIES)[number];

/** Documented `mp3_bitrate` values in kbps; default 128. MP3 output only. */
export const MP3_BITRATES = [64, 128, 192] as const;
export type FishAudioMp3Bitrate = (typeof MP3_BITRATES)[number];

/**
 * Documented `opus_bitrate` values in bps; default -1000 ("auto"). Opus
 * output only.
 */
export const OPUS_BITRATES = [-1000, 24000, 32000, 48000, 64000] as const;
export type FishAudioOpusBitrate = (typeof OPUS_BITRATES)[number];

/** Documented bounds of `prosody.speed` — "Valid range: 0.5 to 2.0". */
export const PROSODY_SPEED_MIN = 0.5;
export const PROSODY_SPEED_MAX = 2.0;

// ---------------------------------------------------------------------------
// Wire types — mirror the TTSRequest schema exactly (snake_case). Explicit
// `null` is the documented default for the nullable fields.
// ---------------------------------------------------------------------------

/**
 * A zero-shot voice-cloning sample. MessagePack only: `audio` carries raw
 * bytes, which JSON cannot express.
 */
export interface FishAudioReferenceAudio {
  /**
   * "Raw audio bytes of the voice sample. Supported formats: WAV, MP3, FLAC.
   * For best results, use 10-30 seconds of clear speech with minimal
   * background noise."
   */
  audio: Uint8Array | ArrayBuffer | string;
  /**
   * "The exact transcript of what is spoken in the audio sample. Accuracy is
   * important for voice cloning quality."
   */
  text: string;
}

export interface FishAudioProsodyControl {
  /** "Speaking rate multiplier. Valid range: 0.5 to 2.0." Default 1. */
  speed?: number | null;
  /** "Volume adjustment in decibels (dB)." Default 0. */
  volume?: number | null;
  /**
   * "Normalize output loudness … Applies to the S2 family (`s2-pro`,
   * `s2.1-pro`, `s2.1-pro-free`); on `s1` it is accepted but has no effect."
   * Default true.
   */
  normalize_loudness?: boolean | null;
}

export interface TtsBody {
  /**
   * HEADER param — stripped from the wire body and emitted as
   * `.request.headers.model`. Defaults to "s2.1-pro" server-side.
   */
  model?: FishAudioTtsModelId | (string & {});
  /** The text to convert to speech (billed per UTF-8 byte). */
  text: string;
  /** "Controls expressiveness"; range 0–1, default 0.7. */
  temperature?: number | null;
  /** "Nucleus sampling diversity"; range 0–1, default 0.7. */
  top_p?: number | null;
  /**
   * Voice model id. An ARRAY selects multi-speaker dialogue, which is
   * "only available with the S2 family … not `s1`".
   */
  reference_id?: string | string[] | null;
  /**
   * Zero-shot cloning samples — MessagePack only (see module JSDoc). Single
   * speaker: `ReferenceAudio[]`. Multi-speaker: `ReferenceAudio[][]`.
   */
  references?: FishAudioReferenceAudio[] | FishAudioReferenceAudio[][] | null;
  /** Speed/volume adjustments. */
  prosody?: FishAudioProsodyControl | null;
  /** Characters per synthesis chunk; range 100–300, default 300. */
  chunk_length?: number | null;
  /** "Normalizes text for English/Chinese". Default true. */
  normalize?: boolean | null;
  /** Container/codec; default "mp3". */
  format?: FishAudioFormat;
  /** Output sample rate in Hz. Defaults per format (48000 for opus). */
  sample_rate?: number | null;
  /** kbps, MP3 output only; default 128. */
  mp3_bitrate?: FishAudioMp3Bitrate;
  /** bps, Opus output only; default -1000 (auto). */
  opus_bitrate?: FishAudioOpusBitrate;
  /** Latency profile; default "normal". */
  latency?: FishAudioLatency;
  /** "Maximum audio tokens per chunk"; default 1024. */
  max_new_tokens?: number | null;
  /** "Values >1.0 reduce repetition"; default 1.2. */
  repetition_penalty?: number | null;
  /** Range 0–100, default 50. */
  min_chunk_length?: number | null;
  /** "Use prior audio for voice consistency". Default true. */
  condition_on_previous_chunks?: boolean | null;
  /** Range 0–1, default 1. */
  early_stop_threshold?: number | null;
  /** Feature flags, e.g. `["quality-guard"]`. Default `[]`. */
  features?: string[] | null;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const referenceAudioSchema = z.looseObject({
  // Uint8Array / ArrayBuffer / base64 string — msgpack carries the bytes.
  audio: z.unknown(),
  text: z.string(),
});

const schema = z.looseObject({
  model: z.string().optional(),
  text: z.string().min(1, "text must not be empty."),
  temperature: z.number().min(0).max(1).nullable().optional(),
  top_p: z.number().min(0).max(1).nullable().optional(),
  reference_id: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  references: z
    .union([z.array(referenceAudioSchema), z.array(z.array(referenceAudioSchema))])
    .nullable()
    .optional(),
  prosody: z
    .looseObject({
      speed: z.number().min(PROSODY_SPEED_MIN).max(PROSODY_SPEED_MAX).nullable().optional(),
      volume: z.number().nullable().optional(),
      normalize_loudness: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
  chunk_length: z.number().int().min(100).max(300).nullable().optional(),
  normalize: z.boolean().nullable().optional(),
  format: z.string().optional(),
  sample_rate: z.number().int().positive().nullable().optional(),
  mp3_bitrate: z.number().optional(),
  opus_bitrate: z.number().optional(),
  latency: z.string().optional(),
  max_new_tokens: z.number().int().positive().nullable().optional(),
  repetition_penalty: z.number().nullable().optional(),
  min_chunk_length: z.number().int().min(0).max(100).nullable().optional(),
  condition_on_previous_chunks: z.boolean().nullable().optional(),
  early_stop_threshold: z.number().min(0).max(1).nullable().optional(),
  features: z.array(z.string()).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const FORMAT_SET = new Set<string>(TTS_FORMATS);
const LATENCY_SET = new Set<string>(TTS_LATENCIES);
const MP3_BITRATE_SET = new Set<number>(MP3_BITRATES);
const OPUS_BITRATE_SET = new Set<number>(OPUS_BITRATES);
const TTS_MODEL_ID_SET = new Set<string>(TTS_MODEL_IDS);
const S2_MODEL_ID_SET = new Set<string>(S2_MODEL_IDS);

function modelOf(params: TtsBody): string {
  return params.model ?? DEFAULT_TTS_MODEL;
}

/**
 * The catalog also carries the retired `speech-1.5` / `speech-1.6` ids so
 * legacy call sites get a precise error rather than a bare `unknown_model`
 * warning. Ids unknown to the catalog stay a warning — they may be new.
 */
function checkModelKind(params: TtsBody, info: ModelInfo | undefined, ctx: PipelineContext): void {
  const model = modelOf(params);
  if (info === undefined || TTS_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message: `"${model}" is not served by POST /v1/tts; the \`model\` header accepts ${TTS_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...TTS_MODEL_IDS], source: MODELS_DOCS },
  });
}

function checkEnums(params: TtsBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const model = modelOf(params);
  const { format, latency, mp3_bitrate, opus_bitrate } = params;
  if (format !== undefined && !FORMAT_SET.has(format)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["format"],
      model,
      message: `\`format\` must be one of ${TTS_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
      meta: { allowed: [...TTS_FORMATS], value: format, source: TTS_DOCS },
    });
  }
  if (latency !== undefined && !LATENCY_SET.has(latency)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["latency"],
      model,
      message: `\`latency\` must be one of ${TTS_LATENCIES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(latency)}.`,
      meta: { allowed: [...TTS_LATENCIES], value: latency, source: TTS_DOCS },
    });
  }
  if (mp3_bitrate !== undefined && !MP3_BITRATE_SET.has(mp3_bitrate)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["mp3_bitrate"],
      model,
      message: `\`mp3_bitrate\` must be one of ${MP3_BITRATES.join(", ")} (kbps); got ${JSON.stringify(mp3_bitrate)}.`,
      meta: { allowed: [...MP3_BITRATES], value: mp3_bitrate, source: TTS_DOCS },
    });
  }
  if (opus_bitrate !== undefined && !OPUS_BITRATE_SET.has(opus_bitrate)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["opus_bitrate"],
      model,
      message: `\`opus_bitrate\` must be one of ${OPUS_BITRATES.join(", ")} (bps, -1000 = auto); got ${JSON.stringify(opus_bitrate)}.`,
      meta: { allowed: [...OPUS_BITRATES], value: opus_bitrate, source: TTS_DOCS },
    });
  }
}

/**
 * `mp3_bitrate` / `opus_bitrate` are documented as codec-scoped ("MP3 only",
 * "Opus only"). Setting one against a different `format` is accepted and
 * dropped, so the request succeeds at a bitrate the caller did not choose —
 * a warning, not an error.
 */
function checkBitrateFormatPairing(
  params: TtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.format ?? "mp3";
  if (params.mp3_bitrate !== undefined && format !== "mp3") {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["mp3_bitrate"],
      model: modelOf(params),
      message: `\`mp3_bitrate\` applies to MP3 output only; \`format\` is ${JSON.stringify(format)}, so it is ignored.`,
      meta: { ignored: true, format, source: TTS_DOCS },
    });
  }
  if (params.opus_bitrate !== undefined && format !== "opus") {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["opus_bitrate"],
      model: modelOf(params),
      message: `\`opus_bitrate\` applies to Opus output only; \`format\` is ${JSON.stringify(format)}, so it is ignored.`,
      meta: { ignored: true, format, source: TTS_DOCS },
    });
  }
}

/**
 * "Multi-speaker dialogue synthesis is only available with the S2 family
 * (`s2-pro`, `s2.1-pro`, `s2.1-pro-free`), not `s1`." A `reference_id` array
 * (or a nested `references` array-of-arrays) is the multi-speaker form.
 */
function checkMultiSpeaker(
  params: TtsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = modelOf(params);
  // Unknown to the catalog → no family known; stay quiet rather than guess.
  if (info === undefined || S2_MODEL_ID_SET.has(model)) return;

  if (Array.isArray(params.reference_id)) {
    ctx.report({
      code: "unsupported_capability",
      path: ["reference_id"],
      model,
      message: `a \`reference_id\` array requests multi-speaker dialogue, which is only available with the S2 family (${S2_MODEL_IDS.join(", ")}); "${model}" is single-speaker only.`,
      meta: { allowed: [...S2_MODEL_IDS], source: TTS_DOCS },
    });
  }
  const references = params.references;
  if (Array.isArray(references) && references.some((entry) => Array.isArray(entry))) {
    ctx.report({
      code: "unsupported_capability",
      path: ["references"],
      model,
      message: `a nested \`references\` array (ReferenceAudio[][]) requests multi-speaker dialogue, which is only available with the S2 family (${S2_MODEL_IDS.join(", ")}); "${model}" is single-speaker only.`,
      meta: { allowed: [...S2_MODEL_IDS], source: TTS_DOCS },
    });
  }
}

/**
 * "`normalize_loudness` … Applies to the S2 family …; on `s1` it is accepted
 * but has no effect." The request is fulfilled, so this is a warning about a
 * silent no-op rather than an error.
 */
function checkNormalizeLoudness(
  params: TtsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = modelOf(params);
  if (info === undefined || S2_MODEL_ID_SET.has(model)) return;
  if (params.prosody?.normalize_loudness == null) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["prosody", "normalize_loudness"],
    model,
    message: `\`prosody.normalize_loudness\` is accepted but has no effect on "${model}"; loudness normalization applies to the S2 family only.`,
    meta: { ignored: true, allowed: [...S2_MODEL_IDS], source: TTS_DOCS },
  });
}

/**
 * `references` carries raw audio bytes, which is why the docs mark it
 * "MessagePack only". `finalize` emits `content-type: application/json`, so
 * the caller must re-serialize with MessagePack and swap the header — the
 * field set is otherwise identical. A warning, because the msgpack path is
 * fully supported and the validated shape is correct for it.
 */
function checkReferencesNeedMsgpack(
  params: TtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.references == null) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["references"],
    model: modelOf(params),
    message: `\`references\` carries raw audio bytes and is documented as MessagePack-only; serialize this body with MessagePack and send \`content-type: ${MSGPACK_CONTENT_TYPE}\` instead of the JSON header on \`.request\`.`,
    meta: { contentType: MSGPACK_CONTENT_TYPE, source: TTS_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — billed per UTF-8 BYTE, not per character (see module JSDoc).
// ---------------------------------------------------------------------------

const ENCODER = new TextEncoder();

/** UTF-8 byte length of `text` — Fish Audio's billing unit. */
export function utf8ByteLength(text: string): number {
  return ENCODER.encode(text).length;
}

function estimate(
  params: TtsBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, utf8ByteLength(params.text));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (model stripped — it is a header) + .request
// ---------------------------------------------------------------------------

type TtsWireBody = Omit<TtsBody, "model">;

/**
 * SDK targets for `fish-audio.speech`. `fish-audio-sdk` (JS) takes wire-shaped
 * params, so the single `"fish-audio"` formatter is the identity. Type alias,
 * not interface: an interface has no implicit index signature and cannot
 * satisfy `SdkFormatters`.
 */
type SpeechSdkTargets<B> = { "fish-audio": () => B };

function finalize(params: TtsBody): Validated<TtsWireBody, SpeechSdkTargets<TtsWireBody>> {
  const { model, ...body } = params;
  return toValidated(
    body,
    {
      url: TTS_URL,
      method: "POST",
      // The `model` header is optional on the wire; only send it when asked so
      // an omitted model keeps the documented server-side fallback.
      headers: { ...JSON_HEADERS, ...(model !== undefined && { model }) },
    },
    { sdk: { "fish-audio": () => body } },
  );
}

const validator = createValidator<TtsBody, Validated<TtsWireBody, SpeechSdkTargets<TtsWireBody>>>({
  endpoint: "fish-audio.speech",
  schema,
  // `model` is optional; checks and pricing run against the documented
  // server-side fallback when it is omitted.
  modelId: (params) => modelOf(params),
  catalog: models,
  checks: [
    checkModelKind,
    checkEnums,
    checkBitrateFormatPairing,
    checkMultiSpeaker,
    checkNormalizeLoudness,
    checkReferencesNeedMsgpack,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Fish Audio `POST /v1/tts`.
 *
 * The result's enumerable properties are the exact fetch JSON body; `model`
 * is stripped because it is a HEADER param and appears on
 * `.request.headers.model` instead. `.toSdk("fish-audio")` returns the body unchanged —
 * `fish-audio-sdk` (JS) takes wire-shaped params. Auth is your job: add an
 * `authorization: Bearer …` header.
 *
 * ```ts
 * const params = fishAudio.speech({
 *   model: "s2.1-pro",
 *   text: "Hello world",
 *   reference_id: "802e3bc2b27e49c2995d23ef70e6ac89",
 *   format: "mp3",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * const audio = await res.arrayBuffer();
 * ```
 */
export const speech = validator as unknown as {
  <T extends TtsBody>(
    params: T & ExactKeys<T, TtsBody>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "model">, SpeechSdkTargets<Omit<T, "model">>>;
  safe<T extends TtsBody>(
    params: T & ExactKeys<T, TtsBody>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "model">, SpeechSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
