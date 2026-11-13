/**
 * Krea's value spaces, on an **import-free** leaf, so `./image-params.ts` and
 * `unmodel/krea/values` can read them without the `krea.image` validator.
 */
/**
 * `aspect_ratio` enum — OpenAPI `aspect_ratio`, in the served order, identical
 * on all three Krea 2 variant routes. https://api.krea.ai/openapi.json
 * (2026-11-12): `"enum":["1:1","4:3","3:2","16:9","2.35:1","4:5","3:4","2:3","9:16"]`.
 * The developers/krea-2/overview table and `@krea-ai/sdk` 0.1.2 list only
 * eight (no `3:4`); the spec the API serves is the ground truth and is wider.
 */
export const KREA_ASPECT_RATIOS = [
  "1:1",
  "4:3",
  "3:2",
  "16:9",
  "2.35:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
] as const;

/** `resolution` enum — "Resolution scale. One of: 1K." */
export const KREA_RESOLUTIONS = ["1K"] as const;

/** `creativity` enum — prompt-expansion mode. */
export const KREA_CREATIVITY_MODES = ["raw", "low", "medium", "high"] as const;
