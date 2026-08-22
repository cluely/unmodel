/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/google/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type { GoogleTtsMultiSpeakerVoiceConfig } from "./tts";
import {
  GEMINI_SPEECH_NATIVE_SAMPLE_RATE,
  GEMINI_TTS_DOCS_URL,
  GEMINI_TTS_LANGUAGE_CODES,
  GEMINI_TTS_MODEL_IDS,
} from "./tts-constraints";
import { GEMINI_TTS_VOICES, type GoogleThinkingConfig } from "./wire";

/** The three ids the speech-generation guide tabulates — the `google/…` refs. */
export const MODELS = GEMINI_TTS_MODEL_IDS;

/**
 * `responseFormat.audio` — five canonical codecs, and the PCM split.
 *
 * `AUDIO_WAV` is absent from `codecs` on purpose: it is not a sixth codec, it
 * is `pcm_s16le` **in a container**, and the compile step below picks between
 * it and `AUDIO_L16` from the resolved container. Putting it in the map would
 * make the codec list six long and give `pcm_s16le` two entries that a caller
 * could not tell apart.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "AUDIO_MP3",
    opus: "AUDIO_OGG_OPUS",
    pcm_s16le: "AUDIO_L16",
    pcm_alaw: "AUDIO_ALAW",
    pcm_mulaw: "AUDIO_MULAW",
  },
  containers: { opus: ["ogg"], pcm_s16le: ["wav", "raw"] },
  // "`bitRate` … Only applicable for compressed formats (MP3, Opus)" — stated
  // per codec rather than endpoint-wide, because MP3 and Ogg-Opus DO take one.
  unavailable: {
    pcm_s16le: ["bitrate"],
    pcm_alaw: ["bitrate"],
    pcm_mulaw: ["bitrate"],
  },
  // The only rate Google publishes for this surface: "raw PCM bytes (24kHz,
  // 1-channel, 16-bit)". A default, never a bound — the reference enumerates no
  // allowed rates at all, so no `sampleRates` list appears above.
  defaults: { sampleRate: GEMINI_SPEECH_NATIVE_SAMPLE_RATE },
  source: GEMINI_TTS_DOCS_URL,
};

/** The five codecs {@link FORMAT} names, in canonical spelling. */
export const CODECS = ["mp3", "opus", "pcm_s16le", "pcm_alaw", "pcm_mulaw"] as const;

/**
 * The knobs `generationConfig` has that the vocabulary has no word for.
 *
 * All three are shared by the three models; `thinkingConfig` is not, and that
 * asymmetry is the reason this is a per-**model** table. `gemini-3.1-flash-tts-preview`
 * is the one reasoning TTS model — `ttsModels`' own `reasoning: true` flag says
 * so, `./tts.ts` states it in the type system as `thinkingConfig?: never` on the
 * other two arms, and `checkGenerationCapabilities` reports it at runtime. This
 * row is that same fact a third time, in the one place a *unified* caller can
 * see it.
 *
 * `multiSpeakerVoiceConfig` is here rather than in the vocabulary because the
 * canonical `voice` is one voice: a two-speaker dialogue needs a speaker **name
 * per voice**, matched to names inside the prompt, which is a request shape no
 * other provider in the category has. It is typed as `./tts.ts`'s bounded
 * 1-or-2 tuple, so an editor refuses a third speaker at the call site and
 * `checkSpeechConfig` refuses it again for everyone else — and it nests under
 * `generationConfig.speechConfig` ({@link EXTRA_NESTING}), beside the
 * `voiceConfig` compiled from `voice`, where the wire's own XOR check then sees
 * both and says exactly that.
 */
export const SHARED_EXTRAS = {
  multiSpeakerVoiceConfig: EXTRA as GoogleTtsMultiSpeakerVoiceConfig,
  temperature: EXTRA as number,
  maxOutputTokens: EXTRA as number,
} as const;

export const GOOGLE_TTS_MODEL_PARAMS = {
  "gemini-3.1-flash-tts-preview": {
    codecs: CODECS,
    languages: GEMINI_TTS_LANGUAGE_CODES,
    voices: GEMINI_TTS_VOICES,
    extras: { ...SHARED_EXTRAS, thinkingConfig: EXTRA as GoogleThinkingConfig },
  },
  "gemini-2.5-flash-preview-tts": {
    codecs: CODECS,
    languages: GEMINI_TTS_LANGUAGE_CODES,
    voices: GEMINI_TTS_VOICES,
    extras: SHARED_EXTRAS,
  },
  "gemini-2.5-pro-preview-tts": {
    codecs: CODECS,
    languages: GEMINI_TTS_LANGUAGE_CODES,
    voices: GEMINI_TTS_VOICES,
    extras: SHARED_EXTRAS,
  },
} as const satisfies TtsModelParamTable;
