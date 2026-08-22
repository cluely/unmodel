/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/google/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import { VEO_PARAMETER_SPACE, type VeoParameterModelId } from "./video-constraints";

/**
 * Every model `:predictLongRunning` serves, Veo and the one non-Veo id — the
 * `google/…` ref union, and the same list `videoModels` catalogs.
 */
export const MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-lite-generate-preview",
  "veo-3.0-generate-001",
  "veo-3.0-fast-generate-001",
  "veo-2.0-generate-001",
  "gemini-omni-flash-preview",
] as const;

/**
 * Veo's per-model surface.
 *
 * Three facts the wire tables carry and the vocabulary can now state up front:
 *
 * - **`durationSeconds`** is 4/6/8 across Veo 3.x, 5–8 on Veo 2 and 3–10 on
 *   Omni. Closed enums, all three, so they narrow rather than staying `number`.
 * - **`resolution` does not exist on Veo 2.** `videoConstraints` denies it
 *   ("output is 720p"), which is exactly what `resolutions: []` says — the
 *   caller's `resolution` types as `never` and the mistake is caught before the
 *   request is built rather than after it is sent.
 * - **`4k` is Veo 3.x-minus-Lite.** Lite stops at 1080p and Omni at 720p.
 *
 * What the rows deliberately do NOT say: `1080p` and `4k` on Veo 3.x also
 * require `duration: 8`, and `personGeneration: "allow_all"` is refused on an
 * image-driven request. Both are *pairings* rather than per-field enums —
 * `checkParameterPairings` owns them, and a row cannot express a rule about two
 * fields at once without inventing a second table that would then disagree.
 *
 * Both extras nest under `parameters` and are re-checked there by the
 * endpoint's own tables, which is why `personGeneration` can carry a different
 * union per model: Veo 3.x has two values, Veo 2 has three (it is the only
 * family with `dont_allow`), and Omni's entry carries no enum at all — the Veo
 * rules are `veo-`-prefix-gated — so nothing narrower than `string` would be
 * true there.
 */
export const VEO_3_EXTRAS = {
  personGeneration: EXTRA as "allow_all" | "allow_adult",
  enhancePrompt: EXTRA as boolean,
} as const;

/**
 * One row, built from `VEO_PARAMETER_SPACE` in `./video` rather than restated.
 *
 * The three enumerated fields are the SAME lists the wire surface narrows
 * `parameters.durationSeconds` / `.resolution` / `.aspectRatio` to, so the two
 * tables cannot disagree — which they did until this was wired: the wire arm
 * accepted `resolution: "4k"` on Veo 2 and on Lite while these rows already
 * said otherwise, and nothing in the suite compared them.
 * `test/types/google.test-d.ts` and `./video.test.ts` now assert the equality
 * in both directions, because "derived" is a property of today's code and the
 * assertion is a property of the repo.
 */
export type UnifiedRow<M extends VeoParameterModelId, E extends object> = {
  readonly durations: (typeof VEO_PARAMETER_SPACE)[M]["durations"];
  readonly resolutions: (typeof VEO_PARAMETER_SPACE)[M]["resolutions"];
  readonly ratios: (typeof VEO_PARAMETER_SPACE)[M]["ratios"];
  readonly extras: E;
};

export function rowOf<M extends VeoParameterModelId, E extends object>(
  model: M,
  extras: E,
): UnifiedRow<M, E> {
  const space = VEO_PARAMETER_SPACE[model];
  return {
    durations: space.durations,
    resolutions: space.resolutions,
    ratios: space.ratios,
    extras,
  };
}

export const GOOGLE_VIDEO_MODEL_PARAMS = {
  "veo-3.1-generate-preview": rowOf("veo-3.1-generate-preview", VEO_3_EXTRAS),
  "veo-3.1-fast-generate-preview": rowOf("veo-3.1-fast-generate-preview", VEO_3_EXTRAS),
  "veo-3.1-lite-generate-preview": rowOf("veo-3.1-lite-generate-preview", VEO_3_EXTRAS),
  "veo-3.0-generate-001": rowOf("veo-3.0-generate-001", VEO_3_EXTRAS),
  "veo-3.0-fast-generate-001": rowOf("veo-3.0-fast-generate-001", VEO_3_EXTRAS),
  "veo-2.0-generate-001": rowOf("veo-2.0-generate-001", {
    personGeneration: EXTRA as "allow_all" | "allow_adult" | "dont_allow",
    enhancePrompt: EXTRA as boolean,
  }),
  "gemini-omni-flash-preview": rowOf("gemini-omni-flash-preview", {
    // `string`, and the wire keeps its documented three-value union: Google
    // publishes no `personGeneration` list for Omni, so neither surface may
    // invent one — this row can only state what the table proves, and the wire
    // type may not widen past what the page names. See the same note in
    // ./video.
    personGeneration: EXTRA as string,
    enhancePrompt: EXTRA as boolean,
  }),
} as const satisfies VideoModelParamTable;
