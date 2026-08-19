/**
 * Validation layer 2: the bundled model profile table.
 *
 * `unmodel/chat` ships `chatProfiles` **inside** the entry rather than behind a
 * subpath, and that is the single largest thing in its bundle — so the checks
 * it buys had better be the ones that matter. Each case below is a request that
 * is perfectly well-formed, compiles to a perfectly valid body, and would still
 * fail (or, worse, quietly under-deliver) at the provider:
 *
 * - tools sent to a model that cannot call them: some APIs 400, others accept
 *   the request and never emit a call, which is the harder bug;
 * - a JSON schema sent to a model with no structured-output support: you get
 *   prose that looks like it might parse;
 * - an attachment in a modality the model does not read;
 * - `maxOutputTokens` above the model's ceiling: a hard 400;
 * - a request whose worst case blows a stated budget.
 *
 * The two negative-space rules are as important as the checks:
 *
 * 1. **An unknown model warns and skips.** models.dev is a committed snapshot,
 *    so a model released after it must stay callable — which means every check
 *    here is conditional on the model being *known*, and a model that is not
 *    must not fail.
 * 2. **`structuredOutput` is tri-state.** Absent means "the catalog has no
 *    answer", and an absent answer must never fail a request. Only an explicit
 *    `false` does.
 */
import { describe, expect, test } from "bun:test";

import { chat } from "../../src/chat/index";
import { chatProfiles, type ChatCatalog } from "../../src/catalog/chat-profiles.gen";

const MESSAGES = [{ role: "user" as const, content: "hi" }];

/**
 * `openai/gpt-3.5-turbo`: deprecated, no tool calling, no structured output,
 * not a reasoning model, text input only, 4096-token output ceiling. One row
 * that exercises every model-dependent check.
 */
const LEGACY = "openai/gpt-3.5-turbo";

function errorsOf(outcome: ReturnType<typeof chat.safe>): Array<{ code: string; path: unknown }> {
  return outcome.ok ? [] : outcome.errors.map((e) => ({ code: e.code, path: e.path }));
}

describe("the profile table is the one that ships", () => {
  test("it covers every provider chat() can address", () => {
    expect(Object.keys(chatProfiles).length).toBeGreaterThan(30);
    expect(chatProfiles["openai"]?.["gpt-3.5-turbo"]).toBeDefined();
  });
});

describe("unknown models warn and skip", () => {
  test("an unrecognised id on a recognised provider is a warning, not an error", () => {
    const outcome = chat.safe({
      model: "openai/gpt-6-nonexistent",
      messages: MESSAGES,
      // Every model-dependent check below would fire if the model were known
      // and incapable; none may fire when the catalog simply has no row.
      tools: { t: { inputSchema: { type: "object" } } },
      responseFormat: { type: "json-schema", schema: { type: "object" } },
      maxOutputTokens: 999_999_999,
      reasoning: "high",
    });
    expect(outcome.ok, JSON.stringify(errorsOf(outcome))).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
    expect(outcome.warnings[0]?.message).toContain("catalog data may lag behind");
  });

  test("…and the request still compiles to a real body at a real URL", () => {
    const result = chat({ model: "openai/gpt-6-nonexistent", messages: MESSAGES });
    expect(result.model).toBe("gpt-6-nonexistent");
    expect(result.request.url).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("capability checks", () => {
  test("a deprecated model warns", () => {
    const outcome = chat.safe({ model: LEGACY, messages: MESSAGES });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.warnings.map((w) => w.code)).toContain("deprecated_model");
  });

  test("tools on a model that cannot call them is an error naming them", () => {
    const outcome = chat.safe({
      model: LEGACY,
      messages: MESSAGES,
      tools: {
        weather: { inputSchema: { type: "object" } },
        clock: { inputSchema: { type: "object" } },
      },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const issue = outcome.errors.find((e) => e.path[0] === "tools");
    expect(issue?.code).toBe("unsupported_capability");
    expect(issue?.message).toContain("weather, clock");
  });

  test("a json-schema response format on a model without structured output errors", () => {
    const outcome = chat.safe({
      model: LEGACY,
      messages: MESSAGES,
      responseFormat: { type: "json-schema", name: "out", schema: { type: "object" } },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(errorsOf(outcome)).toContainEqual({
      code: "unsupported_capability",
      path: ["responseFormat"],
    });
  });

  test("plain JSON mode on the same model is fine — only the schema arm is checked", () => {
    const outcome = chat.safe({
      model: LEGACY,
      messages: MESSAGES,
      responseFormat: { type: "json" },
    });
    expect(outcome.ok, JSON.stringify(errorsOf(outcome))).toBe(true);
  });

  test("a json-schema on a model the catalog says nothing about is allowed", () => {
    // `gemini-2.5-computer-use-preview-10-2025` carries no `structuredOutput`
    // key at all. Tri-state: absent is not `false`.
    expect(
      chatProfiles["google"]?.["gemini-2.5-computer-use-preview-10-2025"]?.structuredOutput,
    ).toBeUndefined();
    const outcome = chat.safe({
      model: "google/gemini-2.5-computer-use-preview-10-2025",
      messages: MESSAGES,
      responseFormat: { type: "json-schema", schema: { type: "object" } },
    });
    expect(outcome.ok, JSON.stringify(errorsOf(outcome))).toBe(true);
  });

  test("`reasoning` on a non-reasoning model errors; turning it off does not", () => {
    const asked = chat.safe({ model: LEGACY, messages: MESSAGES, reasoning: "high" });
    expect(asked.ok).toBe(false);
    if (!asked.ok) {
      expect(asked.errors.some((e) => e.path[0] === "reasoning")).toBe(true);
    }

    // `reasoning: false` / `"off"` asks the model NOT to think, which every
    // model can honour — so it must not trip the capability check.
    for (const off of [false, "off"] as const) {
      const outcome = chat.safe({ model: LEGACY, messages: MESSAGES, reasoning: off });
      expect(outcome.ok, JSON.stringify(errorsOf(outcome))).toBe(true);
    }
  });

  test("an attachment in a modality the model does not read errors, at its own path", () => {
    const outcome = chat.safe({
      model: LEGACY,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "file", mediaType: "image/png", data: "aGVsbG8=" },
          ],
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const issue = outcome.errors.find((e) => e.code === "unsupported_capability");
    expect(issue?.path).toEqual(["messages", 0, "content", 1]);
    expect(issue?.message).toContain("image");
  });

  test("the same attachment on a vision model passes", () => {
    const outcome = chat.safe({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [{ type: "file", mediaType: "image/png", data: "aGVsbG8=" }],
        },
      ],
    });
    expect(outcome.ok, JSON.stringify(errorsOf(outcome))).toBe(true);
  });

  test("maxOutputTokens above the model's ceiling errors with both numbers", () => {
    const outcome = chat.safe({ model: LEGACY, messages: MESSAGES, maxOutputTokens: 8192 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const issue = outcome.errors.find((e) => e.code === "over_output_limit");
    expect(issue?.path).toEqual(["maxOutputTokens"]);
    expect(issue?.meta).toEqual({ requested: 8192, limit: 4096 });
  });
});

describe("layer 4 — estimation, context and budget", () => {
  test("an estimate rides on a successful safe() result", () => {
    const outcome = chat.safe({
      model: "anthropic/claude-opus-5",
      messages: [{ role: "user", content: "x".repeat(400) }],
      maxOutputTokens: 128,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.estimate.inputTokens).toBeGreaterThan(90);
    expect(outcome.estimate.costUSD).toBeGreaterThan(0);
  });

  test("a prompt past the context window errors", () => {
    // gpt-3.5-turbo's window is 16385 tokens; the heuristic is ~4 chars/token.
    const outcome = chat.safe({
      model: LEGACY,
      messages: [{ role: "user", content: "x".repeat(4 * 20_000) }],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const issue = outcome.errors.find((e) => e.code === "over_context");
    expect(issue?.meta?.["limit"]).toBe(16385);
  });

  test("maxCostUSD rejects a request whose worst case exceeds it", () => {
    const params = {
      model: "anthropic/claude-opus-5" as const,
      messages: MESSAGES,
      // 100k output tokens at $25/M = $2.50 worst case.
      maxOutputTokens: 100_000,
    };
    expect(chat.safe(params).ok).toBe(true);

    const outcome = chat.safe(params, { maxCostUSD: 0.01 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const issue = outcome.errors.find((e) => e.code === "over_budget");
    expect(issue?.meta?.["limit"]).toBe(0.01);
    expect(issue?.message).toContain("maxCostUSD");
  });
});

describe("options.catalog", () => {
  /**
   * A one-row override. The realistic use is pinning a snapshot or adding a
   * model that shipped after unmodel's — here it also proves the override
   * *replaces* the bundled table rather than layering on top of it, which is
   * the behaviour a caller pinning a snapshot needs.
   */
  const OVERRIDE: ChatCatalog = {
    openai: {
      "gpt-3.5-turbo": {
        attachment: true,
        reasoning: true,
        toolCall: true,
        structuredOutput: true,
        temperature: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 100_000 },
        cost: { input: 0, output: 0 },
      },
    },
  };

  test("it wins over the bundled table", () => {
    const params = {
      model: LEGACY,
      messages: MESSAGES,
      tools: { weather: { inputSchema: { type: "object" } } },
      maxOutputTokens: 8192,
      reasoning: "high" as const,
    };
    expect(chat.safe(params).ok).toBe(false);

    const overridden = chat.safe(params, { catalog: OVERRIDE });
    expect(overridden.ok, JSON.stringify(errorsOf(overridden))).toBe(true);
    if (!overridden.ok) return;
    // Not deprecated in the override, so no deprecation warning either.
    expect(overridden.warnings.map((w) => w.code)).not.toContain("deprecated_model");
  });

  test("a model the override omits is unknown, even if the bundled table has it", () => {
    const outcome = chat.safe(
      { model: "anthropic/claude-opus-5", messages: MESSAGES, maxOutputTokens: 64 },
      { catalog: OVERRIDE },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });
});
