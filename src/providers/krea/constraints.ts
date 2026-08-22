/**
 * Krea's value spaces, on an **import-free** leaf, so `./image-params.ts` and
 * `unmodel/krea/values` can read them without the `krea.image` validator.
 */
/** `aspect_ratio` enum — OpenAPI `aspect_ratio`. */
export const KREA_ASPECT_RATIOS = [
  "1:1",
  "4:3",
  "3:2",
  "16:9",
  "2.35:1",
  "4:5",
  "2:3",
  "9:16",
] as const;

/** `resolution` enum — "Resolution scale. One of: 1K." */
export const KREA_RESOLUTIONS = ["1K"] as const;

/** `creativity` enum — prompt-expansion mode. */
export const KREA_CREATIVITY_MODES = ["raw", "low", "medium", "high"] as const;
