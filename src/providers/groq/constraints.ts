/**
 * Groq's endpoint-wide chat quirks, as a **leaf** module.
 *
 * Why this is its own file rather than a `const` in `index.ts`: these tables
 * are read twice. Once by groq's own validator (a request *to* groq), and once
 * by the retarget engine when some other endpoint aims a `.toApi("groq")` at
 * it (design-types §4.4 — the target's schema and constraint layers run, the
 * catalog layers do not). The second reader must not drag groq's `index.ts`
 * into an unrelated provider's bundle, because that barrel re-exports the
 * validator, the pipeline and the 100-model generated catalog.
 *
 * So the rules live in a leaf that imports **types only** — which is exactly
 * what `test/import-graph.test.ts` whitelists `constraints.ts` for (rule 4).
 *
 * Note what deliberately stays behind in `index.ts`: the `messages[].name`
 * check. It is nested, so a flat deny table cannot express it, and target-side
 * re-validation runs deny/enum tables only.
 */
import type { FamilyRule } from "../../core/constraint-types";

export const GROQ_OPENAI_COMPAT_DOC =
  "https://console.groq.com/docs/openai (checked 2026-08-13)";

/**
 * Endpoint-wide quirks from Groq's OpenAI-compatibility page: `logprobs`,
 * `logit_bias` and `top_logprobs` "will result in a 400 error", and `n`
 * must equal 1 if supplied.
 */
export const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "Groq chat completions",
    match: () => true,
    deny: {
      logprobs: {
        reason: "Groq's OpenAI-compatible endpoint returns a 400 error for `logprobs`",
        source: GROQ_OPENAI_COMPAT_DOC,
      },
      logit_bias: {
        reason: "Groq's OpenAI-compatible endpoint returns a 400 error for `logit_bias`",
        source: GROQ_OPENAI_COMPAT_DOC,
      },
      top_logprobs: {
        reason: "Groq's OpenAI-compatible endpoint returns a 400 error for `top_logprobs`",
        source: GROQ_OPENAI_COMPAT_DOC,
      },
    },
    // "If N is supplied, it must equal 1."
    enums: { n: [1] },
  },
];
