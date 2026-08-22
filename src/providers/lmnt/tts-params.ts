/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/lmnt/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsModelParamTable } from "../../core/unified/vocabulary/tts";

/** LMNT's one documented model — the ref union for `lmnt/…`. */
export const MODELS = ["blizzard"] as const;

export const SPEECH_DOCS = "https://docs.lmnt.com/api/speech/generate";

export const SAMPLE_RATES = [8000, 16000, 24000] as const;

export const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "mp3",
    aac: "aac",
    pcm_mulaw: "ulaw",
    pcm_s16le: "wav",
    pcm_f32le: "pcm_f32le",
    opus: "webm",
  },
  containers: {
    mp3: ["mp3"],
    aac: ["aac"],
    pcm_mulaw: ["raw"],
    pcm_s16le: ["wav", "raw"],
    pcm_f32le: ["raw"],
    opus: ["webm"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    aac: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_f32le: SAMPLE_RATES,
    opus: SAMPLE_RATES,
  },
  unavailable: ["bitrate"],
  source: SPEECH_DOCS,
};

/**
 * LMNT's one model, and therefore one row.
 *
 * `languages` is {@link SPEECH_LANGUAGES} **minus `"auto"`**, which is the one
 * place this table cannot simply point at the provider's array. `"auto"` is a
 * legal wire value (it is the default) but not a legal *canonical* one: the
 * vocabulary's `language` is a BCP-47 tag, `toPrimaryLanguage` refuses a
 * four-letter word before the request is built, and "let the model detect" is
 * spelled by omitting the field. Completing a value that cannot be sent would
 * be the worst kind of suggestion.
 *
 * `temperature` and `top_p` are LMNT's expressiveness controls — and they are
 * why `speed` is declared unsupported rather than mapped onto one of them: they
 * steer variation and stability, not pace. `debug` saves the clip to the
 * account's library; it changes what the request *does* rather than only how
 * the answer is framed, so it is an extra rather than transport.
 */
export const LMNT_TTS_MODEL_PARAMS = {
  blizzard: {
    codecs: ["mp3", "aac", "opus", "pcm_s16le", "pcm_f32le", "pcm_mulaw"],
    languages: [
      "ar", "as", "bn", "cs", "da", "de", "en", "es", "fi", "fr",
      "hi", "id", "it", "ja", "ko", "ml", "mr", "nl", "pl", "pt",
      "ru", "sk", "sv", "ta", "te", "th", "tr", "uk", "ur", "vi",
      "zh",
    ],
    extras: {
      temperature: EXTRA as number,
      top_p: EXTRA as number,
      debug: EXTRA as boolean,
    },
  },
} as const satisfies TtsModelParamTable;
