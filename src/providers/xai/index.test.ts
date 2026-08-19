import { describe, expect, test } from "bun:test";
import { chat, checkChat, CHAT_COMPLETIONS_URL } from "./index";

describe("unmodel/xai", () => {
  test("chat URL is the documented endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.x.ai/v1/chat/completions");
  });

  test("a catalog grok model validates ok and the result is wire-pure", () => {
    const params = {
      model: "grok-4.6" as const,
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

  test("unknown model warns and names the xai catalog", () => {
    const r = chat.safe({
      model: "grok-99-preview",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("xai");
    }
  });

  test("penalties are denied on reasoning models but fine on non-reasoning ones", () => {
    const denied = chat.safe({
      model: "grok-4.6",
      messages: [{ role: "user", content: "hi" }],
      presence_penalty: 0.5,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      const issue = denied.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["presence_penalty"]);
      expect(issue?.meta?.source).toContain("docs.x.ai");
    }

    const allowed = chat.safe({
      model: "grok-4.20-0309-non-reasoning",
      messages: [{ role: "user", content: "hi" }],
      presence_penalty: 0.5,
    });
    expect(allowed.ok).toBe(true);
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "grok-4.6",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
  });
});
