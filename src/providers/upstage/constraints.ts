/**
 * Upstage's per-family chat quirks, as a **leaf** module.
 *
 * Same reason as `providers/groq/constraints.ts`: the retarget engine runs the
 * *target's* deny tables when another endpoint aims a `.toApi("upstage")` here,
 * and it must be able to reach them without importing upstage's `index.ts`
 * (which re-exports the validator and the generated catalog). Import-graph
 * rule 4 whitelists `constraints.ts` for exactly this.
 *
 * The `match` predicate is a pure string test on purpose — a target-side check
 * only ever knows the model *id*, never the target's `ModelInfo`.
 */
import type { FamilyRule } from "../../core/constraint-types";

export const UPSTAGE_CHAT_DOC =
  "https://console.upstage.ai/api/docs/for-agents/raw (checked 2026-08-13)";

/**
 * The reference's reasoning matrix: solar-mini does not accept
 * `reasoning_effort` at all — sending any value returns HTTP 400. Matched as
 * a family so dated snapshots (e.g. solar-mini-250422) are covered too.
 */
export const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "solar-mini",
    match: (modelId) => modelId === "solar-mini" || modelId.startsWith("solar-mini-"),
    deny: {
      reasoning_effort: {
        reason: "solar-mini does not accept `reasoning_effort`; sending any value returns HTTP 400",
        source: UPSTAGE_CHAT_DOC,
      },
    },
  },
];
