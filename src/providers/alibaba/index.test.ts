import { describe, expect, test } from "bun:test";
import { chat, CHAT_COMPLETIONS_URL, checkChat } from "./index";

describe("unmodel/alibaba", () => {
  test("CHAT_COMPLETIONS_URL targets DashScope's international compatible-mode endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
  });

  test("a catalog model validates and stays wire-pure", () => {
    const params = {
      model: "qwen-plus" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the alibaba catalog", () => {
    const r = chat.safe({ model: "totally-unknown-model", messages: [{ role: "user", content: "hi" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the alibaba catalog");
    }
  });

  test("the 2026-11 catalog additions validate and price from their rows", () => {
    const messages = [{ role: "user" as const, content: "hi" }];
    for (const model of ["qwen3.5-flash", "qwen3.7-flash", "qwen3.8-omni-flash", "kimi-k3"] as const) {
      const r = chat.safe({ model, messages });
      expect(r.ok, model).toBe(true);
      if (r.ok) expect(r.warnings, model).toEqual([]);
    }
    // 1M input + 1M output tokens at the row rates (USD per 1M tokens).
    const usage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 };
    const price = (model: string) =>
      checkChat({ model, choices: [{ finish_reason: "stop" }], usage }).costUSD;
    expect(price("qwen3.5-flash")).toBeCloseTo(0.1 + 0.4, 10);
    expect(price("qwen3.7-flash")).toBeCloseTo(0.03 + 0.13, 10);
    expect(price("qwen3.8-omni-flash")).toBeCloseTo(0.15 + 0.47, 10);
    expect(price("kimi-k3")).toBeCloseTo(3 + 15, 10);
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "qwen-plus",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.costUSD).toBeGreaterThan(0);
    expect(report.warnings).toEqual([]);
  });
});

describe("alibaba.chat per-model rules (checked 2026-11-12)", () => {
  const messages = [{ role: "user" as const, content: "hi" }];
  const safeUnchecked = chat.safe as unknown as (
    params: Record<string, unknown>,
  ) => ReturnType<typeof chat.safe>;

  test("kimi-k3 takes reasoning_effort max / high / low only", () => {
    expect(chat.safe({ model: "kimi-k3", messages, reasoning_effort: "max" }).ok).toBe(true);
    const r = chat.safe({ model: "kimi-k3", messages, reasoning_effort: "medium" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.meta?.allowed).toEqual(["max", "high", "low"]);
    }
  });

  test("kimi-k3 temperature stays with the catalog's fixed-sampling check", () => {
    expect(chat.safe({ model: "kimi-k3", messages, temperature: 1 }).ok).toBe(true);
    expect(chat.safe({ model: "kimi-k3", messages, temperature: 0.7 }).ok).toBe(false);
  });

  test("kimi-k3 ignores parallel_tool_calls: a warning, never a refusal", () => {
    const r = chat.safe({ model: "kimi-k3", messages, parallel_tool_calls: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(r.warnings[0]?.path).toEqual(["parallel_tool_calls"]);
    }
  });

  test("kimi-k3 accepts its documented top_p default 0.95 (and 1), refuses other values", () => {
    const documented = chat.safe({ model: "kimi-k3", messages, temperature: 1, top_p: 0.95 });
    expect(documented.ok).toBe(true);
    if (documented.ok) expect(documented.warnings).toEqual([]);
    expect(chat.safe({ model: "kimi-k3", messages, top_p: 1 }).ok).toBe(true);
    const r = chat.safe({ model: "kimi-k3", messages, top_p: 0.7 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["top_p"]);
      expect(r.errors[0]?.meta?.allowed).toEqual([0.95, 1]);
    }
    // Alibaba documents no presence_penalty refusal for kimi-k3 (only kimi-k3.1-pro is "fixed").
    expect(chat.safe({ model: "kimi-k3", messages, presence_penalty: 0.5 }).ok).toBe(true);
  });

  test("kimi-k3.1-pro fixes temperature 1 / top_p 0.95 / presence_penalty 0", () => {
    const ok = chat.safe({
      model: "kimi-k3.1-pro",
      messages,
      temperature: 1,
      top_p: 0.95,
      presence_penalty: 0,
      reasoning_effort: "medium",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
    const r = chat.safe({ model: "kimi-k3.1-pro", messages, temperature: 0.6, top_p: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path?.[0])).toEqual(["temperature", "top_p"]);
    expect(chat.safe({ model: "kimi-k3.1-pro", messages, reasoning_effort: "xhigh" }).ok).toBe(
      false,
    );
  });

  test("Qwen3.8 takes the documented reasoning_effort ladder, mapped values included", () => {
    for (const model of ["qwen3.8-omni-flash", "qwen3.8-max", "qwen3.8-flash"] as const) {
      for (const reasoning_effort of ["none", "minimal", "high", "xhigh", "max"]) {
        const r = chat.safe({ model, messages, reasoning_effort });
        expect(r.ok, `${model} ${reasoning_effort}`).toBe(true);
      }
      const r = chat.safe({ model, messages, reasoning_effort: "auto" });
      expect(r.ok, model).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
    }
  });

  test("Qwen3.8 rejects reasoning_effort together with thinking_budget", () => {
    for (const model of ["qwen3.8-omni-flash", "qwen3.8-max", "qwen3.8-27b"]) {
      const r = safeUnchecked({ model, messages, reasoning_effort: "low", thinking_budget: 1024 });
      expect(r.ok, model).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_param");
        expect(r.errors[0]?.path).toEqual(["thinking_budget"]);
      }
      // Either one alone is fine (thinking_budget is a DashScope extension: unknown_param).
      expect(safeUnchecked({ model, messages, thinking_budget: 1024 }).ok, model).toBe(true);
    }
    // Not a rule on other families.
    const other = safeUnchecked({
      model: "qwen3.7-flash",
      messages,
      reasoning_effort: "low",
      thinking_budget: 1024,
    });
    expect(other.ok).toBe(true);
  });

  test("qwen3.8-omni-flash warns on json_schema (JSON Mode only) and accepts json_object", () => {
    const r = chat.safe({
      model: "qwen3.8-omni-flash",
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: "x", schema: { type: "object" } },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unsupported_capability"]);
      expect(r.warnings[0]?.message).toContain("json_object");
    }
    const json = chat.safe({
      model: "qwen3.8-omni-flash",
      messages,
      response_format: { type: "json_object" },
    });
    expect(json.ok).toBe(true);
    if (json.ok) expect(json.warnings).toEqual([]);
  });
});
