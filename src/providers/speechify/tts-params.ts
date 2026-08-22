/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/speechify/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsModelParamTable } from "../../core/unified/vocabulary/tts";

/** The four Simba rows — the ref union for `speechify/…`. */
export const MODELS = ["simba-english", "simba-multilingual", "simba-3.0", "simba-3.2"] as const;

export const SPEC_URL = "https://docs.speechify.ai/openapi/api-reference.json";

export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", pcm_s16le: "wav", pcm_mulaw: "ulaw", aac: "aac" },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["raw"],
    aac: ["aac"],
  },
  sampleRates: {
    mp3: [22050, 24000],
    // `pcm_*` and `wav_*` publish different rate sets; the composite enum in
    // the provider validator is the authority on which pairs exist.
    pcm_s16le: [8000, 16000, 22050, 24000, 44100, 48000],
    pcm_mulaw: [8000],
    aac: [24000],
  },
  bitrates: { mp3: [32000, 64000, 96000, 128000, 192000] },
  unavailable: { pcm_s16le: ["bitrate"], pcm_mulaw: ["bitrate"], aac: ["bitrate"] },
  defaultsByCodec: { pcm_mulaw: { sampleRate: 8000 } },
  source: SPEC_URL,
};

/**
 * Speechify's per-model surface, and the one model whose language list is one
 * value long.
 *
 * `simba-3.2` is English only — the provider's `checkLanguage` refuses anything
 * that does not start `en`, citing the 400 it would otherwise return — so its
 * row says `languages: ["en"]` and an editor completes exactly that. The other
 * three carry no list: `simba-3.0`'s six extra locales and
 * `simba-multilingual`'s "30+" are documented in prose rather than as an enum,
 * and `checkLanguage` deliberately does not gate them ("the docs say 30+ and do
 * not enumerate"). A completion list with no authority behind it would be a
 * guess dressed as a capability.
 *
 * The two extras are `options`' members, nested through
 * {@link OPTIONS_NESTING}: loudness normalization to −14 LUFS, and the
 * numbers-and-dates text expansion whose *default* differs between this route
 * and the streaming one — which is exactly why it is worth being able to set
 * explicitly.
 */
export const SPEECHIFY_EXTRAS = {
  loudness_normalization: EXTRA as boolean,
  text_normalization: EXTRA as boolean,
} as const;

export const CODECS = ["mp3", "aac", "pcm_s16le", "pcm_mulaw"] as const;

export const SPEECHIFY_TTS_MODEL_PARAMS = {
  "simba-english": { codecs: CODECS, extras: SPEECHIFY_EXTRAS },
  "simba-multilingual": { codecs: CODECS, extras: SPEECHIFY_EXTRAS },
  "simba-3.0": { codecs: CODECS, extras: SPEECHIFY_EXTRAS },
  "simba-3.2": { codecs: CODECS, languages: ["en"], extras: SPEECHIFY_EXTRAS },
} as const satisfies TtsModelParamTable;
