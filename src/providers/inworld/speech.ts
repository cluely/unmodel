/**
 * Inworld Text-to-Speech — POST https://api.inworld.ai/tts/v1/voice
 *
 * Wire reference:
 * https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech
 * (verified 2026-08-13). Params mirror the wire body exactly. The streaming
 * variant (POST /tts/v1/voice:stream) takes the same body (plus an optional
 * `timestampTransportStrategy`) but returns NDJSON; unmodel finalizes to the
 * non-streaming URL only. The realtime WebSocket API is not validated.
 *
 * CHARACTER CAP: the endpoint documents "Maximum input of 2,000 characters"
 * for `text`. An over-long `text` is reported with issue code
 * `over_output_limit` — there is no character-specific issue code, so the
 * message and meta ({ limitCharacters, actualCharacters }) spell out that
 * the limit is in characters, not tokens.
 *
 * `.toSdk("inworld")` is the identity: Inworld's TTS API has no official JS SDK (the
 * docs drive it with raw fetch; the legacy @inworld/nodejs-sdk targets the
 * Character Engine, not /tts/v1). The response is JSON but carries no
 * quality/usage signals beyond `usage.processedCharactersCount`, so there is
 * no response checker.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models, type InworldTtsModelId } from "./models";

export const TTS_VOICE_URL = "https://api.inworld.ai/tts/v1/voice";
/** Streaming variant — same body; NDJSON response. Not what finalize targets. */
export const TTS_VOICE_STREAM_URL = "https://api.inworld.ai/tts/v1/voice:stream";

/** "Maximum input of 2,000 characters" — synthesize-speech API reference. */
export const INWORLD_TTS_MAX_CHARACTERS = 2000;

// ---------------------------------------------------------------------------
// Wire types — mirror ttsv1SynthesizeSpeechRequest exactly.
// ---------------------------------------------------------------------------

export type InworldAudioEncoding =
  | "LINEAR16"
  | "MP3"
  | "OGG_OPUS"
  | "ALAW"
  | "MULAW"
  | "FLAC"
  | "PCM"
  | "WAV";

/**
 * The seven rates the reference lists: "Accepts values within the range
 * [8000, 48000]. Supported sample rates are: 8000, 16000, 22050, 24000,
 * 32000, 44100, 48000." The range is a bound on that closed list, not a
 * continuum — rates inside the gaps 4xx (SYNTHESIZE_DOCS).
 */
export const INWORLD_SAMPLE_RATES_HERTZ = [
  8000, 16000, 22050, 24000, 32000, 44100, 48000,
] as const;

export type InworldSampleRateHertz = (typeof INWORLD_SAMPLE_RATES_HERTZ)[number];

export interface InworldAudioConfig {
  /** Default: "MP3". */
  audioEncoding?: InworldAudioEncoding;
  /**
   * "Accepts values within the range [8000, 48000]. Supported sample rates
   * are: 8000, 16000, 22050, 24000, 32000, 44100, 48000. … The default is
   * 48,000." A rate the voice does not natively use is resampled; one the
   * chosen encoding does not support "will fail the request and return an
   * error".
   */
  sampleRateHertz?: InworldSampleRateHertz;
  /** Bits per second; compressed formats only; default 128000. */
  bitRate?: number;
  /** Range [0.5, 1.5]; default 1.0. */
  speakingRate?: number;
}

export type InworldDeliveryMode =
  | "DELIVERY_MODE_UNSPECIFIED"
  | "STABLE"
  | "BALANCED"
  | "CREATIVE";

export type InworldTimestampType = "TIMESTAMP_TYPE_UNSPECIFIED" | "WORD" | "CHARACTER";

export type InworldApplyTextNormalization =
  | "APPLY_TEXT_NORMALIZATION_UNSPECIFIED"
  | "ON"
  | "OFF";

/**
 * Prior turns supplied as generation context — the reference documents a
 * single field, `previousRequests`, holding earlier synthesis requests.
 */
export interface InworldSynthesisContext {
  previousRequests?: Array<{ text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface TtsVoiceBody {
  /** Maximum input of 2,000 characters. */
  text: string;
  /** Voice identifier, e.g. "Dennis". */
  voiceId: string;
  modelId: InworldTtsModelId | (string & {});
  audioConfig?: InworldAudioConfig;
  /** BCP-47 tag (e.g. "en-US"); auto-detected when omitted. */
  language?: string;
  /** "Only supported by `inworld-tts-2`" — rejected on the 1.x generations. */
  deliveryMode?: InworldDeliveryMode;
  /** Range (0, 2]; default 1.0. Ignored by inworld-tts-2. */
  temperature?: number;
  timestampType?: InworldTimestampType;
  applyTextNormalization?: InworldApplyTextNormalization;
  /** Audio denoising toggle; default false. */
  enhanceGeneration?: boolean;
  /** Previous requests supplied as generation context. */
  synthesisContext?: InworldSynthesisContext;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

/**
 * Exported so the WebSocket context config in ./realtime validates
 * `audioConfig` against the same bounds — it is the same object on both
 * surfaces, and a second copy would be a second thing to keep in sync.
 */
export const audioConfigSchema = z.looseObject({
  audioEncoding: z
    .enum(["LINEAR16", "MP3", "OGG_OPUS", "ALAW", "MULAW", "FLAC", "PCM", "WAV"])
    .optional(),
  // Closed list, not a range — see INWORLD_SAMPLE_RATES_HERTZ.
  sampleRateHertz: z.literal(INWORLD_SAMPLE_RATES_HERTZ).optional(),
  bitRate: z.number().int().positive().optional(),
  speakingRate: z.number().min(0.5).max(1.5).optional(),
});

const schema = z.looseObject({
  text: z.string().min(1, "text must not be empty."),
  voiceId: z.string().min(1, "voiceId must not be empty."),
  modelId: z.string(),
  audioConfig: audioConfigSchema.optional(),
  language: z.string().optional(),
  deliveryMode: z
    .enum(["DELIVERY_MODE_UNSPECIFIED", "STABLE", "BALANCED", "CREATIVE"])
    .optional(),
  temperature: z.number().gt(0).max(2).optional(),
  timestampType: z.enum(["TIMESTAMP_TYPE_UNSPECIFIED", "WORD", "CHARACTER"]).optional(),
  applyTextNormalization: z
    .enum(["APPLY_TEXT_NORMALIZATION_UNSPECIFIED", "ON", "OFF"])
    .optional(),
  enhanceGeneration: z.boolean().optional(),
  synthesisContext: z
    .looseObject({ previousRequests: z.array(z.looseObject({})).optional() })
    .optional(),
});

// ---------------------------------------------------------------------------
// Constraints — per-model gates the synthesize-speech reference documents.
// ---------------------------------------------------------------------------

const SYNTHESIZE_DOCS =
  "https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech";

const deliveryModeDeny = {
  deliveryMode: {
    reason:
      '`deliveryMode` is documented as "Only supported by `inworld-tts-2`"; the 1.x generations ignore it, so the requested stability/creativity trade-off is not applied',
    source: SYNTHESIZE_DOCS,
  },
} as const;

/**
 * Two deliberately literal readings of the reference:
 * - `deliveryMode` is denied on the 1.x generations (documented as tts-2 only).
 *   `inworld-tts-2-flash` is left permissive: the docs name the generation,
 *   not the exact id, and flash is the same generation.
 * - `temperature` is flagged `ignored` on `inworld-tts-2`, where the reference
 *   says it is ignored: the request is accepted and fulfilled, so this is a
 *   warning about a silent no-op rather than an error. Only the exact id the
 *   docs name is covered.
 */
export const speechConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "inworld-tts-1.5-max": { deny: deliveryModeDeny },
  "inworld-tts-1.5-mini": { deny: deliveryModeDeny },
  "inworld-tts-1": { deny: deliveryModeDeny },
  "inworld-tts-1-max": { deny: deliveryModeDeny },
  "inworld-tts-2": {
    deny: {
      temperature: {
        reason:
          "the request is accepted but sampling is unaffected; use `deliveryMode` to steer stability instead",
        source: SYNTHESIZE_DOCS,
        ignored: true,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Checks + estimation
// ---------------------------------------------------------------------------

/**
 * Enforces the documented 2,000-character `text` cap. The cap is documented
 * at the endpoint level, so it applies even when the model id is unknown to
 * the catalog (see module JSDoc for the issue-code decision).
 */
function checkTextLength(
  params: TtsVoiceBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters ?? INWORLD_TTS_MAX_CHARACTERS;
  if (limit <= 0) return;
  const actual = params.text.length;
  if (actual > limit) {
    ctx.report({
      code: "over_output_limit",
      path: ["text"],
      model: params.modelId,
      message: `text is ${actual} characters, over the ${limit}-character per-request limit of the Inworld TTS API (this limit is in characters, not tokens); split the input into multiple requests.`,
      meta: { limitCharacters: limit, actualCharacters: actual },
    });
  }
}

/** TTS is billed per input character (On-Demand list rates — see models.ts). */
function estimateTts(
  params: TtsVoiceBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `inworld.speech`. Inworld publishes no official JS SDK for
 * /tts/v1 (see the module JSDoc), so the single self-named `"inworld"` target
 * returns the wire body unchanged — the id is still spelled out so the call
 * site reads the same as every other endpoint's, and so a real SDK shape can
 * be added later without a breaking change. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type SpeechSdkTargets<B> = { inworld: () => B };

function finalize(params: TtsVoiceBody): Validated<TtsVoiceBody, SpeechSdkTargets<TtsVoiceBody>> {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: TTS_VOICE_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { inworld: () => body } },
  );
}

const validator = createValidator<TtsVoiceBody, Validated<TtsVoiceBody, SpeechSdkTargets<TtsVoiceBody>>>({
  endpoint: "inworld.speech",
  schema,
  modelId: (params) => params.modelId,
  catalog: models,
  constraints: speechConstraints,
  checks: [checkTextLength],
  estimate: estimateTts,
  finalize,
});

/**
 * Validates params for POST /tts/v1/voice. The result's enumerable
 * properties are the exact fetch JSON body; `.toSdk("inworld")` returns the
 * body unchanged (no official JS SDK — see module JSDoc) and `.request` carries
 * url/method/static headers. Auth is your job: add a Basic `authorization`
 * header.
 *
 * ```ts
 * const params = inworld.speech({ text: "…", voiceId: "Dennis", modelId: "inworld-tts-2" });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Basic ${process.env.INWORLD_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
export const speech = validator as unknown as {
  <T extends TtsVoiceBody>(
    params: T & ExactKeys<T, TtsVoiceBody>,
    options?: ValidateOptions,
  ): Validated<T, SpeechSdkTargets<T>>;
  safe<T extends TtsVoiceBody>(
    params: T & ExactKeys<T, TtsVoiceBody>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, SpeechSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
