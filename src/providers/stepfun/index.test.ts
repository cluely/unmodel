import { describe, expect, test } from "bun:test";
import { chat, checkChat, CHAT_COMPLETIONS_URL } from "./index";

describe("unmodel/stepfun", () => {
  test("chat URL comes from the catalog's api field", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.stepfun.com/v1/chat/completions");
  });

  test("a catalog model validates ok and the result is wire-pure", () => {
    const params = {
      model: "step-3.5-flash" as const,
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

  test("unknown model warns and names the stepfun catalog", () => {
    const r = chat.safe({
      model: "step-99-turbo",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("stepfun");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "step-3.5-flash",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
  });
});
