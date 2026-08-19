import { describe, expect, test } from "bun:test";
import { chat, estimateChatTokens, CHAT_COMPLETIONS_URL } from "./chat";
import { UnmodelValidationError } from "../../core/issues";
import { models } from "../../catalog/openai.gen";
import type { ModelInfo } from "../../core/catalog-types";

const catalog: Record<string, ModelInfo> = models;

// Every model-dependent test reads the real catalog entry it relies on, so a
// catalog refresh that invalidates an assumption fails loudly here.

function userMessage(text: string) {
  return { role: "user" as const, content: text };
}

/** A syntactically valid PNG header padded to `totalBytes`, base64 data URL. */
function pngDataUrl(totalBytes: number, width = 64, height = 64): string {
  const bytes = new Uint8Array(totalBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("openai.chat happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      model: "gpt-4o" as const,
      messages: [userMessage("Hello!")],
      temperature: 0.2,
    };
    const v = chat(params);

    expect(Object.keys(v)).toEqual(["model", "messages", "temperature"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    expect({ ...v }).toEqual(params as typeof v);

    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // No auth headers, ever.
    expect(Object.keys(v.request.headers)).toEqual(["content-type"]);

    // toSdk is identity for OpenAI: wire == SDK params.
    expect(v.toSdk("openai")).toEqual(params);
    expect(() => (v as unknown as { toSdk(t: string): unknown }).toSdk("anthropic")).toThrow(
      TypeError,
    );
  });

  test("safe() returns no warnings for a current catalog model", () => {
    expect(catalog["gpt-4o"]?.status).toBeUndefined();
    const r = chat.safe({ model: "gpt-4o", messages: [userMessage("hi")] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("unknown model warns and passes through", () => {
    const r = chat.safe({ model: "gpt-99-experimental", messages: [userMessage("hi")] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level params warn but pass through", () => {
    const params = {
      model: "gpt-4o",
      messages: [userMessage("hi")],
      brand_new_param: true,
    } as unknown as Parameters<typeof chat.safe>[0];
    const r = chat.safe(params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
      expect(r.warnings[0]?.path).toEqual(["brand_new_param"]);
    }
  });
});

describe("openai.chat message structure", () => {
  test("empty messages array is an invalid_shape error", () => {
    const r = chat.safe({ model: "gpt-4o", messages: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["messages"]);
    }
  });

  test("tool message without a preceding assistant tool_call is rejected", () => {
    const r = chat.safe({
      model: "gpt-4o",
      messages: [
        userMessage("what's the weather?"),
        { role: "tool", content: "72F", tool_call_id: "call_missing" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["messages", 1, "tool_call_id"]);
      expect(r.errors[0]?.message).toContain("call_missing");
    }
  });

  test("tool message answering a declared tool_call passes", () => {
    const r = chat.safe({
      model: "gpt-4o",
      messages: [
        userMessage("what's the weather?"),
        {
          role: "assistant",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "72F", tool_call_id: "call_1" },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe("openai.chat catalog-driven checks", () => {
  test("tools on a model without tool calling is unsupported_capability", () => {
    expect(models["gpt-3.5-turbo"].toolCall).toBe(false);
    const r = chat.safe({
      model: "gpt-3.5-turbo",
      messages: [userMessage("hi")],
      tools: [{ type: "function", function: { name: "f" } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["tools"]);
      expect(issue?.model).toBe("gpt-3.5-turbo");
    }
  });

  test("input_audio part on a model without audio input is unsupported_capability", () => {
    expect(models["gpt-4o"].modalities.input).not.toContain("audio");
    const r = chat.safe({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "transcribe this" },
            { type: "input_audio", input_audio: { data: "AAAAAAAAAAAA", format: "wav" } },
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["messages", 0, "content", 1]);
      expect(issue?.message).toContain("audio input");
      expect(issue?.meta?.modality).toBe("audio");
    }
  });

  test("file part on a model without pdf input is unsupported_capability", () => {
    expect(models["gpt-5"].modalities.input).not.toContain("pdf");
    const r = chat.safe({
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: [{ type: "file", file: { file_id: "file-123" } }],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["messages", 0, "content", 0]);
      expect(issue?.meta?.modality).toBe("pdf");
    }
  });

  test("image part on a text-only model is unsupported_capability at the exact part", () => {
    expect(models["gpt-4"].modalities.input).toEqual(["text"]);
    const r = chat.safe({
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe this" },
            { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["messages", 0, "content", 1]);
    }
  });

  test("json_schema response_format on a model without structured outputs errors", () => {
    expect(models["gpt-4"].structuredOutput).toBe(false);
    const r = chat.safe({
      model: "gpt-4",
      messages: [userMessage("hi")],
      response_format: { type: "json_schema", json_schema: { name: "out", schema: {} } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["response_format"]);
    }
  });

  test("temperature/top_p on a fixed-sampling model are unsupported_param", () => {
    expect(models["gpt-5"].temperature).toBe(false);
    const r = chat.safe({
      model: "gpt-5",
      messages: [userMessage("hi")],
      temperature: 0.7,
      top_p: 0.9,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.filter((e) => e.code === "unsupported_param").map((e) => e.path);
      expect(paths).toEqual([["temperature"], ["top_p"]]);
    }
  });

  test("temperature on a model that supports it passes", () => {
    expect(models["gpt-4o"].temperature).toBe(true);
    const r = chat.safe({ model: "gpt-4o", messages: [userMessage("hi")], temperature: 1.5 });
    expect(r.ok).toBe(true);
  });

  test("explicit default temperature/top_p (1) pass on fixed-sampling models", () => {
    // The API accepts the documented default explicitly: "Only the default
    // (1) value is supported."
    expect(models["gpt-5"].temperature).toBe(false);
    const r = chat.safe({
      model: "gpt-5",
      messages: [userMessage("hi")],
      temperature: 1,
      top_p: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("stop on o3/o4-mini is denied (SDK-documented API rejection)", () => {
    for (const model of ["o3", "o4-mini"] as const) {
      const r = chat.safe({ model, messages: [userMessage("hi")], stop: ["\n"] });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((e) => e.code === "unsupported_param");
        expect(issue?.path).toEqual(["stop"]);
        expect(issue?.model).toBe(model);
        expect(String(issue?.meta?.source)).toContain(
          `test/fixtures/provider-errors/openai/chat-${model}-stop.json`,
        );
      }
    }
    // The deny is exact-id: o3-mini still accepts stop.
    const ok = chat.safe({ model: "o3-mini", messages: [userMessage("hi")], stop: ["\n"] });
    expect(ok.ok).toBe(true);
  });

  test("a custom voice object for audio output passes the schema", () => {
    const r = chat.safe({
      model: "gpt-4o",
      messages: [userMessage("hi")],
      modalities: ["text", "audio"],
      audio: { format: "wav", voice: { id: "voice_1234" } },
    });
    const shapeErrors = r.ok ? [] : r.errors.filter((e) => e.code === "invalid_shape");
    expect(shapeErrors).toEqual([]);
  });

  test("max_completion_tokens over the catalog output limit is over_output_limit", () => {
    const limit = models["gpt-4o"].limit.output;
    expect(limit).toBeGreaterThan(0);
    const r = chat.safe({
      model: "gpt-4o",
      messages: [userMessage("hi")],
      max_completion_tokens: (limit ?? 0) + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["max_completion_tokens"]);
    }
  });

  test("legacy max_tokens over the catalog output limit is over_output_limit", () => {
    const limit = models["gpt-4o"].limit.output;
    expect(limit).toBeGreaterThan(0);
    const r = chat.safe({
      model: "gpt-4o",
      messages: [userMessage("hi")],
      max_tokens: (limit ?? 0) + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["max_tokens"]);
    }
  });

  test("deprecated model warns", () => {
    expect(models["gpt-4"].status).toBe("deprecated");
    const r = chat.safe({ model: "gpt-4", messages: [userMessage("hi")] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("deprecated_model");
  });
});

describe("openai.chat inline image media rules", () => {
  test("a small inline PNG passes", () => {
    const r = chat.safe({
      model: "gpt-4o",
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: { url: pngDataUrl(256) } }] },
      ],
    });
    expect(r.ok).toBe(true);
  });

  test("an inline image over 20MB is media_too_large", () => {
    const r = chat.safe({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: pngDataUrl(21 * 1024 * 1024) } },
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_too_large");
      expect(r.errors[0]?.path).toEqual(["messages", 0, "content", 1]);
    }
  });

  test("URL-referenced images are checked against options.media declarations", () => {
    const r = chat.safe(
      {
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: "https://example.com/huge.png" } }],
          },
        ],
      },
      { media: [{ path: ["messages", 0, "content", 0], bytes: 21 * 1024 * 1024 }] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_too_large");
      expect(r.errors[0]?.path).toEqual(["messages", 0, "content", 0]);
    }
  });

  test("URL-referenced images without a declaration are not flagged", () => {
    const r = chat.safe({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://example.com/cat.png" } }],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("openai.chat estimation and budget", () => {
  test("estimateChatTokens counts text + per-message overhead", () => {
    // "hello world!" = 12 chars -> 3 heuristic tokens, +4 message overhead.
    expect(estimateChatTokens({ messages: [userMessage("hello world!")] })).toBe(7);
  });

  test("image parts cost a fixed constant", () => {
    const tokens = estimateChatTokens({
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: { url: "https://x/y.png" } }] },
      ],
    });
    expect(tokens).toBe(4 + 1000);
  });

  test("tool definitions and assistant tool_call arguments are counted", () => {
    const tool = {
      type: "function" as const,
      function: { name: "get_weather", parameters: { type: "object" } },
    };
    const args = '{"city":"Lisbon"}';
    const tokens = estimateChatTokens({
      messages: [
        {
          role: "assistant",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: args } }],
        },
      ],
      tools: [tool],
    });
    // Message overhead + tool_call arguments + tool definition (JSON size +
    // per-definition overhead), all via the ~4 chars/token heuristic.
    const expected =
      4 + Math.ceil(args.length / 4) + (Math.ceil(JSON.stringify(tool).length / 4) + 4);
    expect(tokens).toBe(expected);
  });

  test("safe() exposes the estimate and prices worst case from max_completion_tokens", () => {
    const cost = models["gpt-4o"].cost;
    const r = chat.safe({
      model: "gpt-4o",
      messages: [userMessage("hello world!")],
      max_completion_tokens: 100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.inputTokens).toBe(7);
      const expected = (7 * (cost?.input ?? 0)) / 1e6 + (100 * (cost?.output ?? 0)) / 1e6;
      expect(r.estimate.costUSD).toBeCloseTo(expected, 10);
    }
  });

  test("maxCostUSD budget enforcement fires over_budget", () => {
    const r = chat.safe(
      {
        model: "gpt-4o",
        messages: [userMessage("x".repeat(4000))],
        max_completion_tokens: 16000,
      },
      { maxCostUSD: 0.000001 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("over_context fires from the estimate", () => {
    const context = models["gpt-3.5-turbo"].limit.context;
    const r = chat.safe({
      model: "gpt-3.5-turbo",
      messages: [userMessage("x".repeat((context + 10) * 4))],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_context");
  });
});

describe("openai.chat throwing form", () => {
  test("throws UnmodelValidationError carrying the issues", () => {
    let caught: unknown;
    try {
      chat({ model: "gpt-5", messages: [userMessage("hi")], temperature: 0.5 });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
    if (UnmodelValidationError.isInstance(caught)) {
      expect(caught.issues[0]?.code).toBe("unsupported_param");
    }
  });
});

describe("openai.chat toApi", () => {
  const params = { model: "gpt-5.4" as const, messages: [userMessage("hi")] };

  test("retargets to a reseller, respelling the model id and swapping the URL", () => {
    const routed = chat(params).toApi("openrouter");

    // Enumerable properties stay exactly the wire body, so this is fetchable
    // as-is; only the model id changed.
    expect(Object.keys(routed)).toEqual(["model", "messages"]);
    expect(routed.model).toBe("openai/gpt-5.4");
    expect(routed.request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(routed.target).toBe("openrouter");
    // The audit trail for the respelling — the one warning a lossless
    // same-dialect hop always carries.
    expect(routed.warnings.map((w) => w.code)).toEqual(["id_respelled"]);
  });

  test("a provider that does not serve the model fails, naming the ones that do", () => {
    // The compile-time union already rules "groq" out; this is the runtime
    // guard behind it, which a JS caller still reaches.
    type Loose = {
      toApiSafe(t: string): { ok: boolean; errors?: Array<{ code: string; message: string }> };
    };
    const result = (chat(params) as unknown as Loose).toApiSafe("groq");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors?.[0]?.code).toBe("unsupported_capability");
      expect(result.errors?.[0]?.message).toContain("is not served by groq");
      expect(result.errors?.[0]?.message).toContain("openrouter");
    }
  });

  test("does not mutate the source validation", () => {
    const v = chat(params);
    v.toApi("vercel");
    expect(v.model).toBe("gpt-5.4");
    expect(v.request.url).toBe(CHAT_COMPLETIONS_URL);
  });
});

describe("openai.chat constraintsFor", () => {
  test("exposes the endpoint-wide vision media rule", () => {
    const merged = chat.constraintsFor("gpt-4o");
    const image = merged.find((c) => c.media?.image)?.media?.image;
    expect(image?.maxBytes).toBe(20 * 1024 * 1024);
    expect(image?.formats).toEqual(["png", "jpeg", "webp", "gif"]);
  });
});
