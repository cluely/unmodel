import { describe, expect, test } from "bun:test";
import { CHAT_COMPLETIONS_URL, chat, checkChat, models } from "./index";

describe("perplexity", () => {
  test("chat URL is the OpenAI-compatible route on api.perplexity.ai", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.perplexity.ai/chat/completions");
  });

  test("a catalog model validates wire-pure", () => {
    const params = {
      model: "sonar" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    expect(models[params.model]).toBeDefined();

    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the perplexity catalog", () => {
    const r = chat.safe({
      model: "not-a-perplexity-model",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the perplexity catalog");
    }
  });

  test("logit_bias/n pass through without errors (unproven for /chat/completions — no deny shipped)", () => {
    const r = chat.safe({
      model: "sonar",
      messages: [{ role: "user", content: "hi" }],
      logit_bias: { "50256": -100 },
      n: 2,
    });
    expect(r.ok).toBe(true);
  });

  test("checkChat maps usage for a minimal response", () => {
    const report = checkChat({
      model: "sonar",
      choices: [{ finish_reason: "stop", message: { refusal: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({ inputTokens: 100, outputTokens: 10, totalTokens: 110 });
  });
});
