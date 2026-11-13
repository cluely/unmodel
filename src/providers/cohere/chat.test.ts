import { describe, expect, test } from "bun:test";
import { chat, CHAT_URL } from "./chat";
import type { ChatBody } from "./chat";

// Real catalog ids used throughout:
//   command-a-03-2025        — toolCall, no reasoning, 256k ctx, 8000 output, $2.5/$10 per M
//   command-a-reasoning-08-2025 — reasoning: true
//   command-r-08-2024        — 4000 output, $0.15/$0.6 per M
//   c4ai-aya-vision-32b      — text+image input
//   command-a-vision-07-2025 — text+image input, toolCall: false

const HI: ChatBody["messages"] = [{ role: "user", content: "hi" }];

function invalid(params: unknown) {
  return chat.safe(params as ChatBody);
}

// A real 1x1 PNG.
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

const TOOL: NonNullable<ChatBody["tools"]>[number] = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Gets the weather",
    parameters: { type: "object", properties: { city: { type: "string" } } },
  },
};

describe("cohere.chat happy path", () => {
  test("enumerable output is the exact wire body", () => {
    const params = { model: "command-a-03-2025", messages: HI, max_tokens: 100 } as const;
    const validated = chat(params);
    expect(Object.keys(validated).sort()).toEqual(["max_tokens", "messages", "model"]);
    expect(JSON.parse(JSON.stringify(validated))).toEqual({
      model: "command-a-03-2025",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
    });
  });

  test("request meta carries the v2 chat URL", () => {
    const validated = chat({ model: "command-a-03-2025", messages: HI });
    expect(validated.request.url).toBe(CHAT_URL);
    expect(validated.request.method).toBe("POST");
    expect(validated.request.headers["content-type"]).toBe("application/json");
  });

  test('toSdk("cohere") re-shapes snake_case params into cohere-ai camelCase', () => {
    const validated = chat({
      model: "command-a-03-2025",
      messages: [
        { role: "user", content: "what's the weather?" },
        {
          role: "assistant",
          tool_plan: "I will check the weather.",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: '{"temp": 20}' },
      ],
      tools: [TOOL],
      max_tokens: 100,
      stop_sequences: ["END"],
      strict_tools: true,
      frequency_penalty: 0.1,
      thinking: { type: "disabled" },
    });
    const sdk = validated.toSdk("cohere");
    expect(sdk.maxTokens).toBe(100);
    expect(sdk.stopSequences).toEqual(["END"]);
    expect(sdk.strictTools).toBe(true);
    expect(sdk.frequencyPenalty).toBe(0.1);
    expect(sdk.thinking).toEqual({ type: "disabled" });
    // The snake_case wire key is GONE from the SDK shape, which the type now
    // states outright — so the assertion has to leave the type to ask the
    // runtime. Keeping it is still worth a line: the type is hand-mirrored
    // from an SDK this repo does not depend on, so the runtime is the only
    // thing that can prove the rename actually happened.
    expect((sdk as unknown as Record<string, unknown>)["max_tokens"]).toBeUndefined();
    const messages = sdk.messages as Array<Record<string, unknown>>;
    expect(messages[1]?.toolPlan).toBe("I will check the weather.");
    expect(messages[1]?.tool_calls).toBeUndefined();
    expect(messages[2]?.toolCallId).toBe("call_1");
    expect(messages[2]?.tool_call_id).toBeUndefined();

    // response_format maps json_schema → jsonSchema (validated without tools —
    // json_object cannot be combined with tools/documents).
    const structured = chat({
      model: "command-a-03-2025",
      messages: [{ role: "user", content: "return JSON" }],
      response_format: { type: "json_object", json_schema: { type: "object" } },
    });
    expect(structured.toSdk("cohere").responseFormat).toEqual({
      type: "json_object",
      jsonSchema: { type: "object" },
    });
  });

  test("toSdk names the available targets when handed an unknown one", () => {
    const validated = chat({ model: "command-a-03-2025", messages: HI });
    expect(() => (validated.toSdk as (t: string) => unknown)("openai")).toThrow(
      /"openai" is not an SDK target for this endpoint\. Available: cohere\./,
    );
  });

  test("cohere.chat declares no .toApi targets (no availability table is generated)", () => {
    const validated = chat({ model: "command-a-03-2025", messages: HI });
    expect("toApi" in validated).toBe(false);
    expect("toApiSafe" in validated).toBe(false);
  });

  test("safe() succeeds with an estimate priced from catalog rates", () => {
    const result = chat.safe({ model: "command-r-08-2024", messages: HI, max_tokens: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
      expect(result.estimate.inputTokens).toBeGreaterThan(0);
      // ~5 input tokens at $0.15/M + 1000 output tokens at $0.6/M ≈ $0.0006
      expect(result.estimate.costUSD).toBeGreaterThan(0.0005);
      expect(result.estimate.costUSD).toBeLessThan(0.0008);
    }
  });

  test("unknown model warns and names the cohere catalog", () => {
    const result = chat.safe({ model: "command-z-2027", messages: HI });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(result.warnings[0]?.message).toContain("cohere");
    }
  });
});

describe("cohere.chat shape", () => {
  test("empty messages is invalid_shape", () => {
    const result = invalid({ model: "command-a-03-2025", messages: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("invalid_shape");
  });

  test("documented sampling ranges are enforced", () => {
    for (const overrides of [
      { p: 0.999 },
      { k: 501 },
      { frequency_penalty: 1.5 },
      { presence_penalty: -0.1 },
      { temperature: -1 },
      { stop_sequences: ["a", "b", "c", "d", "e", "f"] },
    ]) {
      const result = invalid({ model: "command-a-03-2025", messages: HI, ...overrides });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe("invalid_shape");
        expect(result.errors[0]?.path[0]).toBe(Object.keys(overrides)[0] as string);
      }
    }
  });

  test("tool_choice only accepts REQUIRED or NONE", () => {
    const result = invalid({ model: "command-a-03-2025", messages: HI, tool_choice: "auto" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toEqual(["tool_choice"]);
  });

  test("a tool message must answer a declared tool_call id", () => {
    const result = chat.safe({
      model: "command-a-03-2025",
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", tool_call_id: "call_missing", content: "{}" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.path).toEqual(["messages", 1, "tool_call_id"]);
    }
  });

  test("unknown top-level keys warn as unknown_param", () => {
    const result = invalid({ model: "command-a-03-2025", messages: HI, top_p: 0.9 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toContain("unknown_param");
      expect(result.warnings.find((w) => w.code === "unknown_param")?.path).toEqual(["top_p"]);
    }
  });
});

describe("cohere.chat capabilities", () => {
  test("tools on a toolCall-less model is unsupported_capability", () => {
    // "Be aware that tool use isn't supported with this model." —
    // https://docs.cohere.com/docs/command-a-vision (2026-11-12)
    const result = chat.safe({ model: "command-a-vision-07-2025", messages: HI, tools: [TOOL] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_capability");
      expect(result.errors[0]?.path).toEqual(["tools"]);
    }
  });

  test("thinking on a non-reasoning model is unsupported_capability", () => {
    const result = chat.safe({
      model: "command-a-03-2025",
      messages: HI,
      thinking: { type: "enabled", token_budget: 2000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toEqual(["thinking"]);

    const ok = chat.safe({
      model: "command-a-reasoning-08-2025",
      messages: HI,
      thinking: { type: "enabled", token_budget: 2000 },
    });
    expect(ok.ok).toBe(true);
  });

  test("max_tokens above the model's output limit is over_output_limit", () => {
    const result = chat.safe({ model: "command-r-08-2024", messages: HI, max_tokens: 5000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("over_output_limit");
      expect(result.errors[0]?.meta).toEqual({ requested: 5000, limit: 4000 });
    }
  });

  test("image_url parts on a text-only model are unsupported_capability", () => {
    const image = {
      type: "image_url" as const,
      image_url: { url: `data:image/png;base64,${TINY_PNG}` },
    };
    const result = chat.safe({
      model: "command-a-03-2025",
      messages: [{ role: "user", content: [image, { type: "text", text: "describe" }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_capability");
      expect(result.errors[0]?.path).toEqual(["messages", 0, "content", 0]);
    }

    const ok = chat.safe({
      model: "command-a-vision-07-2025",
      messages: [{ role: "user", content: [image, { type: "text", text: "describe" }] }],
    });
    expect(ok.ok).toBe(true);
  });
});

describe("cohere.chat cross-param rules", () => {
  test("response_format json_object with tools is unsupported_param", () => {
    const result = chat.safe({
      model: "command-a-03-2025",
      messages: HI,
      tools: [TOOL],
      response_format: { type: "json_object" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_param");
      expect(result.errors[0]?.path).toEqual(["response_format"]);
      expect(result.errors[0]?.meta?.source).toContain("docs.cohere.com");
    }
  });

  test("response_format json_object with documents is unsupported_param", () => {
    const result = chat.safe({
      model: "command-a-03-2025",
      messages: HI,
      documents: [{ data: { title: "doc", snippet: "text" } }],
      response_format: { type: "json_object" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("unsupported_param");
  });

  test("response_format text with tools passes", () => {
    const result = chat.safe({
      model: "command-a-03-2025",
      messages: HI,
      tools: [TOOL],
      response_format: { type: "text" },
    });
    expect(result.ok).toBe(true);
  });
});

describe("cohere.chat images", () => {
  test("more than 20 images per request is rejected", () => {
    const image = {
      type: "image_url" as const,
      image_url: { url: `data:image/png;base64,${TINY_PNG}` },
    };
    const result = chat.safe({
      model: "c4ai-aya-vision-32b",
      messages: [{ role: "user", content: Array.from({ length: 21 }, () => image) }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.errors.find((e) => e.meta?.limit === 20);
      expect(issue?.code).toBe("invalid_shape");
      expect(issue?.meta?.images).toBe(21);
    }
  });

  test("a declared oversize URL image trips the 20MB total cap", () => {
    const result = chat.safe(
      {
        model: "c4ai-aya-vision-32b",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "https://example.com/huge.png" } },
              { type: "text", text: "describe" },
            ],
          },
        ],
      },
      { media: [{ path: ["messages", 0, "content", 0], bytes: 25 * 1024 * 1024 }] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("media_too_large");
    }
  });
});

describe("cohere.chat north-small-translate-1.0", () => {
  // https://docs.cohere.com/docs/north-small-translate-1.0 (2026-11-12): "Model
  // ID north-small-translate-1.0", "Context Window: 16K tokens Max Output
  // Tokens: 16K tokens", and a capability card with Reasoning, Image Inputs,
  // Tool Use and Structured Outputs greyed out.
  const NST = "north-small-translate-1.0";

  test("validates under Cohere's own id and prices at the free tier's $0", () => {
    const result = chat.safe({ model: NST, messages: HI, max_tokens: 16000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
      expect(result.estimate.costUSD).toBe(0);
    }
  });

  test("models.dev's north-small-translate-09-2026 spelling is not a Cohere id", () => {
    const result = chat.safe({ model: "north-small-translate-09-2026", messages: HI });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("max_tokens above the 16K output limit is over_output_limit", () => {
    const result = chat.safe({ model: NST, messages: HI, max_tokens: 16001 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("over_output_limit");
      expect(result.errors[0]?.meta).toEqual({ requested: 16001, limit: 16000 });
    }
  });

  test("tools, thinking, json_object and image input are unsupported_capability", () => {
    const image = {
      type: "image_url" as const,
      image_url: { url: `data:image/png;base64,${TINY_PNG}` },
    };
    const refusals: Array<[Partial<ChatBody>, Array<string | number>]> = [
      [{ tools: [TOOL] }, ["tools"]],
      [{ thinking: { type: "enabled" } }, ["thinking"]],
      [{ response_format: { type: "json_object" } }, ["response_format"]],
      [{ messages: [{ role: "user", content: [image] }] }, ["messages", 0, "content", 0]],
    ];
    for (const [overrides, path] of refusals) {
      const result = chat.safe({ model: NST, messages: HI, ...overrides });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe("unsupported_capability");
        expect(result.errors[0]?.path).toEqual(path);
      }
    }
  });
});

describe("cohere.chat tiny-aya", () => {
  test("the four instruction-tuned variants validate; no published price means no cost", () => {
    // "The instruction-tuned Tiny Aya variants (`tiny-aya-global`,
    // `tiny-aya-earth`, `tiny-aya-fire`, `tiny-aya-water`) are available on the
    // Cohere API via the Chat endpoint." — https://docs.cohere.com/docs/tiny-aya
    // (2026-11-12). cohere.com/pricing carries no rate for them.
    for (const model of ["tiny-aya-global", "tiny-aya-earth", "tiny-aya-fire", "tiny-aya-water"]) {
      const result = chat.safe({ model, messages: HI, max_tokens: 8000 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.warnings).toEqual([]);
        expect(result.estimate.costUSD).toBeUndefined();
      }
    }
  });

  test("max_tokens above the 8k output limit is over_output_limit", () => {
    const result = chat.safe({ model: "tiny-aya-global", messages: HI, max_tokens: 8001 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("over_output_limit");
  });
});

describe("cohere.chat north-mini-code-1.0", () => {
  test("validates under Cohere's own id; json_object passes — the model page's card renders it active", () => {
    const result = chat.safe({
      model: "north-mini-code-1.0",
      messages: HI,
      response_format: { type: "json_object" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  test("models.dev's north-mini-code-1-0 spelling is not a Cohere id", () => {
    const result = chat.safe({ model: "north-mini-code-1-0", messages: HI });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("its catalog-backed checks run: max_tokens above the 64K output limit is refused", () => {
    const result = chat.safe({ model: "north-mini-code-1.0", messages: HI, max_tokens: 64001 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("over_output_limit");
  });
});

describe("cohere.chat command a+/reasoning/translate/vision pricing", () => {
  test("no costUSD — Cohere publishes no per-token rate its own pages agree on", () => {
    for (const model of [
      "command-a-plus-05-2026",
      "command-a-reasoning-08-2025",
      "command-a-translate-08-2025",
      "command-a-vision-07-2025",
    ]) {
      const result = chat.safe({ model, messages: HI, max_tokens: 100 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.warnings).toEqual([]);
        expect(result.estimate.costUSD).toBeUndefined();
      }
    }
  });

  test("command-a-03-2025 keeps its published $2.50 / $10 rate", () => {
    // "Pricing Input $ 2.5 / 1M tokens Output $ 10 / 1M tokens" —
    // https://docs.cohere.com/docs/command-a (2026-11-12)
    const result = chat.safe({ model: "command-a-03-2025", messages: HI, max_tokens: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.estimate.costUSD).toBeGreaterThan(0.01);
  });
});
