/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/revai/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import type {
  RevaiCustomVocabulary,
  RevaiSegment,
  RevaiSpeakerName,
  RevaiSummarizationConfig,
  RevaiTranslationConfig,
} from "./stt";

/** The four transcribers — the ref union for `revai/…`. */
export const MODELS = ["machine", "low_cost", "fusion", "human"] as const;

/**
 * Rev AI's per-model surface, which is really per-**transcriber** — and this is
 * the provider where the ref genuinely changes what the body may contain, in
 * both directions at once.
 *
 * Three overlapping rules from `./stt.ts`, transcribed into four rows:
 *
 * - **`HUMAN_ONLY`** — `rush`, `segments_to_transcribe` and `speaker_names` are
 *   "only available for `transcriber: "human"`". They are on the `human` row
 *   and nowhere else. *(The research pass had these on `machine` as well;
 *   `checkTranscriberScope` is the authority and it says otherwise.)*
 * - **`MACHINE_ONLY`** — `remove_disfluencies`, `remove_atmospherics`,
 *   `speaker_channels_count`, `diarization_type`, `summarization_config` and
 *   `translation_config` are "not available for human transcription jobs", so
 *   they are on the three machine rows.
 * - **low cost** — `diarization_type` and `forced_alignment` are "not available
 *   in the low-cost environment", which is what separates `low_cost` from
 *   `machine` and `fusion`.
 *
 * `timestamps: ["word"]` on every row: word timings ride on every Rev AI
 * transcript and there is no switch. `forced_alignment` is on the rows that
 * have it as an **extra** rather than as a granularity, because it is a quality
 * upgrade with its own price — not the thing that turns timing on.
 *
 * Excluded: `source_config` / `media_url`, `transcriber`, `language`,
 * `skip_diarization` and `speakers_count` are canonical words' wire spellings —
 * and `skip_diarization` is the inverted one, which makes it the last field
 * that should be settable twice. `test_mode` mocks a job without transcribing,
 * `metadata` / `notification_config` / `callback_url` / `delete_after_seconds`
 * are transport; all stay on `providerOptions.revai`.
 */
export const SHARED_EXTRAS = {
  verbatim: EXTRA as boolean,
  skip_postprocessing: EXTRA as boolean,
  skip_punctuation: EXTRA as boolean,
  filter_profanity: EXTRA as boolean,
  custom_vocabulary_id: EXTRA as string,
  custom_vocabularies: EXTRA as RevaiCustomVocabulary[],
  strict_custom_vocabulary: EXTRA as boolean,
  enable_multilingual: EXTRA as boolean,
} as const;

/** `MACHINE_ONLY` minus the two fields the low-cost environment drops. */
export const MACHINE_EXTRAS = {
  ...SHARED_EXTRAS,
  remove_disfluencies: EXTRA as boolean,
  remove_atmospherics: EXTRA as boolean,
  speaker_channels_count: EXTRA as number,
  summarization_config: EXTRA as RevaiSummarizationConfig,
  translation_config: EXTRA as RevaiTranslationConfig,
} as const;

export const FULL_MACHINE_EXTRAS = {
  ...MACHINE_EXTRAS,
  diarization_type: EXTRA as "standard" | "premium",
  forced_alignment: EXTRA as boolean,
} as const;

export const TIMESTAMPS = ["word"] as const;

export const MACHINE_ROW = { timestamps: TIMESTAMPS, extras: FULL_MACHINE_EXTRAS } as const;

export const REVAI_STT_MODEL_PARAMS = {
  machine: MACHINE_ROW,
  low_cost: { timestamps: TIMESTAMPS, extras: MACHINE_EXTRAS },
  fusion: MACHINE_ROW,
  human: {
    timestamps: TIMESTAMPS,
    extras: {
      ...SHARED_EXTRAS,
      rush: EXTRA as boolean,
      segments_to_transcribe: EXTRA as RevaiSegment[],
      speaker_names: EXTRA as RevaiSpeakerName[],
      forced_alignment: EXTRA as boolean,
    },
  },
} as const satisfies SttModelParamTable;
