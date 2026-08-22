/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/gladia/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import { SOLARIA_3_LANGUAGES } from "./models";
import type {
  GladiaAudioToLlmConfig,
  GladiaCustomSpellingConfig,
  GladiaCustomVocabularyConfig,
  GladiaPiiRedactionConfig,
  GladiaSubtitlesConfig,
  GladiaSummarizationConfig,
  GladiaTranslationConfig,
} from "./stt";

/** The two Solaria models — the ref union for `gladia/…`. */
export const MODELS = ["solaria-3", "solaria-1"] as const;

/**
 * Gladia's two models, and the one that is single-language.
 *
 * `solaria-3` is "Async (pre-recorded) only … Single language only" and covers
 * "English, French, German, Spanish, Italian" — the same
 * {@link SOLARIA_3_LANGUAGES} array `checkModelLanguages` refuses against, by
 * reference. `solaria-1` covers "100+" languages with no published enum, so its
 * row carries no list rather than a guess.
 *
 * `code_switching` follows the same line: it is the multi-language switch, and
 * "solaria-3 does not support code switching", so it is on `solaria-1`'s row
 * alone. It nests under `language_config` ({@link LANGUAGE_CONFIG_NESTING}),
 * beside the `languages` array compiled from the canonical `language` /
 * `languages` — `applyExtras` merges into that object rather than replacing it.
 *
 * `timestamps` is `["word", "segment"]` on both, and carries no `"none"`: the
 * response always includes word timings and `sentences` only changes the
 * grouping, so there is nothing for `"none"` to mean.
 *
 * Everything else is Gladia's feature-plus-config pattern, and both halves of
 * each pair are declared: the API *drops* a `*_config` whose boolean is not
 * `true` (its own `checkToggles` warns about exactly that), so a caller needs
 * to be able to send `summarization: true` and `summarization_config` together
 * — offering only one of the two would guarantee the silent drop.
 *
 * Excluded: `audio_url`, `model`, `language_config.languages`, `diarization`,
 * `diarization_config` and `sentences` are canonical words' wire spellings, and
 * `callback` / `callback_url` / `callback_config` / `custom_metadata` are
 * transport.
 */
export const PRE_RECORDED_EXTRAS = {
  custom_vocabulary: EXTRA as boolean,
  custom_vocabulary_config: EXTRA as GladiaCustomVocabularyConfig,
  custom_spelling: EXTRA as boolean,
  custom_spelling_config: EXTRA as GladiaCustomSpellingConfig,
  punctuation_enhanced: EXTRA as boolean,
  pii_redaction: EXTRA as boolean,
  pii_redaction_config: EXTRA as GladiaPiiRedactionConfig,
  subtitles: EXTRA as boolean,
  subtitles_config: EXTRA as GladiaSubtitlesConfig,
  translation: EXTRA as boolean,
  translation_config: EXTRA as GladiaTranslationConfig,
  summarization: EXTRA as boolean,
  summarization_config: EXTRA as GladiaSummarizationConfig,
  named_entity_recognition: EXTRA as boolean,
  sentiment_analysis: EXTRA as boolean,
  audio_to_llm: EXTRA as boolean,
  audio_to_llm_config: EXTRA as GladiaAudioToLlmConfig,
} as const;

export const TIMESTAMPS = ["word", "segment"] as const;

export const GLADIA_STT_MODEL_PARAMS = {
  "solaria-3": {
    timestamps: TIMESTAMPS,
    languages: SOLARIA_3_LANGUAGES,
    extras: PRE_RECORDED_EXTRAS,
  },
  "solaria-1": {
    timestamps: TIMESTAMPS,
    extras: { ...PRE_RECORDED_EXTRAS, code_switching: EXTRA as boolean },
  },
} as const satisfies SttModelParamTable;
