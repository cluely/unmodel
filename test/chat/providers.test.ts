/**
 * Drift: the provider list, the endpoint table and the profile table have to
 * keep agreeing, and every provider on the list has to actually work.
 *
 * `CHAT_PROVIDERS` is hand-written (32 short strings read better here than in a
 * `.gen.ts`, and `refs.test.ts` pins it against the generated `ChatProviderId`
 * union in both directions). What that does *not* prove is that the list is the
 * right list — i.e. that it is exactly "every provider with a static URL whose
 * dialect has a codec". A provider added to `ENDPOINTS` and forgotten here is
 * silently unreachable from `chat()`; one removed from `ENDPOINTS` and left
 * here is a ref that classifies as `supported` and then fails to compile.
 *
 * So the set is *derived* from the endpoint table and compared. And because a
 * derivation can be right while the plumbing is broken, every provider on the
 * list also gets a real `chat()` call: a resolvable URL and a non-empty body,
 * per provider, one test.
 */
import { describe, expect, test } from "bun:test";

import { chat } from "../../src/chat/index";
import { CHAT_AUTH, CHAT_PROVIDERS, dialectOf } from "../../src/chat/refs";
import { chatProfiles } from "../../src/catalog/chat-profiles.gen";
import {
  ENDPOINTS,
  isFactoryEndpoint,
  resolveEndpoint,
  type TargetEndpoint,
} from "../../src/core/translate/endpoints";
import { TARGET_CONSTRAINT_ENDPOINTS } from "../../src/retarget/target-constraints";

/** The dialects `src/chat/compile.ts` ships a decoder for. */
const CODEC_DIALECTS = new Set(["openai-chat", "anthropic-messages", "gemini"]);

describe("CHAT_PROVIDERS is derived, not decided", () => {
  test("it is exactly the endpoints with a static URL and a codec", () => {
    // `cohere` speaks a fifth dialect and has no entry in ENDPOINTS at all, so
    // it drops out of the derivation rather than needing to be subtracted —
    // which is the honest reason it is unreachable, and the message
    // `refProblemMessage` gives.
    const derived = new Set<string>();
    for (const endpoint of Object.values(ENDPOINTS)) {
      if (endpoint.url === undefined || isFactoryEndpoint(endpoint)) continue;
      if (!CODEC_DIALECTS.has(endpoint.dialect)) continue;
      derived.add(endpoint.provider);
    }
    expect([...derived].sort()).toEqual([...CHAT_PROVIDERS].sort());
  });

  test("every provider resolves to a dialect a decoder exists for", () => {
    for (const provider of CHAT_PROVIDERS) {
      const dialect = dialectOf(provider);
      expect(dialect, `${provider} has no dialect`).toBeDefined();
      expect(CODEC_DIALECTS.has(dialect as string), `${provider} → ${dialect}`).toBe(true);
    }
  });

  // CHAT_AUTH restates the endpoint table's auth column instead of importing
  // it, because importing it would drag all 30 chat/completions URLs into
  // `unmodel/values` (6.1 KiB against a 3 KiB per-export budget). That trade is
  // only defensible while this test exists: it is the thing that makes the
  // restatement a mirror rather than a second opinion.
  test("every CHAT_AUTH row matches the auth its endpoint declares", () => {
    expect(Object.keys(CHAT_AUTH).sort()).toEqual([...CHAT_PROVIDERS].sort());
    for (const provider of CHAT_PROVIDERS) {
      const endpoint = resolveEndpoint(provider);
      expect(endpoint, `${provider} has no endpoint`).toBeDefined();
      expect(CHAT_AUTH[provider], `${provider} auth drifted`).toEqual(
        (endpoint as TargetEndpoint).auth,
      );
    }
  });

  test("every provider has profile rows to validate against", () => {
    for (const provider of CHAT_PROVIDERS) {
      const models = chatProfiles[provider];
      expect(models, `${provider} has no rows in chatProfiles`).toBeDefined();
      expect(Object.keys(models ?? {}).length, `${provider} has zero models`).toBeGreaterThan(0);
    }
  });
});

describe("a smoke request per provider", () => {
  /** The first model each provider serves — stable, since the table is sorted. */
  const firstModelOf = (provider: string): string =>
    Object.keys(chatProfiles[provider] ?? {})[0] as string;

  test.each(CHAT_PROVIDERS.map((p) => [p] as const))(
    "%s compiles to a resolvable URL and a non-empty body",
    (provider) => {
      const modelId = firstModelOf(provider);
      const outcome = chat.safe({
        model: `${provider}/${modelId}`,
        messages: [{ role: "user", content: "hi" }],
      });
      expect(outcome.ok, `${provider}/${modelId}: ${JSON.stringify(outcome)}`).toBe(true);
      if (!outcome.ok) return;

      const result = outcome.params;
      expect(result.request.method).toBe("POST");
      expect(result.request.url.startsWith("https://"), result.request.url).toBe(true);
      expect(result.request.headers["content-type"]).toBe("application/json");
      expect(result.target).toBe(provider);
      expect(result.modelId).toBe(modelId);
      // A body with no enumerable keys would be a compile that produced nothing.
      expect(Object.keys({ ...(result as object) }).length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).toContain("hi");
    },
  );
});

describe("constraints have one authority: the provider's own validator", () => {
  /**
   * There used to be a second table here — `src/chat/constraints.ts`, a
   * chat-side copy of the deny/enum rules — and a drift test asserting it
   * covered at least what the retarget table covers, "or the same request
   * would be rejected through one door and accepted through the other".
   *
   * That table is gone: `chat()` now compiles a body and hands it to the
   * provider's own validator, which applies the provider's own tables. The
   * drift it guarded against is no longer expressible, so the assertion is
   * replaced by the two facts that now carry the guarantee — every endpoint
   * the retarget table names is reachable from `chat()`, and a provider deny
   * rule really does fire through the unified entry.
   */
  test("every endpoint the retarget table names is a provider chat() can reach", () => {
    for (const endpoint of TARGET_CONSTRAINT_ENDPOINTS) {
      const entry = ENDPOINTS[endpoint];
      expect(entry, `${endpoint} is not in ENDPOINTS`).toBeDefined();
      expect(CHAT_PROVIDERS as readonly string[]).toContain(entry?.provider as string);
    }
  });

  test("a provider's hand-written deny rule fires through the unified entry", () => {
    // Groq's OpenAI-compatible endpoint 400s on `logprobs` and accepts only
    // `n: 1`. Both rules live in src/providers/groq/constraints.ts and are
    // applied by groq.chat — which is where chat() terminates. Nothing under
    // src/chat holds a copy that could disagree.
    const outcome = chat.safe({
      model: "groq/llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "hi" }],
      candidates: 3,
      providerOptions: { groq: { logprobs: true } },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const codes = outcome.errors.map((issue) => issue.code);
    expect(codes).toContain("unsupported_param");
    expect(codes).toContain("invalid_enum_value");
    expect(outcome.errors.find((i) => i.code === "unsupported_param")?.message).toContain(
      "logprobs",
    );
  });
});
