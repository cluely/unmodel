/**
 * Veo's per-model parameter space, on an **import-free** leaf.
 *
 * It was declared beside `google.video`'s validator, which is where it is
 * read — but it is also the table `./video-params.ts` narrows the unified
 * `video` params with, and reaching it through the validator costs that
 * validator, its zod schema and `src/catalog/google.gen.ts`. `./video.ts`
 * re-exports it, so every existing caller is unchanged.
 */

import type { GoogleVeoParameters } from "./video";

// ---------------------------------------------------------------------------
// Per-model `parameters` value space.
//
// One table, read twice: the types below narrow `parameters` per model from
// it, and ./unified-video builds `GOOGLE_VIDEO_MODEL_PARAMS` — the rows that
// type the canonical `duration` / `resolution` / `aspectRatio` — out of the
// same rows. Before this existed the two disagreed: `unmodel/video` refused
// `resolution: "1080p"` on Veo 2 at compile time while THIS surface, the one
// it compiles down to, accepted `resolution: "4k"` there. A wire-exact
// validator that is looser than the unified layer above it inverts
// docs/decisions.md #1, so the narrowing lives here and the unified row is
// derived, never the other way round.
//
// WHERE THE VALUES COME FROM. Every list below is the one ./constraints
// already transcribes for the RUNTIME check — `videoConstraints` (per model)
// and `videoFamilyRules` (the `veo-`-prefixed families) — from the "Veo API
// parameters and specifications" table on VEO_DOCS_URL and, for the one
// non-Veo id, GEMINI_OMNI_FLASH_DOCS_URL. Two of them are deliberately
// PERMISSIVE readings of pages that disagree with themselves, and stay that
// way here so the type cannot refuse a request the check would allow:
// Veo 2's `durationSeconds` (parameters table says 5/6/8, feature table says
// "5-8") and Veo 3's `4k` (the feature-comparison table omits it).
//
// WHERE THE DOCS ARE THE WEAKER SOURCE, said plainly rather than papered over:
//
// - `personGeneration` on `gemini-omni-flash-preview`. Google publishes no
//   list for it — the Veo enum rules are `veo-`-prefix-gated and its own pages
//   are silent — so the row carries no `personGeneration` at all and the field
//   keeps the wide documented union. Narrowing it would be inventing an
//   allowed-value space; widening it to `string` (which is what the unified
//   row says, and correctly, because that row can only speak about what the
//   *table* proves) would advertise values no page names.
// - `sampleCount` is NOT narrowed. `videoConstraints` does bound it (1 on
//   Veo 3.x, 1-2 on Veo 2), but the unified table has no row field for it, so
//   there is nothing here to keep the two in step; the runtime enum owns it
//   alone, and `test/types/google.test-d.ts` pins that as a deliberate gap.
// - Pairing rules stay runtime-only, unchanged: 1080p/4k needing 8s, and
//   `allow_all` being refused on an image-driven request, are rules about TWO
//   fields, which a per-field union cannot state (see `checkParameterPairings`
//   and the same note in ./unified-video).
// ---------------------------------------------------------------------------

/**
 * One model's `parameters` value space.
 *
 * An EMPTY list is a positive statement — "this model has no such parameter" —
 * and types the field `never` (Veo 2 takes no `resolution` at all, which
 * `videoConstraints` states as a deny). An ABSENT `personGeneration` is the
 * other statement: no published list, so the field keeps its wide union.
 */
export interface VeoParameterSpace {
  readonly durations: readonly number[];
  readonly resolutions: readonly NonNullable<GoogleVeoParameters["resolution"]>[];
  readonly ratios: readonly NonNullable<GoogleVeoParameters["aspectRatio"]>[];
  readonly personGeneration?: readonly NonNullable<GoogleVeoParameters["personGeneration"]>[];
}

/** Veo 3 and Veo 3.1, standard and fast — one row, four ids. */
export const VEO_3_SPACE = {
  durations: [4, 6, 8],
  resolutions: ["720p", "1080p", "4k"],
  ratios: ["16:9", "9:16"],
  personGeneration: ["allow_all", "allow_adult"],
} as const satisfies VeoParameterSpace;

/** The rows. Every id `videoConstraints` / `videoFamilyRules` bound, and no other. */
export const VEO_PARAMETER_SPACE = {
  "veo-3.1-generate-preview": VEO_3_SPACE,
  "veo-3.1-fast-generate-preview": VEO_3_SPACE,
  /** Lite stops at 1080p — "Veo 3.1 Lite" column of the parameters table. */
  "veo-3.1-lite-generate-preview": {
    durations: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    ratios: ["16:9", "9:16"],
    personGeneration: ["allow_all", "allow_adult"],
  },
  "veo-3.0-generate-001": VEO_3_SPACE,
  "veo-3.0-fast-generate-001": VEO_3_SPACE,
  /** No `resolution` parameter at all (output is 720p); the only family with `dont_allow`. */
  "veo-2.0-generate-001": {
    durations: [5, 6, 7, 8],
    resolutions: [],
    ratios: ["16:9", "9:16"],
    personGeneration: ["allow_all", "allow_adult", "dont_allow"],
  },
  /** "Output video: 3s-10s (720p, 24 FPS)"; 16:9 default, 9:16 portrait. */
  "gemini-omni-flash-preview": {
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p"],
    ratios: ["16:9", "9:16"],
  },
} as const satisfies Readonly<Record<string, VeoParameterSpace>>;

/** A model id {@link VEO_PARAMETER_SPACE} carries a row for. */
export type VeoParameterModelId = keyof typeof VEO_PARAMETER_SPACE;
