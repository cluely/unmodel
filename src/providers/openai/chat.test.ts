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

  test("retargets to openai itself — the identity hop, byte-for-byte the same request", () => {
    // OpenAI serves OpenAI's models, so `.toApi("openai")` is in the union and
    // is a no-op: the same wire body at the same URL. It exists so a
    // provider-generic call site (`req.toApi(providerFromConfig)`) does not
    // need a special case for "the provider I already am".
    const validated = chat({ model: "gpt-5.2", messages: [userMessage("hi")] });
    const routed = validated.toApi("openai");

    // Enumerable properties only — spreading is what a caller does to get the
    // fetch body, and the two bodies are indistinguishable.
    const wire = (v: object): Record<string, unknown> => ({ ...v });
    expect(wire(routed)).toEqual(wire(validated));
    expect(routed.model).toBe("gpt-5.2");
    expect(routed.request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(routed.target).toBe("openai");
    // Lossless, per the warnings contract: nothing was translated, respelled
    // or narrowed, so there is nothing to report.
    expect(routed.warnings.length).toBe(0);
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

/**
 * The substrate signpost, and the three-way agreement behind it.
 *
 * OpenAI serves seventeen ids in its own catalog on routes that are not
 * /v1/chat/completions, and models.dev files every one of them as text-out —
 * so before this check they validated clean and addressed the chat endpoint.
 * The fact is stated three times because three consumers need it in three
 * forms that cannot read each other:
 *
 *   • `NonChatModelId` (./wire.ts) — a TYPE, because it shapes `OpenaiChatModelId`;
 *   • `NON_CHAT_ROUTES` (./chat.ts) — a runtime table, because a check cannot read a type;
 *   • `chatScopeExclude` (data/availability-overrides.json) — data, because
 *     codegen must not import from `src/`.
 *
 * These tests pin (2) against (1) and (3). `test/chat/refs.test.ts` pins the
 * unified half: no `openai/…` chat ref survives that is not a chat model.
 */
describe("openai.chat non-chat route signpost", () => {
  /** The seventeen ids in the committed snapshot OpenAI does not serve here. */
  const NON_CHAT_IDS = [
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5-pro",
    "gpt-5.2-pro",
    "gpt-5.4-pro",
    "gpt-5.5-pro",
    "o1-pro",
    "o3-pro",
    "gpt-daybreak-blue-latest",
    "gpt-daybreak-red-latest",
    "text-embedding-3-large",
    "text-embedding-3-small",
    "text-embedding-ada-002",
    "gpt-image-1-mini",
    "gpt-image-1.5",
    "chatgpt-image-latest",
    "gpt-realtime-2.1",
  ] as const;

  test("every one of them is in the catalog, so this is not a test about typos", () => {
    for (const id of NON_CHAT_IDS) expect(catalog[id]).toBeDefined();
  });

  test("each of them warns and names the route it is actually served on", () => {
    for (const id of NON_CHAT_IDS) {
      const result = chat.safe({ model: id, messages: [userMessage("hi")] });
      // A WARNING, not an error: wire-truth says the substrate never refuses
      // what the API might fulfil. The typed refusal is `unmodel/chat`'s, and
      // it happens by the ref not existing at all.
      expect(result.ok).toBe(true);
      const signpost = result.warnings.find((issue) => issue.code === "unsupported_capability");
      expect(signpost, id).toBeDefined();
      expect(signpost?.path).toEqual(["model"]);
      expect(signpost?.model).toBe(id);
      expect(signpost?.message).toContain("not POST /v1/chat/completions");
      expect(typeof signpost?.meta?.route).toBe("string");
      // The one thing that must never regress into silence: the request is
      // still built, at the chat URL, exactly as written.
      if (!result.ok) continue;
      expect(result.params.request.url).toBe(CHAT_COMPLETIONS_URL);
    }
  });

  test("codex names /v1/responses and says unmodel has no validator for it", () => {
    const result = chat.safe({ model: "gpt-5.3-codex", messages: [userMessage("hi")] });
    const signpost = result.warnings.find((issue) => issue.code === "unsupported_capability");
    expect(signpost?.message).toContain("POST /v1/responses");
    expect(signpost?.message).toContain("unmodel has no validator");
  });

  test("the Daybreak aliases are Responses-only too", () => {
    // "| Chat Completions | `v1/chat/completions` | Not supported |" on both
    // model pages (2026-11-12); models.dev files them as text-out with no status.
    for (const id of ["gpt-daybreak-blue-latest", "gpt-daybreak-red-latest"] as const) {
      const result = chat.safe({ model: id, messages: [userMessage("hi")] });
      const signpost = result.warnings.find((issue) => issue.code === "unsupported_capability");
      expect(signpost?.message, id).toContain("POST /v1/responses");
    }
  });

  test("the pro models are Responses-only too", () => {
    // "| Chat Completions | `v1/chat/completions` | Not supported |" on all six
    // model pages (2026-11-12); "o3-pro is available in the Responses API only".
    for (const id of ["gpt-5-pro", "gpt-5.2-pro", "gpt-5.4-pro", "gpt-5.5-pro", "o1-pro", "o3-pro"] as const) {
      const result = chat.safe({ model: id, messages: [userMessage("hi")] });
      const signpost = result.warnings.find((issue) => issue.code === "unsupported_capability");
      expect(signpost?.message, id).toContain("POST /v1/responses");
    }
    // The suffix match is exact: a dated snapshot is caught, a `-pro…` word is not.
    const snapshot = chat.safe({ model: "o3-pro-2025-06-10", messages: [userMessage("hi")] });
    expect(snapshot.warnings.some((issue) => issue.code === "unsupported_capability")).toBe(true);
    const lookalike = chat.safe({ model: "gpt-5-prompt-tuned", messages: [userMessage("hi")] });
    expect(lookalike.warnings.some((issue) => issue.code === "unsupported_capability")).toBe(false);
  });

  test("the image and realtime families point at the surface that does serve them", () => {
    const image = chat.safe({ model: "gpt-image-1.5", messages: [userMessage("hi")] });
    expect(
      image.warnings.find((i) => i.code === "unsupported_capability")?.message,
    ).toContain("`image` from `unmodel/openai`");
    const realtime = chat.safe({ model: "gpt-realtime-2.1", messages: [userMessage("hi")] });
    expect(
      realtime.warnings.find((i) => i.code === "unsupported_capability")?.message,
    ).toContain("`realtimeSession` from `unmodel/openai`");
  });

  test("a real chat model gets no signpost at all", () => {
    for (const id of ["gpt-5.2", "gpt-4o", "o3"] as const) {
      const result = chat.safe({ model: id, messages: [userMessage("hi")] });
      expect(
        result.warnings.filter((i) => i.code === "unsupported_capability"),
      ).toEqual([]);
    }
  });

  test("the runtime table and `chatScopeExclude` name the same seventeen rows", async () => {
    const overrides = (await Bun.file(
      new URL("../../../data/availability-overrides.json", import.meta.url).pathname,
    ).json()) as { chatScopeExclude: string[] };
    const globs = overrides.chatScopeExclude
      .filter((ref) => ref.startsWith("openai:"))
      .map((ref) => {
        const body = ref
          .slice("openai:".length)
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*");
        return new RegExp(`^${body}$`);
      });
    // Every text-out openai row the data file excludes is a row the check
    // warns on, and vice versa. Drift in either direction is a silent hole:
    // a ref that compiles to a 400, or a warning on a model that works.
    const textOut = Object.keys(catalog).filter((id) =>
      catalog[id]?.modalities.output.includes("text"),
    );
    const excludedByData = textOut.filter((id) => globs.some((re) => re.test(id))).sort();
    const warnedByCheck = textOut
      .filter((id) => {
        const result = chat.safe({ model: id, messages: [userMessage("hi")] });
        return result.warnings.some(
          (issue) => issue.code === "unsupported_capability" && issue.path[0] === "model",
        );
      })
      .sort();
    expect(warnedByCheck).toEqual(excludedByData);
    expect(warnedByCheck).toEqual([...NON_CHAT_IDS].sort());
  });
});

/**
 * GPT-6 on Chat Completions. Every rule here quotes a model page, the
 * reasoning guide or the GPT-6 migration guide (all read 2026-11-12); the
 * value-conditional ones ride `gpt6ChatRules` in ./constraints.ts, the enum
 * ones the `chatConstraints` rows beside it.
 */
describe("openai.chat GPT-6 rules", () => {
  const GPT6_IDS = ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6.1-sol", "gpt-6.1-terra"] as const;
  const tool = { type: "function" as const, function: { name: "lookup" } };

  test("every GPT-6 id validates clean and prices from the catalog", () => {
    const messages = [userMessage("hi")];
    const tokens = estimateChatTokens({ messages });
    for (const id of GPT6_IDS) {
      const cost = catalog[id]?.cost;
      expect(cost?.input, id).toBeGreaterThan(0);
      const r = chat.safe({ model: id, messages, max_completion_tokens: 100 });
      expect(r.ok, id).toBe(true);
      if (!r.ok) continue;
      expect(r.warnings).toEqual([]);
      const expected = (tokens * (cost?.input ?? 0)) / 1e6 + (100 * (cost?.output ?? 0)) / 1e6;
      expect(r.estimate.costUSD).toBeCloseTo(expected, 10);
    }
  });

  test("reasoning_effort is narrowed to each model page's own list", () => {
    // GPT-6 Astra and GPT-6.1 Sol: "`reasoning.effort` supports `low`, `medium`,
    // `high`, `xhigh`, and `max`." — `none` "returns HTTP 400", `minimal` is absent.
    for (const id of ["gpt-6-astra", "gpt-6.1-sol"] as const) {
      for (const effort of ["none", "minimal"] as const) {
        const r = chat.safe({ model: id, messages: [userMessage("hi")], reasoning_effort: effort });
        expect(r.ok, `${id} ${effort}`).toBe(false);
        if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
      }
      expect(chat.safe({ model: id, messages: [userMessage("hi")], reasoning_effort: "max" }).ok).toBe(true);
    }
    // GPT-6 Sol, Luna and GPT-6.1 Terra take `none`; none of them lists `minimal`.
    for (const id of ["gpt-6-sol", "gpt-6-luna", "gpt-6.1-terra"] as const) {
      expect(chat.safe({ model: id, messages: [userMessage("hi")], reasoning_effort: "none" }).ok, id).toBe(true);
      expect(chat.safe({ model: id, messages: [userMessage("hi")], reasoning_effort: "minimal" }).ok, id).toBe(false);
    }
  });

  test("tool calling requires the Responses API on Astra, 6.1 Sol and 6.1 Terra", () => {
    for (const id of ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra"] as const) {
      const r = chat.safe({ model: id, messages: [userMessage("hi")], tools: [tool] });
      expect(r.ok, id).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((e) => e.code === "unsupported_capability");
        expect(issue?.path).toEqual(["tools"]);
        expect(issue?.message).toContain("Responses API");
      }
    }
    // Terra takes `none`, and its page's sentence is unconditional all the same.
    const terra = chat.safe({
      model: "gpt-6.1-terra",
      messages: [userMessage("hi")],
      reasoning_effort: "none",
      tools: [tool],
    });
    expect(terra.ok).toBe(false);
    // An empty tool list is not a tool-calling request.
    expect(chat.safe({ model: "gpt-6-astra", messages: [userMessage("hi")], tools: [] }).ok).toBe(true);
  });

  test("Sol and Luna call tools only at reasoning_effort none", () => {
    for (const id of ["gpt-6-sol", "gpt-6-luna"] as const) {
      const atNone = chat.safe({
        model: id,
        messages: [userMessage("hi")],
        reasoning_effort: "none",
        tools: [tool],
      });
      expect(atNone.ok, id).toBe(true);
      // Absent effort is the server default `medium`, which refuses.
      const defaulted = chat.safe({ model: id, messages: [userMessage("hi")], tools: [tool] });
      expect(defaulted.ok, id).toBe(false);
      if (!defaulted.ok) expect(defaulted.errors[0]?.message).toContain('reasoning_effort: "none"');
      const legacy = chat.safe({
        model: id,
        messages: [userMessage("hi")],
        reasoning_effort: "high",
        functions: [{ name: "lookup" }],
      });
      expect(legacy.ok, id).toBe(false);
      if (!legacy.ok) expect(legacy.errors[0]?.path).toEqual(["functions"]);
    }
  });

  test("log probabilities: never on Astra, only at none on Sol and Luna, unruled on 6.1", () => {
    const astra = chat.safe({
      model: "gpt-6-astra",
      messages: [userMessage("hi")],
      logprobs: true,
      top_logprobs: 2,
    });
    expect(astra.ok).toBe(false);
    if (!astra.ok) {
      expect(astra.errors.map((e) => e.path[0]).sort()).toEqual(["logprobs", "top_logprobs"]);
    }
    // `logprobs: false` asks for none.
    expect(chat.safe({ model: "gpt-6-astra", messages: [userMessage("hi")], logprobs: false }).ok).toBe(true);

    // The chat/create reference's own example: gpt-6-sol at none with logprobs.
    const solAtNone = chat.safe({
      model: "gpt-6-sol",
      messages: [userMessage("hi")],
      reasoning_effort: "none",
      logprobs: true,
      top_logprobs: 2,
    });
    expect(solAtNone.ok).toBe(true);
    const sol = chat.safe({
      model: "gpt-6-sol",
      messages: [userMessage("hi")],
      reasoning_effort: "medium",
      logprobs: true,
    });
    expect(sol.ok).toBe(false);

    // No page names logprobs for GPT-6.1 Sol or Terra, so nothing is refused.
    for (const id of ["gpt-6.1-sol", "gpt-6.1-terra"] as const) {
      expect(chat.safe({ model: id, messages: [userMessage("hi")], logprobs: true }).ok, id).toBe(true);
    }
  });

  test("temperature and top_p are accepted at reasoning_effort none and refused elsewhere", () => {
    for (const id of ["gpt-6-sol", "gpt-6-luna", "gpt-6.1-terra"] as const) {
      expect(catalog[id]?.temperature).toBe(false);
      const atNone = chat.safe({
        model: id,
        messages: [userMessage("hi")],
        reasoning_effort: "none",
        temperature: 0.3,
        top_p: 0.9,
      });
      expect(atNone.ok, id).toBe(true);
      if (atNone.ok) expect(atNone.warnings).toEqual([]);
      const r = chat.safe({ model: id, messages: [userMessage("hi")], temperature: 0.3 });
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["temperature"]);
    }
    // Astra never reaches `none`, so the catalog's fixed sampling stands.
    const astra = chat.safe({
      model: "gpt-6-astra",
      messages: [userMessage("hi")],
      reasoning_effort: "low",
      temperature: 0.3,
    });
    expect(astra.ok).toBe(false);
  });

  test("prompt_cache_retention is 24h-only from gpt-5.5 on", () => {
    // "For `gpt-5.5`, `gpt-5.5-pro`, and future models, only `24h` is supported."
    // "Future models" is read off the catalog: every chat-served row released
    // on or after gpt-5.5, so a new row cannot slip past the narrowing. The
    // Responses-only rows (gpt-5.5-pro, Daybreak) are signposted instead.
    const cut = catalog["gpt-5.5"]?.releaseDate ?? "";
    const signposted = (id: string): boolean =>
      chat
        .safe({ model: id, messages: [userMessage("hi")] })
        .warnings.some((issue) => issue.code === "unsupported_capability" && issue.path[0] === "model");
    const ids = Object.keys(catalog)
      .filter((id) => catalog[id]?.modalities.output.includes("text"))
      .filter((id) => (catalog[id]?.releaseDate ?? "") >= cut && !signposted(id))
      .sort();
    expect(ids).toEqual([
      "gpt-5.5",
      "gpt-5.6",
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-6-astra",
      "gpt-6-luna",
      "gpt-6-sol",
      "gpt-6.1-sol",
      "gpt-6.1-terra",
    ]);
    for (const id of ids) {
      expect(
        chat.safe({ model: id, messages: [userMessage("hi")], prompt_cache_retention: "24h" }).ok,
        id,
      ).toBe(true);
      const r = chat.safe({ model: id, messages: [userMessage("hi")], prompt_cache_retention: "in_memory" });
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
    }
    // Models before the sentence's cut keep both values.
    expect(
      chat.safe({ model: "gpt-5.4", messages: [userMessage("hi")], prompt_cache_retention: "in_memory" }).ok,
    ).toBe(true);
  });
});
