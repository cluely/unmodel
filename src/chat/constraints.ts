/**
 * Validation **layer 3** for `unmodel/chat`: endpoint id → the provider's
 * hand-written chat deny/enum tables.
 *
 * ## Why this is a second table and not `src/retarget/target-constraints.ts`
 *
 * That module answers the same question for `.toApi(provider)` and has the same
 * shape, and merging them looks obviously right for about thirty seconds. It is
 * not, and the reason is where each one is *imported from*.
 *
 * `target-constraints.ts` is imported by **every chat endpoint module** —
 * `anthropic/chat.ts`, `google/chat.ts`, all 31 fleet overlays — because each
 * of them passes `targetValidationFor` to `createToApi`. Whatever it imports,
 * every one of those bundles pays for. That is why it carries exactly two
 * entries (groq, upstage): the two providers whose tables are pure literals and
 * whose rules a retarget can actually violate.
 *
 * `unmodel/chat` needs a *larger* set: it compiles bodies **for** anthropic and
 * openai rather than merely retargeting into them, so their per-model tables
 * are live here in a way they never are for a retarget (Claude 4.7+ rejects
 * `top_k` outright; o3/o4-mini reject `stop`). Adding openai's 617-line
 * constraints module to `target-constraints.ts` to share one table would push it
 * into all ~35 provider bundles to serve one entry, blowing every per-provider
 * budget in `test/bundle-budget.test.ts`. A parallel table costs one file and
 * keeps each entry paying only for what it uses.
 *
 * The two are kept honest by `test/chat/providers.test.ts`, which asserts the
 * chat table is a superset of the retarget one for the endpoints both know.
 *
 * ## What is here and what is deliberately not
 *
 * Deny and enum rules only, matching `checkConstraints` and `TargetValidation`:
 *
 * - **Media rules and `imageTokens` are inert as *rules*** at this layer — only
 *   `deny` and `enums` are read. `imageTokens` is used, but by layer 4's token
 *   estimate rather than here.
 * - **google has no entry, and that is measured rather than assumed.** Its
 *   `chatConstraints` is empty and its `chatFamilyRules` carry no deny or enum
 *   rule at all — only Gemini's media format allowlists — so wiring it in
 *   contributes exactly zero findings. It is not free, though: the module
 *   imports `src/catalog/google.gen.ts` at runtime for its `match` predicates,
 *   and wiring it measured **+44 KiB** on this entry (23.9 KiB of tables plus a
 *   19.9 KiB per-provider catalog chunk) — in the one entry whose whole design
 *   is "the slim profile table and nothing else". Per-export tree-shaking does
 *   not save it: the family rules' closure captures the catalog, and rolldown
 *   emits the module as one chunk. `test/bundle-budget.test.ts` asserts no
 *   `<provider>.gen` chunk reaches this entry, which is what keeps the decision
 *   from being quietly reversed. If google ever gains a chat deny rule, move it
 *   (or a catalog-free copy of it) into a table this module can afford.
 *
 * Import-graph: this module reaches provider directories only through
 * `constraints.ts` leaves, which is what amendment A1 whitelists — and A2 pins
 * the exact four.
 */
import type { EndpointConstraints, FamilyRule } from "../core/constraint-types";
import { constraintsFor } from "../core/pipeline";
import {
  chatConstraints as anthropicChat,
  chatFamilyRules as anthropicChatRules,
} from "../providers/anthropic/constraints";
import {
  chatConstraints as openaiChat,
  chatFamilyRules as openaiChatRules,
} from "../providers/openai/constraints";
import { chatFamilyRules as groqChatRules } from "../providers/groq/constraints";
import { chatFamilyRules as upstageChatRules } from "../providers/upstage/constraints";

/** One endpoint's tables, in the two shapes `constraintsFor` resolves. */
interface ChatConstraintTables {
  /** Per-model table, keyed by the provider's own model id. */
  constraints?: Readonly<Partial<Record<string, EndpointConstraints>>>;
  /** Pattern rules, applied when their `match` accepts the model id. */
  familyRules?: readonly FamilyRule[];
}

/**
 * Endpoint id → tables. Keyed by endpoint rather than provider for the same
 * reason `target-constraints.ts` is: a provider can serve more than one wire
 * surface, and a deny table is a property of the surface.
 *
 * The 28 providers with no entry are not an oversight — they have no
 * hand-written chat deny/enum rules, so layer 3 is a no-op for them and
 * `chatConstraintsFor` returns an empty list at zero cost.
 */
const TABLES: Readonly<Record<string, ChatConstraintTables>> = Object.freeze({
  "anthropic.chat": { constraints: anthropicChat, familyRules: anthropicChatRules },
  "openai.chat": { constraints: openaiChat, familyRules: openaiChatRules },
  "groq.chat": { familyRules: groqChatRules },
  "upstage.chat": { familyRules: upstageChatRules },
});

/** The endpoints `unmodel/chat` can run layer 3 against. Asserted by tests. */
export const CHAT_CONSTRAINT_ENDPOINTS: readonly string[] = Object.freeze(Object.keys(TABLES));

/**
 * Every constraint table that applies to `modelId` on `endpointId` — the
 * per-model entry plus every family rule whose `match` accepts it.
 *
 * `constraintsFor` is `core/pipeline`'s own resolver, reused rather than
 * reimplemented so "which rules apply to this model" cannot mean two different
 * things depending on which entry you came in through.
 */
export function chatConstraintsFor(endpointId: string, modelId: string): EndpointConstraints[] {
  if (!Object.hasOwn(TABLES, endpointId)) return [];
  return constraintsFor(TABLES[endpointId] as ChatConstraintTables, modelId);
}
