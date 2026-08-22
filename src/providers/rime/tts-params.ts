/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/rime/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import { LANGUAGES, MIST_LANGUAGES } from "./models";

/** Every model id the catalog carries — the ref union for `rime/…`. */
export const MODELS = ["coda", "mistv3", "mistv2", "mist", "arcanav3", "arcanav2", "arcana"] as const;

export const CODA_DOCS = "https://docs.rime.ai/api-reference/coda/http";

export const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "audio/mpeg",
    pcm_s16le: "audio/wav",
    pcm_mulaw: "audio/PCMU",
    opus: "audio/ogg;codecs=opus",
  },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["raw"],
    opus: ["ogg", "webm"],
  },
  // `samplingRate` is an open range (per-model, 4000–96000), checked by the
  // provider; there is no bitrate field at all.
  unavailable: ["bitrate"],
  source: CODA_DOCS,
};

/**
 * Rime's per-model surface, which splits three ways — and every split is one
 * the wire already enforces.
 *
 * | | codecs | languages | extras |
 * |---|---|---|---|
 * | `coda`, `arcana*` | mp3, PCM, μ-law, **Opus** | all 16 spellings | *none* |
 * | `mistv3` | mp3, PCM, μ-law, **Opus** | the Mist 8 | inline speed, bracket pauses |
 * | `mistv2`, `mist` | mp3, PCM, μ-law | the Mist 8 | those two, plus phonemes and normalization |
 *
 * **Codecs.** "Opus and WAV arrived with Coda and Mist v3" — `checkAccept`
 * refuses anything outside `MIST_V2_ACCEPT_VALUES` on the two legacy ids, so
 * `opus` is off their row. `pcm_s16le` stays on it because the L16 spelling is
 * documented for them; it is reachable there as a *raw* stream only
 * (`audio/wav` is not), which is a container fact the codec list does not
 * claim to carry and `resolveAudioFormat` reports at run time.
 *
 * **Languages** are the provider's own two arrays by reference —
 * {@link LANGUAGES} (both the 639-1 and the 639-2/3 spelling of eight
 * languages) and {@link MIST_LANGUAGES} — so `checkLanguage`'s allow-list and
 * the editor's completion list are literally the same value. The Mist
 * *generation* is what narrows, which is why `mistv3` has the eight while
 * carrying the newer codecs: the two facts split the catalog differently, and a
 * per-model row is the only shape that can say so.
 *
 * **Extras** are `ttsConstraints` read backwards. Coda denies all four
 * ("per-word speed adjustment is a Mist-family feature — Coda does not support
 * it"), so its row declares none and an editor refuses `inlineSpeedAlpha` on it
 * by name. `speedAlpha` and `timeScaleFactor` are absent from every row: they
 * are the canonical `speed`'s wire spellings, and offering a second way to set
 * the same thing is how two values end up disagreeing.
 */
export const MIST_EXTRAS = {
  /** Comma-separated per-word multipliers for `[bracketed]` words. */
  inlineSpeedAlpha: EXTRA as string,
  /** Honour `<200>`-style angle-bracket pauses. */
  pauseBetweenBrackets: EXTRA as boolean,
} as const;

export const LEGACY_MIST_EXTRAS = {
  ...MIST_EXTRAS,
  /** Read phonemes written in `{curly}` brackets. */
  phonemizeBetweenBrackets: EXTRA as boolean,
  /** Skip text normalization. "mist/mistv2 only." */
  noTextNormalization: EXTRA as boolean,
} as const;

export const MODERN_CODECS = ["mp3", "pcm_s16le", "pcm_mulaw", "opus"] as const;

export const LEGACY_CODECS = ["mp3", "pcm_s16le", "pcm_mulaw"] as const;

export const ARCANA_ROW = { codecs: MODERN_CODECS, languages: LANGUAGES } as const;

export const LEGACY_MIST_ROW = {
  codecs: LEGACY_CODECS,
  languages: MIST_LANGUAGES,
  extras: LEGACY_MIST_EXTRAS,
} as const;

export const RIME_TTS_MODEL_PARAMS = {
  coda: { codecs: MODERN_CODECS, languages: LANGUAGES },
  mistv3: { codecs: MODERN_CODECS, languages: MIST_LANGUAGES, extras: MIST_EXTRAS },
  mistv2: LEGACY_MIST_ROW,
  mist: LEGACY_MIST_ROW,
  arcanav3: { ...ARCANA_ROW, extras: MIST_EXTRAS },
  arcanav2: { ...ARCANA_ROW, extras: MIST_EXTRAS },
  arcana: { ...ARCANA_ROW, extras: MIST_EXTRAS },
} as const satisfies TtsModelParamTable;
