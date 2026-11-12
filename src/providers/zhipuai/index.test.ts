import { describe, expect, test } from "bun:test";
import { chat, CHAT_COMPLETIONS_URL, checkChat } from "./index";
import { chat as openrouterChat } from "../openrouter";
import { chat as unifiedChat } from "../../chat";

describe("unmodel/zhipuai", () => {
  test("CHAT_COMPLETIONS_URL targets Zhipu AI's chat completions endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
  });

  test("a catalog model validates and stays wire-pure", () => {
    const params = {
      model: "glm-4.6" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the zhipuai catalog", () => {
    const r = chat.safe({ model: "totally-unknown-model", messages: [{ role: "user", content: "hi" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the zhipuai catalog");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "glm-4.6",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.costUSD).toBeGreaterThan(0);
    expect(report.warnings).toEqual([]);
  });
});

const HI = [{ role: "user" as const, content: "hi" }];

describe("models added 2026-11-12", () => {
  // GLM-4.6V-Flash is free on open.bigmodel.cn: "| GLM-4.6V-Flash | — | 免费 | 免费 |
  // 限时免费 | 免费 |" (https://docs.bigmodel.cn/cn/guide/start/pricing).
  test("glm-4.6v-flash validates and prices at zero", () => {
    expect(chat.safe({ model: "glm-4.6v-flash", messages: HI }).ok).toBe(true);
    const report = checkChat({
      model: "glm-4.6v-flash",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    });
    expect(report.costUSD).toBe(0);
    expect(report.warnings).toEqual([]);
  });

  test("glm-5.3-flashx validates and prices from its catalog row", () => {
    expect(chat.safe({ model: "glm-5.3-flashx", messages: HI }).ok).toBe(true);
    const report = checkChat({
      model: "glm-5.3-flashx",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    });
    expect(report.costUSD).toBeCloseTo(0.29879 + 1.04577, 6);
  });
});

describe("GLM-5.3 always thinks (https://docs.bigmodel.cn/cn/guide/capabilities/thinking)", () => {
  const FAMILY = ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx"] as const;

  for (const model of FAMILY) {
    test(`${model} refuses a reasoning_effort outside low | high | max`, () => {
      const r = chat.safe({ model, messages: HI, reasoning_effort: "medium" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.map((e) => [e.code, e.path])).toEqual([
        ["invalid_enum_value", ["reasoning_effort"]],
      ]);
      expect(r.errors[0]?.message).toContain('"low", "high", "max"');
    });

    test(`${model} accepts low, high and max`, () => {
      for (const reasoning_effort of ["low", "high", "max"]) {
        expect(chat.safe({ model, messages: HI, reasoning_effort }).ok).toBe(true);
      }
    });

    test(`${model} refuses thinking.type disabled and names what it accepts`, () => {
      const r = chat.safe({ model, messages: HI, thinking: { type: "disabled" } } as never);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.map((e) => [e.code, e.path])).toEqual([
        ["unsupported_param", ["thinking", "type"]],
      ]);
      expect(r.errors[0]?.message).toContain('`thinking: {type: "enabled"}`');
      expect(r.errors[0]?.meta?.source).toContain("docs.bigmodel.cn");
    });

    test(`${model} accepts thinking.type enabled`, () => {
      const r = chat.safe({ model, messages: HI, thinking: { type: "enabled" } } as never);
      expect(r.ok).toBe(true);
    });
  }

  test("glm-5.2 keeps its full effort range and can still turn thinking off", () => {
    expect(chat.safe({ model: "glm-5.2", messages: HI, reasoning_effort: "medium" }).ok).toBe(true);
    expect(chat.safe({ model: "glm-5.2", messages: HI, thinking: { type: "disabled" } } as never).ok).toBe(
      true,
    );
  });

  test("a .toApi(\"zhipuai\") retarget runs the same effort table", () => {
    const body = { model: "z-ai/glm-5.3-flashx" as const, messages: HI, reasoning_effort: "medium" };
    const r = openrouterChat(body).toApiSafe("zhipuai");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("invalid_enum_value");
    expect(openrouterChat({ ...body, reasoning_effort: "high" }).toApiSafe("zhipuai").ok).toBe(true);
  });

  test("the unified entry terminates in the same rule", () => {
    const r = unifiedChat.safe({ model: "zhipuai/glm-5.3-flashx", messages: HI, reasoning: "medium" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code)).toContain("invalid_enum_value");
  });
});
