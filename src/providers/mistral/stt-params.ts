/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/mistral/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";

/** The Voxtral batch models — the ref union for `mistral/…`. */
export const MODELS = [
  "voxtral-mini-latest",
  "voxtral-mini-2602",
  "voxtral-mini-2507",
  "voxtral-small-latest",
  "voxtral-small-2507",
  "voxtral-mini-transcribe-3-0",
  "voxtral-mini-transcribe-3",
  "voxtral-mini-transcribe-latest",
  "voxtral-small-transcribe-3-0",
  "voxtral-small-transcribe-3",
  "voxtral-small-transcribe-latest",
] as const;

/**
 * The five pre-Voxtral 3 ids share one row, because they share one schema, and
 * the one rule they carry (`timestamp_granularities` "is not compatible with
 * `language`") is a *combination* rule that applies to every id equally.
 *
 * `timestamps` carries `"none"` because it is genuinely expressible here — the
 * field is absent by default and the route returns no timings without it — plus
 * the two granularities the adapter maps.
 *
 * Two extras, and both are the sharp end of an adapter gap: `context_bias` is
 * the term list that `prompt` is *not* (its entries may contain neither commas
 * nor whitespace, so a sentence cannot be one), and `temperature` is the
 * sampling knob no canonical word covers.
 */
export const VOXTRAL_ROW = {
  timestamps: ["none", "word", "segment"],
  extras: {
    temperature: EXTRA as number | null,
    context_bias: EXTRA as string[],
  },
} as const;

/**
 * The Voxtral 3 ids: the same schema, minus word timings — "Word timestamps
 * are gone. timestamp_granularities accepts segment only, and word returns a
 * 400 error." (https://docs.mistral.ai/studio/audio/migrate-from-voxtral-2,
 * 2026-11-12).
 */
export const VOXTRAL_3_ROW = {
  timestamps: ["none", "segment"],
  extras: VOXTRAL_ROW.extras,
} as const;

export const MISTRAL_STT_MODEL_PARAMS = {
  "voxtral-mini-latest": VOXTRAL_ROW,
  "voxtral-mini-2602": VOXTRAL_ROW,
  "voxtral-mini-2507": VOXTRAL_ROW,
  "voxtral-small-latest": VOXTRAL_ROW,
  "voxtral-small-2507": VOXTRAL_ROW,
  "voxtral-mini-transcribe-3-0": VOXTRAL_3_ROW,
  "voxtral-mini-transcribe-3": VOXTRAL_3_ROW,
  "voxtral-mini-transcribe-latest": VOXTRAL_3_ROW,
  "voxtral-small-transcribe-3-0": VOXTRAL_3_ROW,
  "voxtral-small-transcribe-3": VOXTRAL_3_ROW,
  "voxtral-small-transcribe-latest": VOXTRAL_3_ROW,
} as const satisfies SttModelParamTable;
