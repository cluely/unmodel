/**
 * Zhipu AI's per-family chat quirks, as a **leaf** module.
 *
 * Same reason as `providers/groq/constraints.ts`: the retarget engine runs the
 * *target's* enum tables when another endpoint aims a `.toApi("zhipuai")`
 * here, and it must be able to reach them without importing zhipuai's
 * `index.ts` (which re-exports the validator and the generated catalog).
 * Import-graph rule 4 whitelists `constraints.ts` for exactly this.
 *
 * The `match` predicate is a pure string test on purpose — a target-side check
 * only ever knows the model *id*, never the target's `ModelInfo`.
 *
 * What stays behind in `index.ts`: the `thinking.type` refusal. `thinking` is
 * a nested Zhipu-only object outside the shared dialect shape, so a flat
 * enum table cannot express it, and target-side re-validation runs deny/enum
 * tables only.
 *
 * Provenance sits in line comments rather than JSDoc: this leaf is bundled
 * into every chat entry through `retarget/target-constraints.ts`, and JSDoc
 * survives the build.
 */
import type { FamilyRule } from "../../core/constraint-types";

// The always-thinking generation, matched by exact id. Each id is named by
// https://docs.bigmodel.cn/cn/guide/start/concept-param (checked 2026-11-12):
// "`GLM-5.3` `GLM-5.3-FLASH` `GLM-5.3-FLASHX` 强制需开启。" Exact rather than a
// `glm-5.3` prefix: `glm-5.3-flashx-legal` shares the family, but no page
// states either rule for it, and a refusal the API might not make is the one
// failure this library must never have.
const GLM_5_3_ALWAYS_THINKING: ReadonlySet<string> = new Set([
  "glm-5.3",
  "glm-5.3-flash",
  "glm-5.3-flashx",
]);

/** True for the GLM-5.3 ids that cannot turn thinking off. */
export function isGlm53AlwaysThinking(modelId: string): boolean {
  return GLM_5_3_ALWAYS_THINKING.has(modelId);
}

/** GLM-5.3's three-level `reasoning_effort`. */
export const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "GLM-5.3",
    match: isGlm53AlwaysThinking,
    // https://docs.bigmodel.cn/cn/guide/capabilities/thinking (checked
    // 2026-11-12), API-request bullet: "针对 `GLM-5.3` `GLM-5.3-FLASH`
    // `GLM-5.3-FLASHX`，仅支持 `max`、`high`、`low`，其余输入将报错；". The
    // remapping the same page describes is for Coding Plan requests only, a
    // different base URL. An explicit `null` is unset, as for every enum table.
    enums: { reasoning_effort: ["low", "high", "max"] },
  },
];
