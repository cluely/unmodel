/**
 * The lipsync adapter's **data**: one model, and a row with nothing on it.
 *
 * A leaf rather than a section of the adapter beside it, for `sync`'s reason:
 * `unmodel/veed/values` publishes these for client-side pickers and the adapter
 * imports this provider's validator, its zod schema and the compile helpers in
 * `core/unified/derive`. The adapter reads the very same objects, so what is
 * published and what is sent cannot drift.
 *
 * ## `extras: {}` — the smallest row in the library, and it is a finding
 *
 * `Lipsync20Input` declares exactly `video_url` and `audio_url`, both required,
 * and is `additionalProperties: false`. There is no third field to declare
 * here, so this table's `extras` is empty and every non-canonical key a caller
 * reaches for is refused by name.
 *
 * That emptiness is the evidence behind a vocabulary decision one layer up.
 * `unmodel/lipsync` deliberately has no canonical word for "what to do when the
 * clip and the track are different lengths" — sync. spells it `sync_mode` with
 * five arms, fal's LatentSync spells it `loop_mode` with two, HeyGen spells it
 * `enable_dynamic_duration` as a boolean, and **VEED does not spell it at all**.
 * A category word needs two independent vendors agreeing on a name and a value
 * space; here there are three spellings, three shapes, and one route that has
 * no opinion. See `../../core/unified/vocabulary/lipsync.ts`.
 *
 * ## The two knobs VEED does have are HEADERS, which is why they are not here
 *
 * `X-Veed-Store-IO` (keep the bodies out of your request logs) and
 * `X-Veed-Media-Expiration-Seconds` (how long the signed result URL lives) are
 * documented on every operation and neither is a body field. `applyExtras`
 * writes into the body, so an extra is the wrong shape for them; they are on
 * `VEED_REQUEST_HEADERS` and you add them to `fetch` beside the bearer token.
 */

import type { LipsyncModelParamTable } from "../../core/unified/vocabulary/lipsync";

/** Every id `veed.lipsync` accepts — one, and the URL says so. */
export const MODELS = ["lipsync-2.0"] as const;

/** A clip. VEED's still-driven model is a different path and a different price. */
const INPUTS = ["video"] as const;

export const VEED_LIPSYNC_MODEL_PARAMS = {
  "lipsync-2.0": { sources: INPUTS, extras: {} },
} as const satisfies LipsyncModelParamTable;
