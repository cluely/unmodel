export { image, LEONARDO_API_BASE_URL, LEONARDO_GENERATIONS_URL } from "./image";
export type {
  GenerationsBody,
  LucidOriginBody,
  LucidRealismBody,
  PhoenixV1Body,
  PhoenixV09Body,
  UnknownLeonardoModelBody,
  LeonardoLucidParameters,
  LeonardoPhoenixParameters,
  LeonardoImageReference,
  LeonardoStyleGuidance,
  LeonardoContentGuidance,
  LeonardoImageToImageGuidance,
} from "./image";

export {
  LEONARDO_MODEL_RULES,
  LEONARDO_DOCS_URL,
  LEONARDO_STYLE_LIMIT_DOCS_URL,
  LEONARDO_PROMPT_ENHANCE,
  LEONARDO_CONTRASTS,
  LEONARDO_IMAGE_TYPES,
  LEONARDO_STYLE_STRENGTHS,
  LEONARDO_GUIDANCE_STRENGTHS,
  LEONARDO_MAX_STYLE_IDS,
  LEONARDO_DEFAULT_STYLE_ID,
  LEONARDO_KNOWN_PARAMETERS,
} from "./model-rules";
export type {
  LeonardoModelRule,
  LeonardoDimensionRule,
  LeonardoGuidanceRule,
  LeonardoPromptEnhance,
  LeonardoContrast,
  LeonardoImageType,
  LeonardoStyleStrength,
  LeonardoGuidanceStrength,
} from "./model-rules";

// No response checker: POST /v2/generations returns a generation id, and
// fetching the images (GET /v2/generations/{id}, or the webhook callback) is
// transport — out of unmodel's scope.

export { models, provider } from "./models";
export type { LeonardoModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

/**
 * Per-model body maps, exported so a declaration-emitting consumer can name
 * them. They appear in the inferred result of every call on this entry (the
 * `…Arm<M>` types index them), so leaving them private produced TS4023/TS4058
 * — "has or is using name '…' from external module … but cannot be named" —
 * which no re-export elsewhere could reach. See src/core/carriers.ts.
 */
export type { LeonardoBodyByModel } from "./image";
