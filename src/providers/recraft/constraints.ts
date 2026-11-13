import type { DenyRule, FamilyRule } from "../../core/constraint-types";

const ENDPOINTS_DOCS_URL = "https://www.recraft.ai/docs/api-reference/endpoints";
const AGENTS_DOCS_URL = "https://www.recraft.ai/docs/api-reference/agents";
const V4_1_FLASH_DOCS_URL = "https://www.recraft.ai/docs/api-reference/models/recraft-v4-1-flash";

/** Recraft V4.1 Flash and its `_raster` alias — the one line that takes no style at all. */
export function isV41FlashModel(modelId: string): boolean {
  return modelId === "recraftv4_1_flash" || modelId === "recraftv4_1_flash_raster";
}

/**
 * The dedicated V4 Styles line — `recraftv4_styles`, `_vector`, `_pro`,
 * `_pro_vector` and the two `_raster` aliases — which "**always requires a
 * style**" (https://www.recraft.ai/docs/api-reference/styles, 2026-11-12).
 */
export function isV4StylesModel(modelId: string): boolean {
  return modelId.startsWith("recraftv4_styles");
}

/**
 * `style_match` per model family, from the "Parameter support by model family"
 * matrix of https://www.recraft.ai/docs/api-reference/agents (2026-11-12):
 * "| `style_match` | no | `flexible`, `precise` | `flexible`, `precise` |
 * `regular` | `regular` |" (columns V4.1 Flash, V4.1/V4, V4 Styles, V3, V2).
 * The endpoints doc adds "A value not supported by the resolved model is
 * rejected." Flash's "no" is a deny on its own family rule.
 */
const V4_STYLE_MATCHES = ["flexible", "precise"] as const;
const V2_V3_STYLE_MATCHES = ["regular"] as const;

/** One reason for every param V4.1 Flash refuses — the page lists them as one sentence. */
const FLASH_DENY: DenyRule = {
  reason:
    "V4.1 Flash takes no style input and no `negative_prompt` / `text_layout` — use `recraftv4_1` for custom styles, or `recraftv3` for curated styles and text layout",
  source: V4_1_FLASH_DOCS_URL,
};

/**
 * Family rules for POST /v1/images/generations. Every rule carries a reason +
 * source per the constraint-table contract. The source for the V4 line is the
 * "Parameter support by model family" matrix of
 * https://www.recraft.ai/docs/api-reference/agents (2026-11-12), which puts
 * V4.1 / V4 and V4 Styles in one column pattern: "| `style_id`,
 * `style_reference_urls`, `style_references` | no | yes | yes, one is
 * required | yes | yes |", and "no" for curated `style`, `negative_prompt` and
 * `text_layout`. The model pages say the same: "Not supported by V4.1:
 * `negative_prompt`, `style` (curated styles), `text_layout`, and the
 * `artistic_level` and `no_text` controls." (V4 identical; V4 Styles "> Not
 * supported: `negative_prompt`, `style` (curated styles), `text_layout`.").
 *
 * One page disagrees on curated `style`: the endpoints table's compatibility
 * column reads "All models except V4.1 Flash" for it — the same wording as the
 * `style_id` row beside it. The matrix, the three model pages and the styles
 * doc ("V2 / V3 Styles") all say V2/V3 only, so the deny stands on those.
 *
 * V4.1 Flash is split out of the `recraftv4` prefix because its page documents
 * a different list — no style input of any kind — and the V4 Styles line
 * shares the rule but additionally requires a style (`checkV4StylesStyle` in
 * image.ts).
 */
export const imageFamilyRules: readonly FamilyRule[] = [
  {
    family: "Recraft V4 / V4.1 / V4 Styles models",
    match: (modelId) => modelId.startsWith("recraftv4") && !isV41FlashModel(modelId),
    enums: { style_match: V4_STYLE_MATCHES },
    deny: {
      style: {
        reason:
          "curated `style` names are V2 / V3 only — the V4 line takes a custom style through `style_id` or `style_reference_urls`; use a Recraft V2/V3 model for a curated style",
        source: AGENTS_DOCS_URL,
      },
      negative_prompt: {
        reason: "`negative_prompt` is supported by V2 / V3 models only",
        source: AGENTS_DOCS_URL,
      },
      text_layout: {
        reason: "`text_layout` is supported by Recraft V3 and Recraft V3 Vector models only",
        source: AGENTS_DOCS_URL,
      },
    },
  },
  {
    // V4.1 Flash page (2026-11-12): "Not supported by Flash: `style`,
    // `style_id`, `style_match`, style references, `negative_prompt`, and
    // `text_layout`." The endpoints doc names the multipart spelling too:
    // "`style`, `style_id`, `style_match`, and style references are not
    // supported with it".
    family: "Recraft V4.1 Flash",
    match: isV41FlashModel,
    deny: {
      style: FLASH_DENY,
      style_id: FLASH_DENY,
      style_match: FLASH_DENY,
      style_reference_urls: FLASH_DENY,
      style_references: FLASH_DENY,
      negative_prompt: FLASH_DENY,
      text_layout: FLASH_DENY,
    },
  },
  {
    family: "Recraft V2 models",
    match: (modelId) =>
      modelId === "recraftv2" || modelId === "recraftv2_raster" || modelId === "recraftv2_vector",
    deny: {
      text_layout: {
        reason: "`text_layout` is supported by Recraft V3 and Recraft V3 Vector models only",
        source: ENDPOINTS_DOCS_URL,
      },
    },
  },
  {
    // Styles doc (2026-11-12): "For V2 / V3 models `regular` is the only valid value."
    family: "Recraft V2 / V3 models",
    match: (modelId) => modelId.startsWith("recraftv2") || modelId.startsWith("recraftv3"),
    enums: { style_match: V2_V3_STYLE_MATCHES },
  },
];

/**
 * `image_format` values — endpoints doc (2026-11-12): "The file format of the
 * returned raster images. Must be one of `webp` or `png`" (OpenAPI
 * `ImageFormat`); each editing route's page lists the same pair: "`webp`
 * (lossless) or `png`." No jpeg. Declared in this leaf so the editing
 * validator reads it without the generations validator.
 */
export const IMAGE_FORMATS = ["webp", "png"] as const;
export type RecraftImageFormat = (typeof IMAGE_FORMATS)[number];

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

/**
 * Explicit sizes for the 1K raster models — appendix (2026-11-12): "**1K
 * models:** `recraftv4_1`, `recraftv4_1_utility`, `recraftv4_1_flash`,
 * `recraftv4`, `recraftv4_styles`." — and their `_raster` aliases.
 */
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

/**
 * Explicit sizes for the 2K raster models — appendix (2026-11-12): "**2K
 * models:** `recraftv4_1_pro`, `recraftv4_1_utility_pro`, `recraftv4_pro`,
 * `recraftv4_styles_pro`." — and their `_raster` aliases.
 */
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
