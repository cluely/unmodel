/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/cartesia/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import type { CartesiaSttEncoding } from "./stt";
import { CARTESIA_STT_LANGUAGES } from "./models";

/** The one batch STT model — the ref union for `cartesia/…`. */
export const MODELS = ["ink-whisper"] as const;

/**
 * One model, one row — and the row is where the 100-code language list finally
 * becomes visible to a caller.
 *
 * The module note above says the enum "lives in `cartesia.stt`'s own
 * `checkLanguage`; duplicating it here would be a second copy to drift". That
 * is still true, which is why `languages` is {@link CARTESIA_STT_LANGUAGES}
 * *by reference*: one array, checked at run time by the provider and completed
 * at compile time by the editor, with no second declaration to keep in step.
 *
 * `timestamps: ["none", "word"]`: the wire array's only member is `"word"`, and
 * `"none"` is expressible because omitting the field is exactly what it means
 * here. `"segment"` and `"character"` are the narrowest refusal in the category
 * — a segment is not a coarse word, so it is an error rather than an
 * approximation.
 *
 * The two extras describe the *bytes*, which this route needs because it takes
 * raw audio as well as containers: `encoding` and `sample_rate` are what a
 * containerless upload has instead of a header. They are not the canonical
 * `outputFormat` — that word belongs to the speech category, and there is no
 * output audio here to have a format.
 */
export const CARTESIA_STT_MODEL_PARAMS = {
  "ink-whisper": {
    timestamps: ["none", "word"],
    languages: CARTESIA_STT_LANGUAGES,
    extras: {
      encoding: EXTRA as CartesiaSttEncoding,
      sample_rate: EXTRA as number,
    },
  },
} as const satisfies SttModelParamTable;
