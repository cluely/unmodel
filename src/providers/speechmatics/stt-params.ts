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

/** The three batch models — the ref union for `speechmatics/…`. */
export const MODELS = ["enhanced", "standard", "melia-1"] as const;

/**
 * Speechmatics' per-model surface: the job config's own fields, and the ten
 * things Melia 1 "does not yet support".
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
 * ## Melia 1
 *
 * Its row is the shared one minus `MELIA_UNSUPPORTED`: no custom dictionary
 * (`additional_vocab`), no find-and-replace (`transcript_filtering_config`), no
 * entity detection, no audio filtering, and none of the five
 * speech-intelligence add-ons. And it "requires `language: "multi"`", which is
 * the whole of its `languages` list — the shortest in the library, and one an
 * editor can now complete.
 *
 * `domain` is Enhanced's alone: `domain: "medical"` "selects the Enhanced
 * Medical model and requires `model: "enhanced"`".
 *
 * Excluded: `fetch_data`, `transcription_config.{language,model,diarization}`
 * and `language_identification_config.expected_languages` are canonical words'
 * wire spellings (the last of those is why the config object still merges
 * rather than replaces), `operating_point` is deprecated in favour of `model`,
 * and `notification_config` / `tracking` are transport.
 */
export const TRANSCRIPTION_CONFIG_EXTRAS = {
  output_locale: EXTRA as string,
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

/** The shared block plus the ten features `MELIA_UNSUPPORTED` names. */
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

export const SPEECHMATICS_STT_MODEL_PARAMS = {
  enhanced: {
    timestamps: TIMESTAMPS,
    extras: { ...FULL_EXTRAS, domain: EXTRA as string },
  },
  standard: { timestamps: TIMESTAMPS, extras: FULL_EXTRAS },
  "melia-1": {
    timestamps: TIMESTAMPS,
    languages: ["multi"],
    extras: { ...TRANSCRIPTION_CONFIG_EXTRAS, ...ROOT_EXTRAS },
  },
} as const satisfies SttModelParamTable;
