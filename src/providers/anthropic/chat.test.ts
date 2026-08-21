import { describe, expect, test } from "bun:test";
import {
  chat,
  checkCapabilities,
  checkThinkingCompatibility,
  ANTHROPIC_VERSION,
  MESSAGES_URL,
} from "./chat";
import type { MessagesBody } from "./chat";
import type { ModelInfo } from "../../core/catalog-types";
import type { PipelineContext, IssueInput } from "../../core/pipeline";
import { heuristicTokenizer } from "../../core/tokens";
import { TranslationUnavailableError } from "../../core/translate/errors";
import { createToApi } from "../../core/translate/retarget";
import type { ValidateResult } from "../../core/result";

// Real catalog ids used throughout:
//   claude-sonnet-4-5  — temperature ok, reasoning, 1M context, 64000 output
//   claude-haiku-4-5   — 200k context, 64000 output
//   claude-opus-5      — temperature: false (sampling params removed)

const HI: MessagesBody["messages"] = [{ role: "user", content: "hi" }];

function invalid(params: unknown) {
  return chat.safe(params as MessagesBody);
}

// A real 1x1 PNG (from the Anthropic vision docs).
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

/** Builds bytes with a valid PNG header claiming the given dimensions. */
function pngBytes(width: number, height: number, totalBytes = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(totalBytes, 33));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[11] = 13; // IHDR chunk length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function imageMessage(data: string): MessagesBody["messages"] {
  return [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data } },
        { type: "text", text: "Describe this image." },
      ],
    },
  ];
}

describe("anthropic.chat happy path", () => {
  test("enumerable output is the exact wire body", () => {
    const params = { model: "claude-sonnet-4-5", max_tokens: 1024, messages: HI } as const;
    const validated = chat(params);

    expect(Object.keys(validated).sort()).toEqual(["max_tokens", "messages", "model"]);
    expect(JSON.parse(JSON.stringify(validated))).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });
  });

  test("request meta carries url, method, and the anthropic-version header", () => {
    const validated = chat({ model: "claude-sonnet-4-5", max_tokens: 1024, messages: HI });
    expect(validated.request.url).toBe(MESSAGES_URL);
    expect(validated.request.method).toBe("POST");
    expect(validated.request.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(validated.request.headers["content-type"]).toBe("application/json");
  });

  test('toSdk("anthropic") returns the same wire shape', () => {
    const validated = chat({ model: "claude-sonnet-4-5", max_tokens: 1024, messages: HI });
    expect(validated.toSdk("anthropic")).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });
  });

  test("toSdk names the available targets when handed an unknown one", () => {
    const validated = chat({ model: "claude-sonnet-4-5", max_tokens: 1024, messages: HI });
    expect(() => (validated.toSdk as (t: string) => unknown)("openai")).toThrow(
      /"openai" is not an SDK target for this endpoint\. Available: anthropic, ai-sdk\./,
    );
  });

  test("safe() succeeds with no warnings and an estimate", () => {
    const result = chat.safe({ model: "claude-sonnet-4-5", max_tokens: 1000, messages: HI });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
      expect(result.estimate.inputTokens).toBeGreaterThan(0);
      // ~5 input tokens at $3/M + 1000 output tokens at $15/M
      expect(result.estimate.costUSD).toBeGreaterThan(0.014);
      expect(result.estimate.costUSD).toBeLessThan(0.017);
    }
  });
});

describe("anthropic.chat toApi", () => {
  const claude = () => chat({ model: "claude-opus-5", max_tokens: 1024, messages: HI });

  test("toApi/toApiSafe are attached and non-enumerable", () => {
    const validated = claude();
    expect(Object.keys(validated)).toEqual(["model", "max_tokens", "messages"]);
    expect(Object.getOwnPropertyDescriptor(validated, "toApi")?.enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(validated, "toApiSafe")?.enumerable).toBe(false);
  });

  test("a provider that does not serve the model is an error naming the ones that do", () => {
    // `.toApi("groq")` is a COMPILE error on a Claude request (asserted in
    // test/types/anthropic.test-d.ts); the cast is what lets this file check
    // that the runtime guard behind that type is there too, for callers whose
    // model id is only known at runtime.
    const validated = claude() as unknown as {
      toApi(target: string): unknown;
      toApiSafe(target: string): ValidateResult<object>;
    };
    const result = validated.toApiSafe("groq");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toEqual(["unsupported_capability"]);
      expect(result.errors[0]?.message).toContain('"claude-opus-5" is not served by groq');
      // Names the providers that DO serve it, straight from the generated data.
      expect(result.errors[0]?.message).toContain("openrouter");
    }
    expect(() => validated.toApi("groq")).toThrow(/is not served by groq/);
  });

  test("the cross-dialect hop to openrouter produces a chat-completions body", () => {
    // The flagship path: anthropic-messages → openai-chat through the IR.
    const routed = claude().toApi("openrouter");
    expect(JSON.parse(JSON.stringify(routed))).toEqual({
      model: "anthropic/claude-opus-5",
      messages: [{ role: "user", content: "hi" }],
      max_completion_tokens: 1024,
    });
    expect(routed.request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    // Lossless apart from the id respelling, which is always reported.
    expect(routed.warnings.map((w) => w.code)).toEqual(["id_respelled"]);
  });

  test("a dialect this endpoint declares no decoder for is a named failure", () => {
    // anthropic.chat declares exactly one decoder (openai-chat), because
    // that is the only dialect its availability data can statically reach.
    // Anything else must fail by name, never as a silently wrong body.
    const spec = {
      from: "anthropic-messages" as const,
      endpoint: "anthropic.chat",
      modelId: () => "claude-opus-5",
      availability: { "claude-opus-5": { google: "gemini-3-pro" } },
      encode: () => ({ source: "anthropic-messages" as const, model: "x", messages: [], settings: {} }),
      decoders: {},
    };
    const retarget = createToApi(spec)({});
    const { result, structural } = retarget("google");
    expect(result.ok).toBe(false);
    // `.toApi` throws this verbatim; `.toApiSafe` reports the same message
    // through `result.errors` instead.
    expect(TranslationUnavailableError.isInstance(structural)).toBe(true);
    expect(structural?.message).toMatch(
      /crosses wire dialects \(anthropic-messages → gemini\) and this build ships no codec/,
    );
  });

  test("factory-configured targets are rejected with the reason, not a bad URL", () => {
    // amazon-bedrock IS in the generated data (phase 3 needs no codegen change)
    // but has no provider-wide URL, so the one-arg call cannot produce one.
    expect(() => (claude().toApi as (t: string) => unknown)("amazon-bedrock")).toThrow(
      /amazon-bedrock has no provider-wide URL; it needs region/,
    );
  });

  test("an unknown target id is named as such", () => {
    expect(() => (claude().toApi as (t: string) => unknown)("not-a-provider")).toThrow(
      /"not-a-provider" is not a known `\.toApi` target/,
    );
  });
});

describe("anthropic.chat shape", () => {
  test("missing max_tokens is invalid_shape", () => {
    const result = invalid({ model: "claude-sonnet-4-5", messages: HI });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("invalid_shape");
      expect(result.errors.some((e) => e.path[0] === "max_tokens")).toBe(true);
    }
  });

  test("empty messages is invalid_shape", () => {
    const result = invalid({ model: "claude-sonnet-4-5", max_tokens: 100, messages: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("invalid_shape");
  });

  test("first message must have role user", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "assistant", content: "hello" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.path).toEqual(["messages", 0, "role"]);
      expect(result.errors[0]?.message).toContain('"user"');
    }
  });

  test("thinking budget_tokens below 1024 is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      messages: HI,
      thinking: { type: "enabled", budget_tokens: 512 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.path).toEqual(["thinking", "budget_tokens"]);
    }
  });

  test("thinking budget_tokens >= max_tokens is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      messages: HI,
      thinking: { type: "enabled", budget_tokens: 4096 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.path).toEqual(["thinking", "budget_tokens"]);
      // Interleaved thinking (beta header) legitimately exceeds max_tokens;
      // the message points at the severity-override escape hatch.
      expect(result.errors[0]?.message).toContain("interleaved");
    }
  });

  test("budget_tokens strictly below max_tokens passes", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      messages: HI,
      thinking: { type: "enabled", budget_tokens: 4095 },
    });
    expect(result.ok).toBe(true);
  });

  test("trailing assistant prefill with thinking on is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      messages: [
        { role: "user", content: "What is the Greek name for Sun?" },
        { role: "assistant", content: "The best answer is (" },
      ],
      thinking: { type: "enabled", budget_tokens: 2048 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.path).toEqual(["messages", 1, "role"]);
      expect(result.errors[0]?.message).toContain("prefill");
    }
  });

  test("trailing assistant prefill without thinking passes", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        { role: "user", content: "What is the Greek name for Sun?" },
        { role: "assistant", content: "The best answer is (" },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe("anthropic.chat crash safety on malformed blocks", () => {
  test("{type:'text'} without text never throws", () => {
    let result: unknown;
    expect(() => {
      result = chat.safe({
        model: "claude-sonnet-4-5",
        max_tokens: 100,
        messages: [{ role: "user", content: [{ type: "text" }] }],
      } as unknown as MessagesBody);
    }).not.toThrow();
    expect(result).toBeDefined();
  });

  test("{type:'document'} without source never throws", () => {
    let result: unknown;
    expect(() => {
      result = chat.safe({
        model: "claude-sonnet-4-5",
        max_tokens: 100,
        messages: [{ role: "user", content: [{ type: "document" }] }],
      } as unknown as MessagesBody);
    }).not.toThrow();
    expect(result).toBeDefined();
  });

  test("assorted payload-less blocks contribute 0 tokens and never throw", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text" },
            { type: "thinking" },
            { type: "tool_use" },
            { type: "tool_result" },
            { type: "document", source: 42 },
            { type: "image" },
          ],
        },
      ],
    } as unknown as MessagesBody);
    // The request may or may not be reported invalid, but safe() must return.
    expect(typeof result.ok).toBe("boolean");
  });
});

describe("anthropic.chat tool_use/tool_result pairing", () => {
  const toolUseTurn: MessagesBody["messages"] = [
    { role: "user", content: "weather in Paris?" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "Paris" } }],
    },
  ];

  test("tool_result immediately following its tool_use passes", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        ...toolUseTurn,
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "22C, sunny" }],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  test("text AFTER the tool_result in the same user message passes", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        ...toolUseTurn,
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_01", content: "22C, sunny" },
            { type: "text", text: "What should I wear?" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  test("tool_result with an unknown tool_use_id is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        ...toolUseTurn,
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_MISSING", content: "22C" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.every((e) => e.code === "invalid_shape")).toBe(true);
      // The mismatched tool_result AND the now-unanswered tool_use both report.
      expect(result.errors.map((e) => e.path.join("."))).toContain(
        "messages.2.content.0.tool_use_id",
      );
      expect(result.errors.map((e) => e.path.join("."))).toContain("messages.1.content.0.id");
    }
  });

  test("tool_result referencing a LATER tool_use is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "22C" }],
        },
        ...toolUseTurn.slice(1),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path.includes("tool_use_id"))).toBe(true);
    }
  });

  test("tool_result answering an EARLIER (not immediately preceding) assistant turn fails", () => {
    // [user, assistant(tool_use), user(text), assistant, user(tool_result)]
    // 400s on the API: results must immediately follow their tool use turn.
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        ...toolUseTurn,
        { role: "user", content: "hold on" },
        { role: "assistant", content: "Sure, take your time." },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "22C" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((e) => e.path.join("."));
      // The tool_use is unanswered in the immediately following user message...
      expect(paths).toContain("messages.1.content.0.id");
      // ...and the late tool_result references a non-adjacent assistant turn.
      expect(paths).toContain("messages.4.content.0.tool_use_id");
    }
  });

  test("unanswered tool_use followed by a text-only user message fails", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [...toolUseTurn, { role: "user", content: "never mind" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.path).toEqual(["messages", 1, "content", 0, "id"]);
    }
  });

  test("tool_result placed after a text block is invalid_shape (results must come first)", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        ...toolUseTurn,
        {
          role: "user",
          content: [
            { type: "text", text: "Here are the results:" },
            { type: "tool_result", tool_use_id: "toolu_01", content: "22C" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.path.join(".") === "messages.2.content.1" && e.message.includes("FIRST"),
        ),
      ).toBe(true);
    }
  });

  test("duplicate tool_result for the same tool_use id is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        ...toolUseTurn,
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_01", content: "22C" },
            { type: "tool_result", tool_use_id: "toolu_01", content: "22C again" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) =>
            e.path.join(".") === "messages.2.content.1.tool_use_id" &&
            e.message.includes("duplicate"),
        ),
      ).toBe(true);
    }
  });

  test("parallel tool_use ids all answered in the next user message passes", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        { role: "user", content: "weather in Paris and London?" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "Paris" } },
            { type: "tool_use", id: "toolu_02", name: "get_weather", input: { city: "London" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_01", content: "22C" },
            { type: "tool_result", tool_use_id: "toolu_02", content: "17C" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe("anthropic.chat max_tokens: 0 (prompt-cache pre-warm)", () => {
  test("max_tokens: 0 alone is valid", () => {
    const result = chat.safe({ model: "claude-sonnet-4-5", max_tokens: 0, messages: HI });
    expect(result.ok).toBe(true);
  });

  test("max_tokens: 0 with stream: true is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 0,
      messages: HI,
      stream: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.path).toEqual(["stream"]);
    }
  });

  test("max_tokens: 0 with extended thinking is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 0,
      messages: HI,
      thinking: { type: "enabled", budget_tokens: 2048 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path.join(".") === "thinking")).toBe(true);
    }
  });

  test("max_tokens: 0 with output_config.format is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 0,
      messages: HI,
      output_config: { format: { type: "json_schema" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.path).toEqual(["output_config", "format"]);
    }
  });

  test("max_tokens: 0 with forced tool_choice is invalid_shape", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 0,
      messages: HI,
      tools: [{ name: "f", input_schema: { type: "object" } }],
      tool_choice: { type: "any" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.path).toEqual(["tool_choice"]);
    }
  });
});

describe("anthropic.chat catalog + constraints", () => {
  test("unknown model is a warning, not an error", () => {
    const result = chat.safe({ model: "claude-next-9000", max_tokens: 100, messages: HI });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level params warn and pass through", () => {
    const result = invalid({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: HI,
      brand_new_param: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
      expect((result.params as unknown as Record<string, unknown>)["brand_new_param"]).toBe(true);
    }
  });

  test("temperature on claude-opus-5 is unsupported_param", () => {
    const result = chat.safe({
      model: "claude-opus-5",
      max_tokens: 100,
      messages: HI,
      // @ts-expect-error — the catalog marks this generation `temperature:
      // false`, so the arm types `temperature` as `1`. Kept as a runtime test:
      // the compile error is the type layer's answer, this is the validator's,
      // and a JS caller only ever gets the second one.
      temperature: 0.7,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("unsupported_param");
      expect(result.errors[0]?.path).toEqual(["temperature"]);
    }
  });

  test("top_p 0.9 and top_k on claude-opus-5 are unsupported_param", () => {
    const result = chat.safe({
      model: "claude-opus-5",
      max_tokens: 100,
      messages: HI,
      // `top_p` is deliberately NOT narrowed: its rule is a numeric lower
      // bound (>= 0.99), which has no honest literal type.
      top_p: 0.9,
      // @ts-expect-error — `top_k` is `never` on this generation: the deny
      // table says any value returns a 400.
      top_k: 40,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((e) => e.path[0]).sort();
      expect(paths).toEqual(["top_k", "top_p"]);
      expect(result.errors.every((e) => e.code === "unsupported_param")).toBe(true);
      expect(result.errors[0]?.meta?.source).toBeString();
    }
  });

  test("documented backwards-compatible defaults pass on claude-opus-5", () => {
    // API deprecation notes: temperature 1.0 and top_p >= 0.99 remain accepted
    // on sampling-removed generations.
    const result = chat.safe({
      model: "claude-opus-5",
      max_tokens: 100,
      messages: HI,
      temperature: 1,
      top_p: 0.995,
    });
    expect(result.ok).toBe(true);
  });

  test("top_k on claude-opus-5 rejects ANY value, including with thinking (no duplicates)", () => {
    const result = chat.safe({
      model: "claude-opus-5",
      max_tokens: 4096,
      messages: HI,
      thinking: { type: "adaptive" },
      // @ts-expect-error — `top_k` is `never` on this generation; the runtime
      // assertion below (exactly one issue, no duplicate) still matters.
      top_k: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Exactly ONE issue at top_k: the deny table reports it and the
      // thinking-compatibility check must not duplicate it.
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("unsupported_param");
      expect(result.errors[0]?.path).toEqual(["top_k"]);
    }
  });

  test("temperature on claude-sonnet-4-5 is fine", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: HI,
      temperature: 0.7,
    });
    expect(result.ok).toBe(true);
  });

  test("max_tokens over the model output limit is over_output_limit", () => {
    const result = chat.safe({ model: "claude-haiku-4-5", max_tokens: 70000, messages: HI });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("over_output_limit");
      expect(result.errors[0]?.path).toEqual(["max_tokens"]);
      expect(result.errors[0]?.meta?.limit).toBe(64000);
    }
  });
});

describe("anthropic.chat thinking compatibility", () => {
  const base = { model: "claude-sonnet-4-5", max_tokens: 4096, messages: HI } as const;
  const thinking = { type: "enabled", budget_tokens: 2048 } as const;

  test("temperature with thinking enabled is rejected", () => {
    const result = chat.safe({ ...base, thinking, temperature: 0.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("unsupported_param");
      expect(result.errors[0]?.path).toEqual(["temperature"]);
      expect(result.errors[0]?.meta?.source).toBeString();
    }
  });

  test("top_k with thinking enabled is rejected", () => {
    const result = chat.safe({ ...base, thinking, top_k: 40 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toEqual(["top_k"]);
  });

  test("top_p below 0.95 with thinking is rejected; 0.97 passes", () => {
    const bad = chat.safe({ ...base, thinking, top_p: 0.9 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.path).toEqual(["top_p"]);

    const good = chat.safe({ ...base, thinking, top_p: 0.97 });
    expect(good.ok).toBe(true);
  });

  test("forced tool_choice with manual extended thinking is rejected", () => {
    const result = chat.safe({
      ...base,
      thinking,
      tools: [{ name: "f", input_schema: { type: "object" } }],
      tool_choice: { type: "any" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_param");
      expect(result.errors[0]?.path).toEqual(["tool_choice"]);
    }
  });

  test("thinking without sampling params passes", () => {
    const result = chat.safe({ ...base, thinking });
    expect(result.ok).toBe(true);
  });

  test("thinking disabled on claude-fable-5 is rejected (cannot be turned off)", () => {
    const result = chat.safe({
      model: "claude-fable-5",
      max_tokens: 1024,
      messages: HI,
      // @ts-expect-error — `{ type: "disabled" }` is excluded from this
      // model's `thinking` arm: it always thinks.
      thinking: { type: "disabled" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("unsupported_param");
      expect(result.errors[0]?.path).toEqual(["thinking"]);
    }
  });

  test("thinking disabled at effort xhigh on claude-opus-5 is rejected", () => {
    const result = chat.safe({
      model: "claude-opus-5",
      max_tokens: 1024,
      messages: HI,
      thinking: { type: "disabled" },
      output_config: { effort: "xhigh" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.path).toEqual(["thinking"]);
    }
  });

  test("thinking disabled at effort high on claude-opus-5 passes", () => {
    const result = chat.safe({
      model: "claude-opus-5",
      max_tokens: 1024,
      messages: HI,
      thinking: { type: "disabled" },
      output_config: { effort: "high" },
    });
    expect(result.ok).toBe(true);
  });
});

describe("anthropic.chat image media rules", () => {
  test("a small real PNG passes", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: imageMessage(TINY_PNG),
    });
    expect(result.ok).toBe(true);
  });

  test("image estimation adds the standard-tier per-image token cap (1568)", () => {
    const withImage = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: imageMessage(TINY_PNG),
    });
    expect(withImage.ok).toBe(true);
    if (withImage.ok) {
      expect(withImage.estimate.inputTokens).toBeGreaterThanOrEqual(1568);
      expect(withImage.estimate.inputTokens).toBeLessThan(4784);
    }
  });

  test("high-resolution models estimate 4784 tokens per image", () => {
    const withImage = chat.safe({
      model: "claude-opus-5",
      max_tokens: 100,
      messages: imageMessage(TINY_PNG),
    });
    expect(withImage.ok).toBe(true);
    if (withImage.ok) expect(withImage.estimate.inputTokens).toBeGreaterThanOrEqual(4784);
  });

  test("URL and file image sources pass without byte inspection", () => {
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: "https://example.com/a.png" } },
            { type: "image", source: { type: "file", file_id: "file_abc" } },
            { type: "text", text: "Describe these." },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  test("declared metadata for a URL image source is enforced", () => {
    const result = chat.safe(
      {
        model: "claude-sonnet-4-5",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: "https://example.com/huge.png" } },
            ],
          },
        ],
      },
      { media: [{ path: ["messages", 0, "content", 0], width: 9000, height: 9000 }] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("media_dimensions_exceeded");
      expect(result.errors[0]?.path).toEqual(["messages", 0, "content", 0]);
    }
  });

  test("images above 8000x8000 px are media_dimensions_exceeded", () => {
    const huge = Buffer.from(pngBytes(9000, 9000)).toString("base64");
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: imageMessage(huge),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("media_dimensions_exceeded");
      expect(result.errors[0]?.path).toEqual(["messages", 0, "content", 0]);
    }
  });

  test("images above 10MB base64-encoded are media_too_large", () => {
    const big = Buffer.from(pngBytes(10, 10, 8 * 1024 * 1024)).toString("base64");
    const result = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: imageMessage(big),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("media_too_large");
  });

  test("more than 20 images triggers the stricter 2000px per-dimension limit", () => {
    const wide = Buffer.from(pngBytes(2100, 100)).toString("base64");
    const image = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: wide },
    } as const;
    const twentyOne = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: Array.from({ length: 21 }, () => image) }],
    });
    expect(twentyOne.ok).toBe(false);
    if (!twentyOne.ok) {
      expect(twentyOne.errors.every((e) => e.code === "media_dimensions_exceeded")).toBe(true);
      expect(twentyOne.errors).toHaveLength(21);
    }

    // The same images in a 20-image request are fine (2100px < 8000px).
    const twenty = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: Array.from({ length: 20 }, () => image) }],
    });
    expect(twenty.ok).toBe(true);
  });

  test("image count above the per-request cap (100 on 200k-context models) is rejected", () => {
    const image = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: TINY_PNG },
    } as const;
    const result = chat.safe({
      model: "claude-haiku-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: Array.from({ length: 101 }, () => image) }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.code === "invalid_shape" && e.meta?.limit === 100),
      ).toBe(true);
    }

    // 101 images are fine on a 1M-context model (cap 600).
    const bigContext = chat.safe({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: Array.from({ length: 101 }, () => image) }],
    });
    expect(bigContext.ok).toBe(true);
  });
});

describe("anthropic.chat budget", () => {
  test("maxCostUSD below the estimate is over_budget", () => {
    const result = chat.safe(
      { model: "claude-sonnet-4-5", max_tokens: 8192, messages: HI },
      { maxCostUSD: 0.0001 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("over_budget");
  });

  test("severity overrides can silence a code", () => {
    const result = chat.safe(
      { model: "claude-next-9000", max_tokens: 100, messages: HI },
      { severity: { unknown_model: "off" } },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });
});

// All catalog Anthropic models support tools/vision/thinking, so the
// unsupported_capability branches are exercised with a synthetic ModelInfo.
describe("anthropic.chat capability checks (synthetic model)", () => {
  const textOnly: ModelInfo = {
    id: "text-only",
    name: "Text Only",
    attachment: false,
    reasoning: false,
    toolCall: false,
    temperature: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 1000, output: 100 },
  };

  function run(params: MessagesBody, info: ModelInfo): IssueInput[] {
    const issues: IssueInput[] = [];
    const ctx: PipelineContext = {
      endpoint: "anthropic.chat",
      options: {},
      tokenizer: heuristicTokenizer,
      report: (issue) => issues.push(issue),
    };
    checkCapabilities(params, info, ctx);
    checkThinkingCompatibility(params, info, ctx);
    return issues;
  }

  test("tools without toolCall is unsupported_capability", () => {
    const issues = run(
      {
        model: "text-only",
        max_tokens: 50,
        messages: HI,
        tools: [{ name: "f", input_schema: { type: "object" } }],
      },
      textOnly,
    );
    expect(issues.map((i) => i.code)).toEqual(["unsupported_capability"]);
    expect(issues[0]?.path).toEqual(["tools"]);
  });

  test("thinking without reasoning is unsupported_capability", () => {
    const issues = run(
      {
        model: "text-only",
        max_tokens: 50,
        messages: HI,
        thinking: { type: "enabled", budget_tokens: 2048 },
      },
      textOnly,
    );
    expect(issues.map((i) => i.code)).toEqual(["unsupported_capability"]);
    expect(issues[0]?.path).toEqual(["thinking"]);
  });

  test("image blocks without image input modality are unsupported_capability", () => {
    const issues = run(
      { model: "text-only", max_tokens: 50, messages: imageMessage(TINY_PNG) },
      textOnly,
    );
    expect(issues.map((i) => i.code)).toEqual(["unsupported_capability"]);
    expect(issues[0]?.path).toEqual(["messages", 0, "content", 0]);
  });

  test("PDF document blocks without pdf input modality are unsupported_capability", () => {
    const issues = run(
      {
        model: "text-only",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
              },
              // Plain-text document sources are NOT pdf input; must not flag.
              {
                type: "document",
                source: { type: "text", media_type: "text/plain", data: "hello" },
              },
            ],
          },
        ],
      },
      textOnly,
    );
    expect(issues.map((i) => i.code)).toEqual(["unsupported_capability"]);
    expect(issues[0]?.path).toEqual(["messages", 0, "content", 0]);
  });
});

describe("anthropic.chat constraintsFor", () => {
  test("exposes the family media rule and per-model denies", () => {
    const opus = chat.constraintsFor("claude-opus-5");
    expect(opus.some((c) => c.deny?.top_k !== undefined)).toBe(true);
    expect(opus.some((c) => c.media?.image?.maxWidth === 8000)).toBe(true);
    // High-resolution vision tier.
    expect(opus.some((c) => c.imageTokens === 4784)).toBe(true);

    const sonnet = chat.constraintsFor("claude-sonnet-4-5");
    expect(sonnet.some((c) => c.deny?.top_k !== undefined)).toBe(false);
    expect(sonnet.some((c) => c.imageTokens === 1568)).toBe(true);
  });
});
