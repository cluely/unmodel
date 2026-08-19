/**
 * Target-side re-validation inputs, keyed by the endpoint a retarget lands on.
 *
 * This is the table that makes design-types §4.4 real. The stated reason
 * `.toApi` re-validates at all is the groq case:
 *
 * ```ts
 * deepinfraChat({ model: "Qwen/Qwen3.6-27B", messages: […], logprobs: true })
 *   .toApi("groq")   // ← groq 400s on `logprobs`; this must be an error, not a wire failure
 * ```
 *
 * Groq denies `logprobs` / `logit_bias` / `top_logprobs` endpoint-wide and
 * pins `n` to 1. Without this table the retargeted body ships those params
 * untouched and the user learns about it from a 400.
 *
 * ## Why the table lives here
 *
 * `core/translate/retarget.ts` runs the checks but may never import
 * `src/providers/**` (import-graph rule 1), and a provider endpoint module may
 * never import another provider's non-`interop` file (rule 6). `src/retarget/**`
 * is the one place allowed to reach provider *leaves* — `wire.ts`,
 * `constraints.ts`, `interop.ts` (rule 4) — so the mapping belongs here, and
 * the endpoint modules import this instead of each other.
 *
 * ## Why it is small, and why that is the point
 *
 * Only the deny/enum tables of targets that *have* them are reachable, and
 * they are hand-written literals with no catalog, schema or validator behind
 * them — a few hundred bytes each. Everything expensive is deliberately out:
 *
 * - **The target's catalog** (`unknown_model`, `over_context`, `over_budget`,
 *   capability checks) — 349 models for openrouter, which is precisely the
 *   import the per-provider layout exists to avoid. The documented escape
 *   hatch is composition: `openrouterChat(claude.toApi("openrouter"))`.
 * - **`xai`'s reasoning-model family rule.** Its `match` predicate reads the
 *   generated xai catalog (`models[id].reasoning`), so honouring it target-side
 *   would drag that catalog into every bundle. A target-side check knows the
 *   model *id* and nothing else, which is the same boundary the catalog layers
 *   sit behind. Left to xai's own validator.
 * - **Nested checks.** Groq's `messages[].name` rule is an `extraCheck`, not a
 *   deny table, and target-side re-validation runs deny/enum tables only.
 */
import type { EndpointConstraints } from "../core/constraint-types";
import type { TargetEndpoint } from "../core/translate/endpoints";
import { chatFamilyRules as groqChatRules } from "../providers/groq/constraints";
import { chatFamilyRules as upstageChatRules } from "../providers/upstage/constraints";

/** Target validation inputs, per resolved endpoint. Mirrors `TargetValidation`. */
export interface TargetConstraints {
  constraints?: readonly EndpointConstraints[];
}

/**
 * Endpoint id → the target's hand-written deny/enum tables.
 *
 * Keyed by endpoint rather than provider because a provider can serve more
 * than one wire surface (`google-vertex.chatMaas` vs `google-vertex.chat`),
 * and a deny table is a property of the surface.
 */
const TABLES: Readonly<Record<string, readonly EndpointConstraints[]>> = Object.freeze({
  "groq.chat": groqChatRules,
  "upstage.chat": upstageChatRules,
});

/**
 * The `RetargetSpec.targetValidation` hook every chat endpoint passes.
 *
 * Returns `undefined` for targets with no tables, which is the common case and
 * costs nothing: `createToApi` skips the check entirely.
 */
export function targetValidationFor(endpoint: TargetEndpoint): TargetConstraints | undefined {
  if (!Object.hasOwn(TABLES, endpoint.id)) return undefined;
  return { constraints: TABLES[endpoint.id] };
}

/** The endpoints this build can re-validate against. Asserted by tests. */
export const TARGET_CONSTRAINT_ENDPOINTS: readonly string[] = Object.freeze(Object.keys(TABLES));
