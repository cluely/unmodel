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

  // models.dev marks every sonar row deprecated (snapshot 2026-11-12), and they
  // stay reachable: "Sonar Chat Completions support ended on September 27,
  // 2026. Synchronous and streaming requests keep working: they are being
  // reformulated as Agent API requests"
  // (https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview, 2026-11-12).
  test("every sonar id still validates, warning deprecated_model", () => {
    for (const model of ["sonar", "sonar-pro", "sonar-reasoning-pro", "sonar-deep-research"] as const) {
      expect(models[model].status).toBe("deprecated");
      const r = chat.safe({ model, messages: [{ role: "user", content: "hi" }] });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    }
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

  // The sample response on https://docs.perplexity.ai/docs/legacy/sonar/models/sonar
  // (2026-11-12): token rates alone price it at $0.000411; the billed total
  // includes the search fee, "1 request × $5 ÷ 1,000 = $0.005".
  test("checkChat reports the billed usage.cost.total_cost, search fee included", () => {
    const response = {
      model: "sonar",
      choices: [{ finish_reason: "stop", message: { refusal: null } }],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 402,
        total_tokens: 411,
        search_context_size: "low",
        cost: { input_tokens_cost: 0.0, output_tokens_cost: 0.0, request_cost: 0.005, total_cost: 0.005 },
      },
    };
    const report = checkChat(response);
    expect(report.costUSD).toBe(0.005);
    expect(report.usage).toEqual({ inputTokens: 9, outputTokens: 402, totalTokens: 411 });
  });

  // The sample response on
  // https://docs.perplexity.ai/docs/legacy/sonar/models/sonar-deep-research
  // (2026-11-12): reasoning tokens sit at the top level of `usage`, outside
  // `total_tokens`, and are billed ("193,947 tokens ÷ 1,000,000 × $3 = $0.581841").
  test("checkChat reads top-level usage.reasoning_tokens and the billed deep-research total", () => {
    const response = {
      model: "sonar-deep-research",
      choices: [{ finish_reason: "stop", message: { refusal: null } }],
      usage: {
        prompt_tokens: 33,
        completion_tokens: 11395,
        total_tokens: 11428,
        citation_tokens: 19028,
        num_search_queries: 21,
        reasoning_tokens: 193947,
        cost: {
          input_tokens_cost: 0.0,
          output_tokens_cost: 0.091,
          citation_tokens_cost: 0.038,
          reasoning_tokens_cost: 0.582,
          search_queries_cost: 0.105,
          total_cost: 0.816,
        },
      },
    };
    const report = checkChat(response);
    expect(report.costUSD).toBe(0.816);
    expect(report.usage).toEqual({
      inputTokens: 33,
      outputTokens: 11395,
      totalTokens: 11428,
      reasoningTokens: 193947,
    });
  });

  test("checkChat omits costUSD when usage.cost is absent, rather than pricing tokens only", () => {
    const report = checkChat({
      model: "sonar",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 9, completion_tokens: 402, total_tokens: 411 },
    });
    expect(report.costUSD).toBeUndefined();
    expect(report.usage.totalTokens).toBe(411);
  });
});
