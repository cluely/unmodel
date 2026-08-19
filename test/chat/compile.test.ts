/**
 * The compile step, end to end: one request, three dialects, byte-for-byte.
 *
 * `golden.test.ts` proves the *encoder* lands on the right IR and
 * `test/interop/golden.test.ts` proves the decoders land on the right bodies —
 * so what is left to assert here is the join: that `chat()` produces exactly
 * the body a hand-written request to that provider would have, at exactly the
 * right URL, with the right headers, and with an honest `warnings` list.
 *
 * The first two cases are the design's own worked example: the same request
 * object, with only `model` changed, has to come out as Anthropic's
 * `max_tokens` + `thinking` and as OpenAI's `max_completion_tokens` +
 * `reasoning_effort`. If that is not true the feature has no reason to exist.
 */
import { describe, expect, test } from "bun:test";

import { chat } from "../../src/chat/index";

const PROMPT = "Explain retargeting.";

/**
 * The enumerable half of a result — i.e. the fetch body.
 *
 * Taking `object` rather than the result type is what erases the declared
 * non-enumerable members (`toSdk`, `request`, `warnings`, …) from the spread's
 * *type*. They are already absent at runtime; this keeps `toEqual` comparing
 * the same thing the type checker thinks it is comparing.
 */
const body = (result: object): Record<string, unknown> => ({ ...result });

describe("the worked example", () => {
  test("anthropic/claude-opus-5 compiles to the /v1/messages body, warning-free", () => {
    const result = chat({
      model: "anthropic/claude-opus-5",
      messages: [{ role: "user", content: PROMPT }],
      reasoning: { budgetTokens: 2048 },
      maxOutputTokens: 4096,
    });

    // Enumerable properties ARE the wire body — `toSdk`, `request`, `warnings`,
    // `target` and `modelId` are all non-enumerable, so this deep-equals the
    // JSON that goes on the wire.
    expect(body(result)).toEqual({
      model: "claude-opus-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }] }],
      thinking: { type: "enabled", budget_tokens: 2048 },
    });
    expect(result.request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(result.request.method).toBe("POST");
    expect(result.request.headers["anthropic-version"]).toBe("2023-06-01");
    // A token budget is exactly what Anthropic's thinking takes, so nothing was
    // approximated and nothing was dropped.
    expect(result.warnings).toEqual([]);
    expect(result.target).toBe("anthropic");
    expect(result.modelId).toBe("claude-opus-5");
  });

  test("the same params with openai/gpt-5.2 compile to chat-completions", () => {
    const result = chat({
      model: "openai/gpt-5.2",
      messages: [{ role: "user", content: PROMPT }],
      reasoning: { budgetTokens: 2048 },
      maxOutputTokens: 4096,
    });

    expect(body(result)).toEqual({
      model: "gpt-5.2",
      messages: [{ role: "user", content: PROMPT }],
      max_completion_tokens: 4096,
      reasoning_effort: "low",
    });
    expect(result.request.url).toBe("https://api.openai.com/v1/chat/completions");
    // chat-completions has no token budget, so bucketing 2048 tokens into an
    // effort level is a real loss and must be named.
    expect(result.warnings.map((w) => w.code)).toEqual(["approximated_param"]);
    expect(result.warnings[0]?.message).toContain("reasoning_effort");
  });
});

describe("the wire body is the whole body", () => {
  test("JSON.stringify is the fetch body on every dialect", () => {
    for (const model of ["anthropic/claude-opus-5", "openai/gpt-5.2", "google/gemini-2.5-flash"]) {
      const result = chat({ model, messages: [{ role: "user", content: "hi" }] });
      const parsed = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
      for (const hidden of ["toSdk", "request", "warnings", "target", "modelId"]) {
        expect(Object.keys(parsed), `${model} leaked ${hidden}`).not.toContain(hidden);
      }
      expect(Object.keys(parsed).length).toBeGreaterThan(0);
    }
  });

  test("gemini carries no `model` — it lives in the URL", () => {
    const result = chat({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(Object.keys(body(result))).not.toContain("model");
    expect(result.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    // …and `modelId` is the only way to read it back.
    expect(result.modelId).toBe("gemini-2.5-flash");
  });

  test("no `toApi` — a unified result has no dialect to leave", () => {
    const result = chat({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
    });
    expect("toApi" in result).toBe(false);
    expect("toApiSafe" in result).toBe(false);
  });
});

describe("toSdk", () => {
  test("the identity dialects hand back the wire body itself", () => {
    const anthropic = chat({
      model: "anthropic/claude-opus-5",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 16,
    });
    expect(anthropic.toSdk("anthropic")).toEqual(body(anthropic) as never);

    const openai = chat({
      model: "openai/gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(openai.toSdk("openai")).toEqual(body(openai) as never);
  });

  test("gemini reshapes into @google/genai's { model, contents, config }", () => {
    const result = chat({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 128,
      system: "Be brief.",
    });
    expect(result.toSdk("google")).toEqual({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      config: {
        maxOutputTokens: 128,
        systemInstruction: { parts: [{ text: "Be brief." }] },
      },
    });
  });

  test("ai-sdk is on every dialect and carries its own warnings", () => {
    const result = chat({
      model: "anthropic/claude-opus-5",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 64,
      reasoning: { budgetTokens: 1024 },
    });
    const options = result.toSdk("ai-sdk");
    expect(options.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
    expect(options.maxOutputTokens).toBe(64);
    expect(options.providerOptions).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 1024 } },
    });
    // Spreading the options into `generateText` must carry the options only.
    expect(Object.keys({ ...options })).not.toContain("warnings");
    expect(options.warnings).toEqual([]);
  });

  test("an unknown target names the ones that exist", () => {
    const result = chat({
      model: "openai/gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(() => (result.toSdk as (t: string) => unknown)("anthropic")).toThrow(
      /is not an SDK target/,
    );
  });
});
