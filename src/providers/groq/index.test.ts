import { describe, expect, test } from "bun:test";
import { chat, checkChat, CHAT_COMPLETIONS_URL } from "./index";

describe("unmodel/groq", () => {
  test("chat URL is the documented OpenAI-compatible endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  test("a catalog model validates ok and the result is wire-pure", () => {
    const params = {
      model: "llama-3.1-8b-instant" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const r = chat.safe(params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(Object.keys(r.params)).toEqual(["model", "messages"]);
      expect(JSON.parse(JSON.stringify(r.params))).toEqual(params);
      expect(r.params.request.url).toBe(CHAT_COMPLETIONS_URL);
      expect(r.params.request.method).toBe("POST");
    }
  });

  test("unknown model warns and names the groq catalog", () => {
    const r = chat.safe({
      model: "llama-99-preview",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("groq");
    }
  });

  test("logit_bias is denied per Groq's OpenAI-compatibility docs", () => {
    const r = chat.safe({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
      logit_bias: { "1234": -100 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["logit_bias"]);
      expect(issue?.meta?.source).toContain("console.groq.com");
    }
  });

  test("messages[].name is denied per Groq's OpenAI-compatibility docs", () => {
    const r = chat.safe({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "hi", name: "alice" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["messages", 0, "name"]);
      expect(r.errors[0]?.meta?.source).toContain("console.groq.com");
    }
  });

  test("n must equal 1 if supplied", () => {
    const r = chat.safe({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
      n: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "llama-3.1-8b-instant",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
  });
});
