import type { FamilyRule } from "../../core/constraint-types";

const STYLES_DOCS_URL = "https://www.recraft.ai/docs/api-reference/styles";
const ENDPOINTS_DOCS_URL = "https://www.recraft.ai/docs/api-reference/endpoints";

/**
 * Family rules for POST /v1/images/generations. Every rule carries a reason +
 * source per the constraint-table contract. The generations parameter table
 * marks `style`/`style_id` as "V2 / V3 styles", `negative_prompt` as
 * "V2 / V3 models", and `text_layout` as "V3 models only"; the styles doc
 * states "Styles are not yet supported for V4 models" (which covers the whole
 * V4/V4.1 line, per its model-by-model list).
 */
export const imageFamilyRules: readonly FamilyRule[] = [
  {
    family: "Recraft V4 / V4.1 models",
    match: (modelId) => modelId.startsWith("recraftv4"),
    deny: {
      style: {
        reason:
          "styles are not yet supported for V4 / V4.1 models — use a Recraft V2/V3 model to pick a curated style",
        source: STYLES_DOCS_URL,
      },
      style_id: {
        reason:
          "styles are not yet supported for V4 / V4.1 models — use a Recraft V2/V3 model to reference a custom style",
        source: STYLES_DOCS_URL,
      },
      negative_prompt: {
        reason: "`negative_prompt` is supported by V2 / V3 models only",
        source: ENDPOINTS_DOCS_URL,
      },
      text_layout: {
        reason: "`text_layout` is supported by Recraft V3 and Recraft V3 Vector models only",
        source: ENDPOINTS_DOCS_URL,
      },
    },
  },
  {
    family: "Recraft V2 models",
    match: (modelId) => modelId === "recraftv2" || modelId === "recraftv2_vector",
    deny: {
      text_layout: {
        reason: "`text_layout` is supported by Recraft V3 and Recraft V3 Vector models only",
        source: ENDPOINTS_DOCS_URL,
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Size tables — appendix "List of supported image sizes" (2026-08-13). The
// same 14 aspect ratios apply to every model; explicit WxH values depend on
// the raster model group.
// ---------------------------------------------------------------------------

/** `w:h` aspect values accepted by every model. */
export const ASPECT_RATIOS = [
  "1:1",
  "2:1",
  "1:2",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "6:10",
  "14:10",
  "10:14",
  "16:9",
  "9:16",
] as const;

/** Explicit sizes for Recraft V4.1 / V4.1 Utility / V4 (standard raster). */
export const V4_STANDARD_SIZES = [
  "1024x1024",
  "1536x768",
  "768x1536",
  "1280x832",
  "832x1280",
  "1216x896",
  "896x1216",
  "1152x896",
  "896x1152",
  "832x1344",
  "1280x896",
  "896x1280",
  "1344x768",
  "768x1344",
] as const;

/** Explicit sizes for Recraft V4.1 Pro / V4.1 Utility Pro / V4 Pro. */
export const V4_PRO_SIZES = [
  "2048x2048",
  "3072x1536",
  "1536x3072",
  "2560x1664",
  "1664x2560",
  "2432x1792",
  "1792x2432",
  "2304x1792",
  "1792x2304",
  "1664x2688",
  "2560x1792",
  "1792x2560",
  "2688x1536",
  "1536x2688",
] as const;

/** Explicit sizes for Recraft V2 / V3 (raster). */
export const V2_V3_SIZES = [
  "1024x1024",
  "2048x1024",
  "1024x2048",
  "1536x1024",
  "1024x1536",
  "1365x1024",
  "1024x1365",
  "1280x1024",
  "1024x1280",
  "1024x1707",
  "1434x1024",
  "1024x1434",
  "1820x1024",
  "1024x1820",
] as const;

/**
 * WxH values the appendix's per-model tables never attribute to a model, but
 * which are the transpose of a listed size (the V2/V3 table lists
 * `1024x1707`, never `1707x1024`). Rejecting a size the API may well accept
 * on the strength of a table that is silent about it would be a false
 * negative, so these are passed through unvalidated on every model.
 */
export const UNATTRIBUTED_SIZE_VALUES = ["1707x1024"] as const;
