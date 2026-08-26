export {
  image,
  toFormData,
  IDEOGRAM_V3_GENERATE_URL,
  RENDERING_SPEEDS,
  MAGIC_PROMPT_OPTIONS,
  STYLE_TYPES,
  ASPECT_RATIOS,
  RESOLUTIONS,
  STYLE_PRESETS,
  COLOR_PALETTE_PRESETS,
} from "./image";
export type {
  GenerateParams,
  IdeogramRenderingSpeed,
  IdeogramMagicPromptOption,
  IdeogramStyleType,
  IdeogramAspectRatio,
  IdeogramResolution,
  IdeogramStylePreset,
  IdeogramColorPalettePreset,
  IdeogramColorPalette,
  IdeogramColorPaletteMember,
} from "./image";

export { imageV4, IDEOGRAM_V4_GENERATE_URL, RESOLUTIONS_V4, V4_RENDERING_SPEEDS } from "./image-v4";
export type {
  GenerateV4Params,
  IdeogramResolutionV4,
  IdeogramV4RenderingSpeed,
  V4JsonPrompt,
  V4StyleDescription,
  V4CompositionalDeconstruction,
  V4PromptElement,
} from "./image-v4";

export {
  imageEdit,
  imageEditRemix,
  imageEditReframe,
  imageEditReplaceBackground,
  IDEOGRAM_V3_EDIT_URL,
  IDEOGRAM_V3_REMIX_URL,
  IDEOGRAM_V3_REFRAME_URL,
  IDEOGRAM_V3_REPLACE_BACKGROUND_URL,
} from "./image-edit";
export type { EditParams, RemixParams, ReframeParams, ReplaceBackgroundParams } from "./image-edit";

export {
  models,
  provider,
  RENDERING_SPEED_TO_MODEL_ID,
  RENDERING_SPEED_TO_V4_MODEL_ID,
  CHARACTER_REFERENCE_PER_IMAGE,
} from "./models";
export type { IdeogramModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
