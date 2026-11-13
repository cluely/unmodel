import { describe, expect, test } from "bun:test";
import { createAzure, azureChatCompletionsUrl, chatModels, models, type AzureTextModelId } from "./index";

const azure = createAzure({ endpoint: "https://my-resource.openai.azure.com" });

function userMessage(text: string) {
  return { role: "user" as const, content: text };
}

describe("azure URL construction", () => {
  test("v1 route: endpoint + /openai/v1/chat/completions, no api-version by default", () => {
    expect(azure.chatUrl).toBe("https://my-resource.openai.azure.com/openai/v1/chat/completions");
  });

  test("trailing slashes on the endpoint are stripped", () => {
    const a = createAzure({ endpoint: "https://my-resource.openai.azure.com/" });
    expect(a.chatUrl).toBe("https://my-resource.openai.azure.com/openai/v1/chat/completions");
  });

  test("apiVersion is appended (URL-encoded) as a query param", () => {
    const a = createAzure({
      endpoint: "https://my-resource.services.ai.azure.com",
      apiVersion: "preview",
    });
    expect(a.chatUrl).toBe(
      "https://my-resource.services.ai.azure.com/openai/v1/chat/completions?api-version=preview",
    );
    expect(azureChatCompletionsUrl("https://x.openai.azure.com", "a b")).toBe(
      "https://x.openai.azure.com/openai/v1/chat/completions?api-version=a%20b",
    );
  });

  test("instances are independent: each carries its own URL", () => {
    const other = createAzure({ endpoint: "https://other.openai.azure.com" });
    const a = azure.chat({ model: "gpt-5", messages: [userMessage("hi")] });
    const b = other.chat({ model: "gpt-5", messages: [userMessage("hi")] });
    expect(a.request.url).toBe("https://my-resource.openai.azure.com/openai/v1/chat/completions");
    expect(b.request.url).toBe("https://other.openai.azure.com/openai/v1/chat/completions");
  });
});

describe("azure wire body (OpenAI Chat Completions dialect)", () => {
  test("enumerable props are the exact wire body; request carries url/method/headers", () => {
    const params = {
      model: "gpt-5" as const,
      messages: [userMessage("hi")],
      max_completion_tokens: 128,
    };
    const v = azure.chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages", "max_completion_tokens"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    // The chat-completions dialect's SDK params are wire-shaped, and the
    // target id for every OpenAI-compatible overlay (azure included) is
    // "openai" — you use the `openai` npm client with a custom baseURL.
    expect(v.toSdk("openai")).toEqual(params);
    expect(v.request.method).toBe("POST");
    expect(v.request.url).toBe(azure.chatUrl);
    expect(v.request.headers).toEqual({ "content-type": "application/json" });
  });

  test("typo'd top-level keys are a compile error (ExactKeys)", () => {
    // @ts-expect-error — `max_output_tokens` is not a Chat Completions param
    const r = azure.chat.safe({ model: "gpt-5", messages: [userMessage("hi")], max_output_tokens: 5 });
    expect(r.ok).toBe(true);
  });
});

describe("azure deployment-name catalog matching", () => {
  test("a deployment named exactly after a model gets full catalog checks", () => {
    // gpt-5 has temperature: false in the catalog — only the default 1 passes.
    const r = azure.chat.safe({ model: "gpt-5", messages: [userMessage("hi")], temperature: 0.2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["temperature"]);
    }
  });

  test("prefixed deployment names resolve best-effort (gpt-5-prod → gpt-5)", () => {
    const r = azure.chat.safe({
      model: "gpt-5-prod",
      messages: [userMessage("hi")],
      max_completion_tokens: 200000, // over gpt-5's 128000 output limit
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
    }
  });

  test("date-suffixed deployment names resolve (gpt-5-2025-08-07 → gpt-5)", () => {
    const r = azure.chat.safe({
      model: "gpt-5-2025-08-07",
      messages: [userMessage("hi")],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
  });

  test("custom deployment names get an unknown_model warning, checks skipped", () => {
    const r = azure.chat.safe({
      model: "my-custom-deploy",
      messages: [userMessage("hi")],
      temperature: 0.2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the azure catalog");
    }
  });

  test("estimate prices against the resolved catalog entry", () => {
    // "hello world!" = 3 heuristic tokens + 4 message overhead = 7.
    const r = azure.chat.safe({
      model: "gpt-5-prod",
      messages: [userMessage("hello world!")],
      max_completion_tokens: 100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.inputTokens).toBe(7);
      // gpt-5: $1.25/M input, $10/M output.
      expect(r.estimate.costUSD).toBeCloseTo((7 * 1.25 + 100 * 10) / 1e6, 12);
    }
  });
});

describe("azure catalog rows from the 2026-11-12 models.dev slice", () => {
  // [deployment name, $/1M input + $/1M output, or undefined when the row is unpriced]
  const NEW_CHAT_ROWS: ReadonlyArray<readonly [AzureTextModelId, number | undefined]> = [
    ["deepseek-v4.1-flash", 0.3 + 1.2],
    ["gpt-6-astra", 10 + 50],
    ["gpt-6-sol", 2 + 10],
    ["gpt-6-luna", 0.1 + 0.5],
    ["gpt-6.1-sol", 2 + 10],
    ["gpt-6.1-terra", 1 + 5],
    ["grok-4.6", 2 + 6],
    // models.dev's azure row carries no cost for grok-4.7: unpriced, never guessed.
    ["grok-4.7", undefined],
  ];

  test.each(NEW_CHAT_ROWS)("%s validates against its own row and prices", (model, perMillion) => {
    const r = azure.chat.safe({ model, messages: [userMessage("hi")] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
    const report = azure.checkChat({
      model,
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
    });
    if (perMillion === undefined) expect(report.costUSD).toBeUndefined();
    else expect(report.costUSD).toBeCloseTo(perMillion, 10);
  });
});

describe("azure chatModels: Azure's documented corrections to generated rows", () => {
  test.each(["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6.1-sol", "gpt-6.1-terra"] as const)(
    "%s takes temperature and top_p (Azure's GPT-6 feature table)",
    (model) => {
      expect(models[model].temperature).toBe(false);
      expect(chatModels[model].temperature).toBe(true);
      const r = azure.chat.safe({ model, messages: [userMessage("hi")], temperature: 0.2, top_p: 0.5 });
      expect(r.ok).toBe(true);
    },
  );

  test("the GPT-5.6 sibling keeps its fixed sampling: temperature other than 1 is refused", () => {
    const r = azure.chat.safe({ model: "gpt-5.6-sol", messages: [userMessage("hi")], temperature: 0.2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["temperature"]);
    }
  });

  test("deepseek-v4.1-flash takes Azure's 384,000-token output, and refuses past it", () => {
    expect(models["deepseek-v4.1-flash"].limit.output).toBe(128000);
    const ok = azure.chat.safe({
      model: "deepseek-v4.1-flash",
      messages: [userMessage("hi")],
      max_completion_tokens: 384_000,
    });
    expect(ok.ok).toBe(true);
    const over = azure.chat.safe({
      model: "deepseek-v4.1-flash",
      messages: [userMessage("hi")],
      max_completion_tokens: 384_001,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.code).toBe("over_output_limit");
  });
});

describe("azure checkChat", () => {
  test("prices response usage via the same best-effort resolution", () => {
    const report = azure.checkChat({
      model: "gpt-5-2025-08-07",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
    });
    expect(report.costUSD).toBeCloseTo(1.25, 10);
    expect(report.warnings).toEqual([]);
  });

  test("never throws on empty responses", () => {
    const report = azure.checkChat({});
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({});
  });
});
