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
  resolveAudioFormat,
  resolveVoice,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { SpeechParams } from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  type InworldAudioConfig,
  type InworldAudioEncoding,
  type InworldSampleRateHertz,
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

export const speech = {
  category: "speech",
  provider: "inworld",
  models: MODELS,
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

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, InworldSpeechWire, InworldSpeechResult>;
