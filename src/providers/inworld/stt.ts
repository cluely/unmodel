/**
 * Inworld Speech-to-Text (sync) — POST https://api.inworld.ai/stt/v1/transcribe
 *
 * Wire reference:
 * https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe
 * plus https://docs.inworld.ai/stt/overview (verified 2026-08-13). Params
 * mirror `v1TranscribeSpeechRequest` exactly: a `transcribeConfig` object and
 * an `audioData` object carrying base64 audio. There is no multipart upload
 * surface and no file-id indirection — the bytes ride inline in the JSON body,
 * which is why the endpoint's cap is a request-size cap ("Sync transcription
 * accepts audio files up to ~16 MB") rather than a duration cap.
 *
 * ROUTER, NOT A MODEL FAMILY: `transcribeConfig.modelId` is always
 * `{provider}/{model-name}` and most ids are third-party models Inworld
 * fronts. The sync endpoint serves only `inworld/inworld-stt-1` and
 * `groq/whisper-large-v3`; the rest are WebSocket-only and are reported here
 * (see STT_SYNC_MODEL_IDS in models.ts for the exact doc wording this reads).
 *
 * The realtime/streaming surface is the `transcribe:streamBidirectional`
 * WebSocket. Its FIRST FRAME is the same `transcribeConfig` object validated
 * here, so it gets its own config validator in ./realtime — the socket
 * lifecycle itself (audio chunks, interim results, endTurn/closeStream) is
 * transport and stays out of unmodel's scope.
 *
 * `.toSdk("inworld")` is the identity: Inworld's STT API has no official JS
 * SDK (the docs drive it with raw fetch/`ws`). The response carries
 * `usage.transcribedAudioMs`, but unmodel validates requests, so there is no
 * response checker.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions, MediaDeclaration } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import {
  sttModels,
  STT_SYNC_MODEL_IDS,
  type InworldSttModelId,
  type InworldSttVendor,
} from "./models";

export const STT_TRANSCRIBE_URL = "https://api.inworld.ai/stt/v1/transcribe";

export const TRANSCRIBE_DOCS =
  "https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe";
export const STT_OVERVIEW_DOCS = "https://docs.inworld.ai/stt/overview";

/**
 * "Sync transcription accepts audio files up to ~16 MB. The actual duration
 * depends on the encoding — for example, ~18 minutes of MP3 or ~8 minutes of
 * 16 kHz 16-bit WAV." (STT_OVERVIEW_DOCS.) The docs state it approximately;
 * unmodel enforces the round number, measured on the DECODED bytes rather
 * than the base64 text (base64 inflates by 4/3, so measuring the encoded
 * string would reject files a third under the cap).
 */
export const STT_MAX_AUDIO_BYTES = 16 * 1024 * 1024;

/** LINEAR16 is signed 16-bit PCM — two bytes per sample per channel. */
export const LINEAR16_BYTES_PER_SAMPLE = 2;

/** "sampleRateHertz … Default: 16000" — and the documented recommendation. */
export const STT_DEFAULT_SAMPLE_RATE_HERTZ = 16000;
/** "numberOfChannels … Default: 1". */
export const STT_DEFAULT_CHANNELS = 1;

// ---------------------------------------------------------------------------
// Wire types — mirror v1TranscribeConfig / sttv1AudioContent exactly.
// ---------------------------------------------------------------------------

/**
 * The transcribe API reference lists `AUTO_DETECT, LINEAR16, MP3, OGG_OPUS,
 * FLAC`; the WebSocket reference lists the same set plus the proto zero value
 * `AUDIO_ENCODING_UNSPECIFIED`. The zero value is accepted on both (it is one
 * enum), so it is included here and the sync reference's omission is treated
 * as the table not bothering to print it.
 */
export type InworldSttAudioEncoding =
  | "AUDIO_ENCODING_UNSPECIFIED"
  | "AUTO_DETECT"
  | "LINEAR16"
  | "MP3"
  | "OGG_OPUS"
  | "FLAC";

export const INWORLD_STT_AUDIO_ENCODINGS = [
  "AUDIO_ENCODING_UNSPECIFIED",
  "AUTO_DETECT",
  "LINEAR16",
  "MP3",
  "OGG_OPUS",
  "FLAC",
] as const satisfies readonly InworldSttAudioEncoding[];

/**
 * Encodings the WebSocket surface accepts. The overview says "WebSocket
 * streaming supports: LINEAR16 only"; the WebSocket reference's constraints
 * note says "Streaming transcription supports LINEAR16 and AUTO_DETECT;
 * MP3, OGG_OPUS, FLAC unsupported for streaming". Only the intersection —
 * the three formats BOTH pages call unsupported — is enforced, so the
 * disagreement about AUTO_DETECT never fails a legal request.
 */
export const INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS = [
  "MP3",
  "OGG_OPUS",
  "FLAC",
] as const satisfies readonly InworldSttAudioEncoding[];

/** Groq-specific options; only legal with a `groq/...` model. */
export interface InworldGroqConfig {
  /** Range [0.0, 1.0]. */
  temperature?: number;
}

/** Inworld STT 1 turn-taking; only legal with `inworld/inworld-stt-1`. */
export interface InworldSttV1Config {
  /** Milliseconds of confident silence before the turn ends. */
  minEndOfTurnSilenceWhenConfident?: number;
  /** Range [0.0, 1.0]; default 0.5. Set to 0 to disable server-side turn detection. */
  vadThreshold?: number;
}

/** AssemblyAI-specific options; only legal with an `assemblyai/...` model. */
export interface InworldAssemblyaiConfig {
  /** Milliseconds. */
  minEndOfTurnSilenceWhenConfident?: number;
  /** Milliseconds. */
  maxTurnSilence?: number;
  /** Range [0.0, 1.0]; default 0.5. */
  vadThreshold?: number;
  /** Custom instructions — "Universal-3 Pro only" (assemblyai/u3-rt-pro). */
  prompt?: string;
}

/** Soniox context guidance; mirrors Soniox's own `context` object. */
export interface InworldSonioxContext {
  /** Key-value pairs (domain, topic, intent). */
  general?: Record<string, string>;
  /** Free-form background text. */
  text?: string;
  /** Domain-specific words. */
  terms?: string[];
}

/** Soniox-specific options; only legal with a `soniox/...` model. */
export interface InworldSonioxConfig {
  /** Overrides the top-level `language` field. */
  languageHints?: string[];
  /** Force the language constraints from `languageHints`. */
  languageHintsStrict?: boolean;
  /** Semantic end-of-turn detection. */
  enableEndpointDetection?: boolean;
  /** Range [500, 5000] ms; default 2000. */
  maxEndpointDelayMs?: number;
  context?: InworldSonioxContext;
}

export interface InworldVoiceProfileConfig {
  /**
   * Required when the object is present. Voice Profile (emotion, vocal style,
   * accent, age, pitch) is an `inworld/inworld-stt-1` feature.
   */
  enableVoiceProfile: boolean;
  /** Top labels returned per class; default 10. */
  topN?: number;
}

/** Fields both surfaces share. */
interface TranscribeConfigBase {
  /** `{provider}/{model-name}`, e.g. "inworld/inworld-stt-1". */
  modelId: InworldSttModelId | (string & {});
  audioEncoding: InworldSttAudioEncoding;
  /** ISO 639 code ("en", "ja") or BCP-47 tag ("en-US"). */
  language?: string;
  /** Default 16000; 16 kHz / 16-bit / mono is the documented recommendation. */
  sampleRateHertz?: number;
  /** Default 1. */
  numberOfChannels?: number;
  /** Silence duration before transcription stops. */
  inactivityTimeoutSeconds?: number;
  /** Range [0.0, 1.0]; default 0.5. */
  endOfTurnConfidenceThreshold?: number;
  /** Custom vocabulary / key terms — a soft bias, letters+digits+spaces only. */
  prompts?: string[];
  /** Per-word timing; AssemblyAI / Soniox / Deepgram only. */
  includeWordTimestamps?: boolean;
  /** Per-word speaker labels; AssemblyAI / Soniox / Deepgram only. */
  enableSpeakerDiarization?: boolean;
  voiceProfileConfig?: InworldVoiceProfileConfig;
}

/**
 * The `transcribeConfig` object of the SYNC body. The sync reference
 * documents exactly two provider blocks — the other two vendors are
 * WebSocket-only, so their blocks live on the realtime config type instead.
 * At most one block may be set, and it must match the model's vendor.
 */
export interface InworldTranscribeConfig extends TranscribeConfigBase {
  groqConfig?: InworldGroqConfig;
  inworldSttV1Config?: InworldSttV1Config;
}

/**
 * The `transcribeConfig` first frame of the WebSocket surface — the same
 * object plus the two provider blocks only the streaming vendors use.
 * Consumed by ./realtime; it lives here so the shared checks have one type.
 */
export interface InworldRealtimeTranscribeConfig extends TranscribeConfigBase {
  groqConfig?: InworldGroqConfig;
  inworldSttV1Config?: InworldSttV1Config;
  assemblyaiConfig?: InworldAssemblyaiConfig;
  sonioxConfig?: InworldSonioxConfig;
}

/** `sttv1AudioContent` — base64-encoded raw audio. */
export interface InworldAudioContent {
  /** Base64-encoded raw audio in the encoding named by `audioEncoding`. */
  content: string;
}

export interface TranscribeBody {
  transcribeConfig: InworldTranscribeConfig;
  audioData: InworldAudioContent;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

/**
 * "Format: `{provider}/{model-name}`". Enforced as shape, not as an
 * allow-list: the router gains vendors faster than a catalog can track them,
 * and an id the catalog does not know is only an `unknown_model` warning.
 */
const MODEL_ID_PATTERN = /^[^\s/]+\/[^\s/]\S*$/;

/** ISO 639 ("en") or BCP-47 ("en-US", "zh-Hans-CN"). */
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

const voiceProfileConfigSchema = z.looseObject({
  enableVoiceProfile: z.boolean(),
  topN: z.number().int().positive().optional(),
});

const groqConfigSchema = z.looseObject({
  // "temperature … Range: [0.0, 1.0]".
  temperature: z.number().min(0).max(1).optional(),
});

const inworldSttV1ConfigSchema = z.looseObject({
  minEndOfTurnSilenceWhenConfident: z.number().int().min(0).optional(),
  // "vadThreshold … Range: [0.0, 1.0]; set to 0 to disable".
  vadThreshold: z.number().min(0).max(1).optional(),
});

const assemblyaiConfigSchema = z.looseObject({
  minEndOfTurnSilenceWhenConfident: z.number().int().min(0).optional(),
  maxTurnSilence: z.number().int().min(0).optional(),
  vadThreshold: z.number().min(0).max(1).optional(),
  prompt: z.string().optional(),
});

const sonioxConfigSchema = z.looseObject({
  languageHints: z.array(z.string().min(1)).optional(),
  languageHintsStrict: z.boolean().optional(),
  enableEndpointDetection: z.boolean().optional(),
  // "maxEndpointDelayMs … Range: [500, 5000]" (default 2000).
  maxEndpointDelayMs: z.number().int().min(500).max(5000).optional(),
  context: z
    .looseObject({
      general: z.record(z.string(), z.string()).optional(),
      text: z.string().optional(),
      terms: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

/**
 * The fields both surfaces share, as a zod shape so ./realtime can extend it
 * with the streaming-only provider blocks without restating a single bound.
 */
export const transcribeConfigShape = {
  modelId: z
    .string()
    .min(1)
    .regex(MODEL_ID_PATTERN, 'modelId must be "{provider}/{model-name}", e.g. "inworld/inworld-stt-1".'),
  audioEncoding: z.enum(INWORLD_STT_AUDIO_ENCODINGS),
  language: z
    .string()
    .regex(LANGUAGE_PATTERN, 'language must be an ISO 639 code ("en") or a BCP-47 tag ("en-US").')
    .optional(),
  // No range is documented for STT sample rates (unlike TTS, which publishes
  // a closed list) — only the 16 kHz default and recommendation.
  sampleRateHertz: z.number().int().positive().optional(),
  numberOfChannels: z.number().int().positive().optional(),
  inactivityTimeoutSeconds: z.number().int().positive().optional(),
  // "endOfTurnConfidenceThreshold … Range: [0.0, 1.0]" (default 0.5).
  endOfTurnConfidenceThreshold: z.number().min(0).max(1).optional(),
  prompts: z.array(z.string().min(1)).optional(),
  includeWordTimestamps: z.boolean().optional(),
  enableSpeakerDiarization: z.boolean().optional(),
  voiceProfileConfig: voiceProfileConfigSchema.optional(),
  groqConfig: groqConfigSchema.optional(),
  inworldSttV1Config: inworldSttV1ConfigSchema.optional(),
} as const;

/** The streaming-only provider blocks, kept next to the shape they extend. */
export const streamOnlyConfigShape = {
  assemblyaiConfig: assemblyaiConfigSchema.optional(),
  sonioxConfig: sonioxConfigSchema.optional(),
} as const;

const schema = z.looseObject({
  transcribeConfig: z.looseObject(transcribeConfigShape),
  audioData: z.looseObject({
    content: z.string().min(1, "audioData.content must not be empty."),
  }),
});

// ---------------------------------------------------------------------------
// Shared config checks — the same object is validated on both surfaces, so
// every rule that is a property of the CONFIG (not of the transport) lives
// here and ./realtime re-uses it with a different path prefix.
// ---------------------------------------------------------------------------

/** The `{provider}` half of a `{provider}/{model-name}` id. */
export function sttVendorOf(modelId: string): string | undefined {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash) : undefined;
}

/** Provider-specific config blocks, paired with the vendor that owns each. */
const VENDOR_CONFIG_KEYS = [
  ["groqConfig", "groq"],
  ["inworldSttV1Config", "inworld"],
  ["assemblyaiConfig", "assemblyai"],
  ["sonioxConfig", "soniox"],
] as const satisfies ReadonlyArray<readonly [string, InworldSttVendor]>;

/**
 * Characters the API rejects inside `prompts`: "Only letters, digits, spaces,
 * and basic punctuation allowed; characters like `#`, `/`, `@`, `|` rejected
 * with INVALID_ARGUMENT (code 3)". Read literally — the allow-list half of
 * that sentence ("basic punctuation") is not enumerated anywhere, so only the
 * four characters the docs name are enforced. A stricter allow-list would
 * invent a rule and fail requests the API accepts.
 */
const REJECTED_PROMPT_CHARACTERS = ["#", "/", "@", "|"] as const;

export interface TranscribeConfigCheckOptions {
  /** Path prefix of the config inside the validated params. */
  path: Array<string | number>;
  /** Which endpoint is being validated — gates the surface-specific rules. */
  surface: "sync" | "stream";
  /** Model ids the surface serves. */
  allowedModelIds: readonly string[];
}

/**
 * Every rule that is a property of the transcribe config itself. Shared by
 * `stt` (sync) and `realtimeTranscribeConfig` (WebSocket first frame).
 */
export function checkTranscribeConfig(
  config: InworldRealtimeTranscribeConfig,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
  options: TranscribeConfigCheckOptions,
): void {
  const at = (...rest: Array<string | number>): Array<string | number> => [...options.path, ...rest];
  const modelId = config.modelId;
  const vendor = sttVendorOf(modelId);
  const record = config as unknown as Record<string, unknown>;

  // Endpoint availability. Only enforced for ids the catalog knows: an
  // unfamiliar id already warns as unknown_model and may well be a new model
  // for this surface.
  if (info !== undefined && !options.allowedModelIds.includes(modelId)) {
    ctx.report({
      code: "unsupported_capability",
      path: at("modelId"),
      model: modelId,
      message:
        options.surface === "sync"
          ? `"${modelId}" is served only by the Inworld STT WebSocket (transcribe:streamBidirectional); POST /stt/v1/transcribe accepts ${options.allowedModelIds.map((id) => `"${id}"`).join(", ")}.`
          : `"${modelId}" is served only by the sync endpoint (POST /stt/v1/transcribe); the transcribe:streamBidirectional WebSocket accepts ${options.allowedModelIds.map((id) => `"${id}"`).join(", ")}.`,
      meta: { allowed: [...options.allowedModelIds], source: STT_OVERVIEW_DOCS },
    });
  }

  // At most one provider block ("Mutually exclusive; set at most one"), and
  // the one that is set must belong to the model's vendor.
  const present = VENDOR_CONFIG_KEYS.filter(([key]) => record[key] != null);
  if (present.length > 1) {
    // Reported against the config itself rather than one of the blocks: with
    // two set there is no way to tell which one the caller meant to keep.
    ctx.report({
      code: "invalid_shape",
      path: at(),
      model: modelId,
      message: `provider-specific config blocks are mutually exclusive; set at most one, got ${present.map(([key]) => `\`${key}\``).join(" + ")}.`,
      meta: { provided: present.map(([key]) => key), source: TRANSCRIBE_DOCS },
    });
  }
  for (const [key, owner] of present) {
    if (vendor !== undefined && vendor !== owner) {
      ctx.report({
        code: "unsupported_param",
        path: at(key),
        model: modelId,
        message: `\`${key}\` configures ${owner}-routed models; "${modelId}" is routed to ${vendor}.`,
        meta: { vendor, expected: owner, source: TRANSCRIBE_DOCS },
      });
    }
  }

  // "prompt … Custom instructions (Universal-3 Pro only)".
  if (config.assemblyaiConfig?.prompt != null && modelId !== "assemblyai/u3-rt-pro") {
    ctx.report({
      code: "unsupported_param",
      path: at("assemblyaiConfig", "prompt"),
      model: modelId,
      message: `\`assemblyaiConfig.prompt\` is documented as Universal-3 Pro only; use "assemblyai/u3-rt-pro" or drop the prompt.`,
      meta: { allowed: ["assemblyai/u3-rt-pro"], source: STT_OVERVIEW_DOCS },
    });
  }

  // Voice Profile is a first-party feature: the model table lists it against
  // `inworld/inworld-stt-1` alone.
  if (config.voiceProfileConfig?.enableVoiceProfile === true && vendor !== undefined && vendor !== "inworld") {
    ctx.report({
      code: "unsupported_capability",
      path: at("voiceProfileConfig", "enableVoiceProfile"),
      model: modelId,
      message: `Voice Profile (emotion, vocal style, accent, age, pitch) is only produced by "inworld/inworld-stt-1"; "${modelId}" is routed to ${vendor}.`,
      meta: { source: STT_OVERVIEW_DOCS },
    });
  }

  // "Word timestamps & diarization: Available for AssemblyAI, Soniox,
  // Deepgram; not yet for Inworld." Groq is not named on either side of that
  // sentence, so only the vendor the docs exclude is reported.
  if (vendor === "inworld") {
    for (const key of ["includeWordTimestamps", "enableSpeakerDiarization"] as const) {
      if (config[key] === true) {
        ctx.report({
          code: "unsupported_capability",
          path: at(key),
          model: modelId,
          message: `\`${key}\` is not implemented for "${modelId}" yet (it is available on the AssemblyAI, Soniox and Deepgram routes); the field is accepted but no per-word data comes back.`,
          meta: { source: STT_OVERVIEW_DOCS },
        });
      }
    }
  }

  if (Array.isArray(config.prompts)) {
    config.prompts.forEach((prompt, index) => {
      if (typeof prompt !== "string") return;
      const bad = REJECTED_PROMPT_CHARACTERS.filter((char) => prompt.includes(char));
      if (bad.length > 0) {
        ctx.report({
          code: "invalid_shape",
          path: at("prompts", index),
          model: modelId,
          message: `prompts may only contain letters, digits, spaces and basic punctuation; ${bad.map((c) => `"${c}"`).join(", ")} is rejected with INVALID_ARGUMENT.`,
          meta: { rejected: bad, source: TRANSCRIBE_DOCS },
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Sync-only checks + estimation
// ---------------------------------------------------------------------------

/**
 * Decoded byte length of a base64 payload, computed arithmetically. Decoding
 * would materialise up to 16 MB of audio on every validation just to read
 * `.length`; the length of the encoded text plus its padding says the same
 * thing for free. Returns undefined when the string is not base64 at all
 * (a URL, a data: prefix someone forgot to strip) — a shape unmodel cannot
 * measure is not a shape it should report a size for.
 */
export function decodedBase64Bytes(content: string): number | undefined {
  const trimmed = content.trim();
  if (trimmed.length === 0) return undefined;
  // Standard and URL-safe alphabets, with optional padding.
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return undefined;
  const padding = /=*$/.exec(trimmed)?.[0].length ?? 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
}

function checkAudioSize(
  params: TranscribeBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const bytes = decodedBase64Bytes(params.audioData.content);
  if (bytes === undefined || bytes <= STT_MAX_AUDIO_BYTES) return;
  ctx.report({
    code: "media_too_large",
    path: ["audioData", "content"],
    model: params.transcribeConfig.modelId,
    message: `audio decodes to ${bytes} bytes; the Inworld sync transcribe endpoint accepts audio files up to ~${STT_MAX_AUDIO_BYTES} bytes (16 MB) — stream longer audio over transcribe:streamBidirectional instead.`,
    meta: { bytes, limit: STT_MAX_AUDIO_BYTES, source: STT_OVERVIEW_DOCS },
  });
}

function checkSyncConfig(
  params: TranscribeBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkTranscribeConfig(params.transcribeConfig, info, ctx, {
    path: ["transcribeConfig"],
    surface: "sync",
    allowedModelIds: STT_SYNC_MODEL_IDS,
  });
}

const AUDIO_PATH: Array<string | number> = ["audioData", "content"];

/**
 * Audio duration, in seconds, from the best source available:
 *
 * 1. an `options.media` declaration for the audio (exact-path match first,
 *    then any declaration carrying `durationSeconds`), then
 * 2. the bytes themselves, but only for LINEAR16 — raw signed 16-bit PCM has
 *    no container and no compression, so `bytes / (rate x channels x 2)` is
 *    the duration exactly. Every other encoding (and AUTO_DETECT, which may
 *    resolve to any of them) compresses or carries a header, so bytes reveal
 *    nothing and the caller must declare the length to get a cost estimate.
 */
function durationSeconds(
  params: TranscribeBody,
  media: MediaDeclaration[] | undefined,
): number | undefined {
  const exact = findMediaDeclaration(media, AUDIO_PATH);
  if (exact?.durationSeconds !== undefined) return exact.durationSeconds;
  const declared = media?.find((d) => d.durationSeconds !== undefined)?.durationSeconds;
  if (declared !== undefined) return declared;

  const config = params.transcribeConfig;
  if (config.audioEncoding !== "LINEAR16") return undefined;
  const bytes = decodedBase64Bytes(params.audioData.content);
  if (bytes === undefined) return undefined;
  const rate = config.sampleRateHertz ?? STT_DEFAULT_SAMPLE_RATE_HERTZ;
  const channels = config.numberOfChannels ?? STT_DEFAULT_CHANNELS;
  const bytesPerSecond = rate * channels * LINEAR16_BYTES_PER_SAMPLE;
  return bytesPerSecond > 0 ? bytes / bytesPerSecond : undefined;
}

/** STT is billed per minute of audio processed (On-Demand list rate). */
function estimateStt(
  params: TranscribeBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const seconds = durationSeconds(params, ctx.options.media);
  if (seconds === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, minutesFromSeconds(seconds));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `inworld.stt`. Inworld publishes no official JS SDK
 * for /stt/v1 (see the module JSDoc), so the single self-named `"inworld"`
 * target returns the wire body unchanged — the id is still spelled out so the
 * call site reads the same as every other endpoint's, and so a real SDK shape
 * can be added later without a breaking change. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type SttSdkTargets<B> = { inworld: () => B };

function finalize(params: TranscribeBody): Validated<TranscribeBody, SttSdkTargets<TranscribeBody>> {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: STT_TRANSCRIBE_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { inworld: () => body } },
  );
}

const validator = createValidator<
  TranscribeBody,
  Validated<TranscribeBody, SttSdkTargets<TranscribeBody>>
>({
  endpoint: "inworld.stt",
  schema,
  modelId: (params) => params.transcribeConfig?.modelId,
  catalog: sttModels,
  checks: [checkSyncConfig, checkAudioSize],
  estimate: estimateStt,
  finalize,
});

/**
 * Validates params for POST /stt/v1/transcribe (sync STT). The result's
 * enumerable properties are the exact fetch JSON body; `.toSdk("inworld")`
 * returns the body unchanged (no official JS SDK — see module JSDoc) and
 * `.request` carries url/method/static headers. Auth is your job: add a Basic
 * `authorization` header.
 *
 * Cost estimation is exact for LINEAR16 (duration is derived from the decoded
 * byte count, the sample rate and the channel count); for compressed
 * encodings declare the length via
 * `options.media = [{ path: ["audioData", "content"], durationSeconds }]`.
 *
 * ```ts
 * const params = inworld.stt({
 *   transcribeConfig: {
 *     modelId: "inworld/inworld-stt-1",
 *     audioEncoding: "LINEAR16",
 *     sampleRateHertz: 16000,
 *     language: "en-US",
 *   },
 *   audioData: { content: base64Audio },
 * });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Basic ${process.env.INWORLD_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const stt = validator as unknown as {
  <T extends TranscribeBody>(
    params: T & ExactKeys<T, TranscribeBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, SttSdkTargets<T>>;
  safe<T extends TranscribeBody>(
    params: T & ExactKeys<T, TranscribeBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, SttSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
