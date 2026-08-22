/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/elevenlabs/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";

/** The two batch Scribe models — the ref union for `elevenlabs/…`. */
export const MODELS = ["scribe_v2", "scribe_v1"] as const;

/**
 * Scribe's per-model surface: the category's only three-value `timestamps`
 * row, and one key `scribe_v1` does not have.
 *
 * `timestamps_granularity` is a scalar enum `none | word | character` whose
 * default is `"word"`, so `"none"` is a **value** here rather than an omission
 * — the one cell in the category where asking for no timing is expressible and
 * therefore belongs on the row. `"segment"` is the granularity this route does
 * not have, and it is a compile error naming the three it does.
 *
 * `no_verbatim` ("Only supported with scribe_v2 model", which
 * `speechToTextConstraints` denies on `scribe_v1`) is the one row difference.
 * Everything else is shared: audio-event tagging, keyterm biasing, sampling,
 * multichannel handling, speaker-library lookups and the entity
 * detection/redaction trio.
 *
 * Excluded: `model_id`, `file`, `source_url`, `language_code`, `diarize` and
 * `num_speakers` are canonical words' wire spellings, and `timestamps_
 * granularity` is the canonical `timestamps`' own — an extra of that name could
 * overwrite what the adapter compiled.
 */
export const SCRIBE_EXTRAS = {
  tag_audio_events: EXTRA as boolean,
  keyterms: EXTRA as string[],
  temperature: EXTRA as number,
  seed: EXTRA as number,
  file_format: EXTRA as "pcm_s16le_16" | "other",
  additional_formats: EXTRA as Array<Record<string, unknown>>,
  diarization_threshold: EXTRA as number | null,
  use_multi_channel: EXTRA as boolean,
  multichannel_output_style: EXTRA as "separate" | "combined",
  use_speaker_library: EXTRA as boolean,
  detect_speaker_roles: EXTRA as boolean,
  entity_detection: EXTRA as string | string[],
  entity_redaction: EXTRA as string | string[],
  entity_redaction_mode: EXTRA as "redacted" | "entity_type" | "enumerated_entity_type",
} as const;

export const TIMESTAMPS = ["none", "word", "character"] as const;

export const ELEVENLABS_STT_MODEL_PARAMS = {
  scribe_v2: {
    timestamps: TIMESTAMPS,
    extras: { ...SCRIBE_EXTRAS, no_verbatim: EXTRA as boolean },
  },
  scribe_v1: { timestamps: TIMESTAMPS, extras: SCRIBE_EXTRAS },
} as const satisfies SttModelParamTable;
