/**
 * `unmodel/atlascloud/values` — the **runtime** lists behind this provider's
 * unified surface (video).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (resolutions, ratios,
 * extras) and Atlas's own published enums. It is the value half of
 * `unmodel/atlascloud/types`, for the client-side validation and the pickers a
 * type cannot draw.
 *
 * The category table is **the same object the adapter compiles with** —
 * re-exported, never copied — so a picker built from `VIDEO_MODEL_PARAMS` and
 * the request the matching `unmodel/video` builds cannot disagree. It is read
 * from the import-free `video-params` leaf rather than from the adapter, which
 * is what keeps this entry off the validator, the zod schema and the catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 *
 * {@link ATLASCLOUD_PRICING_CAVEAT} is here rather than in the types entry
 * because it is the one thing a picker genuinely has to render: Atlas ships no
 * usable unit for its rates, so `cost` is absent from every row and a UI that
 * shows a price has to show this sentence instead of inventing one.
 */

export {
  ATLASCLOUD_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
  RATIOS,
  VEO_RATIOS_SHAPES,
  WAN_RATIOS_SHAPES,
} from "./video-params";

export {
  AUTO_DURATION,
  BITRATE_MODES,
  OMNI_REFERENCE_TASK_TYPES,
  SEEDANCE_15_ASPECT_RATIOS,
  SEEDANCE_15_FAST_RESOLUTIONS,
  SEEDANCE_15_RESOLUTIONS,
  SEEDANCE_20_RESOLUTIONS,
  SEEDANCE_20_SMALL_RESOLUTIONS,
  SEEDANCE_25_RESOLUTIONS,
  VEO_ASPECT_RATIOS,
  VEO_RESOLUTIONS,
  VIDEO_OUTPUT_FORMATS,
  VIDEO_RATIOS,
  WAN_PRIME_RESOLUTIONS,
  WAN_RATIOS,
  WAN_RESOLUTIONS,
} from "./constraints";

export {
  ATLASCLOUD_LISTED_BASE_PRICE_USD,
  ATLASCLOUD_PRICING_CAVEAT,
  ATLASCLOUD_PRICING_SOURCE,
  ATLASCLOUD_PRICING_VERIFIED,
} from "./pricing";
