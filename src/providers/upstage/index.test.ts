import { describe, expect, test } from "bun:test";
import { chat, checkChat, CHAT_COMPLETIONS_URL } from "./index";

describe("unmodel/upstage", () => {
  test("chat URL is the documented OpenAI-compatible endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.upstage.ai/v1/chat/completions");
  });

  test("a catalog model validates ok and the result is wire-pure", () => {
    const params = {
      model: "solar-pro4" as const,
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

  test("unknown model warns and names the upstage catalog", () => {
    const r = chat.safe({
      model: "solar-max-9000",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("upstage");
    }
  });

  // The live for-agents/raw URL serves a 404 page (checked 2026-11-12), so the
  // deny cites its last capture and names the replacement model.
  test("reasoning_effort is denied for the retired solar-mini, citing the archived reference", () => {
    const r = chat.safe({
      model: "solar-mini",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["reasoning_effort"]);
      expect(issue?.meta?.source).toStartWith(
        "https://web.archive.org/web/20260414103038/https://console.upstage.ai/api/docs/for-agents/raw",
      );
      expect(issue?.message).toContain("solar-mini4");
    }
  });

  test("reasoning_effort stays allowed on solar-pro4", () => {
    const r = chat.safe({
      model: "solar-pro4",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  // https://console.upstage.ai/docs/capabilities/generate/reasoning (checked
  // 2026-11-12): the matrix row for `solar-mini4` lists "`none`, `minimal`" as
  // turning reasoning off and "`low`, `medium`, `high`, `xhigh`, `max`" as
  // turning it on. Its id shares the solar-mini family's prefix, so this pins
  // that the family deny does not reach it.
  test("reasoning_effort stays allowed on solar-mini4 and its dated snapshot", () => {
    for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      const r = chat.safe({
        model: "solar-mini4",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: effort,
      });
      expect(r.ok, effort).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
    const snapshot = chat.safe({
      model: "solar-mini4-260922",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "max",
    });
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) expect(snapshot.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  // https://console.upstage.ai/docs/models/solar-mini-4 (checked 2026-11-12):
  // "## Max output tokens\n\n128K".
  test("max_tokens is capped at solar-mini4's 128K output ceiling", () => {
    const messages = [{ role: "user" as const, content: "hi" }];
    expect(chat.safe({ model: "solar-mini4", messages, max_tokens: 131_072 }).ok).toBe(true);
    const r = chat.safe({ model: "solar-mini4", messages, max_tokens: 131_073 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toEqual(["over_output_limit"]);
      expect(r.errors[0]?.path).toEqual(["max_tokens"]);
    }
  });

  // https://console.upstage.ai/docs/models/solar-mini-4 (checked 2026-11-12):
  // "$0.10/1M tokens (Input Token)", "$0.40/1M tokens (Output Token)",
  // "$0.01/1M tokens (Cached Token)".
  test("checkChat prices solar-mini4 at its list rates, dated snapshot included", () => {
    const report = checkChat({
      model: "solar-mini4-260922",
      choices: [{ finish_reason: "stop" }],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        total_tokens: 2_000_000,
        prompt_tokens_details: { cached_tokens: 400_000 },
      },
    });
    expect(report.warnings).toEqual([]);
    expect(report.costUSD).toBeCloseTo(0.6 * 0.1 + 0.4 * 0.01 + 1 * 0.4, 12);
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "solar-pro4",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
  });
});
