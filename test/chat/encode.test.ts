/**
 * `encodeUnified` unit tests — the mappings the golden suite cannot reach.
 *
 * `test/chat/golden.test.ts` is the real correctness argument: it pins the
 * unified encoder against hand-written wire bodies in three dialects. What it
 * cannot cover is everything the twelve golden cases happen not to contain,
 * and that is precisely where the target-conditional logic lives — the
 * reasoning matrix (3 dialects × 5 input shapes), the effort-vocabulary
 * clamps, `providerOptions` routing and Gemini's streaming carve-out.
 *
 * Each block below states the invariant it is defending, because "assert the
 * function does what it does" is worthless and these all encode a decision.
 */
import { describe, expect, test } from "bun:test";

import type { ChatIR, DialectId } from "../../src/core/translate/ir";
import type { TranslationWarning } from "../../src/core/translate/warnings";
import { createWarningSink } from "../../src/core/translate/warnings";
import { encodeUnified } from "../../src/chat/encode";
import type { ChatParams, ChatReasoning } from "../../src/chat/types";

function encode(
  params: Partial<ChatParams>,
  dialect: DialectId = "openai-chat",
): { ir: ChatIR; warnings: TranslationWarning[] } {
  const sink = createWarningSink("unmodel/chat", "test");
  const full: ChatParams = { model: "openai/gpt-5", messages: [], ...params };
  return { ir: encodeUnified(full, dialect, sink.warn), warnings: sink.warnings };
}

const user = (text: string): ChatParams["messages"][number] => ({ role: "user", content: text });

// ---------------------------------------------------------------------------

describe("the IR envelope", () => {
  test("`source` is the TARGET dialect, and `model` is the bare id", () => {
    // `source` is what `ai-sdk.ts` reads to decide which passthrough bucket is
    // the live one, and for an IR authored *for* a target that is the target.
    // The three wire decoders never read it at all.
    const { ir } = encode({ model: "anthropic/claude-opus-5" }, "anthropic-messages");
    expect(ir.source).toBe("anthropic-messages");
    expect(ir.model).toBe("claude-opus-5");
  });

  test("a slashed model id keeps its slashes; only the provider is stripped", () => {
    const { ir } = encode({ model: "openrouter/anthropic/claude-opus-5" });
    expect(ir.model).toBe("anthropic/claude-opus-5");
  });

  test("a ref with no provider half is left alone for the schema layer to reject", () => {
    // Encoding never fails. A bare id still produces an IR (with the id
    // verbatim) so the caller can inspect what it would have sent.
    const { ir, warnings } = encode({ model: "gpt-5" });
    expect(ir.model).toBe("gpt-5");
    expect(warnings).toEqual([]);
  });
});

describe("system prompts", () => {
  test("`system` comes first, then role:\"system\" messages in order", () => {
    // Every dialect keeps system text in one leading slot, so the fold has to
    // pick an order; the one that surprises least is "the standalone param is
    // the preamble".
    const { ir } = encode({
      system: "A",
      messages: [
        { role: "system", content: "B" },
        user("hi"),
        { role: "system", content: "C" },
      ],
    });
    expect(ir.system).toEqual([{ text: "A" }, { text: "B" }, { text: "C" }]);
    expect(ir.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  });

  test("the array form carries per-block cache breakpoints", () => {
    const { ir } = encode({
      system: [{ text: "long preamble", cache: true }, { text: "tail" }],
    });
    expect(ir.system).toEqual([
      { text: "long preamble", cache: { kind: "ephemeral" } },
      { text: "tail" },
    ]);
  });

  test("no system text means no `system` key at all", () => {
    expect(encode({ messages: [user("hi")] }).ir.system).toBeUndefined();
  });
});

describe("cache breakpoints", () => {
  test("`true` is the provider default; the object form carries a ttl; `false` is nothing", () => {
    const { ir } = encode({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "a", cache: true },
            { type: "text", text: "b", cache: { ttl: "1h" } },
            { type: "text", text: "c", cache: false },
            { type: "text", text: "d", cache: {} },
          ],
        },
      ],
    });
    expect(ir.messages[0]?.content).toEqual([
      { type: "text", text: "a", cache: { kind: "ephemeral" } },
      { type: "text", text: "b", cache: { kind: "ephemeral", ttl: "1h" } },
      { type: "text", text: "c" },
      { type: "text", text: "d", cache: { kind: "ephemeral" } },
    ]);
  });

  test("breakpoints ride on tool definitions and tool calls too", () => {
    const { ir } = encode({
      tools: { t: { inputSchema: { type: "object" }, cache: { ttl: "5m" } } },
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "c1", toolName: "t", input: {}, cache: true },
          ],
        },
      ],
    });
    expect(ir.tools?.[0]?.cache).toEqual({ kind: "ephemeral", ttl: "5m" });
    expect(ir.messages[0]?.content[0]).toMatchObject({ cache: { kind: "ephemeral" } });
  });
});

describe("attachments", () => {
  test("the three readings of `data`, and the one type that is never invented", () => {
    const { ir, warnings } = encode({
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: "data:image/png;base64,AAA=" },
            { type: "file", data: "https://example.com/cat.png" },
            { type: "file", mediaType: "image/png", data: "AAA=" },
            { type: "file", data: { fileId: "file-1", provider: "openai" } },
          ],
        },
      ],
    });
    expect(ir.messages[0]?.content).toEqual([
      { type: "media", mediaType: "image/png", data: { kind: "base64", base64: "AAA=" } },
      // No mediaType: decoders that need one infer it from the URL themselves,
      // so inferring here would only make this IR differ from the dialect
      // encoders' for the same request.
      { type: "media", data: { kind: "url", url: "https://example.com/cat.png" } },
      { type: "media", mediaType: "image/png", data: { kind: "base64", base64: "AAA=" } },
      { type: "media", data: { kind: "file", dialect: "openai-chat", ref: "file-1" } },
    ]);
    expect(warnings).toEqual([]);
  });

  test("a declared mediaType beats the one in a data: URL", () => {
    const { ir } = encode({
      messages: [
        {
          role: "user",
          content: [
            { type: "file", mediaType: "application/pdf", data: "data:application/octet-stream;base64,AAA=" },
          ],
        },
      ],
    });
    expect(ir.messages[0]?.content[0]).toMatchObject({ mediaType: "application/pdf" });
  });

  test("a file handle from a provider unmodel has no endpoint for is dropped, by name", () => {
    // A handle only means anything paired with the dialect that minted it —
    // that pairing is what lets a foreign decoder drop it loudly. With no
    // dialect to record, emitting it would guarantee a dead reference.
    const { ir, warnings } = encode({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "file", data: { fileId: "f-9", provider: "not-a-provider" } },
          ],
        },
      ],
    });
    expect(ir.messages[0]?.content).toEqual([{ type: "text", text: "look" }]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ["dropped_content", ["messages", 0, "content", 1]],
    ]);
    expect(warnings[0]?.meta).toEqual({ ref: "f-9", provider: "not-a-provider" });
  });

  test("`gs://` and other schemes are locators, not bytes", () => {
    const { ir } = encode({
      messages: [{ role: "user", content: [{ type: "file", data: "gs://bucket/clip.mp4" }] }],
    });
    expect(ir.messages[0]?.content[0]).toEqual({
      type: "media",
      data: { kind: "url", url: "gs://bucket/clip.mp4" },
    });
  });
});

describe("tool results", () => {
  test("`error-text` is the text arm plus isError — the IR's shape, not a fifth kind", () => {
    const { ir } = encode({
      messages: [
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "a", output: { type: "text", value: "ok" } },
            { type: "tool-result", toolCallId: "b", output: { type: "error-text", value: "boom" } },
            { type: "tool-result", toolCallId: "c", output: { type: "json", value: { n: 1 } } },
            {
              type: "tool-result",
              toolCallId: "d",
              toolName: "shot",
              output: {
                type: "content",
                value: [
                  { type: "text", text: "see" },
                  { type: "media", data: "AAA=", mediaType: "image/png" },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(ir.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "tool-result", id: "a", output: { kind: "text", text: "ok" } },
          { type: "tool-result", id: "b", output: { kind: "text", text: "boom" }, isError: true },
          { type: "tool-result", id: "c", output: { kind: "json", value: { n: 1 } } },
          {
            type: "tool-result",
            id: "d",
            name: "shot",
            output: {
              kind: "content",
              parts: [
                { type: "text", text: "see" },
                { type: "media", mediaType: "image/png", data: { kind: "base64", base64: "AAA=" } },
              ],
            },
          },
        ],
      },
    ]);
  });

  test("a tool turn folds into the NEXT user turn rather than becoming its own", () => {
    // `[assistant, tool, user]` must produce two IR messages. Three would put
    // two consecutive user turns on the wire, which Anthropic rejects outright.
    const { ir } = encode({
      messages: [
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "t", input: {} }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", output: { type: "text", value: "r" } }] },
        user("thanks"),
      ],
    });
    expect(ir.messages.map((m) => [m.role, m.content.map((p) => p.type)])).toEqual([
      ["assistant", ["tool-call"]],
      ["user", ["tool-result", "text"]],
    ]);
  });

  test("a trailing tool turn flushes into a user message of its own", () => {
    const { ir } = encode({
      messages: [
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "t", input: {} }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", output: { type: "text", value: "r" } }] },
      ],
    });
    expect(ir.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
  });
});

describe("tools", () => {
  test("the record's key IS the name, and insertion order is preserved, not sorted", () => {
    // Declaration order is visible to the model on every provider, so sorting
    // would quietly change behaviour to buy a determinism the caller already
    // has by writing the object literal.
    const { ir } = encode({
      tools: {
        zebra: { inputSchema: { type: "object" } },
        alpha: { description: "a", inputSchema: { type: "object" }, strict: true },
      },
    });
    expect(ir.tools).toEqual([
      { kind: "function", name: "zebra", parameters: { type: "object" } },
      {
        kind: "function",
        name: "alpha",
        description: "a",
        parameters: { type: "object" },
        strict: true,
      },
    ]);
  });

  test("native tool names are recovered from whichever shape the dialect uses", () => {
    const { ir } = encode({
      nativeTools: [
        { provider: "anthropic", definition: { type: "web_search_20250305", name: "web_search" } },
        { provider: "google", definition: { googleSearch: {} } },
        { provider: "openai", definition: { type: "custom", custom: { name: "grammar" } } },
      ],
    });
    expect(ir.nativeTools).toEqual([
      {
        kind: "native",
        dialect: "anthropic-messages",
        name: "web_search",
        raw: { type: "web_search_20250305", name: "web_search" },
      },
      { kind: "native", dialect: "gemini", name: "googleSearch", raw: { googleSearch: {} } },
      {
        kind: "native",
        dialect: "openai-chat",
        name: "grammar",
        raw: { type: "custom", custom: { name: "grammar" } },
      },
    ]);
  });

  test("a native tool for a provider with no endpoint is dropped, naming the provider", () => {
    const { ir, warnings } = encode({
      // @ts-expect-error — `cohere` resolves to no dialect, so a tool filed
      // under it can only ever be discarded; `ChatNativeTool`'s discriminant
      // says so at compile time now. The runtime drop is still the contract for
      // a JS caller (and for a provider added to the endpoint table without a
      // codec), so the coverage stays — it just needs the cast to get here.
      nativeTools: [{ provider: "cohere", definition: { name: "connectors" } }],
    });
    expect(ir.nativeTools).toBeUndefined();
    expect(warnings.map((w) => [w.code, w.path, w.meta])).toEqual([
      ["dropped_tool", ["nativeTools", 0], { provider: "cohere" }],
    ]);
  });

  test("tool choice maps to the IR's four modes", () => {
    expect(encode({ toolChoice: "auto" }).ir.toolChoice).toEqual({ mode: "auto" });
    expect(encode({ toolChoice: "none" }).ir.toolChoice).toEqual({ mode: "none" });
    expect(encode({ toolChoice: "required" }).ir.toolChoice).toEqual({ mode: "required" });
    expect(encode({ toolChoice: { type: "tool", toolName: "t" } }).ir.toolChoice).toEqual({
      mode: "tool",
      name: "t",
    });
  });
});

describe("settings", () => {
  test("temperatureMax is ALWAYS 2 — the scale is this vocabulary's, not the target's", () => {
    for (const dialect of ["openai-chat", "anthropic-messages", "gemini"] as const) {
      const { ir } = encode({ temperature: 1.4 }, dialect);
      expect(ir.settings.temperatureMax, dialect).toBe(2);
      expect(ir.settings.temperature, dialect).toBe(1.4);
    }
  });

  test("`stream` is withheld from the Gemini IR — there it is a method, not a flag", () => {
    // The compile step swaps the URL to `:streamGenerateContent`. Putting the
    // flag in the IR anyway would make the Gemini decoder warn `dropped_param`
    // about a request that streams perfectly well.
    expect(encode({ stream: true }, "gemini").ir.settings.stream).toBeUndefined();
    expect(encode({ stream: true }, "gemini").warnings).toEqual([]);
    expect(encode({ stream: true }, "openai-chat").ir.settings.stream).toBe(true);
    expect(encode({ stream: false }, "anthropic-messages").ir.settings.stream).toBe(false);
  });

  test("`responseFormat: text` is the default and has no IR arm", () => {
    expect(encode({ responseFormat: { type: "text" } }).ir.settings.responseFormat).toBeUndefined();
    expect(encode({ responseFormat: { type: "json" } }).ir.settings.responseFormat).toEqual({
      kind: "json",
    });
    expect(
      encode({
        responseFormat: { type: "json-schema", name: "n", schema: { type: "object" }, strict: true },
      }).ir.settings.responseFormat,
    ).toEqual({ kind: "json-schema", name: "n", schema: { type: "object" }, strict: true });
  });

  test("the plain scalars carry through under their IR names", () => {
    const { ir } = encode({
      maxOutputTokens: 100,
      topP: 0.9,
      topK: 40,
      stopSequences: ["END"],
      seed: 7,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      candidates: 3,
      user: "u-1",
      parallelToolCalls: false,
      serviceTier: "flex",
    });
    expect(ir.settings).toEqual({
      maxOutputTokens: 100,
      topP: 0.9,
      topK: 40,
      stopSequences: ["END"],
      seed: 7,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      candidates: 3,
      user: "u-1",
      parallelToolCalls: false,
      serviceTier: "flex",
    });
  });
});

// ---------------------------------------------------------------------------

describe("reasoning", () => {
  const DIALECTS: readonly DialectId[] = ["openai-chat", "anthropic-messages", "gemini"];

  test("`false` and `\"off\"` are the same request", () => {
    for (const dialect of DIALECTS) {
      expect(encode({ reasoning: false }, dialect).ir.settings.reasoning, dialect).toEqual({
        mode: "off",
      });
      expect(encode({ reasoning: "off" }, dialect).ir.settings.reasoning, dialect).toEqual({
        mode: "off",
      });
    }
  });

  test("a bare budget is a budget on every dialect", () => {
    for (const dialect of DIALECTS) {
      const { ir, warnings } = encode({ reasoning: { budgetTokens: 4096 } }, dialect);
      expect(ir.settings.reasoning, dialect).toEqual({ mode: "budget", budgetTokens: 4096 });
      // The chat-completions decoder is where a budget becomes an effort
      // bucket and warns; the encoder has nothing to approximate.
      expect(warnings, dialect).toEqual([]);
    }
  });

  /**
   * Both given is the portable spelling, and the whole reason `encodeUnified`
   * takes a target dialect: dialects with a real token budget take the budget,
   * dialects without one take the bucket. Neither is an approximation of the
   * other here — each target got the more precise control it actually has —
   * so this row warns nowhere.
   */
  test("both given: budget wins where budgets exist, effort where they do not", () => {
    const reasoning: ChatReasoning = { effort: "high", budgetTokens: 8192 };
    expect(encode({ reasoning }, "anthropic-messages").ir.settings.reasoning).toEqual({
      mode: "budget",
      budgetTokens: 8192,
    });
    expect(encode({ reasoning }, "gemini").ir.settings.reasoning).toEqual({
      mode: "budget",
      budgetTokens: 8192,
    });
    expect(encode({ reasoning }, "openai-chat").ir.settings.reasoning).toEqual({
      mode: "effort",
      effort: "high",
    });
    for (const dialect of DIALECTS) {
      expect(encode({ reasoning }, dialect).warnings, dialect).toEqual([]);
    }
  });

  /**
   * The effort vocabularies genuinely differ: OpenAI has `minimal` and no
   * `xhigh`/`max`, Anthropic has `xhigh`/`max` and no `minimal`, Gemini has
   * `minimal` and no `xhigh`/`max`. The unified type is their **union**, so
   * every request is sayable and the encoder narrows — always towards *more*
   * thinking, never less, because dropping the level entirely would turn an
   * explicit "think hard" into silence.
   */
  const MATRIX: ReadonlyArray<[DialectId, string, string, boolean]> = [
    ["openai-chat", "minimal", "minimal", false],
    ["openai-chat", "low", "low", false],
    ["openai-chat", "medium", "medium", false],
    ["openai-chat", "high", "high", false],
    ["openai-chat", "xhigh", "high", true],
    ["openai-chat", "max", "high", true],
    ["anthropic-messages", "minimal", "low", true],
    ["anthropic-messages", "low", "low", false],
    ["anthropic-messages", "medium", "medium", false],
    ["anthropic-messages", "high", "high", false],
    ["anthropic-messages", "xhigh", "xhigh", false],
    ["anthropic-messages", "max", "max", false],
    ["gemini", "minimal", "minimal", false],
    ["gemini", "low", "low", false],
    ["gemini", "medium", "medium", false],
    ["gemini", "high", "high", false],
    ["gemini", "xhigh", "high", true],
    ["gemini", "max", "high", true],
  ];

  test.each(MATRIX)("%s: effort %s → %s (warns: %p)", (dialect, effort, expected, warns) => {
    const { ir, warnings } = encode({ reasoning: effort as ChatReasoning }, dialect);
    expect(ir.settings.reasoning).toEqual({ mode: "effort", effort: expected });
    expect(warnings.length).toBe(warns ? 1 : 0);
    if (warns) {
      expect(warnings[0]?.code).toBe("approximated_param");
      expect(warnings[0]?.meta).toEqual({ from: effort, to: expected, dialect });
    }
  });

  test("the warning path names where the caller wrote the effort", () => {
    // Shorthand → `["reasoning"]`; the object form → `["reasoning", "effort"]`.
    // Pointing at a field the caller did not write is how a warning stops
    // being actionable.
    expect(encode({ reasoning: "max" }, "openai-chat").warnings[0]?.path).toEqual(["reasoning"]);
    expect(encode({ reasoning: { effort: "max" } }, "openai-chat").warnings[0]?.path).toEqual([
      "reasoning",
      "effort",
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("providerOptions", () => {
  test("the bucket matching `model`'s provider lands in the target's passthrough", () => {
    const { ir, warnings } = encode(
      {
        model: "openai/gpt-5",
        providerOptions: { openai: { store: true, prompt_cache_key: "k" } },
      },
      "openai-chat",
    );
    expect(ir.passthrough).toEqual({ "openai-chat": { store: true, prompt_cache_key: "k" } });
    expect(warnings).toEqual([]);
  });

  test("Gemini's nesting is the caller's to write, and survives verbatim", () => {
    // `generationConfig` is a real Gemini wire key and its decoder merges the
    // passthrough bucket of that name into the config it built. Flattening it
    // here would put `thinkingConfig` at the top level of the body.
    const { ir } = encode(
      {
        model: "google/gemini-3-pro",
        providerOptions: {
          google: { generationConfig: { mediaResolution: "MEDIA_RESOLUTION_HIGH" } },
        },
      },
      "gemini",
    );
    expect(ir.passthrough).toEqual({
      gemini: { generationConfig: { mediaResolution: "MEDIA_RESOLUTION_HIGH" } },
    });
  });

  test("other KNOWN providers' buckets are inert and silent — that is the point of the field", () => {
    // One request object carries tuned settings for several providers and
    // stays portable. Warning about the ones that did not apply would make
    // that unusable.
    const { ir, warnings } = encode(
      {
        model: "anthropic/claude-opus-5",
        providerOptions: {
          anthropic: { container: "c-1" },
          openai: { store: true },
          "amazon-bedrock": { guardrailConfig: {} },
          cohere: { citation_quality: "accurate" },
        },
      },
      "anthropic-messages",
    );
    expect(ir.passthrough).toEqual({ "anthropic-messages": { container: "c-1" } });
    expect(warnings).toEqual([]);
  });

  test("a bucket keyed by something that is not a provider id is a typo, and says so", () => {
    const { ir, warnings } = encode({
      model: "openai/gpt-5",
      // @ts-expect-error — the point of the fixture: a typo'd bucket key. The
      // key set is closed now, so TypeScript catches this one at the keystroke
      // ("Did you mean to write 'openrouter'?"); the runtime path below still
      // has to work for JS callers and for a key built at runtime.
      providerOptions: { openrouterr: { provider: { order: ["x"] } } },
    });
    expect(ir.passthrough).toBeUndefined();
    expect(warnings.map((w) => [w.code, w.path, w.meta])).toEqual([
      ["dropped_param", ["providerOptions", "openrouterr"], { provider: "openrouterr" }],
    ]);
  });

  test("`__`-prefixed keys are the codecs' private channel and cannot be smuggled through", () => {
    // Every decoder strips `__*` before emitting (they carry round-trip
    // bookkeeping like `__system_role`), so passing one through silently would
    // be the one thing this layer promises never to do.
    const { ir, warnings } = encode({
      model: "openai/gpt-5",
      providerOptions: { openai: { __system_role: "developer", store: true } },
    });
    expect(ir.passthrough).toEqual({ "openai-chat": { store: true } });
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ["dropped_param", ["providerOptions", "openai", "__system_role"]],
    ]);
  });

  test("no providerOptions means no passthrough key at all", () => {
    expect(encode({ messages: [user("hi")] }).ir.passthrough).toBeUndefined();
  });
});
