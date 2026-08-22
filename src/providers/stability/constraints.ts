/**
 * Stability's aspect-ratio enum, on an **import-free** leaf — the same split
 * `./image-params.ts` and `unmodel/stability/values` need everywhere else:
 * `./image.ts` is a validator, and one ratio list should not cost one.
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
