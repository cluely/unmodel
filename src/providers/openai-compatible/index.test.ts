import { describe, expect, test } from "bun:test";
import { createOpenAICompatible } from "./index";
import type { ModelInfo } from "../../core/catalog-types";
import type { AvailabilityMap } from "../../core/translate/availability-types";
import { TranslationUnavailableError } from "../../core/translate/retarget";

// A tiny inline catalog exercising every catalog-driven code path.
const catalog = {
  "tiny-chat": {
    id: "tiny-chat",
    name: "Tiny Chat",
    attachment: false,
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    temperature: true,
    openWeights: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000, output: 256 },
    cost: { input: 1, output: 2 },
  },
  "tiny-notools": {
    id: "tiny-notools",
    name: "Tiny NoTools",
    attachment: false,
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    temperature: true,
    openWeights: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 1000, output: 256 },
  },
} as const satisfies Record<string, ModelInfo>;

type AcmeModelId = keyof typeof catalog;

const acme = createOpenAICompatible<AcmeModelId>({
  id: "acme",
  baseUrl: "https://api.acme.dev/openai/v1",
  catalog,
  headers: { "x-acme-beta": "chat-v2" },
  constraints: {
    "tiny-chat": {
      deny: {
        logit_bias: {
          reason: "acme's runtime ignores logit_bias and 400s on it",
          source: "https://docs.acme.dev/chat (test fixture)",
        },
      },
    },
  },
  familyRules: [
    {
      family: "acme vision input",
      match: (id) => id === "tiny-chat",
      media: { image: { maxBytes: 1024, formats: ["png"] } },
      imageTokens: 5,
    },
  ],
});

function userMessage(text: string) {
  return { role: "user" as const, content: text };
}

/** A syntactically valid PNG header padded to `totalBytes`, base64 data URL. */
function pngDataUrl(totalBytes: number): string {
  const bytes = new Uint8Array(totalBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, 64);
  new DataView(bytes.buffer).setUint32(20, 64);
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("createOpenAICompatible URL and request building", () => {
  test("chatUrl is baseUrl + /chat/completions", () => {
    expect(acme.chatUrl).toBe("https://api.acme.dev/openai/v1/chat/completions");
  });

  test("validated result is wire-pure and carries url + merged static headers", () => {
    const params = { model: "tiny-chat" as const, messages: [userMessage("hi")], temperature: 0.3 };
    const v = acme.chat(params);

    expect(Object.keys(v)).toEqual(["model", "messages", "temperature"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);
    // One SDK target for the whole fleet: these params ARE the OpenAI SDK's.
    expect(v.toSdk("openai")).toEqual(params);
    expect(() => (v as unknown as { toSdk(t: string): unknown }).toSdk("acme")).toThrow(TypeError);

    expect(v.request.url).toBe(acme.chatUrl);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers).toEqual({
      "content-type": "application/json",
      "x-acme-beta": "chat-v2",
    });
  });

  test("no two validations share a headers object", () => {
    const a = acme.chat({ model: "tiny-chat", messages: [userMessage("a")] });
    const b = acme.chat({ model: "tiny-chat", messages: [userMessage("b")] });
    a.request.headers.authorization = "Bearer secret";
    expect(b.request.headers.authorization).toBeUndefined();
  });

  test("providers configured without extra headers get plain JSON headers", () => {
    const bare = createOpenAICompatible({
      id: "bare",
      baseUrl: "https://bare.example/v1",
      catalog,
    });
    const v = bare.chat({ model: "tiny-chat", messages: [userMessage("hi")] });
    expect(v.request.url).toBe("https://bare.example/v1/chat/completions");
    expect(Object.keys(v.request.headers)).toEqual(["content-type"]);
  });
});

describe("createOpenAICompatible endpoint naming in messages", () => {
  test("unknown model warning names the provider's catalog", () => {
    const r = acme.chat.safe({ model: "tiny-unreleased", messages: [userMessage("hi")] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("the acme catalog");
    }
  });

  test("unknown params warn with the provider-qualified endpoint name", () => {
    // `store` is an OpenAI-only param, not part of the shared dialect.
    const params = {
      model: "tiny-chat",
      messages: [userMessage("hi")],
      store: true,
    } as unknown as Parameters<typeof acme.chat.safe>[0];
    const r = acme.chat.safe(params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
      expect(r.warnings[0]?.path).toEqual(["store"]);
      expect(r.warnings[0]?.message).toContain("acme.chat");
    }
  });

  test("thrown errors carry the provider-qualified endpoint name", () => {
    expect(() => acme.chat({ model: "tiny-chat", messages: [] })).toThrow(
      /Invalid params for acme\.chat/,
    );
  });
});

describe("createOpenAICompatible catalog wiring", () => {
  test("tools on a model without tool calling is unsupported_capability", () => {
    const r = acme.chat.safe({
      model: "tiny-notools",
      messages: [userMessage("hi")],
      tools: [{ type: "function", function: { name: "f" } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["tools"]);
      expect(issue?.model).toBe("tiny-notools");
    }
  });

  test("image input on a text-only model is unsupported_capability", () => {
    const r = acme.chat.safe({
      model: "tiny-notools",
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://x.example/a.png" } }],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["messages", 0, "content", 0]);
      expect(issue?.meta?.modality).toBe("image");
    }
  });

  test("json_schema response_format without structured outputs errors", () => {
    const r = acme.chat.safe({
      model: "tiny-notools",
      messages: [userMessage("hi")],
      response_format: { type: "json_schema", json_schema: { name: "out", schema: {} } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("unsupported_capability");
  });

  test("max_tokens over the catalog output limit is over_output_limit", () => {
    const r = acme.chat.safe({
      model: "tiny-chat",
      messages: [userMessage("hi")],
      max_tokens: 257,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("over_output_limit");
      expect(r.errors[0]?.path).toEqual(["max_tokens"]);
    }
  });

  test("over_context fires from the estimate against the catalog window", () => {
    const r = acme.chat.safe({
      model: "tiny-chat",
      messages: [userMessage("x".repeat(1010 * 4))],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("over_context");
  });

  test("config.constraints deny rules fire with reason and source", () => {
    const r = acme.chat.safe({
      model: "tiny-chat",
      messages: [userMessage("hi")],
      logit_bias: { "50256": -100 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["logit_bias"]);
      expect(issue?.message).toContain("acme's runtime ignores logit_bias");
      expect(issue?.meta?.source).toContain("docs.acme.dev");
    }
  });

  test("config.familyRules media rules apply to inline images", () => {
    const r = acme.chat.safe({
      model: "tiny-chat",
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: { url: pngDataUrl(2048) } }] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("media_too_large");
      expect(r.errors[0]?.path).toEqual(["messages", 0, "content", 0]);
    }
  });

  test("constraintsFor merges model constraints and matching family rules", () => {
    const merged = acme.chat.constraintsFor("tiny-chat");
    expect(merged.some((c) => c.deny?.logit_bias !== undefined)).toBe(true);
    expect(merged.find((c) => c.media?.image)?.media?.image?.maxBytes).toBe(1024);
    expect(acme.chat.constraintsFor("tiny-notools")).toEqual([]);
  });
});

describe("createOpenAICompatible estimation", () => {
  test("estimate prices tokens from the provider catalog", () => {
    // "hello world!" = 12 chars -> 3 heuristic tokens, +4 message overhead.
    const r = acme.chat.safe({
      model: "tiny-chat",
      messages: [userMessage("hello world!")],
      max_completion_tokens: 100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.inputTokens).toBe(7);
      // 7 input at $1/M + 100 worst-case output at $2/M.
      expect(r.estimate.costUSD).toBeCloseTo((7 * 1 + 100 * 2) / 1e6, 12);
    }
  });

  test("family-rule imageTokens drive the image estimate", () => {
    const r = acme.chat.safe({
      model: "tiny-chat",
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: { url: pngDataUrl(64) } }] },
      ],
    });
    expect(r.ok).toBe(true);
    // Message overhead (4) + configured imageTokens (5), not the default 1000.
    if (r.ok) expect(r.estimate.inputTokens).toBe(9);
  });

  test("the returned estimateChatTokens is the shared heuristic estimator", () => {
    expect(acme.estimateChatTokens({ messages: [userMessage("hello world!")] })).toBe(7);
  });

  test("models without cost rates estimate tokens but no cost", () => {
    const r = acme.chat.safe({ model: "tiny-notools", messages: [userMessage("hi")] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.inputTokens).toBeGreaterThan(0);
      expect(r.estimate.costUSD).toBeUndefined();
    }
  });
});

describe("createOpenAICompatible checkChat", () => {
  test("maps usage and prices actual cost against the provider catalog", () => {
    const report = acme.checkChat({
      model: "tiny-chat",
      choices: [{ finish_reason: "stop", message: { refusal: null } }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
    });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({ inputTokens: 1000, outputTokens: 100, totalTokens: 1100 });
    expect(report.costUSD).toBeCloseTo((1000 * 1 + 100 * 2) / 1e6, 12);
  });

  test("dated snapshot ids resolve to the catalog prefix for pricing", () => {
    const report = acme.checkChat({
      model: "tiny-chat-2026-01-15",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
    });
    expect(report.costUSD).toBeCloseTo(1, 10);
  });

  test("finish_reason length warns about truncation", () => {
    const report = acme.checkChat({ model: "tiny-chat", choices: [{ finish_reason: "length" }] });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.code).toBe("over_output_limit");
    expect(report.warnings[0]?.meta?.kind).toBe("truncated");
  });

  test("content_filter warnings name the provider, not OpenAI", () => {
    const report = acme.checkChat({ choices: [{ finish_reason: "content_filter" }] });
    expect(report.warnings[0]?.meta?.kind).toBe("content_filtered");
    expect(report.warnings[0]?.message).toContain("acme's content filter");
    expect(report.warnings[0]?.message).not.toContain("OpenAI");
  });

  test("empty responses produce an empty report, never a throw", () => {
    const report = acme.checkChat({});
    expect(report.warnings).toEqual([]);
    expect(report.usage).toEqual({});
    expect(report.finishReason).toBeUndefined();
    expect(report.costUSD).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// `.toApi(provider)` — wired once here, inherited by all 29 fleet overlays.
// The retarget engine itself is tested in core/translate/retarget.test.ts;
// what this asserts is the FACTORY's wiring of it: the source dialect, the
// `<id>.chat` endpoint label, and the availability table reaching the lookup.
// ---------------------------------------------------------------------------

const availability = {
  "tiny-chat": {
    // A same-dialect fleet hop — 84.8% of all edges in the generated data.
    groq: "acme/tiny-chat",
    cerebras: { id: "tiny-chat", narrows: { context: 500, drops: ["image"] } },
    // Cross-dialect, and factory-configured: both must fail loudly rather
    // than produce a body nobody can fetch.
    anthropic: "claude-nonsense",
    "amazon-bedrock": "acme.tiny-chat",
  },
} as const satisfies AvailabilityMap;

const routed = createOpenAICompatible<AcmeModelId, typeof availability>({
  id: "acme",
  baseUrl: "https://api.acme.dev/openai/v1",
  catalog,
  availability,
});

/**
 * The `.toApi` union guards TypeScript callers at compile time; these are the
 * runtime guards behind it, which a JS caller — or a stale availability table
 * on a source model the catalog has not caught up on — still reaches.
 */
function untyped(validated: object): {
  toApi(target: string): Record<string, unknown>;
  toApiSafe(target: string): {
    ok: boolean;
    errors?: Array<{ code: string; path: unknown[]; message: string }>;
  };
} {
  return validated as never;
}

describe("createOpenAICompatible toApi", () => {
  const params = { model: "tiny-chat" as const, messages: [userMessage("hi")] };

  test("same-dialect hop respells the model id and swaps the URL", () => {
    const out = routed.chat(params).toApi("groq");

    expect(Object.keys(out)).toEqual(["model", "messages"]);
    expect(out.model).toBe("acme/tiny-chat");
    expect(out.request.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(out.request.headers).toEqual({ "content-type": "application/json" });
    expect(out.target).toBe("groq");
    expect(out.warnings.map((w) => w.code)).toEqual(["id_respelled"]);
    // The endpoint label comes from the factory's `id`, not from the dialect.
    expect(out.warnings[0]?.from).toBe("acme.chat");
    expect(out.warnings[0]?.to).toBe("groq.chat");
  });

  test("generated narrows metadata becomes warnings, with no target catalog loaded", () => {
    const out = routed.chat(params).toApi("cerebras");

    expect(out.warnings.map((w) => w.code)).toEqual([
      "id_respelled",
      "capability_narrowed",
      "capability_narrowed",
    ]);
    expect(out.warnings[1]?.message).toContain("500-token context window");
    expect(out.warnings[2]?.message).toContain("image");
  });

  test("leaves the source validation untouched", () => {
    const v = routed.chat(params);
    v.toApi("groq");
    expect(v.model).toBe("tiny-chat");
    expect(v.request.url).toBe(routed.chatUrl);
  });

  test("a provider that does not serve the model fails, naming the ones that do", () => {
    const result = untyped(routed.chat(params)).toApiSafe("openrouter");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors?.[0]?.code).toBe("unsupported_capability");
      expect(result.errors?.[0]?.message).toContain("is not served by openrouter");
      expect(result.errors?.[0]?.message).toContain("groq");
    }
  });

  test("a cross-dialect target says so instead of producing a wrong body", () => {
    // v1 ships no codecs on the fleet: openai-chat → anthropic-messages is
    // declared in the data but undeclared in this build, and the message says
    // exactly that rather than silently emitting an OpenAI body to /v1/messages.
    expect(() => routed.chat(params).toApi("anthropic")).toThrow(TranslationUnavailableError);
    expect(() => routed.chat(params).toApi("anthropic")).toThrow(
      /acme\.chat → anthropic\.messages crosses wire dialects/,
    );
  });

  test("a factory-configured target names the config the call never supplied", () => {
    expect(() => untyped(routed.chat(params)).toApi("amazon-bedrock")).toThrow(
      TranslationUnavailableError,
    );
    expect(() => untyped(routed.chat(params)).toApi("amazon-bedrock")).toThrow(
      /needs region that this call never supplied/,
    );
  });

  test("overlays without an availability table ship no toApi at all", () => {
    const v = acme.chat(params);
    expect("toApi" in v).toBe(false);
    expect("toApiSafe" in v).toBe(false);
  });
});

describe("createOpenAICompatible typing", () => {
  test("model ids from the overlay catalog assign as literals", () => {
    const v = acme.chat({ model: "tiny-chat", messages: [userMessage("hi")] });
    // Compile-time: `model` keeps the catalog literal type through validation.
    const modelId: "tiny-chat" = v.model;
    expect(modelId).toBe("tiny-chat");

    // Unknown ids still type-check through the (string & {}) escape hatch.
    const escaped = acme.chat.safe({ model: "tiny-unreleased", messages: [userMessage("hi")] });
    expect(escaped.ok).toBe(true);

    // @ts-expect-error — typo'd top-level keys are rejected by ExactKeys
    const typoed = acme.chat.safe({ model: "tiny-chat", messages: [userMessage("hi")], max_output_tokens: 5 });
    expect(typoed.ok).toBe(true);
  });
});
