/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/ideogram/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import type {
  IdeogramColorPalette,
  IdeogramMagicPromptOption,
  IdeogramStylePreset,
  IdeogramStyleType,
} from "./image";
import { RESOLUTIONS } from "./constraints";
import type { V4JsonPrompt } from "./image-v4";
import { RESOLUTIONS_V4 } from "./constraints";
import type { IdeogramModelId } from "./models";

/**
 * Every pseudo-model the hand catalog carries — the ref union for
 * `ideogram/…`, both routes.
 *
 * `satisfies readonly IdeogramModelId[]` is what stops this list drifting from
 * `models.ts`: a typo here is a compile error rather than an `unknown_model`
 * warning nobody notices until a bill arrives with no estimate against it.
 */
export const MODELS = [
  "ideogram-3.0-flash",
  "ideogram-3.0-turbo",
  "ideogram-3.0-default",
  "ideogram-3.0-quality",
  "ideogram-4.0-turbo",
  "ideogram-4.0-default",
  "ideogram-4.0-quality",
] as const satisfies readonly IdeogramModelId[];

// ---------------------------------------------------------------------------
// The per-model table
// ---------------------------------------------------------------------------

/**
 * The two routes' per-model surfaces, which barely overlap.
 *
 * **Sizes.** Both routes size with a closed `resolution` enum — 69 values on
 * 3.0, 38 on 4.0 — so both rows carry `sizes` and **neither** carries
 * `sizeFreeform`: `checkEnums` rejects a `WxH` outside the list, and a
 * template tail would suggest otherwise. 3.0 additionally has the 15-value
 * `aspect_ratio` enum, which is what `ratios` holds; 4.0 has no ratio field
 * at all, so its `ratios` is absent and `aspectRatio` there is *derived* into
 * a `resolution` by `toSizeEnum` — which is why leaving it wide is right.
 *
 * **Tiers.** 3.0 renders one budget (`["1k"]`), 4.0 two.
 *
 * **Extras.** The 3.0 form's style vocabulary is large and entirely absent
 * from 4.0, whose structured `json_prompt` is absent from 3.0 — so passing a
 * `style_preset` to a 4.0 ref is an `unsupported_param` naming the four 3.0
 * refs, which is precisely the mistake this table exists to catch.
 *
 * `rendering_speed` is deliberately **not** an extra on either row: it is
 * already compiled from the model half of the ref (`ideogram-3.0-quality` →
 * `rendering_speed: "QUALITY"`), and offering a second way to set it would
 * let one request say two things about which model it wants.
 */
/**
 * Ideogram's fifteen shapes, respelled with a colon.
 *
 * `ASPECT_RATIOS` is the **wire** spelling (`"16x9"`) and the canonical
 * `aspectRatio` is a `W:H` — `toRatioEnum` is what bridges the two at run
 * time, matching on the reduced ratio and handing back Ideogram's own
 * spelling. The type has to bridge it too, and the honest way is to state the
 * canonical list rather than to autocomplete a caller into a spelling the
 * vocabulary does not use.
 */
export const ASPECT_RATIOS_CANONICAL = [
  "1:3",
  "3:1",
  "1:2",
  "2:1",
  "9:16",
  "16:9",
  "10:16",
  "16:10",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "1:1",
] as const;

export const IDEOGRAM_V3_EXTRAS = {
  magic_prompt: EXTRA as IdeogramMagicPromptOption,
  style_type: EXTRA as IdeogramStyleType,
  style_preset: EXTRA as IdeogramStylePreset,
  style_codes: EXTRA as string[],
  color_palette: EXTRA as IdeogramColorPalette,
  custom_model_uri: EXTRA as string,
  style_reference_images: EXTRA as Blob[],
  character_reference_images: EXTRA as Blob[],
  character_reference_images_mask: EXTRA as Blob[],
  enable_copyright_detection: EXTRA as boolean | null,
} as const;

export const IDEOGRAM_V4_EXTRAS = {
  json_prompt: EXTRA as V4JsonPrompt,
  enable_copyright_detection: EXTRA as boolean | null,
} as const;

export const IDEOGRAM_V3_ROW = {
  sizes: RESOLUTIONS,
  ratios: ASPECT_RATIOS_CANONICAL,
  tiers: ["1k"],
  extras: IDEOGRAM_V3_EXTRAS,
} as const;

export const IDEOGRAM_V4_ROW = {
  sizes: RESOLUTIONS_V4,
  tiers: ["1k", "2k"],
  extras: IDEOGRAM_V4_EXTRAS,
} as const;

export const IDEOGRAM_IMAGE_MODEL_PARAMS = {
  "ideogram-3.0-flash": IDEOGRAM_V3_ROW,
  "ideogram-3.0-turbo": IDEOGRAM_V3_ROW,
  "ideogram-3.0-default": IDEOGRAM_V3_ROW,
  "ideogram-3.0-quality": IDEOGRAM_V3_ROW,
  "ideogram-4.0-turbo": IDEOGRAM_V4_ROW,
  "ideogram-4.0-default": IDEOGRAM_V4_ROW,
  "ideogram-4.0-quality": IDEOGRAM_V4_ROW,
} as const satisfies ModelParamTable;
