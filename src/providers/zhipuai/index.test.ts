import { describe, expect, test } from "bun:test";
import { chat, CHAT_COMPLETIONS_URL, checkChat } from "./index";

describe("unmodel/zhipuai", () => {
  test("CHAT_COMPLETIONS_URL targets Zhipu AI's chat completions endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
  });

  test("a catalog model validates and stays wire-pure", () => {
    const params = {
      model: "glm-4.6" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the zhipuai catalog", () => {
    const r = chat.safe({ model: "totally-unknown-model", messages: [{ role: "user", content: "hi" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the zhipuai catalog");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "glm-4.6",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.costUSD).toBeGreaterThan(0);
    expect(report.warnings).toEqual([]);
  });
});
