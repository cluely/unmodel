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
// parameters and specifications" table on VEO_DOCS_URL. Two of them are
// deliberately PERMISSIVE readings of pages that disagree with themselves, and
// stay that way here so the type cannot refuse a request the check would
// allow: Veo 2's `durationSeconds` (parameters table says 5/6/8, feature table
// says "5-8") and Veo 3's `4k` (the feature-comparison table omits it).
//
// WHERE THE DOCS ARE THE WEAKER SOURCE, said plainly rather than papered over:
//
// - `personGeneration` is narrowed only where Google publishes a list. An
//   ABSENT `personGeneration` on a row means no published list, so the field
//   keeps the wide documented union: narrowing it would be inventing an
//   allowed-value space; widening it to `string` would advertise values no
//   page names. Every served row publishes one today.
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

/** Veo 3, standard and fast — one row, two ids. */
export const VEO_3_SPACE = {
  durations: [4, 6, 8],
  resolutions: ["720p", "1080p", "4k"],
  ratios: ["16:9", "9:16"],
  personGeneration: ["allow_all", "allow_adult"],
} as const satisfies VeoParameterSpace;

/** The rows. Every id `videoConstraints` / `videoFamilyRules` bound, and no other. */
export const VEO_PARAMETER_SPACE = {
  "veo-3.0-generate-001": VEO_3_SPACE,
  "veo-3.0-fast-generate-001": VEO_3_SPACE,
  /** No `resolution` parameter at all (output is 720p); the only family with `dont_allow`. */
  "veo-2.0-generate-001": {
    durations: [5, 6, 7, 8],
    resolutions: [],
    ratios: ["16:9", "9:16"],
    personGeneration: ["allow_all", "allow_adult", "dont_allow"],
  },
} as const satisfies Readonly<Record<string, VeoParameterSpace>>;

/** A model id {@link VEO_PARAMETER_SPACE} carries a row for. */
export type VeoParameterModelId = keyof typeof VEO_PARAMETER_SPACE;

/** The Gemini API deprecations page — the source every retirement below quotes. */
export const GOOGLE_DEPRECATIONS_URL = "https://ai.google.dev/gemini-api/docs/deprecations";

/** {@link VIDEO_RETIRED_IDS} with its literal keys, for {@link VideoRetiredModelId}. */
const VIDEO_RETIRED = {
  "gemini-omni-flash-preview":
    "it was shut down on October 22, 2026; its replacement, gemini-omni-1.2-flash, is an Interactions API model unmodel does not serve yet",
} as const satisfies Readonly<Record<string, string>>;

/**
 * Catalogued video-output ids Google has shut down, each with the reason the
 * refusal quotes. models.dev still carries a row for each, so without this
 * list a request would validate — with bounds — against a model that no longer
 * answers. Listed rather than merely dropped from the tables, so the refusal
 * can say why and name the replacement, and so the coverage tests in
 * ./video.test.ts know which catalogued video id is allowed to have no bounds.
 *
 * The list holds models.dev-carried ids only. The hand-catalogued Veo 2 /
 * Veo 3 / Veo 3 Fast rows in ./veo-models were shut down too, on 2026-06-30,
 * but stay at `status: "deprecated"` until the owner decides the surface's
 * future (the fork is recorded in that file's header): refusing them would
 * refuse every id this surface serves.
 *
 * - `gemini-omni-flash-preview`: GOOGLE_DEPRECATIONS_URL (2026-11-12) —
 *   "`gemini-omni-flash-preview` — June 30, 2026 — October 22, 2026 —
 *   `gemini-omni-1.2-flash`"; its model page: "Shut down:
 *   `gemini-omni-flash-preview`". The replacement is an Interactions API
 *   model (every sample on the omni guide is `POST /v1beta/interactions`),
 *   which this `:predictLongRunning` surface cannot carry.
 */
export const VIDEO_RETIRED_IDS: Readonly<Record<string, string>> = VIDEO_RETIRED;

/**
 * A retired id, by literal — subtracted from `GenerateVideosBody["model"]` so
 * the editor never offers an id the runtime always refuses.
 */
export type VideoRetiredModelId = keyof typeof VIDEO_RETIRED;
