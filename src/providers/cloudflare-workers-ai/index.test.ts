import { describe, expect, test } from "bun:test";
import { createCloudflare, models } from "./index";

const ACCOUNT_ID = "023e105f4ecef8ad9ca31a8372d0c353";
const { chat, chatUrl, checkChat } = createCloudflare(ACCOUNT_ID);

describe("cloudflare-workers-ai", () => {
  test("chat URL embeds the account id per the OpenAI-compatibility docs", () => {
    expect(chatUrl).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/v1/chat/completions`,
    );
  });

  test("a catalog model validates wire-pure", () => {
    const params = {
      model: "@cf/openai/gpt-oss-120b" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    expect(models[params.model]).toBeDefined();

    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(chatUrl);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the cloudflare-workers-ai catalog", () => {
    const r = chat.safe({
      model: "@cf/not/a-real-model",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("cloudflare-workers-ai");
    }
  });

  test("checkChat maps usage for a minimal response", () => {
    const report = checkChat({
      model: "@cf/openai/gpt-oss-120b",
      choices: [{ finish_reason: "stop", message: { refusal: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({ inputTokens: 100, outputTokens: 10, totalTokens: 110 });
  });
});
