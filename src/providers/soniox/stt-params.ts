/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/soniox/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import type { SonioxTranslation } from "./stt";

/** The two async models — the ref union for `soniox/…`. */
export const MODELS = ["stt-async-v5", "stt-async-v4"] as const;

/**
 * Both async models share one row: one schema, one param surface, no per-model
 * constraint table.
 *
 * `timestamps: ["word"]` and no `"none"` — Soniox returns per-token timing on
 * every response and offers no switch, so `"word"` agrees and costs nothing
 * while the other three are refused by name.
 *
 * The three extras are the rest of Soniox's language machinery, and they are
 * exactly the fields the canonical mapping *approximates* around.
 * `language_hints_strict` is the flag this adapter already sets to `true` when
 * `language` is used — so setting it alongside `languages` is the only way to
 * say "bias hard toward this shortlist" without asserting a single language,
 * which is the request the canonical vocabulary has no word for.
 * `enable_language_identification` returns the detected language per token, and
 * `translation` is the one-way/two-way translation config.
 *
 * Excluded: `audio_url`, `file_id`, `language_hints`,
 * `enable_speaker_diarization` and `context` are canonical words' wire
 * spellings.
 */
export const SONIOX_ROW = {
  timestamps: ["word"],
  extras: {
    language_hints_strict: EXTRA as boolean,
    enable_language_identification: EXTRA as boolean,
    translation: EXTRA as SonioxTranslation | null,
  },
} as const;

export const SONIOX_STT_MODEL_PARAMS = {
  "stt-async-v5": SONIOX_ROW,
  "stt-async-v4": SONIOX_ROW,
} as const satisfies SttModelParamTable;
