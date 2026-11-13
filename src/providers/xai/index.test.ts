import { describe, expect, test } from "bun:test";
import { chat, checkChat, CHAT_COMPLETIONS_URL, models } from "./index";

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

describe("grok-4.7", () => {
  test("validates with no warnings, including reasoning_effort xhigh", () => {
    // "- **Reasoning efforts (supported):** `low`, `medium`, `high`, `xhigh`"
    // — https://docs.x.ai/developers/models/grok-4.7 (2026-11-12).
    const r = chat.safe({
      model: "grok-4.7",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "xhigh",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("prices at $2.00 input / $0.50 cached / $6.00 output per 1M", () => {
    // "| grok-4.7 (< 200k prompt tokens) | 500k | $2.00 | $0.50 | $6.00 |"
    // — https://docs.x.ai/developers/models (2026-11-12).
    expect(models["grok-4.7"].cost).toEqual({ input: 2, output: 6, cacheRead: 0.5 });
    const report = checkChat({
      model: "grok-4.7",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
    });
    expect(report.costUSD).toBeCloseTo(8, 10);
  });

  test("is a reasoning model: penalties and stop are refused", () => {
    // "`presencePenalty`, `frequencyPenalty`, and `stop` cannot be used with
    // reasoning models. Requests that include them return an error."
    // — https://docs.x.ai/developers/model-capabilities/text/reasoning (2026-11-12).
    const messages = [{ role: "user" as const, content: "hi" }];
    const refused = [
      chat.safe({ model: "grok-4.7", messages, frequency_penalty: 0.5 }),
      chat.safe({ model: "grok-4.7", messages, presence_penalty: 0.5 }),
      chat.safe({ model: "grok-4.7", messages, stop: ["END"] }),
    ];
    expect(
      refused.map((r) => (r.ok ? [] : r.errors.map((e) => [e.code, ...e.path]))),
    ).toEqual([
      [["unsupported_param", "frequency_penalty"]],
      [["unsupported_param", "presence_penalty"]],
      [["unsupported_param", "stop"]],
    ]);
    // The cited page states the fact: "* `stop` (array | null) — (Not
    // supported by reasoning models)".
    for (const r of refused) {
      if (!r.ok) {
        expect(r.errors[0]?.meta?.source).toContain(
          "https://docs.x.ai/developers/rest-api-reference/inference/chat-completions",
        );
      }
    }
  });
});
