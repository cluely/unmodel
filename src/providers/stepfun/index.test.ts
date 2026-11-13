import { describe, expect, test } from "bun:test";
import { chat, checkChat, CHAT_COMPLETIONS_URL, models } from "./index";

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

  test("step-5-preview validates clean and prices from its catalog row", () => {
    const r = chat.safe({
      model: "step-5-preview",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 65536,
      reasoning_effort: "high",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.estimate.costUSD).toBeGreaterThan(0);
    }
  });

  test("step-5-preview: max_tokens past the 64k output limit is over_output_limit", () => {
    const r = chat.safe({
      model: "step-5-preview",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 65537,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_output_limit");
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

/**
 * Cache hits. StepFun's prompt-cache guide reports them at the TOP level —
 * "A positive `response.usage.cached_tokens` value indicates a cache hit"
 * (https://platform.stepfun.ai/docs/en/guides/developer/prompt-cache.md,
 * 2026-11-12) — while its China chat reference nests them under
 * `prompt_tokens_details`, OpenAI's spelling. Both must price at the
 * cache-read rate; when both arrive, the nested one wins.
 */
describe("stepfun.checkChat cached tokens", () => {
  // step-5-preview: input 1.04613, cacheRead 0.10461, output 2.98895 per 1M —
  // 100 uncached + 900 cached input tokens, 10 output tokens.
  const CACHED_COST = (100 * 1.04613 + 900 * 0.10461 + 10 * 2.98895) / 1e6;

  test("the top-level `usage.cached_tokens` is read and priced at the cache-read rate", () => {
    const report = checkChat({
      model: "step-5-preview",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 10, cached_tokens: 900 },
    });
    expect(report.usage.cachedInputTokens).toBe(900);
    expect(report.costUSD).toBeCloseTo(CACHED_COST, 12);
  });

  test("the nested `prompt_tokens_details.cached_tokens` prices the same", () => {
    const report = checkChat({
      model: "step-5-preview",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 900 } },
    });
    expect(report.usage.cachedInputTokens).toBe(900);
    expect(report.costUSD).toBeCloseTo(CACHED_COST, 12);
  });

  test("with both present, the nested value wins", () => {
    const report = checkChat({
      model: "step-5-preview",
      choices: [{ finish_reason: "stop" }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 10,
        cached_tokens: 100,
        prompt_tokens_details: { cached_tokens: 900 },
      },
    });
    expect(report.usage.cachedInputTokens).toBe(900);
    expect(report.costUSD).toBeCloseTo(CACHED_COST, 12);
  });
});

/**
 * "Models that support three reasoning tiers accept `low`, `medium`, `high`;
 * `step-3.5-flash-2603` accepts `low` and `high` only."
 * (https://platform.stepfun.ai/docs/en/api-reference/chat/chat-completion-create.md,
 * 2026-11-12).
 */
describe("stepfun.chat reasoning_effort ladder", () => {
  const messages = [{ role: "user" as const, content: "hi" }];

  test("step-3.5-flash-2603 takes low and high", () => {
    for (const reasoning_effort of ["low", "high"] as const) {
      const r = chat.safe({ model: "step-3.5-flash-2603", messages, reasoning_effort });
      expect(r.ok, reasoning_effort).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("medium on step-3.5-flash-2603 is invalid_enum_value", () => {
    const r = chat.safe({ model: "step-3.5-flash-2603", messages, reasoning_effort: "medium" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["reasoning_effort"]);
    }
  });

  test("medium on step-5-preview stays clean", () => {
    const r = chat.safe({ model: "step-5-preview", messages, reasoning_effort: "medium" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

/**
 * The substrate signpost for the catalog's ASR row, and its agreement with the
 * data file that withdraws the `unmodel/chat` ref — the openai.chat pattern
 * (src/providers/openai/chat.test.ts).
 */
describe("stepfun.chat non-chat route signpost", () => {
  const messages = [{ role: "user" as const, content: "hi" }];

  test("stepaudio-2.5-asr warns, names the ASR route, and is still sent as written", () => {
    const r = chat.safe({ model: "stepaudio-2.5-asr", messages });
    // A WARNING, not an error: the substrate never refuses what the API might fulfil.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const signpost = r.warnings.find((issue) => issue.code === "unsupported_capability");
    expect(signpost?.path).toEqual(["model"]);
    expect(signpost?.model).toBe("stepaudio-2.5-asr");
    expect(signpost?.message).toContain("POST /v1/audio/asr/sse");
    expect(signpost?.message).toContain("not POST /v1/chat/completions");
    expect(signpost?.message).toContain("unmodel has no validator");
    expect(signpost?.meta?.source).toBe(
      "https://platform.stepfun.ai/docs/en/api-reference/audio/asr-sse.md",
    );
    expect(r.params.request.url).toBe(CHAT_COMPLETIONS_URL);
  });

  test("the runtime table and `chatScopeExclude` name the same rows", async () => {
    const overrides = (await Bun.file(
      new URL("../../../data/availability-overrides.json", import.meta.url).pathname,
    ).json()) as { chatScopeExclude: string[] };
    const globs = overrides.chatScopeExclude
      .filter((ref) => ref.startsWith("stepfun:"))
      .map((ref) => {
        const body = ref
          .slice("stepfun:".length)
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*");
        return new RegExp(`^${body}$`);
      });
    // Drift in either direction is a silent hole: a ref that compiles to a
    // request the chat route cannot serve, or a warning on a model that works.
    const textOut = Object.values(models)
      .filter((info) => (info.modalities.output as readonly string[]).includes("text"))
      .map((info) => info.id);
    const excludedByData = textOut.filter((id) => globs.some((re) => re.test(id))).sort();
    const warnedByCheck = textOut
      .filter((id) => {
        const r = chat.safe({ model: id, messages });
        return r.warnings.some(
          (issue) => issue.code === "unsupported_capability" && issue.path[0] === "model",
        );
      })
      .sort();
    expect(warnedByCheck).toEqual(excludedByData);
    expect(warnedByCheck).toEqual(["stepaudio-2.5-asr"]);
  });
});
