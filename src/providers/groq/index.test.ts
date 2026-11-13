import { describe, expect, test } from "bun:test";
import { chat, checkChat, CHAT_COMPLETIONS_URL, models } from "./index";

describe("unmodel/groq", () => {
  test("chat URL is the documented OpenAI-compatible endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  test("a catalog model validates ok and the result is wire-pure", () => {
    const params = {
      model: "openai/gpt-oss-20b" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const r = chat.safe(params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(Object.keys(r.params)).toEqual(["model", "messages"]);
      expect(JSON.parse(JSON.stringify(r.params))).toEqual(params);
      expect(r.params.request.url).toBe(CHAT_COMPLETIONS_URL);
      expect(r.params.request.method).toBe("POST");
    }
  });

  // https://console.groq.com/docs/deprecations (checked 2026-11-12): "This
  // deprecation applies to free and developer-tier usage; enterprise customers
  // with a committed-spend contract are not affected." The id stays reachable.
  test("a deprecated, still-served model validates with a deprecated_model warning", () => {
    const r = chat.safe({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });

  test("unknown model warns and names the groq catalog", () => {
    const r = chat.safe({
      model: "llama-99-preview",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("groq");
    }
  });

  test("logit_bias is denied per Groq's OpenAI-compatibility docs", () => {
    const r = chat.safe({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
      logit_bias: { "1234": -100 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["logit_bias"]);
      expect(issue?.meta?.source).toContain("console.groq.com");
    }
  });

  test("messages[].name is denied per Groq's OpenAI-compatibility docs", () => {
    const r = chat.safe({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "hi", name: "alice" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["messages", 0, "name"]);
      expect(r.errors[0]?.meta?.source).toContain("console.groq.com");
    }
  });

  test("n must equal 1 if supplied", () => {
    const r = chat.safe({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hi" }],
      n: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("qwen3.8-27b estimates each image at Groq's documented 2048 tokens", () => {
    const r = chat.safe({
      model: "qwen/qwen3.8-27b",
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] },
      ],
      max_completion_tokens: 100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Message overhead (4) + 2048 per image, not the 1000-token default.
      expect(r.estimate.inputTokens).toBe(2052);
      // $0.80 / 1M input, $4.00 / 1M output (https://console.groq.com/docs/models).
      expect(r.estimate.costUSD).toBeCloseTo((2052 * 0.8 + 100 * 4) / 1e6, 12);
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "llama-3.1-8b-instant",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
  });
});

/**
 * The Whisper signpost. models.dev files both Whisper rows as text-out, so
 * they are in `GroqTextModelId`; Groq serves them on its speech-to-text routes
 * only (https://console.groq.com/docs/speech-to-text, checked 2026-11-12). The
 * fact is stated twice: `NON_CHAT_ROUTES` (./index.ts) for the substrate
 * warning, and `chatScopeExclude` (data/availability-overrides.json) for the
 * unified refs, because codegen cannot import `src/`. The last test pins the
 * two together.
 */
describe("groq.chat non-chat route signpost", () => {
  const WHISPER_ROUTES = {
    "whisper-large-v3":
      "POST https://api.groq.com/openai/v1/audio/transcriptions and POST https://api.groq.com/openai/v1/audio/translations",
    // "Translation Support | No" in the doc's model table.
    "whisper-large-v3-turbo":
      'POST https://api.groq.com/openai/v1/audio/transcriptions only (Groq marks its translation support "No")',
  } as const;

  test("each Whisper id warns once, names its route, and still builds the request", () => {
    for (const [id, route] of Object.entries(WHISPER_ROUTES)) {
      expect(models[id as keyof typeof models], id).toBeDefined();
      const r = chat.safe({ model: id, messages: [{ role: "user", content: "hi" }] });
      // A warning, not an error: the substrate never refuses on routing.
      expect(r.ok, id).toBe(true);
      if (!r.ok) continue;
      expect(r.warnings.map((w) => w.code), id).toEqual(["unsupported_capability"]);
      const signpost = r.warnings[0];
      expect(signpost?.path).toEqual(["model"]);
      expect(signpost?.model).toBe(id);
      expect(signpost?.meta?.route).toBe(route);
      expect(signpost?.message).toContain(route);
      expect(signpost?.message).toContain(`not POST ${CHAT_COMPLETIONS_URL}`);
      expect(signpost?.message).toContain("unmodel ships no validator for Groq's audio routes");
      expect(signpost?.meta?.source).toContain("https://console.groq.com/docs/speech-to-text");
      expect(r.params.request.url).toBe(CHAT_COMPLETIONS_URL);
    }
  });

  test("the runtime table and `chatScopeExclude` name the same groq rows", async () => {
    const overrides = (await Bun.file(
      new URL("../../../data/availability-overrides.json", import.meta.url).pathname,
    ).json()) as { chatScopeExclude: string[] };
    const globs = overrides.chatScopeExclude
      .filter((ref) => ref.startsWith("groq:"))
      .map((ref) => {
        const body = ref
          .slice("groq:".length)
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*");
        return new RegExp(`^${body}$`);
      });
    // Drift in either direction is a silent hole: a ref that compiles to a
    // request Groq does not serve, or a warning on a model that works.
    const textOut: string[] = Object.values(models)
      .filter((model) => (model.modalities.output as readonly string[]).includes("text"))
      .map((model) => model.id);
    const excludedByData = textOut.filter((id) => globs.some((re) => re.test(id))).sort();
    const warnedByCheck = textOut
      .filter((id) => {
        const r = chat.safe({ model: id, messages: [{ role: "user", content: "hi" }] });
        return r.warnings.some((w) => w.code === "unsupported_capability" && w.path[0] === "model");
      })
      .sort();
    expect(warnedByCheck).toEqual(excludedByData);
    expect(warnedByCheck).toEqual(Object.keys(WHISPER_ROUTES).sort());
  });
});
