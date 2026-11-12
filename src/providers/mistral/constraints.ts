/**
 * Mistral's per-model chat rules, as a **leaf** module.
 *
 * Same shape and the same reason as `providers/groq/constraints.ts`: the
 * tables import types only, so the retarget engine could run them against a
 * `.toApi("mistral")` without importing this provider's `index.ts` (import-graph
 * rule 4 whitelists `constraints.ts` for exactly that). The `match` predicates
 * are pure id tests on purpose — a target-side check only ever knows the model
 * *id*, never the target's `ModelInfo`.
 *
 * What lives here is the `reasoning_effort` ladder of the models that do not
 * take the whole API-wide enum. openapi.yaml lists `none | minimal | low |
 * medium | high | xhigh | max` for every model, and the reasoning guide says
 * outright that "a value appearing in the enum does not mean every model
 * accepts it". The shared dialect check (`checkReasoningCapability`) lets
 * `"none"` through on any model, so without these rows a `"none"` sent to a
 * model that has no such level validates and comes back a 400.
 */
import type { FamilyRule } from "../../core/constraint-types";

/** Source of every ladder below (retrieved 2026-11-12). */
export const MISTRAL_REASONING_DOC = "https://docs.mistral.ai/inference/conversations/reasoning";

/**
 * Mistral Large 4 and the ids that serve it. The card lists
 * `"names":["mistral-large-4","mistral-large-4-0","mistral-large-latest"]`
 * (https://docs.mistral.ai/models/mistral-large-4-0, page source, 2026-11-12).
 */
export const LARGE_4_MODEL_IDS = ["mistral-large-4", "mistral-large-4-0"] as const;

/**
 * Z.ai GLM 5.3 and its aliases — the card lists
 * `"names":["zai-glm-5-3","zai-glm-5","zai-glm-latest"]`
 * (https://docs.mistral.ai/models/zai-glm-5-3, page source, 2026-11-12) — plus
 * GLM 5.3 Flash, which the reasoning guide gives the same ladder.
 */
export const GLM_5_3_MODEL_IDS = [
  "zai-glm-5-3",
  "zai-glm-5",
  "zai-glm-latest",
  "zai-glm-5-3-flash",
] as const;

export const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "Mistral Large 4",
    match: (modelId) => (LARGE_4_MODEL_IDS as readonly string[]).includes(modelId),
    // "Mistral Large 4 ( mistral-large-4 / mistral-large-4-0 ) supports three
    // reasoning levels: … Mistral Large 4 does not accept none , minimal ,
    // xhigh , or max ; these are not aliases for its supported levels."
    enums: { reasoning_effort: ["low", "medium", "high"] },
  },
  {
    family: "Z.ai GLM 5.3",
    match: (modelId) => (GLM_5_3_MODEL_IDS as readonly string[]).includes(modelId),
    // "zai-glm-5-3 : … Supported values are low , high , and max … GLM 5.3
    // Flash ( zai-glm-5-3-flash ): Supports low , high , and max reasoning
    // effort. none is not supported."
    enums: { reasoning_effort: ["low", "high", "max"] },
  },
];
