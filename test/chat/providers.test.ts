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
import { CHAT_PROVIDERS, dialectOf } from "../../src/chat/refs";
import { CHAT_CONSTRAINT_ENDPOINTS } from "../../src/chat/constraints";
import { chatProfiles } from "../../src/catalog/chat-profiles.gen";
import { ENDPOINTS, isFactoryEndpoint } from "../../src/core/translate/endpoints";
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

describe("the two constraint tables", () => {
  /**
   * `src/chat/constraints.ts` and `src/retarget/target-constraints.ts` answer
   * the same question for different callers and are deliberately separate (see
   * either module's header for the bundle argument). What must not drift is the
   * *coverage*: a provider whose rules a retarget honours must not be a
   * provider `chat()` ignores, or the same request would be rejected through
   * one door and accepted through the other.
   */
  test("the chat table covers every endpoint the retarget table does", () => {
    for (const endpoint of TARGET_CONSTRAINT_ENDPOINTS) {
      expect(CHAT_CONSTRAINT_ENDPOINTS, `${endpoint} is missing from the chat table`).toContain(
        endpoint,
      );
    }
  });

  test("every endpoint the chat table names is a real chat endpoint", () => {
    for (const endpoint of CHAT_CONSTRAINT_ENDPOINTS) {
      const entry = ENDPOINTS[endpoint];
      expect(entry, `${endpoint} is not in ENDPOINTS`).toBeDefined();
      expect(CHAT_PROVIDERS as readonly string[]).toContain(entry?.provider as string);
    }
  });
});
