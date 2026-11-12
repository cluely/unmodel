import { describe, expect, test } from "bun:test";
import { chat, chatModels, CHAT_COMPLETIONS_URL, checkChat } from "./index";

describe("unmodel/mistral", () => {
  test("CHAT_COMPLETIONS_URL targets Mistral's chat completions endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.mistral.ai/v1/chat/completions");
  });

  test("a catalog model validates and stays wire-pure", () => {
    const params = {
      model: "mistral-small-latest" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the mistral catalog", () => {
    const r = chat.safe({ model: "totally-unknown-model", messages: [{ role: "user", content: "hi" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the mistral catalog");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "mistral-small-latest",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.costUSD).toBeGreaterThan(0);
    expect(report.warnings).toEqual([]);
  });
});

const hi = [{ role: "user" as const, content: "hi" }];

/** USD for 1M input + 1M output tokens, as `checkChat` prices it. */
function millionEachUSD(model: string): number | undefined {
  return checkChat({
    model,
    choices: [{ finish_reason: "stop" }],
    usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
  }).costUSD;
}

describe("mistral.chat — the 2026-11 models", () => {
  test.each([
    ["codestral-2508", 0.3 + 0.9],
    ["ministral-14b-2512", 0.2 + 0.2],
    ["ministral-8b-2512", 0.15 + 0.15],
    ["ministral-3b-2512", 0.1 + 0.1],
    ["deepseek-v4-1-flash-1017", 0.3 + 1.2],
    ["mistral-large-4", 0.7 + 2.1],
    ["zai-glm-5-3", 1.4 + 4.4],
    ["zai-glm-5-3-flash", 0.15 + 0.5],
    // Vendor aliases models.dev does not carry, priced as the model they serve.
    ["mistral-large-4-0", 0.7 + 2.1],
    ["ministral-14b-latest", 0.2 + 0.2],
    ["zai-glm-5", 1.4 + 4.4],
    ["zai-glm-latest", 1.4 + 4.4],
    ["mistral-medium-3-5", 1.5 + 7.5],
    ["mistral-medium-3", 1.5 + 7.5],
  ])("%s validates and prices at its card rate", (model, usd) => {
    const r = chat.safe({ model, messages: hi });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const deprecated = model.startsWith("mistral-medium-3");
      expect(r.warnings.map((w) => w.code)).toEqual(deprecated ? ["deprecated_model"] : []);
    }
    expect(millionEachUSD(model)).toBeCloseTo(usd, 10);
  });

  test("Mistral Large 4 is GA and open-weight, as its card says", () => {
    expect(chatModels["mistral-large-4"].openWeights).toBe(true);
    expect("status" in chatModels["mistral-large-4"]).toBe(false);
    expect(chatModels["mistral-large-4-0"].openWeights).toBe(true);
  });

  test("Ministral 3 3B carries its 256k window, under both ids", () => {
    expect(chatModels["ministral-3b-2512"].limit.context).toBe(262_144);
    expect(chatModels["ministral-3b-latest"].limit.context).toBe(262_144);
  });

  test.each(["mistral-large-2512", "mistral-medium-latest", "mistral-medium-2604"])(
    "%s is deprecated in favour of Mistral Large 4 and warns",
    (model) => {
      const r = chat.safe({ model, messages: hi });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    },
  );

  test("DeepSeek V4.1 Flash takes image parts", () => {
    const r = chat.safe({
      model: "deepseek-v4-1-flash-1017",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe("mistral.chat reasoning_effort ladders", () => {
  test.each(["mistral-large-4", "mistral-large-4-0", "mistral-large-latest"])(
    "%s takes low/medium/high and refuses none",
    (model) => {
      for (const effort of ["low", "medium", "high"]) {
        expect(chat.safe({ model, messages: hi, reasoning_effort: effort }).ok).toBe(true);
      }
      const r = chat.safe({ model, messages: hi, reasoning_effort: "none" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_enum_value");
        expect(r.errors[0]?.path).toEqual(["reasoning_effort"]);
        expect(r.errors[0]?.message).toContain('"low", "medium", "high"');
      }
    },
  );

  test.each(["zai-glm-5-3", "zai-glm-5", "zai-glm-latest", "zai-glm-5-3-flash"])(
    "%s takes low/high/max and refuses none and medium",
    (model) => {
      for (const effort of ["low", "high", "max"]) {
        expect(chat.safe({ model, messages: hi, reasoning_effort: effort }).ok).toBe(true);
      }
      for (const effort of ["none", "medium"]) {
        const r = chat.safe({ model, messages: hi, reasoning_effort: effort });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0]?.message).toContain('"low", "high", "max"');
      }
    },
  );

  test("mistral-large-latest is Large 4: a reasoning model with a 1M window at Large 4 rates", () => {
    expect(chatModels["mistral-large-latest"].reasoning).toBe(true);
    expect(chatModels["mistral-large-latest"].limit.context).toBe(1_048_576);
    expect(millionEachUSD("mistral-large-latest")).toBeCloseTo(0.7 + 2.1, 10);
    const r = chat.safe({ model: "mistral-large-latest", messages: hi, reasoning_effort: "high" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("models without a documented ladder keep the whole enum", () => {
    expect(chat.safe({ model: "mistral-small-latest", messages: hi, reasoning_effort: "none" }).ok).toBe(true);
  });
});
