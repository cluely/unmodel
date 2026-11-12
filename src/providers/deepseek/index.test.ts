import { describe, expect, test } from "bun:test";
import type { ChatCompletionsBodyBase } from "../openai-compatible";
import { chat, CHAT_COMPLETIONS_URL, checkChat, type DeepseekTextModelId } from "./index";

type Body = ChatCompletionsBodyBase<DeepseekTextModelId>;

const hi = [{ role: "user" as const, content: "hi" }];
const weatherTool = {
  type: "function" as const,
  function: { name: "get_weather", parameters: { type: "object" } },
};

/**
 * DeepSeek's `thinking` object is not part of the shared dialect's type, so a
 * literal carrying it is widened here; the runtime schema passes it through.
 */
function withThinking(body: Body, type: "enabled" | "disabled"): Body {
  return { ...body, thinking: { type } } as Body;
}

/** A syntactically valid PNG header of the given dimensions, as a base64 data URL. */
function pngDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("unmodel/deepseek", () => {
  test("CHAT_COMPLETIONS_URL targets DeepSeek's chat completions endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.deepseek.com/chat/completions");
  });

  test("a catalog model validates and stays wire-pure", () => {
    const params = {
      model: "deepseek-flash" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("deepseek-flash and deepseek-v4-pro validate clean", () => {
    for (const model of ["deepseek-flash", "deepseek-v4-pro"] as const) {
      const r = chat.safe({ model, messages: hi });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("the legacy Flash names stay reachable and warn deprecated", () => {
    for (const model of ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"] as const) {
      const r = chat.safe({ model, messages: hi });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
    }
  });

  test("unknown models warn and name the deepseek catalog", () => {
    const r = chat.safe({ model: "totally-unknown-model", messages: [{ role: "user", content: "hi" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the deepseek catalog");
    }
  });

  test("max_tokens reaches the documented 393216 ceiling and no further", () => {
    expect(chat.safe({ model: "deepseek-flash", messages: hi, max_tokens: 393216 }).ok).toBe(true);
    const r = chat.safe({ model: "deepseek-flash", messages: hi, max_tokens: 393217 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_output_limit");
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "deepseek-flash",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.costUSD).toBeGreaterThan(0);
    expect(report.warnings).toEqual([]);
  });

  test("checkChat prices deepseek-flash at $0.15 in / $0.60 out per 1M", () => {
    const report = checkChat({
      model: "deepseek-flash",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    });
    expect(report.costUSD).toBeCloseTo(0.75, 10);
  });
});

describe("deepseek.chat thinking-mode rules", () => {
  test("tool_choice required is refused in thinking mode, the default", () => {
    const r = chat.safe({
      model: "deepseek-flash",
      messages: hi,
      tools: [weatherTool],
      tool_choice: "required",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["tool_choice"]);
      expect(r.errors[0]?.message).toContain('reasoning_effort: "none"');
      expect(r.errors[0]?.meta?.source).toContain("api-docs.deepseek.com");
    }
  });

  test("a named tool_choice is refused in thinking mode", () => {
    const r = chat.safe({
      model: "deepseek-v4-pro",
      messages: hi,
      tools: [weatherTool],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["tool_choice"]);
  });

  test("forced tool_choice validates once thinking is off", () => {
    const base = {
      model: "deepseek-flash",
      messages: hi,
      tools: [weatherTool],
      tool_choice: "required",
    } satisfies Body;
    expect(chat.safe({ ...base, reasoning_effort: "none" }).ok).toBe(true);
    expect(chat.safe(withThinking(base, "disabled")).ok).toBe(true);
  });

  test("an explicit thinking object takes precedence over reasoning_effort", () => {
    const body = withThinking(
      {
        model: "deepseek-flash",
        messages: hi,
        tools: [weatherTool],
        tool_choice: "required",
        reasoning_effort: "none",
      },
      "enabled",
    );
    expect(chat.safe(body).ok).toBe(false);
  });

  test("temperature warns in thinking mode and applies with thinking off", () => {
    const thinking = chat.safe({ model: "deepseek-flash", messages: hi, temperature: 0.7 });
    expect(thinking.ok).toBe(true);
    if (thinking.ok) {
      expect(thinking.warnings.map((w) => [w.code, w.path])).toEqual([
        ["unsupported_param", ["temperature"]],
      ]);
      expect(thinking.warnings[0]?.meta?.ignored).toBe(true);
    }
    const off = chat.safe({
      model: "deepseek-flash",
      messages: hi,
      temperature: 0.7,
      reasoning_effort: "none",
    });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.warnings).toEqual([]);
  });

  test("top_p follows each model's documented thinking-mode behaviour", () => {
    function topPWarnings(model: DeepseekTextModelId, top_p: number, thinkingOff = false): number {
      const r = chat.safe({
        model,
        messages: hi,
        top_p,
        ...(thinkingOff && { reasoning_effort: "none" }),
      });
      expect(r.ok).toBe(true);
      return r.ok ? r.warnings.filter((w) => w.path[0] === "top_p").length : -1;
    }
    // deepseek-flash: thinking clamps below 0.95; non-thinking ignores the value.
    expect(topPWarnings("deepseek-flash", 0.5)).toBe(1);
    expect(topPWarnings("deepseek-flash", 0.97)).toBe(0);
    expect(topPWarnings("deepseek-flash", 0.97, true)).toBe(1);
    // deepseek-v4-pro: thinking ignores the value; non-thinking uses it.
    expect(topPWarnings("deepseek-v4-pro", 0.97)).toBe(1);
    expect(topPWarnings("deepseek-v4-pro", 0.5, true)).toBe(0);
  });
});

describe("deepseek.chat endpoint rules", () => {
  test("stream_options without stream: true is refused", () => {
    const body = { model: "deepseek-flash", messages: hi, stream_options: { include_usage: true } };
    const r = chat.safe(body);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["stream_options"]);
    }
    expect(chat.safe({ ...body, stream: true }).ok).toBe(true);
  });

  test("reasoning_effort takes DeepSeek's documented values and compatibility aliases", () => {
    for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]) {
      const r = chat.safe({ model: "deepseek-flash", messages: hi, reasoning_effort: effort });
      expect(r.ok).toBe(true);
    }
    const r = chat.safe({ model: "deepseek-flash", messages: hi, reasoning_effort: "maximum" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["reasoning_effort"]);
    }
  });

  test("frequency_penalty and presence_penalty are accepted with an ignored warning", () => {
    const r = chat.safe({
      model: "deepseek-v4-pro",
      messages: hi,
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.path[0])).toEqual(["frequency_penalty", "presence_penalty"]);
      for (const w of r.warnings) {
        expect(w.code).toBe("unsupported_param");
        expect(w.meta?.ignored).toBe(true);
      }
    }
  });

  test("inline images on the vision models are held to DeepSeek's 8192-px side", () => {
    function image(model: "deepseek-flash" | "deepseek-v4-flash-vision-exp", url: string) {
      return chat.safe({
        model,
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }],
      });
    }
    expect(image("deepseek-flash", pngDataUrl(8192, 8192)).ok).toBe(true);
    for (const model of ["deepseek-flash", "deepseek-v4-flash-vision-exp"] as const) {
      const r = image(model, pngDataUrl(8193, 64));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("media_dimensions_exceeded");
    }
  });

  test("a declared image over 32 MiB is refused", () => {
    const path = ["messages", 0, "content", 0] as const;
    const part = { type: "image_url" as const, image_url: { url: "https://example.com/a.png" } };
    const body = { model: "deepseek-flash", messages: [{ role: "user" as const, content: [part] }] };
    const limit = 32 * 1024 * 1024;
    expect(chat.safe(body, { media: [{ path, bytes: limit }] }).ok).toBe(true);
    const r = chat.safe(body, { media: [{ path, bytes: limit + 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("media_too_large");
  });

  test("the vision limits apply only to image-capable ids", () => {
    function hasImageRule(model: string): boolean {
      return chat.constraintsFor(model).some((c) => c.media?.image !== undefined);
    }
    expect(hasImageRule("deepseek-flash")).toBe(true);
    expect(hasImageRule("deepseek-v4-pro")).toBe(false);
    expect(hasImageRule("constructor")).toBe(false);
  });
});
