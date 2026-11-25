/**
 * Stability's enums shared between routes, on an **import-free** leaf — the
 * same split `./image-params.ts` and `unmodel/stability/values` need everywhere
 * else: `./image.ts` is a validator, and one list should not cost one.
 *
 * `style_preset` and `output_format` live here for a second reader: the edit
 * routes in `./image-edit.ts` take the same two enums, and reading them from
 * `./image.ts` would put the three generation validators inside every bundle
 * that edits — `unmodel/image-edit` among them.
 */
/** Aspect ratios accepted by all three generate routes. */
export const STABILITY_ASPECT_RATIOS = [
  "21:9",
  "16:9",
  "3:2",
  "5:4",
  "1:1",
  "4:5",
  "2:3",
  "9:16",
  "9:21",
] as const;

/** `style_preset` values accepted by all three generate routes. */
export const STABILITY_STYLE_PRESETS = [
  "enhance",
  "anime",
  "photographic",
  "digital-art",
  "comic-book",
  "fantasy-art",
  "line-art",
  "analog-film",
  "neon-punk",
  "isometric",
  "low-poly",
  "origami",
  "modeling-compound",
  "cinematic",
  "3d-model",
  "pixel-art",
  "tile-texture",
] as const;
export type StabilityStylePreset = (typeof STABILITY_STYLE_PRESETS)[number];

export const STABILITY_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export type StabilityOutputFormat = (typeof STABILITY_OUTPUT_FORMATS)[number];
