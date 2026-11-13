/**
 * MiniMax's per-model chat quirks, as a **leaf** module.
 *
 * The same shape as `providers/groq/constraints.ts` and
 * `providers/upstage/constraints.ts`: pure literal deny/enum tables importing
 * **types only** (the `constraints.ts` contract of `test/import-graph.test.ts`
 * rule 4), with `match` predicates that are pure string tests — a target-side
 * check only ever knows the model *id*, never the target's `ModelInfo`. These
 * tables are not on `src/retarget/target-constraints.ts`, so a
 * `.toApi("minimax")` from another provider does not run them; compose with
 * `minimax.chat` to apply them.
 *
 * What stays behind in `./chat`: the `top_p` range, which is a bound rather
 * than a list, and MiniMax-M3.1-Flash's refusal of `thinking.type:
 * "disabled"`, which is a nested field — neither a deny nor an enum table can
 * express either.
 */
import type { FamilyRule } from "../../core/constraint-types";

export const MINIMAX_OPENAI_COMPAT_DOC =
  "https://platform.minimax.io/docs/api-reference/text-openai-api (checked 2026-11-12)";

/** The M3 generation the OpenAI-compatible page's parameter table names. */
export const MINIMAX_M3_GENERATION: ReadonlySet<string> = new Set([
  "MiniMax-M3",
  "MiniMax-M3.1-Flash",
]);

/**
 * `reasoning_effort` on MiniMax-M3.1-Flash — "Accepts `low`, `medium`, `high`,
 * `xhigh`, and `max` … `none` is not supported" (text-openai-api, 2026-11-12),
 * and the same page quotes the 400 it earns: "model \"MiniMax-M3.1-Flash\"
 * requires adaptive thinking; thinking.type=\"disabled\" (including
 * reasoning.effort=none) is not allowed (2013)".
 */
export const MINIMAX_FLASH_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export const chatFamilyRules: readonly FamilyRule[] = [
  {
    // "| `temperature` | Not supported yet; any value passed has no effect.
    // `MiniMax-M3.1-Flash` and `MiniMax-M3` always use 1. |" and "| `top_p` |
    // Not supported yet; any value passed has no effect. `MiniMax-M3.1-Flash`
    // and `MiniMax-M3` always use 0.95. …" (text-openai-api, 2026-11-12).
    //
    // The page's "Important Notes" name no model, and its Supported Models
    // table lists exactly these two ids, so the notes bind the whole M3
    // generation (text-openai-api, 2026-11-12): "1. Some OpenAI parameters
    // (such as `temperature`, `top_p`, `presence_penalty`,
    // `frequency_penalty`, `logit_bias`, etc.) will be ignored", "3. The `n`
    // parameter only supports value 1", "4. The deprecated `function_call` is
    // not supported, please use the `tools` parameter". The deprecated M2.x
    // ids the catalog still carries are not on that table, so the notes are
    // not extended to them.
    family: "MiniMax-M3 generation",
    match: (modelId) => MINIMAX_M3_GENERATION.has(modelId),
    deny: {
      temperature: {
        reason: "MiniMax-M3 and MiniMax-M3.1-Flash always sample at temperature 1",
        source: MINIMAX_OPENAI_COMPAT_DOC,
        ignored: true,
      },
      top_p: {
        reason: "MiniMax-M3 and MiniMax-M3.1-Flash always sample at top_p 0.95",
        source: MINIMAX_OPENAI_COMPAT_DOC,
        ignored: true,
      },
      presence_penalty: {
        reason: "MiniMax's OpenAI-compatible endpoint ignores `presence_penalty`",
        source: MINIMAX_OPENAI_COMPAT_DOC,
        ignored: true,
      },
      frequency_penalty: {
        reason: "MiniMax's OpenAI-compatible endpoint ignores `frequency_penalty`",
        source: MINIMAX_OPENAI_COMPAT_DOC,
        ignored: true,
      },
      logit_bias: {
        reason: "MiniMax's OpenAI-compatible endpoint ignores `logit_bias`",
        source: MINIMAX_OPENAI_COMPAT_DOC,
        ignored: true,
      },
      function_call: {
        reason: "the deprecated `function_call` is not supported; declare function tools in `tools`",
        source: MINIMAX_OPENAI_COMPAT_DOC,
      },
    },
    enums: { n: [1] },
  },
  {
    // "| `service_tier` | Request admission tier. Supported values are
    // `standard` and `priority`; … `MiniMax-M3.1-Flash` does not support this
    // field. |" (text-openai-api, 2026-11-12; the same sentence in
    // openapi-chat-openai.json). Whether Flash ignores the field or refuses
    // it is not stated, so it warns, never refuses.
    family: "MiniMax-M3.1-Flash",
    match: (modelId) => modelId === "MiniMax-M3.1-Flash",
    deny: {
      service_tier: {
        reason:
          "MiniMax documents that MiniMax-M3.1-Flash does not support `service_tier` (whether it is ignored or refused is not stated)",
        source: MINIMAX_OPENAI_COMPAT_DOC,
        ignored: true,
      },
    },
    enums: { reasoning_effort: MINIMAX_FLASH_REASONING_EFFORTS },
  },
  {
    // "| `reasoning_effort` | Thinking depth, effective for
    // `MiniMax-M3.1-Flash` only. …" (text-openai-api, 2026-11-12), which
    // openapi-chat-openai.json ChatCompletionReq spells out: "Only
    // `MiniMax-M3.1-Flash` supports real thinking-depth tuning; other models
    // ignore this field." The same schema's `service_tier`: "Supported values
    // are `standard` and `priority`." The 400 on `reasoning_effort: "none"` is
    // stated for Flash alone, so on M3 every value only warns.
    family: "MiniMax-M3",
    match: (modelId) => modelId === "MiniMax-M3",
    deny: {
      reasoning_effort: {
        reason:
          'thinking depth is tunable on MiniMax-M3.1-Flash only; MiniMax-M3 ignores `reasoning_effort` (disable thinking with `thinking: { type: "disabled" }`)',
        source: MINIMAX_OPENAI_COMPAT_DOC,
        ignored: true,
      },
    },
    enums: { service_tier: ["standard", "priority"] },
  },
];
