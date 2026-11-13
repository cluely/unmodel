import { describe, expect, test } from "bun:test";
import { chat, CHAT_COMPLETIONS_URL, checkChat, type DeepseekTextModelId } from "./index";
import type { ChatBody as Body } from "./types";

const hi = [{ role: "user" as const, content: "hi" }];
const weatherTool = {
  type: "function" as const,
  function: { name: "get_weather", parameters: { type: "object" } },
};

function withThinking(body: Body, type: "enabled" | "disabled"): Body {
  return { ...body, thinking: { type } };
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
    const off = chat.safe(withThinking(base, "disabled"));
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.warnings).toEqual([]);
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
    const offByObject = chat.safe(
      withThinking({ model: "deepseek-flash", messages: hi, temperature: 0.7 }, "disabled"),
    );
    expect(offByObject.ok).toBe(true);
    if (offByObject.ok) expect(offByObject.warnings).toEqual([]);
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
    const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
    for (const effort of efforts) {
      const r = chat.safe({ model: "deepseek-flash", messages: hi, reasoning_effort: effort });
      expect(r.ok).toBe(true);
    }
    // @ts-expect-error — "maximum" is not one of DeepSeek's values
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

describe("deepseek.chat top-level extensions", () => {
  test("thinking, user_id, safety_check and title validate clean", () => {
    const r = chat.safe({
      model: "deepseek-flash",
      messages: hi,
      thinking: { type: "enabled" },
      user_id: "user_123",
      safety_check: { level: "high" },
      title: { enabled: true },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("a thinking type outside enabled/disabled is refused", () => {
    // @ts-expect-error — `type` is "enabled" | "disabled"
    const r = chat.safe({ model: "deepseek-flash", messages: hi, thinking: { type: "off" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["thinking", "type"]);
  });

  test("response_format json_schema warns and names what DeepSeek offers", () => {
    for (const model of ["deepseek-flash", "deepseek-v4-pro"] as const) {
      const r = chat.safe({
        model,
        messages: hi,
        response_format: { type: "json_schema", json_schema: { name: "x", schema: { type: "object" } } },
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings.map((w) => [w.code, w.path])).toEqual([
          ["unsupported_capability", ["response_format"]],
        ]);
        expect(r.warnings[0]?.message).toContain('type: "json_object"');
        expect(r.warnings[0]?.message).toContain("strict: true");
      }
    }
    const json = chat.safe({ model: "deepseek-flash", messages: hi, response_format: { type: "json_object" } });
    expect(json.ok).toBe(true);
    if (json.ok) expect(json.warnings).toEqual([]);
  });
});

describe("deepseek.chat content parts", () => {
  const imageUrl = "https://example.com/a.png";
  const toolCall = { id: "call_1", type: "function" as const, function: { name: "f", arguments: "{}" } };

  function withToolImage(model: DeepseekTextModelId): Body {
    return {
      model,
      messages: [
        ...hi,
        { role: "assistant", tool_calls: [toolCall] },
        { role: "tool", tool_call_id: "call_1", content: [{ type: "image_url", image_url: { url: imageUrl } }] },
      ],
    };
  }

  test("DeepSeek's documented image shapes validate clean on deepseek-flash", () => {
    const bodies: Body[] = [
      {
        model: "deepseek-flash",
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: imageUrl, detail: "original" } }] }],
      },
      { model: "deepseek-flash", messages: [{ role: "user", content: [{ type: "file", file_id: "file-api-1" }] }] },
      {
        model: "deepseek-flash",
        messages: [
          { role: "user", content: [{ type: "file", file_data: pngDataUrl(64, 64), filename: "a.png" }] },
        ],
      },
      withToolImage("deepseek-flash"),
      {
        model: "deepseek-flash",
        messages: [
          { role: "system", content: [{ type: "text", text: "s" }, { type: "image_url", image_url: { url: imageUrl } }] },
          ...hi,
        ],
      },
    ];
    for (const body of bodies) {
      const r = chat.safe(body);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("a file part needs exactly one of file_id and file_data", () => {
    function filePart(part: Record<string, unknown>) {
      return chat.safe({
        model: "deepseek-flash",
        messages: [{ role: "user", content: [{ type: "file", ...part }] }],
      });
    }
    const both = filePart({ file_id: "file-api-1", file_data: pngDataUrl(64, 64) });
    expect(both.ok).toBe(false);
    if (!both.ok) {
      expect(both.errors.map((e) => [e.code, e.path])).toEqual([["invalid_shape", ["messages", 0, "content", 0]]]);
      expect(both.errors[0]?.message).toContain("file cannot have both file_id and file_data");
    }
    const neither = filePart({ filename: "a.png" });
    expect(neither.ok).toBe(false);
    if (!neither.ok) expect(neither.errors[0]?.message).toContain("file must have a file_id or file_data");
    // The dialect's nested form carries neither on the part itself.
    const nested = filePart({ file: { file_id: "file-api-1" } });
    expect(nested.ok).toBe(false);
    if (!nested.ok) expect(nested.errors[0]?.message).toContain("nested `file: {…}` object");
  });

  test("an image in an assistant message is refused", () => {
    const r = chat.safe({
      model: "deepseek-flash",
      // @ts-expect-error — assistant content takes text and refusal parts only
      messages: [...hi, { role: "assistant", content: [{ type: "image_url", image_url: { url: imageUrl } }] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["messages", 1, "content"]);
  });

  test("text-only deepseek-v4-pro refuses images in any role", () => {
    const tool = chat.safe(withToolImage("deepseek-v4-pro"));
    expect(tool.ok).toBe(false);
    if (!tool.ok) {
      expect(tool.errors.map((e) => [e.code, e.path])).toEqual([
        ["unsupported_capability", ["messages", 2, "content", 0]],
      ]);
    }
    const inline = chat.safe({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: [{ type: "file", file_data: pngDataUrl(64, 64) }] }],
    });
    expect(inline.ok).toBe(false);
    if (!inline.ok) expect(inline.errors[0]?.message).toContain("does not accept image input");
  });

  test("a file_id part is not taken for an image, so no model refuses it", () => {
    // The id may name a document the Files API parsed.
    const r = chat.safe({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: [{ type: "file", file_id: "file-api-1" }] }],
    });
    expect(r.ok).toBe(true);
  });

  test("the vision limits reach file_data and tool-message images", () => {
    const fileData = chat.safe({
      model: "deepseek-flash",
      messages: [{ role: "user", content: [{ type: "file", file_data: pngDataUrl(8193, 64) }] }],
    });
    expect(fileData.ok).toBe(false);
    if (!fileData.ok) expect(fileData.errors[0]?.code).toBe("media_dimensions_exceeded");

    const path = ["messages", 2, "content", 0] as const;
    const r = chat.safe(withToolImage("deepseek-flash"), { media: [{ path, bytes: 32 * 1024 * 1024 + 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("media_too_large");
  });

  test("a declared file_id image is not held to the 32 MiB inline cap", () => {
    const path = ["messages", 0, "content", 0] as const;
    const r = chat.safe(
      { model: "deepseek-flash", messages: [{ role: "user", content: [{ type: "file", file_id: "file-api-1" }] }] },
      { media: [{ path, bytes: 48 * 1024 * 1024 }] },
    );
    expect(r.ok).toBe(true);
  });

  test("toSdk(ai-sdk) maps DeepSeek's parts onto the dialect", () => {
    const v = chat({
      model: "deepseek-flash",
      messages: [
        { role: "system", content: [{ type: "text", text: "sys" }, { type: "image_url", image_url: { url: imageUrl } }] },
        { role: "user", content: [{ type: "file", file_data: pngDataUrl(64, 64), filename: "a.png" }] },
      ],
    });
    const options = v.toSdk("ai-sdk");
    expect(options.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(options.messages[1]).toMatchObject({
      role: "user",
      content: [{ type: "file", mediaType: "image/png", filename: "a.png" }],
    });
    expect(options.warnings.map((w) => [w.code, w.path])).toEqual([
      ["dropped_content", ["messages", 0, "content", 1]],
    ]);
  });
});

describe("deepseek checkChat interruptions", () => {
  function report(finishReason: string) {
    return checkChat({
      model: "deepseek-flash",
      choices: [{ finish_reason: finishReason }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  }

  test("insufficient_system_resource and aborted each warn", () => {
    for (const finishReason of ["insufficient_system_resource", "aborted"]) {
      const r = report(finishReason);
      expect(r.finishReason).toBe(finishReason);
      expect(r.warnings.map((w) => [w.code, w.path, w.meta])).toEqual([
        ["unsupported_capability", ["choices", 0, "finish_reason"], { kind: "interrupted", finishReason }],
      ]);
      expect(r.warnings[0]?.model).toBe("deepseek-flash");
    }
    expect(report("insufficient_system_resource").warnings[0]?.message).toContain("retry the request");
  });

  test("stop stays clean and length still warns once", () => {
    expect(report("stop").warnings).toEqual([]);
    expect(report("length").warnings.map((w) => w.code)).toEqual(["over_output_limit"]);
  });
});
