/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/speechmatics/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import type {
  SpeechmaticsAdditionalVocabEntry,
  SpeechmaticsAudioEventsConfig,
  SpeechmaticsAudioFilteringConfig,
  SpeechmaticsLanguageIdentificationConfig,
  SpeechmaticsOutputConfig,
  SpeechmaticsPunctuationOverrides,
  SpeechmaticsSpeakerDiarizationConfig,
  SpeechmaticsSummarizationConfig,
  SpeechmaticsTopicDetectionConfig,
  SpeechmaticsTranscriptFilteringConfig,
  SpeechmaticsTranslationConfig,
} from "./stt";

/** The four batch models — the ref union for `speechmatics/…`. */
export const MODELS = ["enhanced", "standard", "melia-1", "oak-1"] as const;

/**
 * Speechmatics' per-model surface: the job config's own fields, and the nine
 * things Melia 1 and Oak 1 "do not yet support".
 *
 * ## Whole config objects, not flattened members
 *
 * Every extra below that ends in `_config` or `_overrides` is declared as one
 * typed **object**, rather than as its members promoted to top-level keys. That
 * is a deliberate departure from the flattening the other adapters do, and the
 * reason is this endpoint's shape: its knobs live three levels deep in eight
 * different config objects, and flattening them would put `topics`, `types`,
 * `speakers`, `replacements` and `sensitivity` on the unified request as
 * top-level words — names so generic that they would read as canonical
 * vocabulary rather than as Speechmatics' own. One object per feature keeps the
 * provider's structure visible, keeps the types exact (each is an interface
 * `./stt.ts` already exports), and keeps the extras list short enough to
 * read. Same call MiniMax's `voice_modify` makes, for the same reason.
 *
 * ## `timestamps: ["word"]`
 *
 * There is no granularity field: word timings ride on every transcript. So
 * `"word"` agrees and compiles to nothing, and `"segment"` / `"character"` /
 * `"none"` are refused by name.
 *
 * ## Melia 1 and Oak 1
 *
 * One row, shared: "On Batch, Melia 1 and Oak 1 match the Enhanced and
 * Standard models for core transcription features" and lack the same list
 * (https://docs.speechmatics.com/speech-to-text/models.md, 2026-11-12). It is
 * the full set minus `MULTILINGUAL_UNSUPPORTED`: no custom dictionary
 * (`additional_vocab`), no find-and-replace (`transcript_filtering_config`), no
 * audio filtering, and none of the six speech-intelligence add-ons.
 * `enable_entities` stays on the row: the models page lists entity detection
 * among the gaps, while https://www.speechmatics.com/pricing.md lists
 * "| Entity detection | Pre-recorded | On request | Melia 1, Oak 1 |", so
 * the wire validator sends it with a warning rather than refusing it (see
 * `./stt.ts`). The docs' instruction is "Set `language` to `multi`": `auto`
 * "returns an error" and the pack codes are unsupported, both refused, while a
 * single language code is undocumented there and the wire validator warns
 * about it. So `"multi"` is the whole of its `languages` list: the shortest in
 * the library, and one an editor can now complete.
 *
 * ## `domain`
 *
 * Enhanced and Standard both take `domain`, typed `string` like the wire. The
 * API reference types it as a free string — "Request a specialized model
 * based on 'language' but optimized for a particular field, e.g. 'finance' or
 * 'medical'" — with no model restriction
 * (https://docs.speechmatics.com/api-ref/batch/create-a-new-job.md,
 * 2026-11-12), and "Enhanced and Standard are feature-identical and differ
 * only in accuracy and speed"
 * (https://docs.speechmatics.com/speech-to-text/models.md). The Spanish and
 * English pack is `{"language": "es", "domain": "bilingual-en"}`, for "The
 * Enhanced and Standard models"
 * (https://docs.speechmatics.com/speech-to-text/languages.md, 2026-11-12).
 * `"medical"` selects the Enhanced Medical model and requires
 * `model: "enhanced"`; that is refused at run time by the wire validator,
 * because a `string` type cannot exclude one literal. Oak 1 is the
 * multilingual medical model by its id, and neither Melia 1 nor Oak 1 takes
 * `domain`.
 *
 * Excluded: `fetch_data`, `transcription_config.{language,model,diarization}`
 * and `language_identification_config.expected_languages` are canonical words'
 * wire spellings (the last of those is why the config object still merges
 * rather than replaces), `operating_point` is deprecated in favour of `model`,
 * and `notification_config` / `tracking` are transport.
 * `transcription_config.{language_hints_strict, entities_config,
 * enable_redaction, redaction_config}` are typed on the wire and reach it
 * through `providerOptions.speechmatics`. No row claims them because
 * Speechmatics' own sources disagree about where they apply: the models page
 * and pricing.md on entity detection and redaction for Melia 1 and Oak 1 (see
 * `./stt.ts`), and the batch input docs ("guide detection without restricting
 * it") and the Python SDK ("Recognition is restricted to these languages") on
 * what hints, and so strict hints, mean.
 */
export const TRANSCRIPTION_CONFIG_EXTRAS = {
  output_locale: EXTRA as string | string[],
  punctuation_overrides: EXTRA as SpeechmaticsPunctuationOverrides,
  channel_diarization_labels: EXTRA as string[],
  max_delay_mode: EXTRA as "fixed" | "flexible",
  speaker_diarization_config: EXTRA as SpeechmaticsSpeakerDiarizationConfig,
  language_hints: EXTRA as string[],
} as const;

export const ROOT_EXTRAS = {
  language_identification_config: EXTRA as SpeechmaticsLanguageIdentificationConfig,
  output_config: EXTRA as SpeechmaticsOutputConfig,
} as const;

/** The shared block, `enable_entities`, and the nine features `MULTILINGUAL_UNSUPPORTED` names. */
export const FULL_EXTRAS = {
  ...TRANSCRIPTION_CONFIG_EXTRAS,
  ...ROOT_EXTRAS,
  additional_vocab: EXTRA as SpeechmaticsAdditionalVocabEntry[],
  enable_entities: EXTRA as boolean,
  audio_filtering_config: EXTRA as SpeechmaticsAudioFilteringConfig,
  transcript_filtering_config: EXTRA as SpeechmaticsTranscriptFilteringConfig,
  translation_config: EXTRA as SpeechmaticsTranslationConfig,
  summarization_config: EXTRA as SpeechmaticsSummarizationConfig,
  topic_detection_config: EXTRA as SpeechmaticsTopicDetectionConfig,
  audio_events_config: EXTRA as SpeechmaticsAudioEventsConfig,
  sentiment_analysis_config: EXTRA as Record<string, unknown>,
  auto_chapters_config: EXTRA as Record<string, unknown>,
} as const;

export const TIMESTAMPS = ["word"] as const;

/** Melia 1's and Oak 1's shared row. */
const MULTILINGUAL = {
  timestamps: TIMESTAMPS,
  languages: ["multi"],
  extras: { ...TRANSCRIPTION_CONFIG_EXTRAS, ...ROOT_EXTRAS, enable_entities: EXTRA as boolean },
} as const;

export const SPEECHMATICS_STT_MODEL_PARAMS = {
  enhanced: {
    timestamps: TIMESTAMPS,
    extras: { ...FULL_EXTRAS, domain: EXTRA as string },
  },
  standard: {
    timestamps: TIMESTAMPS,
    extras: { ...FULL_EXTRAS, domain: EXTRA as string },
  },
  "melia-1": MULTILINGUAL,
  "oak-1": MULTILINGUAL,
} as const satisfies SttModelParamTable;
