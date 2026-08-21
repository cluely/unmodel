/**
 * MiniMax Text to Audio (T2A v2) — POST https://api.minimax.io/v1/t2a_v2
 *
 * Wire notes (transcribed from the OpenAPI document embedded in
 * https://platform.minimax.io/docs/api-reference/speech-t2a-http — "MiniMax
 * T2A API" 1.0.0, server https://api.minimax.io — on 2026-08-13):
 * - Everything rides in the JSON body; there are no path or query params on
 *   the international platform. `https://api-uw.minimax.io/v1/t2a_v2` is a
 *   documented lower-latency alias of the same contract (T2A_UW_URL).
 * - `voice_setting.voice_id` picks the voice; leave it out ONLY when mixing
 *   voices through `timbre_weights` (up to 4, weights 1–100).
 * - Non-streaming responses return the audio hex-encoded in
 *   `data.audio` (or a URL when `output_format: "url"`), so this is a JSON
 *   API — but unmodel validates requests only, so there is no checker here.
 * - Auth is `Authorization: Bearer <MINIMAX_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 * - This is the INTERNATIONAL platform. The China platform (api.minimaxi.com)
 *   is a separate host with its own GroupId query param and is out of scope.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { speechModels, SPEECH_MODEL_IDS, type MinimaxSpeechModelId } from "./models";

export const T2A_URL = "https://api.minimax.io/v1/t2a_v2";
/** Documented lower-latency alternative host for the same endpoint. */
export const T2A_UW_URL = "https://api-uw.minimax.io/v1/t2a_v2";

const T2A_DOCS = "https://platform.minimax.io/docs/api-reference/speech-t2a-http";

/** `voice_setting.emotion` values. */
export const T2A_EMOTIONS = [
  "happy",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
  "calm",
  "fluent",
  "whisper",
] as const;
export type MinimaxEmotion = (typeof T2A_EMOTIONS)[number];

/** `audio_setting.format` values. */
export const T2A_AUDIO_FORMATS = [
  "mp3",
  "pcm",
  "flac",
  "wav",
  "pcmu_raw",
  "pcmu_wav",
  "opus",
] as const;
export type MinimaxAudioFormat = (typeof T2A_AUDIO_FORMATS)[number];

/** `audio_setting.sample_rate` values. */
export const T2A_SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100] as const;
/** `audio_setting.bitrate` values (mp3 only). */
export const T2A_BITRATES = [32000, 64000, 128000, 256000] as const;

/** `language_boost` values (plus "auto"). */
export const T2A_LANGUAGE_BOOSTS = [
  "Chinese",
  "Chinese,Yue",
  "English",
  "Arabic",
  "Russian",
  "Spanish",
  "French",
  "Portuguese",
  "German",
  "Turkish",
  "Dutch",
  "Ukrainian",
  "Vietnamese",
  "Indonesian",
  "Japanese",
  "Italian",
  "Korean",
  "Thai",
  "Polish",
  "Romanian",
  "Greek",
  "Czech",
  "Finnish",
  "Hindi",
  "Bulgarian",
  "Danish",
  "Hebrew",
  "Malay",
  "Persian",
  "Slovak",
  "Swedish",
  "Croatian",
  "Filipino",
  "Hungarian",
  "Norwegian",
  "Slovenian",
  "Catalan",
  "Nynorsk",
  "Tamil",
  "Afrikaans",
  "auto",
] as const;
export type MinimaxLanguageBoost = (typeof T2A_LANGUAGE_BOOSTS)[number];

/** `voice_modify.sound_effects` values (one at a time). */
export const T2A_SOUND_EFFECTS = [
  "spacious_echo",
  "auditorium_echo",
  "lofi_telephone",
  "robotic",
] as const;

/** "Up to 4 voices can be mixed" through `timbre_weights`. */
export const T2A_MAX_TIMBRE_WEIGHTS = 4;

/**
 * "`fluent`, `whisper` is only available for models: speech-2.6-turbo,
 * speech-2.6-hd. speech-2.8-hd and speech-2.8-turbo do not support `whisper`."
 */
const FLUENT_MODELS = new Set(["speech-2.6-turbo", "speech-2.6-hd"]);
const WHISPER_MODELS = new Set(["speech-2.6-turbo", "speech-2.6-hd"]);
const FLUENT_ALSO_ON_2_8 = new Set(["speech-2.8-hd", "speech-2.8-turbo"]);

/**
 * "The speech-01 and speech-02 series models do not currently support
 * Persian, Filipino, or Tamil" (`language_boost`).
 */
const LATE_LANGUAGE_BOOSTS = new Set(["Persian", "Filipino", "Tamil"]);

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

export interface MinimaxVoiceSetting {
  /** System, cloned or AI-generated voice id. Omit only when mixing timbres. */
  voice_id?: string;
  /** Speech speed, 0.5–2. Default 1. */
  speed?: number;
  /** Speech volume, greater than 0 and up to 10. Default 1. */
  vol?: number;
  /** Pitch offset, integer -12–12. Default 0. */
  pitch?: number;
  /** Emotion; auto-selected when omitted. */
  emotion?: MinimaxEmotion;
  /** Digit-reading normalization (Chinese/English). Default false. */
  text_normalization?: boolean;
  /** LaTeX formula reading (Chinese only; forces language_boost Chinese). */
  latex_read?: boolean;
}

export interface MinimaxAudioSetting {
  sample_rate?: (typeof T2A_SAMPLE_RATES)[number];
  /** mp3 only. */
  bitrate?: (typeof T2A_BITRATES)[number];
  format?: MinimaxAudioFormat;
  /** 1 = mono (default), 2 = stereo. */
  channel?: 1 | 2;
  /** Constant bitrate; only effective for streamed mp3. Default false. */
  force_cbr?: boolean;
}

export interface MinimaxTimbreWeight {
  voice_id: string;
  /** 1–100. */
  weight: number;
}

export interface MinimaxVoiceModify {
  /** -100–100. */
  pitch?: number;
  /** -100–100. */
  intensity?: number;
  /** -100–100. */
  timbre?: number;
  sound_effects?: (typeof T2A_SOUND_EFFECTS)[number];
}

export interface T2aParams {
  /** The speech synthesis model. Required. */
  model: MinimaxSpeechModelId | (string & {});
  /** The text to synthesize (billed per character); under 10,000 characters. */
  text: string;
  /** Stream the audio back in chunks. Default false. */
  stream?: boolean;
  stream_options?: { exclude_aggregated_audio?: boolean };
  voice_setting?: MinimaxVoiceSetting;
  audio_setting?: MinimaxAudioSetting;
  /** Custom pronunciation rules, `original/replacement` per entry. */
  pronunciation_dict?: { tone?: string[] };
  /** Mix up to 4 voices by weight (leave `voice_setting.voice_id` empty). */
  timbre_weights?: MinimaxTimbreWeight[];
  /** Enhance recognition of a specific language/dialect. Default null. */
  language_boost?: MinimaxLanguageBoost | (string & {}) | null;
  voice_modify?: MinimaxVoiceModify;
  /** Return timestamped subtitles alongside the audio. Default false. */
  subtitle_enable?: boolean;
  /** Subtitle granularity; "word_streaming" requires `stream: true`. */
  subtitle_type?: "sentence" | "word" | "word_streaming";
  /** "url" or "hex" (default). Non-streaming only. */
  output_format?: "url" | "hex";
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const t2aSchema = z.looseObject({
  model: z.string().min(1, "model is required"),
  text: z.string(),
  stream: z.boolean().optional(),
  stream_options: z
    .looseObject({ exclude_aggregated_audio: z.boolean().optional() })
    .optional(),
  voice_setting: z
    .looseObject({
      voice_id: z.string().optional(),
      speed: z.number().min(0.5, "speed must be between 0.5 and 2").max(2, "speed must be between 0.5 and 2").optional(),
      vol: z.number().gt(0, "vol must be greater than 0 and at most 10").max(10, "vol must be greater than 0 and at most 10").optional(),
      pitch: z.number().int().min(-12).max(12).optional(),
      emotion: z.string().optional(),
      text_normalization: z.boolean().optional(),
      latex_read: z.boolean().optional(),
    })
    .optional(),
  audio_setting: z
    .looseObject({
      sample_rate: z.number().optional(),
      bitrate: z.number().optional(),
      format: z.string().optional(),
      channel: z.number().optional(),
      force_cbr: z.boolean().optional(),
    })
    .optional(),
  pronunciation_dict: z.looseObject({ tone: z.array(z.string()).optional() }).optional(),
  timbre_weights: z
    .array(
      z.looseObject({
        voice_id: z.string(),
        weight: z.number().int().min(1, "weight must be between 1 and 100").max(100, "weight must be between 1 and 100"),
      }),
    )
    .max(T2A_MAX_TIMBRE_WEIGHTS, `at most ${T2A_MAX_TIMBRE_WEIGHTS} voices can be mixed`)
    .optional(),
  language_boost: z.string().nullable().optional(),
  voice_modify: z
    .looseObject({
      pitch: z.number().int().min(-100).max(100).optional(),
      intensity: z.number().int().min(-100).max(100).optional(),
      timbre: z.number().int().min(-100).max(100).optional(),
      sound_effects: z.string().optional(),
    })
    .optional(),
  subtitle_enable: z.boolean().optional(),
  subtitle_type: z.enum(["sentence", "word", "word_streaming"]).optional(),
  output_format: z.enum(["url", "hex"]).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const SPEECH_MODEL_ID_SET = new Set<string>(SPEECH_MODEL_IDS);
const EMOTION_SET = new Set<string>(T2A_EMOTIONS);
const FORMAT_SET = new Set<string>(T2A_AUDIO_FORMATS);
const LANGUAGE_BOOST_SET = new Set<string>(T2A_LANGUAGE_BOOSTS);
const SOUND_EFFECT_SET = new Set<string>(T2A_SOUND_EFFECTS);

/** `model` is a documented enum on this route. */
function checkModelEnum(params: T2aParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  if (SPEECH_MODEL_ID_SET.has(params.model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model: params.model,
    message: `\`model\` must be one of ${SPEECH_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(params.model)}.`,
    meta: { allowed: [...SPEECH_MODEL_IDS], value: params.model, source: T2A_DOCS },
  });
}

/**
 * A request must name a voice: either `voice_setting.voice_id` or the
 * `timbre_weights` mix ("To apply mixed voices, configure the
 * `timbre_weights` parameter and leave this value empty").
 */
function checkVoiceSelection(
  params: T2aParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const hasVoiceId = (params.voice_setting?.voice_id ?? "") !== "";
  const hasTimbres = (params.timbre_weights?.length ?? 0) > 0;
  if (!hasVoiceId && !hasTimbres) {
    ctx.report({
      code: "invalid_shape",
      path: ["voice_setting", "voice_id"],
      message:
        "A voice is required: set `voice_setting.voice_id`, or mix voices with `timbre_weights` and leave `voice_id` empty.",
      meta: { source: T2A_DOCS },
    });
  }
}

/** `emotion` enum plus its documented per-model availability. */
function checkEmotion(params: T2aParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const emotion = params.voice_setting?.emotion;
  if (emotion === undefined) return;
  if (!EMOTION_SET.has(emotion)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["voice_setting", "emotion"],
      message: `\`voice_setting.emotion\` must be one of ${T2A_EMOTIONS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(emotion)}.`,
      meta: { allowed: [...T2A_EMOTIONS], value: emotion, source: T2A_DOCS },
    });
    return;
  }
  const model = params.model;
  if (emotion === "fluent" && !FLUENT_MODELS.has(model) && !FLUENT_ALSO_ON_2_8.has(model)) {
    ctx.report({
      code: "unsupported_capability",
      path: ["voice_setting", "emotion"],
      model,
      message: `\`emotion: "fluent"\` is only available on ${[...FLUENT_MODELS].map((v) => `"${v}"`).join(", ")}; "${model}" does not support it.`,
      meta: { allowed: [...FLUENT_MODELS], source: T2A_DOCS },
    });
  }
  if (emotion === "whisper" && !WHISPER_MODELS.has(model)) {
    ctx.report({
      code: "unsupported_capability",
      path: ["voice_setting", "emotion"],
      model,
      message: `\`emotion: "whisper"\` is only available on ${[...WHISPER_MODELS].map((v) => `"${v}"`).join(", ")}; "${model}" does not support it.`,
      meta: { allowed: [...WHISPER_MODELS], source: T2A_DOCS },
    });
  }
}

/** `audio_setting` enums, plus "bitrate only applies to mp3". */
function checkAudioSetting(
  params: T2aParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const audio = params.audio_setting;
  if (audio === undefined) return;
  if (audio.format !== undefined && !FORMAT_SET.has(audio.format)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["audio_setting", "format"],
      message: `\`audio_setting.format\` must be one of ${T2A_AUDIO_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(audio.format)}.`,
      meta: { allowed: [...T2A_AUDIO_FORMATS], value: audio.format, source: T2A_DOCS },
    });
  }
  if (
    audio.sample_rate !== undefined &&
    !T2A_SAMPLE_RATES.includes(audio.sample_rate as (typeof T2A_SAMPLE_RATES)[number])
  ) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["audio_setting", "sample_rate"],
      message: `\`audio_setting.sample_rate\` must be one of ${T2A_SAMPLE_RATES.join(", ")}; got ${audio.sample_rate}.`,
      meta: { allowed: [...T2A_SAMPLE_RATES], value: audio.sample_rate, source: T2A_DOCS },
    });
  }
  if (audio.channel !== undefined && audio.channel !== 1 && audio.channel !== 2) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["audio_setting", "channel"],
      message: `\`audio_setting.channel\` must be 1 (mono) or 2 (stereo); got ${audio.channel}.`,
      meta: { allowed: [1, 2], value: audio.channel, source: T2A_DOCS },
    });
  }
  if (audio.bitrate === undefined) return;
  if (!T2A_BITRATES.includes(audio.bitrate as (typeof T2A_BITRATES)[number])) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["audio_setting", "bitrate"],
      message: `\`audio_setting.bitrate\` must be one of ${T2A_BITRATES.join(", ")}; got ${audio.bitrate}.`,
      meta: { allowed: [...T2A_BITRATES], value: audio.bitrate, source: T2A_DOCS },
    });
  }
  if (audio.format !== undefined && audio.format !== "mp3" && FORMAT_SET.has(audio.format)) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["audio_setting", "bitrate"],
      message: `\`audio_setting.bitrate\` only applies to mp3 output; it is ignored for "${audio.format}".`,
      meta: { ignored: true, source: T2A_DOCS },
    });
  }
}

/**
 * `language_boost` enum, plus "the speech-01 and speech-02 series models do
 * not currently support Persian, Filipino, or Tamil".
 */
function checkLanguageBoost(
  params: T2aParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const boost = params.language_boost;
  if (boost == null) return;
  if (!LANGUAGE_BOOST_SET.has(boost)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["language_boost"],
      message: `\`language_boost\` must be one of the documented languages or "auto"; got ${JSON.stringify(boost)}.`,
      meta: { allowed: [...T2A_LANGUAGE_BOOSTS], value: boost, source: T2A_DOCS },
    });
    return;
  }
  const family = info?.family;
  if (
    LATE_LANGUAGE_BOOSTS.has(boost) &&
    (family === "speech-01" || family === "speech-02")
  ) {
    ctx.report({
      code: "unsupported_capability",
      path: ["language_boost"],
      model: params.model,
      message: `\`language_boost: ${JSON.stringify(boost)}\` is not supported by the speech-01 and speech-02 series; "${params.model}" ignores it.`,
      meta: { source: T2A_DOCS },
    });
  }
}

/** `voice_modify.sound_effects` enum; only one effect can be applied. */
function checkVoiceModify(
  params: T2aParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const effect = params.voice_modify?.sound_effects;
  if (effect === undefined || SOUND_EFFECT_SET.has(effect)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["voice_modify", "sound_effects"],
    message: `\`voice_modify.sound_effects\` must be one of ${T2A_SOUND_EFFECTS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(effect)}.`,
    meta: { allowed: [...T2A_SOUND_EFFECTS], value: effect, source: T2A_DOCS },
  });
}

/**
 * Streaming pairings: `subtitle_type: "word_streaming"` is "only valid when
 * stream=true", and `output_format` is "only effective in non-streaming
 * scenarios. In streaming, only `hex` is supported".
 */
function checkStreamingPairings(
  params: T2aParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.subtitle_type === "word_streaming" && params.stream !== true) {
    ctx.report({
      code: "invalid_shape",
      path: ["subtitle_type"],
      message: '`subtitle_type: "word_streaming"` is only valid when `stream: true`.',
      meta: { source: T2A_DOCS },
    });
  }
  if (params.stream === true && params.output_format === "url") {
    ctx.report({
      code: "unsupported_param",
      path: ["output_format"],
      message:
        '`output_format: "url"` is only effective for non-streaming requests; streaming responses are always hex.',
      meta: { source: T2A_DOCS },
    });
  }
}

/**
 * Per-request character cap on `text` (catalog `limit.characters`). Reported
 * as `over_output_limit` — the code names tokens elsewhere, but the message
 * and meta ({ limitCharacters, actualCharacters }) are explicitly about
 * characters; there is no character-specific issue code.
 */
function checkCharacterLimit(
  params: T2aParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const limit = info?.limit.characters;
  if (limit === undefined) return;
  const actual = params.text.length;
  if (actual <= limit) return;
  ctx.report({
    code: "over_output_limit",
    path: ["text"],
    model: params.model,
    message: `\`text\` is ${actual} characters; MiniMax documents "must be less than ${limit} characters" for a T2A request.`,
    meta: { limitCharacters: limit, actualCharacters: actual, source: T2A_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — T2A is billed per input character.
// ---------------------------------------------------------------------------

function estimate(params: T2aParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const costUSD = computeCharacterCostUSD(info?.cost, params.text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize — the whole params object is the wire body.
// ---------------------------------------------------------------------------

/**
 * Written as a `type` kept in lockstep with the object literal in `finalize`:
 * an `interface extends Record<string, …>` would inherit a string index
 * signature and collapse `keyof` to `string`, so `.toSdk("anything")` would
 * type-check. See `SdkFormatters` in core/request.ts.
 */
type MinimaxSdkTargets<B> = { minimax: () => B };

function finalize(params: T2aParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: T2A_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { minimax: () => body } },
  );
}

const validator = createValidator<T2aParams, unknown>({
  endpoint: "minimax.speech",
  schema: t2aSchema,
  modelId: (params) => params.model,
  catalog: speechModels,
  checks: [
    checkModelEnum,
    checkVoiceSelection,
    checkEmotion,
    checkAudioSetting,
    checkLanguageBoost,
    checkVoiceModify,
    checkStreamingPairings,
    checkCharacterLimit,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for MiniMax `POST /v1/t2a_v2` (Text to Audio).
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * MiniMax ships no official JS SDK for this API, so `.toSdk("minimax")`
 * returns the body unchanged. Auth is your job: add
 * `authorization: Bearer <MINIMAX_API_KEY>` when fetching.
 *
 * ```ts
 * const params = minimax.speech({
 *   model: "speech-2.8-hd",
 *   text: "Hello world",
 *   voice_setting: { voice_id: "English_Graceful_Lady", speed: 1 },
 *   audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000 },
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
 *   },
 *   body: JSON.stringify(params),
 * });
 * const { data } = await res.json(); // data.audio is hex-encoded audio
 * ```
 */
export const speech = validator as unknown as {
  <T extends T2aParams>(
    params: T & ExactKeys<T, T2aParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, MinimaxSdkTargets<T>>;
  safe<T extends T2aParams>(
    params: T & ExactKeys<T, T2aParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, MinimaxSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
