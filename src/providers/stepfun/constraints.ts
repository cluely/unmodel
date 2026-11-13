/**
 * StepFun's per-model chat rules, as a **leaf** module.
 *
 * Same shape and the same reason as `providers/groq/constraints.ts`: the
 * tables import types only, so the retarget engine could run them against a
 * `.toApi("stepfun")` without importing this provider's barrel (import-graph
 * rule 4 whitelists `constraints.ts` for exactly that). The `match` predicates
 * are pure id tests on purpose — a target-side check only ever knows the model
 * *id*, never the target's `ModelInfo`.
 */
import type { FamilyRule } from "../../core/constraint-types";

export const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "StepFun step-3.5-flash-2603",
    match: (modelId) => modelId === "step-3.5-flash-2603",
    // "Models that support three reasoning tiers accept `low`, `medium`,
    // `high`; `step-3.5-flash-2603` accepts `low` and `high` only."
    // (https://platform.stepfun.ai/docs/en/api-reference/chat/chat-completion-create.md,
    // retrieved 2026-11-12); the China reference agrees: "`step-3.5-flash-2603`
    // 兼容 `low`、`high` 两档。"
    // (https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create.md,
    // retrieved 2026-11-12).
    enums: { reasoning_effort: ["low", "high"] },
  },
];
