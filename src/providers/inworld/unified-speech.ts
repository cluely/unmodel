/**
 * `unmodel/speech` → `inworld.speech` (POST /tts/v1/voice).
 *
 * `audioConfig` is the closest thing in this category to the canonical
 * `outputFormat`: encoding, sample rate and bitrate are three fields on one
 * object, so the mapping is nearly a rename — plus `speakingRate`, which is a
 * plain multiplier (0.5–1.5) and therefore an identity mapping.
 *
 * One deliberate omission: **`LINEAR16` is not used.** Inworld's encoding enum
 * carries `LINEAR16`, `PCM` and `WAV`, and its docs do not say which of the
 * three includes a RIFF header. `PCM` and `WAV` are unambiguous by name, so
 * they are what a canonical `pcm_s16le` compiles to (raw and WAV
 * respectively); `LINEAR16` stays reachable through
 * `providerOptions.inworld.audioConfig`.
 */
import {
  applyExtras,
  EXTRA,
  resolveAudioFormat,
  resolveVoice,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  SpeechAdapterFor,
  SpeechModelParamTable,
  SpeechParams,
} from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  type InworldApplyTextNormalization,
  type InworldAudioConfig,
  type InworldAudioEncoding,
  type InworldDeliveryMode,
  type InworldSampleRateHertz,
  type InworldTimestampType,
  type TtsVoiceBody,
} from "./speech";

/** The six TTS model ids — the ref union for `inworld/…`. */
const MODELS = [
  "inworld-tts-2",
  "inworld-tts-2-flash",
  "inworld-tts-1.5-max",
  "inworld-tts-1.5-mini",
  "inworld-tts-1",
  "inworld-tts-1-max",
] as const;

const SYNTHESIZE_DOCS =
  "https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech";

/** The wire body this adapter compiles to. */
export type InworldSpeechWire = TtsVoiceBody;

/** What a unified call to `inworld/…` returns. */
export type InworldSpeechResult = ReturnType<typeof validator>;

const SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000] as const;

const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "MP3",
    flac: "FLAC",
    opus: "OGG_OPUS",
    pcm_alaw: "ALAW",
    pcm_mulaw: "MULAW",
    pcm_s16le: "WAV",
  },
  containers: {
    mp3: ["mp3"],
    flac: ["flac"],
    opus: ["ogg"],
    pcm_alaw: ["raw"],
    pcm_mulaw: ["raw"],
    pcm_s16le: ["wav", "raw"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    flac: SAMPLE_RATES,
    opus: SAMPLE_RATES,
    pcm_alaw: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
  },
  // "Bits per second; compressed formats only" — there is no bitrate to set on
  // an uncompressed stream, and FLAC's is a property of the encoder.
  unavailable: { pcm_alaw: ["bitrate"], pcm_mulaw: ["bitrate"], pcm_s16le: ["bitrate"], flac: ["bitrate"] },
  source: SYNTHESIZE_DOCS,
};

/**
 * Inworld's per-model surface: one codec set, and a `speechConstraints` table
 * read into three rows.
 *
 * `deliveryMode` is "Only supported by `inworld-tts-2`" — which in the deny
 * table means the two TTS-2 ids, since the 1.x generations are the ones it
 * denies — and `temperature` runs the other way: it is flagged `ignored` on
 * `inworld-tts-2`, where "the request is accepted but sampling is unaffected;
 * use `deliveryMode` to steer stability instead". So the flagship carries
 * `deliveryMode` and not `temperature`, the 1.x line carries `temperature` and
 * not `deliveryMode`, and `inworld-tts-2-flash` is the one id that carries
 * both. Two crossing per-model rules, stated once here and enforced again by
 * the provider for the callers a type cannot reach.
 *
 * No `languages`: `language` is BCP-47 with a region and passes through
 * unmapped, against no published enum.
 */
const SHARED_EXTRAS = {
  applyTextNormalization: EXTRA as InworldApplyTextNormalization,
  enhanceGeneration: EXTRA as boolean,
  timestampType: EXTRA as InworldTimestampType,
} as const;

const CODECS = ["mp3", "flac", "opus", "pcm_s16le", "pcm_mulaw", "pcm_alaw"] as const;

const LEGACY_ROW = {
  codecs: CODECS,
  extras: { ...SHARED_EXTRAS, temperature: EXTRA as number },
} as const;

const INWORLD_SPEECH_MODEL_PARAMS = {
  "inworld-tts-2": {
    codecs: CODECS,
    extras: { ...SHARED_EXTRAS, deliveryMode: EXTRA as InworldDeliveryMode },
  },
  "inworld-tts-2-flash": {
    codecs: CODECS,
    extras: {
      ...SHARED_EXTRAS,
      deliveryMode: EXTRA as InworldDeliveryMode,
      temperature: EXTRA as number,
    },
  },
  "inworld-tts-1.5-max": LEGACY_ROW,
  "inworld-tts-1.5-mini": LEGACY_ROW,
  "inworld-tts-1": LEGACY_ROW,
  "inworld-tts-1-max": LEGACY_ROW,
} as const satisfies SpeechModelParamTable;

export const speech = {
  category: "speech",
  provider: "inworld",
  models: MODELS,
  modelParams: INWORLD_SPEECH_MODEL_PARAMS,
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<InworldSpeechWire, InworldSpeechResult> {
    ctx.from(["voiceId"], "voice");
    ctx.from(["modelId"], "model");
    ctx.from(["audioConfig"], "outputFormat");
    ctx.from(["audioConfig", "speakingRate"], "speed");

    const body: InworldSpeechWire = { text: input.text, voiceId: "", modelId: ctx.model };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: SYNTHESIZE_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voiceId = voice.value;
    }

    const audioConfig: InworldAudioConfig = {};
    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        audioConfig.audioEncoding =
          format.codec === "pcm_s16le" && format.container === "raw"
            ? "PCM"
            : (format.wire as InworldAudioEncoding);
        if (format.sampleRate !== undefined) {
          audioConfig.sampleRateHertz = format.sampleRate as InworldSampleRateHertz;
        }
        if (format.bitrate !== undefined) audioConfig.bitRate = format.bitrate;
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.5, max: 1.5, source: SYNTHESIZE_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) audioConfig.speakingRate = speed;
    }

    if (Object.keys(audioConfig).length > 0) body.audioConfig = audioConfig;

    // BCP-47 already ("en-US"), which is exactly what `language` takes.
    if (input.language !== undefined) body.language = input.language;

    applyExtras(input, INWORLD_SPEECH_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SpeechAdapterFor<
  typeof INWORLD_SPEECH_MODEL_PARAMS,
  InworldSpeechWire,
  InworldSpeechResult
>;
