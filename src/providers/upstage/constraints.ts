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

/**
 * The last capture of Upstage's agent-readable reference; the live URL serves
 * a Next.js 404 page (checked 2026-11-12).
 */
export const UPSTAGE_CHAT_DOC =
  "https://web.archive.org/web/20260414103038/https://console.upstage.ai/api/docs/for-agents/raw (read 2026-11-12)";

/**
 * solar-mini and `reasoning_effort`. While the model was served, the reference
 * ({@link UPSTAGE_CHAT_DOC}) said: "`solar-mini` and `syn-pro` do not support
 * reasoning. The `reasoning_effort` parameter is ignored for these models."
 * The rule is an error rather than an `ignored` warning because the model is
 * gone: https://console.upstage.ai/docs/resources/changelog (checked
 * 2026-11-12), October 30, 2026: "Support ended for `solar-mini` and all of
 * its versions" / "Please upgrade to the `solar-mini4` alias", and
 * https://console.upstage.ai/docs/resources/error-codes (checked 2026-11-12)
 * answers "a model that is invalid or no longer supported" with 400
 * `invalid_request_body`. Matched as a family so dated snapshots (e.g.
 * solar-mini-250422) are covered too.
 *
 * The predicate matches `solar-mini` and `solar-mini-*` only, and must stay
 * that narrow: solar-mini4 (and its snapshot solar-mini4-260922) is a
 * different model that accepts `reasoning_effort`, although models.dev files
 * it under family "solar-mini" — matching on the catalog's family field would
 * refuse requests Upstage fulfils.
 * https://console.upstage.ai/docs/capabilities/generate/reasoning (checked
 * 2026-11-12): "`solar-mini4` follows the same rules as `solar-pro4`: the same
 * effort values turn reasoning on and off, and its thought process is
 * returned the same way."
 */
export const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "solar-mini",
    match: (modelId) => modelId === "solar-mini" || modelId.startsWith("solar-mini-"),
    deny: {
      reasoning_effort: {
        reason:
          "Upstage's reference said solar-mini ignores `reasoning_effort`, and the model ended service on 2026-10-30 (KST): Upstage now answers any request naming it with HTTP 400 `invalid_request_body`; use solar-mini4",
        source: UPSTAGE_CHAT_DOC,
      },
    },
  },
];
