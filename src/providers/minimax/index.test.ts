import { describe, expect, test } from "bun:test";
import { chat, CHAT_COMPLETIONS_URL, checkChat, models } from "./index";
import { MINIMAX_FLASH_REASONING_EFFORTS } from "./constraints";

const hi = [{ role: "user" as const, content: "hi" }];

describe("unmodel/minimax", () => {
  test("CHAT_COMPLETIONS_URL targets MiniMax's OpenAI-compatible endpoint, not the Anthropic route", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.minimax.io/v1/chat/completions");
  });

  test("a catalog model validates and stays wire-pure", () => {
    const params = {
      model: "MiniMax-M3" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const v = chat(params);
    expect(Object.keys(v)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
  });

  test("unknown models warn and name the minimax catalog", () => {
    const r = chat.safe({ model: "totally-unknown-model", messages: [{ role: "user", content: "hi" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the minimax catalog");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "MiniMax-M3",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.costUSD).toBeGreaterThan(0);
    expect(report.warnings).toEqual([]);
  });

  test("MiniMax-M3 takes the documented 524,288-token completion maximum", () => {
    // "For MiniMax-M3.1-Flash and MiniMax-M3 the recommended value is 131072
    // (128K) and the maximum is 524288 (512K)." (openapi-chat-openai.json)
    for (const model of ["MiniMax-M3", "MiniMax-M3.1-Flash"] as const) {
      expect(chat.safe({ model, messages: hi, max_completion_tokens: 524288 }).ok).toBe(true);
      const over = chat.safe({ model, messages: hi, max_completion_tokens: 524289 });
      expect(over.ok).toBe(false);
      if (!over.ok) expect(over.errors[0]?.code).toBe("over_output_limit");
    }
  });
});

describe("minimax.chat — MiniMax-M3.1-Flash", () => {
  test("validates warning-free and prices at $0.15 / $0.60 per 1M tokens", () => {
    const r = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);

    expect(models["MiniMax-M3.1-Flash"].cost).toEqual({ input: 0.15, output: 0.6, cacheRead: 0.015 });
    const report = checkChat({
      model: "MiniMax-M3.1-Flash",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    });
    expect(report.costUSD).toBeCloseTo(0.75, 10);
  });

  test("reasoning_effort takes low … max and refuses none", () => {
    for (const effort of MINIMAX_FLASH_REASONING_EFFORTS) {
      const r = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, reasoning_effort: effort });
      expect(r.ok, `reasoning_effort ${effort}`).toBe(true);
    }
    const none = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, reasoning_effort: "none" });
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.errors[0]?.code).toBe("invalid_enum_value");
      expect(none.errors[0]?.path).toEqual(["reasoning_effort"]);
      expect(none.errors[0]?.message).toContain('"xhigh", "max"');
    }
  });

  test("the reasoning_effort ladder is Flash's alone: MiniMax-M3 is not refused for none", () => {
    // The 400 is documented for MiniMax-M3.1-Flash only ("`MiniMax-M3.1-Flash`
    // always thinks"); MiniMax-M3 turns thinking off through `thinking`.
    expect(chat.safe({ model: "MiniMax-M3", messages: hi, reasoning_effort: "none" }).ok).toBe(true);
  });

  test("thinking cannot be disabled: { type: \"disabled\" } is the documented 400", () => {
    // `thinking` is not on the shared dialect body, hence the casts.
    const off = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, thinking: { type: "disabled" } } as never);
    expect(off.ok).toBe(false);
    if (!off.ok) {
      expect(off.errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", ["thinking", "type"]]]);
      expect(off.errors[0]?.message).toContain('`thinking: {type: "adaptive"}`');
    }
    const adaptive = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, thinking: { type: "adaptive" } } as never);
    expect(adaptive.ok).toBe(true);
  });

  test("MiniMax-M3 keeps thinking: { type: \"disabled\" } — its documented off switch", () => {
    expect(chat.safe({ model: "MiniMax-M3", messages: hi, thinking: { type: "disabled" } } as never).ok).toBe(true);
  });

  test("service_tier is not supported: a warning, never a refusal", () => {
    const r = chat.safe({ model: "MiniMax-M3.1-Flash", messages: hi, service_tier: "priority" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => [w.code, w.path[0]])).toEqual([["unsupported_param", "service_tier"]]);
      expect(r.warnings[0]?.meta?.["ignored"]).toBe(true);
    }
  });

  test("structured outputs are refused (no response_format on the OpenAI-compatible body)", () => {
    const r = chat.safe({
      model: "MiniMax-M3.1-Flash",
      messages: hi,
      response_format: { type: "json_schema", json_schema: { name: "x", schema: {} } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_capability");
  });
});

describe("minimax.chat — the M3 generation's sampling parameters", () => {
  test("temperature and top_p are accepted and ignored on both models", () => {
    for (const model of ["MiniMax-M3", "MiniMax-M3.1-Flash"] as const) {
      const r = chat.safe({ model, messages: hi, temperature: 0.2, top_p: 0.5 });
      expect(r.ok, model).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => w.path[0])).toEqual(["temperature", "top_p"]);
        expect(r.warnings.every((w) => w.meta?.["ignored"] === true)).toBe(true);
      }
    }
  });

  test("top_p must still be within (0, 1]", () => {
    for (const model of ["MiniMax-M3", "MiniMax-M3.1-Flash"] as const) {
      expect(chat.safe({ model, messages: hi, top_p: 1 }).ok, model).toBe(true);
      for (const topP of [0, 1.5]) {
        const r = chat.safe({ model, messages: hi, top_p: topP });
        expect(r.ok, `${model} top_p ${topP}`).toBe(false);
        if (!r.ok) {
          expect(r.errors[0]?.path).toEqual(["top_p"]);
          expect(r.errors[0]?.message).toContain("(0, 1]");
        }
      }
    }
  });
});

// The page's "Important Notes" name no model; its Supported Models table is
// exactly these two ids (text-openai-api, 2026-11-12).
describe("minimax.chat — the M3 generation's Important Notes", () => {
  const m3Generation = ["MiniMax-M3", "MiniMax-M3.1-Flash"] as const;

  test("n is pinned to 1", () => {
    for (const model of m3Generation) {
      expect(chat.safe({ model, messages: hi, n: 1 }).ok, model).toBe(true);
      const two = chat.safe({ model, messages: hi, n: 2 });
      expect(two.ok, model).toBe(false);
      if (!two.ok) {
        expect(two.errors[0]?.code).toBe("invalid_enum_value");
        expect(two.errors[0]?.path).toEqual(["n"]);
      }
    }
  });

  test("the deprecated function_call is refused and points at tools", () => {
    for (const model of m3Generation) {
      const r = chat.safe({ model, messages: hi, function_call: "auto" });
      expect(r.ok, model).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_param");
        expect(r.errors[0]?.path).toEqual(["function_call"]);
        expect(r.errors[0]?.message).toContain("`tools`");
      }
    }
  });

  test("the penalties and logit_bias are ignored: a warning, never a refusal", () => {
    for (const model of m3Generation) {
      const r = chat.safe({
        model,
        messages: hi,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
        logit_bias: { "1": 1 },
      });
      expect(r.ok, model).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => [w.code, w.path[0]])).toEqual([
          ["unsupported_param", "presence_penalty"],
          ["unsupported_param", "frequency_penalty"],
          ["unsupported_param", "logit_bias"],
        ]);
        expect(r.warnings.every((w) => w.meta?.["ignored"] === true)).toBe(true);
      }
    }
  });
});

// openapi-chat-openai.json `MessageContentPart` (2026-11-12): "`MiniMax-M3.1-Flash`
// and `MiniMax-M3` support text, image, and video content parts".
describe("minimax.chat — image and video content parts", () => {
  const m3Generation = ["MiniMax-M3", "MiniMax-M3.1-Flash"] as const;

  test("a video_url part validates, with fps and detail", () => {
    for (const model of m3Generation) {
      for (const url of ["https://example.com/clip.mp4", "data:video/mp4;base64,AAAA", "mm_file://file_id"]) {
        const r = chat.safe({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "describe" },
                { type: "video_url", video_url: { url, detail: "default", fps: 0.2, max_long_side_pixel: 720 } },
              ],
            },
          ],
        });
        expect(r.ok, `${model} ${url}`).toBe(true);
        if (r.ok) expect(r.warnings).toEqual([]);
      }
    }
  });

  test("image_url takes detail \"default\" and max_long_side_pixel", () => {
    for (const model of m3Generation) {
      const r = chat.safe({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "https://example.com/a.png", detail: "default", max_long_side_pixel: 1024 } },
            ],
          },
        ],
      });
      expect(r.ok, model).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("fps outside [0.2, 5] is refused at its own path", () => {
    for (const fps of [0.1, 5.5]) {
      const r = chat.safe({
        model: "MiniMax-M3.1-Flash",
        messages: [{ role: "user", content: [{ type: "video_url", video_url: { url: "mm_file://file_id", fps } }] }],
      });
      expect(r.ok, `fps ${fps}`).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_shape");
        expect(r.errors[0]?.path).toEqual(["messages", 0, "content", 0, "video_url", "fps"]);
      }
    }
  });

  test("a model the catalog gives no video input still refuses the part", () => {
    const r = chat.safe({
      model: "MiniMax-M2.7",
      messages: [{ role: "user", content: [{ type: "video_url", video_url: { url: "https://example.com/clip.mp4" } }] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.meta?.["modality"]).toBe("video");
    }
  });
});

describe("minimax.chat — MiniMax-M3", () => {
  test("reasoning_effort is accepted and ignored: a warning for every value, none included", () => {
    // "| `reasoning_effort` | Thinking depth, effective for `MiniMax-M3.1-Flash`
    // only. …" (text-openai-api, 2026-11-12).
    for (const effort of ["high", "none"]) {
      const r = chat.safe({ model: "MiniMax-M3", messages: hi, reasoning_effort: effort });
      expect(r.ok, effort).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => [w.code, w.path])).toEqual([["unsupported_param", ["reasoning_effort"]]]);
        expect(r.warnings[0]?.meta?.["ignored"]).toBe(true);
      }
    }
  });

  test("service_tier takes standard or priority and nothing else", () => {
    for (const tier of ["standard", "priority", null]) {
      const r = chat.safe({ model: "MiniMax-M3", messages: hi, service_tier: tier });
      expect(r.ok, String(tier)).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
    const bogus = chat.safe({ model: "MiniMax-M3", messages: hi, service_tier: "bogus" });
    expect(bogus.ok).toBe(false);
    if (!bogus.ok) {
      expect(bogus.errors[0]?.code).toBe("invalid_enum_value");
      expect(bogus.errors[0]?.path).toEqual(["service_tier"]);
    }
  });
});
