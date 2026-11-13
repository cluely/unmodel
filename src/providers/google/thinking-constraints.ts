/**
 * Gemini `thinkingConfig` constants — and nothing else.
 *
 * Import-free for the same reason as `./tts-constraints.ts` and
 * `./audio-constraints.ts`: `./constraints.ts` reads `src/catalog/google.gen.ts`
 * and `./veo-models.ts`, and the thinking rules are enforced by `./tts-checks.ts`,
 * the check battery `google.chat`, `google.stt` AND `google.tts` share — a
 * battery that may not reach the generated catalog (`unmodel/tts` asserts a
 * catalog-free graph in test/bundle-budget.test.ts). `./constraints.ts`
 * re-exports everything below, so the public surface of `unmodel/google` is
 * unchanged by the split.
 */

/** The per-model "Levels Supported" table (verified 2026-11-12). */
export const GEMINI_THINKING_DOCS_URL = "https://ai.google.dev/gemini-api/docs/thinking";

/** The long-decode guide: continuation tokens, the per-hop output defaults and the 1M ceiling. */
export const GEMINI_LONG_DECODE_DOCS_URL = "https://ai.google.dev/gemini-api/docs/long-decode";

/**
 * `enum (ThinkingLevel)`. "Recommended for Gemini 3 or later models. Use with
 * earlier models results in an error."
 *
 * `XHIGH` — "XHigh thinking level." (REST reference, 2026-11-12). Documented
 * as supported on `gemini-4-hydrogen` only ("The model defaults to `high` and
 * introduces `xhigh`"), and NOT refused elsewhere: no page says it errors on
 * another model, and a refusal the API would have fulfilled is the one failure
 * this library must not have. {@link GEMINI_XHIGH_THINKING_MODEL_IDS} is what
 * the MINIMAL refusal's "it accepts …" list reads to say so per model, and
 * what decides that `XHIGH` elsewhere draws a warning rather than nothing.
 */
export const GEMINI_THINKING_LEVELS = [
  "THINKING_LEVEL_UNSPECIFIED",
  "MINIMAL",
  "LOW",
  "MEDIUM",
  "HIGH",
  "XHIGH",
] as const;

/**
 * Models that reject `MINIMAL` even though the wire enum offers it.
 *
 * Kept to the ids the docs say *return an error* for, rather than derived from
 * the thinking table's omissions: every other row states which levels are
 * supported and stays silent on what an unlisted one does, and
 * `gemini-3.6-flash` / `gemini-3.5-flash` still take MINIMAL, so this is a
 * per-model fact and not a generation-wide one.
 *
 * - `gemini-3.7-flash`, `gemini-3.8-flash`: both model pages carry "Note:
 *   `minimal` is not supported and returns an error"; the thinking guide says
 *   "Not supported on Gemini 4 models or `gemini-3.8-flash`."
 * - `gemini-4-argon`, `gemini-4-carbon`, `gemini-4-hydrogen`: the long-decode
 *   guide (2026-11-12) — "Gemini 4 models (`gemini-4-carbon`, `gemini-4-argon`,
 *   and `gemini-4-hydrogen`) do not support `minimal`. Use `low`, `medium`, or
 *   `high` (plus `xhigh` on `gemini-4-hydrogen`)." and its error table: "Error
 *   for `thinking_level: "minimal"`". The Hydrogen what's-new page: "rejects
 *   `minimal` with an error."
 */
export const GEMINI_NO_MINIMAL_THINKING_MODEL_IDS = [
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-4-argon",
  "gemini-4-carbon",
  "gemini-4-hydrogen",
] as const;

/**
 * Models whose documented level set includes `XHIGH`, so the MINIMAL refusal
 * names it among the levels the model DOES accept, and `XHIGH` on any other id
 * is a warning (documented here only; no page says it errors elsewhere).
 *
 * `gemini-4-hydrogen` — model page (2026-11-12): "Supported (low, medium, high,
 * xhigh)"; what's-new: "Hydrogen defaults to `high` rather than `medium`, adds
 * `xhigh`, and rejects `minimal` with an error." `gemini-4-argon` is "Supported
 * (low, medium, high)" and carbon the same, so neither is listed.
 */
export const GEMINI_XHIGH_THINKING_MODEL_IDS = ["gemini-4-hydrogen"] as const;

/**
 * The Gemini 4 generateContent models — the three ids two documented rules name
 * together, both verified 2026-11-12:
 *
 * 1. **`thinkingBudget` and `thinkingLevel` are exclusive.** Thinking guide:
 *    "In Gemini 4 models (`gemini-4-carbon`, `gemini-4-argon`, and
 *    `gemini-4-hydrogen`), `thinkingBudget` (`thinking_budget`) is deprecated.
 *    If passed alone, it maps to the nearest `thinkingLevel` (`thinking_level`)
 *    and returns a warning; sending `thinkingBudget` and `thinkingLevel`
 *    together returns a `400` error." A budget alone is therefore NOT refused.
 * 2. **`maxOutputTokens` is bounded by long decode, not the catalog row.**
 *    The catalog's `limit.output` (32,768 on carbon/argon, 65,536 on hydrogen)
 *    is the per-hop default — "One hop returns up to 65,536 output tokens (or
 *    up to 32,768 on direct non-streaming REST calls to `gemini-4-carbon` and
 *    `gemini-4-argon`)" — while "Output can use up to 1,048,576 minus your
 *    input tokens." and the guide's own REST sample sends `maxOutputTokens:
 *    262144` to `gemini-4-carbon:generateContent`. Refusing above the per-hop
 *    figure would refuse documented requests, so
 *    {@link GEMINI_LONG_DECODE_MAX_OUTPUT_TOKENS} is the bound on these ids.
 *
 * A fourth Gemini 4 id joins only when BOTH pages name it.
 */
export const GEMINI_4_MODEL_IDS = ["gemini-4-argon", "gemini-4-carbon", "gemini-4-hydrogen"] as const;

/**
 * "Output can use up to 1,048,576 minus your input tokens." — the long-decode
 * guide; the model pages agree: "Max output 65,536 (default synchronous) / up
 * to 1,048,576 (with long decode)". The `maxOutputTokens` ceiling on
 * {@link GEMINI_4_MODEL_IDS}; `limit.output` stays the per-request default
 * `estimate()` bills.
 */
export const GEMINI_LONG_DECODE_MAX_OUTPUT_TOKENS = 1_048_576;
