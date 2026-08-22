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

/** The five Voxtral batch models — the ref union for `mistral/…`. */
export const MODELS = [
  "voxtral-mini-latest",
  "voxtral-mini-2602",
  "voxtral-mini-2507",
  "voxtral-small-latest",
  "voxtral-small-2507",
] as const;

/**
 * The five Voxtral ids share one row, because they share one schema: there is
 * no per-model constraint table on this endpoint at all, and the one rule that
 * exists (`timestamp_granularities` "is not compatible with `language`") is a
 * *combination* rule that applies to every id equally.
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

export const MISTRAL_STT_MODEL_PARAMS = {
  "voxtral-mini-latest": VOXTRAL_ROW,
  "voxtral-mini-2602": VOXTRAL_ROW,
  "voxtral-mini-2507": VOXTRAL_ROW,
  "voxtral-small-latest": VOXTRAL_ROW,
  "voxtral-small-2507": VOXTRAL_ROW,
} as const satisfies SttModelParamTable;
