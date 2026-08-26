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
import { CHAT_PROVIDERS, classifyRef } from "../../src/chat/refs";
import type { ChatProviderOptions, ChatServiceTierFor } from "../../src/chat/types";
import { DEFAULT_ENDPOINT_ID, ENDPOINTS } from "../../src/core/translate/endpoints";
import { GROQ_OPENAI_COMPAT_DOC } from "../../src/providers/groq/constraints";
import type { ChatCompletionsBody } from "../../src/providers/openai/chat";

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
      // @ts-expect-error — deliberate typo. The closed key set now catches it
      // at compile time ("Did you mean to write 'openai'?"), which is the point
      // of the tightening; this test keeps pinning the runtime warning that JS
      // callers (and runtime-built keys) still depend on.
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

// ---------------------------------------------------------------------------
// The KEY set is closed, and closed to exactly what the runtime tolerates
//
// `providerOptions` used to be keyed `ChatProviderId | (string & {})`, which in
// key position collapses the mapped type to `[x: string]: …` and switches
// excess-property checking off entirely: `{ opneai: … }` type-checked, and
// `encode.ts` then made the bucket silently inert. A settings override that
// never happens, invisible in a diff and invisible at runtime.
//
// Closing the keys is only safe while the closed set matches the set the
// runtime honours — which is not `ChatProviderId`: the five providers unmodel
// knows but `unmodel/chat` cannot send to keep working buckets on purpose (see
// the portability argument in `encode.test.ts`). Nothing but this test keeps a
// hand-written union in step with three derived tables, so it is pinned in both
// directions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// `serviceTier`'s openai arm is a copy WITH a drift guard
//
// The other two arms are read straight off their dialect bodies through
// `DialectBody`, so they cannot drift. OpenAI's cannot be: the shared
// `openai-chat` wire type leaves `service_tier` a bare `string` (~30 providers
// share that body and most define their own tiers), and the closed list lives
// on `ChatCompletionsBody` in a module `src/chat/**` may not import. A test
// may import both, so the copy is pinned here instead of merely commented.
// ---------------------------------------------------------------------------

describe("ChatServiceTier's openai arm", () => {
  /**
   * This used to be a two-direction drift guard over a hand-written copy:
   * `src/chat/types.ts` restated OpenAI's six tiers because `src/chat/**` may
   * not import `src/providers/openai/chat.ts`, and only a test could see both.
   * The copy is gone — `retarget/dialects.ts` re-exports the endpoint body
   * through the one module amendment A1 lets this directory name, so the arm
   * IS the field. What is left is the identity assertion, which fails the day
   * someone reintroduces a copy, plus the runtime half the type never covered.
   */
  test("IS `ChatCompletionsBody.service_tier`, not a copy of it", () => {
    type Wire = NonNullable<Exclude<ChatCompletionsBody["service_tier"], null>>;
    type Unified = ChatServiceTierFor<"openai-chat">;
    type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
      ? true
      : false;
    const _identical: Exact<Wire, Unified> = true;
    void _identical;
    // The runtime half: the six are what a caller can send today, and the
    // encoder forwards them verbatim.
    for (const tier of ["auto", "default", "flex", "scale", "priority", "fast"] as const) {
      const result = chat({ model: "openai/gpt-5.2", messages: MESSAGES, serviceTier: tier });
      expect({ ...(result as object) }).toMatchObject({ service_tier: tier });
    }
  });

  test("an unknown tier is carried, not refused — which is why the type keeps its tail", () => {
    // The type completes nine values and gates none. That is only honest while
    // the runtime tolerates an unknown one; if a codec ever starts refusing,
    // the tail should go with it.
    const result = chat({
      model: "openai/gpt-5.2",
      messages: MESSAGES,
      serviceTier: "a_tier_shipped_next_month",
    });
    expect({ ...(result as object) }).toMatchObject({ service_tier: "a_tier_shipped_next_month" });
    expect(result.warnings).toEqual([]);
  });
});

describe("the bucket key set", () => {
  type BucketKey = Extract<keyof ChatProviderOptions, string>;

  const KEYS = [
    ...CHAT_PROVIDERS,
    "amazon-bedrock",
    "azure",
    "cloudflare-workers-ai",
    "cohere",
    "google-vertex",
  ] as const satisfies readonly BucketKey[];

  // The `satisfies` above covers "no key in the list is outside the type"; this
  // covers "no key of the type is missing from the list". Fails `tsc`, not bun.
  type MissingKey = Exclude<BucketKey, (typeof KEYS)[number]>;
  const _noMissingKey: MissingKey[] = [];
  void _noMissingKey;

  test("is exactly the set of keys the runtime does not warn about", () => {
    // `encode.ts` warns `dropped_param` for a bucket key whose `classifyRef`
    // verdict is `unknown-provider`, and stays silent for every other key. That
    // predicate is the contract; this derives it rather than restating it.
    const candidates = new Set<string>([
      ...CHAT_PROVIDERS,
      ...Object.values(ENDPOINTS).map((endpoint) => endpoint.provider),
      ...Object.keys(DEFAULT_ENDPOINT_ID),
      "cohere",
      "amazon-bedrock",
    ]);
    const tolerated = [...candidates].filter(
      (key) => classifyRef(key).kind !== "unknown-provider",
    );
    expect(tolerated.sort()).toEqual([...KEYS].sort());
    expect(KEYS).toHaveLength(37);
  });

  test("a typo'd key is a compile error AND a runtime warning", () => {
    const result = chat({
      model: "openai/gpt-5.2",
      messages: MESSAGES,
      // @ts-expect-error — closed keys catch it at the keystroke.
      providerOptions: { openai_: { store: true } },
    });
    expect(result.warnings.map((w) => w.code)).toEqual(["dropped_param"]);
  });

  test("an inert bucket for a provider `unmodel/chat` cannot serve stays legal and silent", () => {
    const result = chat({
      model: "openai/gpt-5.2",
      messages: MESSAGES,
      providerOptions: {
        "amazon-bedrock": { additionalModelRequestFields: { top_k: 5 } },
        cohere: { k: 5 },
        azure: { logprobs: true },
      },
    });
    expect(result.warnings).toEqual([]);
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
