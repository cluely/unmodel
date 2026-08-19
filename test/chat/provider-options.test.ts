/**
 * `providerOptions` — the escape hatch, and the property that makes it worth
 * having: it is **addressed, not broadcast**.
 *
 * One request object can carry tuned settings for several providers at once.
 * The bucket matching the ref's provider is merged into that provider's wire
 * body verbatim; every other bucket is *inert*, and — this is the part that has
 * to be tested rather than assumed — inert means **silent**. A `dropped_param`
 * warning for an OpenAI setting on an Anthropic request would be noise in a
 * list whose entire contract is "everything here is something the translation
 * cost you", and it would make the portable-request pattern unusable: nobody
 * keeps a warning-free build while carrying four providers' settings.
 *
 * The last case is the one the whole layer-3 design exists for. `logprobs` is
 * not in the unified vocabulary at all, so it can only arrive through
 * `providerOptions` — and groq returns a 400 for it. That must be a named error
 * citing groq's own compatibility doc, at a path the caller can act on, rather
 * than a failure they discover from the wire.
 */
import { describe, expect, test } from "bun:test";

import { chat } from "../../src/chat/index";
import { GROQ_OPENAI_COMPAT_DOC } from "../../src/providers/groq/constraints";

const MESSAGES = [{ role: "user" as const, content: "hi" }];

/** Every provider bucket a portable request might reasonably carry. */
const ALL_BUCKETS = {
  openai: { store: true, prompt_cache_key: "session-1" },
  anthropic: { container: "container-1" },
  google: { generationConfig: { topK: 5 }, cachedContent: "cached/1" },
} as const;

describe("the target's bucket lands", () => {
  test("openai-chat merges at the top level of the body", () => {
    const result = chat({
      model: "openai/gpt-5.2",
      messages: MESSAGES,
      providerOptions: ALL_BUCKETS,
    });
    const wire = { ...(result as object) } as Record<string, unknown>;
    expect(wire["store"]).toBe(true);
    expect(wire["prompt_cache_key"]).toBe("session-1");
  });

  test("anthropic-messages merges at the top level of the body", () => {
    const result = chat({
      model: "anthropic/claude-opus-5",
      messages: MESSAGES,
      maxOutputTokens: 32,
      providerOptions: ALL_BUCKETS,
    });
    const wire = { ...(result as object) } as Record<string, unknown>;
    expect(wire["container"]).toBe("container-1");
  });

  test("gemini nests exactly as it does on the wire", () => {
    // Gemini's settings live under `generationConfig`, and a caller writing
    // provider options for Gemini writes them the way the API takes them — so
    // the bucket's own `generationConfig` merges into the compiled one rather
    // than replacing it or landing beside it.
    const result = chat({
      model: "google/gemini-2.5-flash",
      messages: MESSAGES,
      maxOutputTokens: 256,
      providerOptions: ALL_BUCKETS,
    });
    const wire = { ...(result as object) } as Record<string, unknown>;
    expect(wire["generationConfig"]).toEqual({ maxOutputTokens: 256, topK: 5 });
    expect(wire["cachedContent"]).toBe("cached/1");
  });
});

describe("the other buckets are inert AND silent", () => {
  test.each([
    ["openai/gpt-5.2", ["container", "cachedContent", "generationConfig"]],
    ["anthropic/claude-opus-5", ["store", "prompt_cache_key", "cachedContent"]],
    ["google/gemini-2.5-flash", ["store", "prompt_cache_key", "container"]],
  ])("%s carries none of the foreign keys and warns about none of them", (model, foreign) => {
    const result = chat({
      model,
      messages: MESSAGES,
      maxOutputTokens: 32,
      providerOptions: ALL_BUCKETS,
    });
    const serialized = JSON.stringify(result);
    for (const key of foreign) {
      expect(serialized, `${model} leaked ${key}`).not.toContain(`"${key}"`);
    }
    // Silence is the point: a portable request carrying four providers'
    // settings must still be warning-free.
    expect(result.warnings).toEqual([]);
  });
});

describe("a bucket addressed to nobody is named", () => {
  test("an unknown provider key produces one dropped_param naming it", () => {
    const result = chat({
      model: "openai/gpt-5.2",
      messages: MESSAGES,
      providerOptions: { opnai: { store: true } },
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("dropped_param");
    expect(result.warnings[0]?.path).toEqual(["providerOptions", "opnai"]);
    expect(result.warnings[0]?.message).toContain("opnai");
  });

  test("a known provider's bucket that is simply not the target says nothing", () => {
    const result = chat({
      model: "openai/gpt-5.2",
      messages: MESSAGES,
      providerOptions: { groq: { service_tier: "auto" } },
    });
    expect(result.warnings).toEqual([]);
  });
});

describe("layer 3 runs against the compiled body", () => {
  test("`{ groq: { logprobs: true } }` on a groq model is a named error", () => {
    const outcome = chat.safe({
      model: "groq/llama-3.1-8b-instant",
      messages: MESSAGES,
      providerOptions: { groq: { logprobs: true } },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    const issue = outcome.errors.find((e) => e.code === "unsupported_param");
    expect(issue, JSON.stringify(outcome.errors)).toBeDefined();
    expect(issue?.model).toBe("llama-3.1-8b-instant");
    // Cites groq's own compatibility doc, verbatim from its constraint leaf.
    expect(issue?.meta?.["source"]).toBe(GROQ_OPENAI_COMPAT_DOC);
    // `logprobs` has no unified name — it could only have arrived through
    // `providerOptions`, so the path keeps the wire spelling and the message
    // says where to go and remove it.
    expect(issue?.path).toEqual(["logprobs"]);
    expect(issue?.message).toContain("supplied via `providerOptions`");
  });

  test("groq's `n: 1` enum rule fires on the unified `candidates` param", () => {
    // `candidates` IS in the vocabulary, so this is the other half of the
    // remapping: the rule is written against the wire name `n`, and the path
    // that comes back names what the caller actually typed.
    const outcome = chat.safe({
      model: "groq/llama-3.1-8b-instant",
      messages: MESSAGES,
      candidates: 3,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    const issue = outcome.errors.find((e) => e.code === "invalid_enum_value");
    expect(issue, JSON.stringify(outcome.errors)).toBeDefined();
    expect(issue?.path).toEqual(["candidates"]);
    expect(issue?.message).not.toContain("supplied via `providerOptions`");
  });

  test("anthropic's per-model deny lands on the unified param name", () => {
    // Claude 4.7+ removed `top_k` outright ("any value returns a 400"). The
    // caller wrote `topK`, so that is what the path has to say — pointing them
    // at `top_k` would send them looking for a param that does not exist in the
    // vocabulary they are using.
    const outcome = chat.safe({
      model: "anthropic/claude-opus-5",
      messages: MESSAGES,
      maxOutputTokens: 32,
      topK: 5,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const issue = outcome.errors.find((e) => e.code === "unsupported_param");
    expect(issue?.path).toEqual(["topK"]);
    expect(issue?.model).toBe("claude-opus-5");
    // The message keeps the wire spelling — it quotes the provider's own rule —
    // but the path, which is what tooling acts on, is unified.
    expect(issue?.message).toContain("`top_k`");
    expect(issue?.message).not.toContain("supplied via `providerOptions`");

    // An earlier Claude generation still accepts it.
    expect(
      chat.safe({
        model: "anthropic/claude-sonnet-4-5",
        messages: MESSAGES,
        maxOutputTokens: 32,
        topK: 5,
      }).ok,
    ).toBe(true);
  });

  test("openai's per-model deny remaps `stop` to `stopSequences`", () => {
    const outcome = chat.safe({
      model: "openai/o3",
      messages: MESSAGES,
      stopSequences: ["\n\n"],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const issue = outcome.errors.find((e) => e.code === "unsupported_param");
    expect(issue?.path).toEqual(["stopSequences"]);
    expect(issue?.message).toContain("o3");
  });

  test("the same params on a provider with no deny table pass", () => {
    const outcome = chat.safe({
      model: "openai/gpt-5.2",
      messages: MESSAGES,
      providerOptions: { openai: { logprobs: true } },
    });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  });
});

describe("reserved keys", () => {
  test("a `__`-prefixed key is dropped loudly rather than silently stripped", () => {
    const result = chat({
      model: "openai/gpt-5.2",
      messages: MESSAGES,
      providerOptions: { openai: { __system_role: "developer" } },
    });
    expect(result.warnings.map((w) => w.code)).toEqual(["dropped_param"]);
    expect(result.warnings[0]?.path).toEqual(["providerOptions", "openai", "__system_role"]);
  });
});
