import { describe, expect, test } from "bun:test";
import { CHAT_COMPLETIONS_URL, chat, checkChat, models } from "./index";

describe("nvidia", () => {
  test("chat URL is the documented OpenAI-compatible route", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
  });

  test("a catalog model validates wire-pure", () => {
    const params = {
      model: "meta/llama-3.3-70b-instruct" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    expect(models[params.model]).toBeDefined();

    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the nvidia catalog", () => {
    const r = chat.safe({
      model: "not-an-nvidia-model",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the nvidia catalog");
    }
  });

  test("checkChat maps usage for a minimal response", () => {
    const report = checkChat({
      model: "meta/llama-3.3-70b-instruct",
      choices: [{ finish_reason: "stop", message: { refusal: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({ inputTokens: 100, outputTokens: 10, totalTokens: 110 });
  });
});
