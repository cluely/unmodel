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
