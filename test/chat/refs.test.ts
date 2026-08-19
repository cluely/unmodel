/**
 * Model-ref parsing and the "why can't I send there?" classifier.
 *
 * Two things are worth a test rather than a glance:
 *
 * 1. **The first-slash split.** openrouter and vercel serve models whose own
 *    ids contain slashes, so the obvious `split("/")`, `lastIndexOf("/")` and
 *    `split("/", 2)` implementations are all wrong in ways that produce a
 *    plausible-looking provider id. Pinned explicitly below.
 * 2. **`CHAT_PROVIDERS` agreeing with the generated union, in both
 *    directions.** The array is hand-written (32 short strings are easier to
 *    read here than in a `.gen.ts`) and the union is generated from the
 *    snapshot, so nothing but a test keeps them honest — and a one-directional
 *    check would miss the failure mode that matters, a provider that leaves
 *    the snapshot and stays in the array.
 */
import { describe, expect, test } from "bun:test";

import {
  CHAT_PROVIDERS,
  classifyModelRef,
  classifyRef,
  dialectOf,
  parseModelRef,
  refProblemMessage,
  type RefProblem,
} from "../../src/chat/refs";
import type { ChatProviderId } from "../../src/catalog/chat-refs.gen";
import { ENDPOINTS, isFactoryEndpoint, resolveEndpoint } from "../../src/core/translate/endpoints";

// --- compile-time: the array and the generated union are the same set -------
// `satisfies readonly ChatProviderId[]` in refs.ts covers one direction (no
// stale id in the array). These cover the other (no missing id), and both fail
// `bun run check` rather than at runtime.
type Missing = Exclude<ChatProviderId, (typeof CHAT_PROVIDERS)[number]>;
type Extra = Exclude<(typeof CHAT_PROVIDERS)[number], ChatProviderId>;
const _noMissing: Missing[] = [];
const _noExtra: Extra[] = [];
void _noMissing;
void _noExtra;

describe("parseModelRef", () => {
  test("splits on the FIRST slash, so slashed model ids survive", () => {
    expect(parseModelRef("openai/gpt-5")).toEqual({ provider: "openai", modelId: "gpt-5" });
    expect(parseModelRef("openrouter/anthropic/claude-opus-5")).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-opus-5",
    });
    expect(parseModelRef("vercel/moonshotai/kimi-k2")).toEqual({
      provider: "vercel",
      modelId: "moonshotai/kimi-k2",
    });
  });

  test("a ref is a shape: no slash, a leading slash or a trailing slash is not a ref", () => {
    expect(parseModelRef("gpt-5")).toBeUndefined();
    expect(parseModelRef("/gpt-5")).toBeUndefined();
    expect(parseModelRef("openai/")).toBeUndefined();
    expect(parseModelRef("")).toBeUndefined();
  });
});

describe("CHAT_PROVIDERS", () => {
  test("is 32 ids, sorted and unique", () => {
    expect(CHAT_PROVIDERS.length).toBe(32);
    expect([...CHAT_PROVIDERS]).toEqual([...CHAT_PROVIDERS].sort());
    expect(new Set(CHAT_PROVIDERS).size).toBe(32);
  });

  test("every one resolves to a non-factory endpoint with a real URL", () => {
    // The scope rule codegen applies (`providers` minus `targetOnly` minus the
    // factory four) is repeated in scripts/codegen.ts because codegen may not
    // import src/. This is where the two are made to agree: a chat provider
    // whose endpoint needs config would produce refs `chat()` cannot post.
    for (const provider of CHAT_PROVIDERS) {
      const endpoint = resolveEndpoint(provider);
      expect(endpoint, provider).toBeDefined();
      expect(isFactoryEndpoint(endpoint as never), provider).toBe(false);
      expect((endpoint as { url?: unknown }).url, provider).toBeDefined();
    }
  });

  test("excludes every factory-configured target in the endpoint table", () => {
    const factory = Object.values(ENDPOINTS)
      .filter(isFactoryEndpoint)
      .map((endpoint) => endpoint.provider);
    for (const provider of new Set(factory)) {
      expect(CHAT_PROVIDERS as readonly string[], provider).not.toContain(provider);
    }
  });
});

describe("dialectOf", () => {
  test("maps a provider to the wire format it speaks", () => {
    expect(dialectOf("openai")).toBe("openai-chat");
    expect(dialectOf("groq")).toBe("openai-chat");
    expect(dialectOf("anthropic")).toBe("anthropic-messages");
    expect(dialectOf("google")).toBe("gemini");
    expect(dialectOf("google-vertex")).toBe("gemini");
    expect(dialectOf("amazon-bedrock")).toBe("bedrock-converse");
  });

  test("is undefined for providers the endpoint table does not know", () => {
    expect(dialectOf("cohere")).toBeUndefined();
    expect(dialectOf("not-a-provider")).toBeUndefined();
  });
});

describe("classifyRef", () => {
  test("supported providers carry their dialect", () => {
    expect(classifyRef("anthropic")).toEqual({
      kind: "supported",
      provider: "anthropic",
      dialect: "anthropic-messages",
    });
    expect(classifyRef("google")).toEqual({
      kind: "supported",
      provider: "google",
      dialect: "gemini",
    });
    expect(classifyRef("openrouter").kind).toBe("supported");
  });

  test("cohere is a fifth dialect with no codec", () => {
    expect(classifyRef("cohere")).toEqual({ kind: "no-codec", provider: "cohere" });
    const message = refProblemMessage(classifyRef("cohere") as RefProblem);
    expect(message).toContain("fifth dialect");
    expect(message).toContain("unmodel/cohere");
  });

  test("factory targets name the exact config keys their URL needs", () => {
    expect(classifyRef("azure")).toEqual({
      kind: "factory",
      provider: "azure",
      config: ["endpoint"],
    });
    expect(classifyRef("google-vertex")).toEqual({
      kind: "factory",
      provider: "google-vertex",
      config: ["project", "location"],
    });
    expect(classifyRef("cloudflare-workers-ai")).toEqual({
      kind: "factory",
      provider: "cloudflare-workers-ai",
      config: ["accountId"],
    });
    const message = refProblemMessage(classifyRef("google-vertex") as RefProblem);
    expect(message).toContain("`project`");
    expect(message).toContain("`location`");
    expect(message).toContain("unmodel/google-vertex");
  });

  test("amazon-bedrock is unreachable for two independent reasons, and says so", () => {
    expect(classifyRef("amazon-bedrock")).toEqual({
      kind: "factory-and-no-codec",
      provider: "amazon-bedrock",
      config: ["region"],
    });
    const message = refProblemMessage(classifyRef("amazon-bedrock") as RefProblem);
    expect(message).toContain("bedrock-converse");
    expect(message).toContain("`region`");
    // The distinguishing sentence: fixing either half alone does not help, so
    // the message must not read like the plain factory one.
    expect(message).toContain("would not help");
    expect(message).not.toBe(refProblemMessage(classifyRef("azure") as RefProblem));
  });

  test("an unknown provider gets valid ids to compare against", () => {
    expect(classifyRef("openai-compatible")).toEqual({
      kind: "unknown-provider",
      provider: "openai-compatible",
    });
    const message = refProblemMessage(classifyRef("typo") as RefProblem);
    expect(message).toContain('"typo"');
    expect(message).toContain('"anthropic"');
    expect(message).toContain("CHAT_PROVIDERS");
  });
});

describe("classifyModelRef", () => {
  test("a ref with no provider half is a shape problem, not a lookup miss", () => {
    expect(classifyModelRef("gpt-5")).toEqual({ kind: "no-slash", ref: "gpt-5" });
    const message = refProblemMessage(classifyModelRef("gpt-5") as RefProblem);
    // The guidance has to show the fix AND the first-slash rule, because the
    // second is what a user hits next with an openrouter id.
    expect(message).toContain('"openai/gpt-5"');
    expect(message).toContain("FIRST slash");
  });

  test("classifies the provider half of a slashed model id", () => {
    expect(classifyModelRef("openrouter/anthropic/claude-opus-5")).toEqual({
      kind: "supported",
      provider: "openrouter",
      dialect: "openai-chat",
    });
  });

  test("every problem renders a message that names something actionable", () => {
    for (const ref of ["gpt-5", "cohere/command-a", "azure/gpt-5", "amazon-bedrock/x", "nope/y"]) {
      const classification = classifyModelRef(ref);
      expect(classification.kind, ref).not.toBe("supported");
      const message = refProblemMessage(classification as RefProblem);
      expect(message.length, ref).toBeGreaterThan(60);
    }
  });
});
