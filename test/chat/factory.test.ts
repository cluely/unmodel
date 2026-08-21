/** Runtime contract for the narrow `unmodel/chat/factory` entry. */
import { describe, expect, test } from "bun:test";

import { createChat } from "../../src/chat/factory";
import { chat } from "../../src/chat/index";
import type { ModelInfo } from "../../src/core/catalog-types";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { chat as anthropic } from "../../src/providers/anthropic/chat";
import { chat as google } from "../../src/providers/google/chat";
import { createOpenAICompatible } from "../../src/providers/openai-compatible";

const MESSAGES = [{ role: "user" as const, content: "hi" }];

const narrow = createChat({ anthropic, google });

describe("createChat", () => {
  test("registers, sorts and exposes only the supplied providers", () => {
    expect(narrow.providers).toEqual(["anthropic", "google"]);
  });

  test("terminates in a supplied provider's exact validator", () => {
    const outcome = narrow.safe({
      model: "anthropic/claude-sonnet-4-5",
      messages: MESSAGES,
      maxOutputTokens: 2048,
      reasoning: { budgetTokens: 4096 },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors[0]?.message).toContain("must be less than max_tokens");
  });

  test("restores Gemini's URL-only model while calling its provider validator", () => {
    const result = narrow({
      model: "google/gemini-2.5-flash",
      messages: MESSAGES,
      maxOutputTokens: 128,
    });
    expect(result.modelId).toBe("gemini-2.5-flash");
    expect(result).not.toHaveProperty("model");
    expect(result.request.url).toContain("models/gemini-2.5-flash:generateContent");
  });

  test("an omitted provider is a structural failure in both forms", () => {
    const anthropicOnly = createChat({ anthropic });
    const outcome = anthropicOnly.safe({
      model: "google/gemini-2.5-flash",
      messages: MESSAGES,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors[0]?.meta?.["structural"]).toBe(true);
      expect(outcome.errors[0]?.message).toContain("not registered");
    }
    expect(() =>
      anthropicOnly({ model: "google/gemini-2.5-flash", messages: MESSAGES }),
    ).toThrow(TranslationUnavailableError);
  });

  test("the advertised provider list is frozen", () => {
    // It is read straight off the closure; a caller who mutated it would
    // change what `has()` appears to promise without changing what dispatches.
    expect(Object.isFrozen(narrow.providers)).toBe(true);
  });

  test("a narrow pack still retargets to providers it never registered", () => {
    // `.toApi` is the *provider validator's* surface, typed off its generated
    // availability table — registering anthropic buys anthropic's whole
    // retarget vocabulary, not just anthropic.
    const result = narrow({
      model: "anthropic/claude-opus-5",
      messages: MESSAGES,
      maxOutputTokens: 16,
    });
    expect(result.toApi("openrouter").request.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  test("safeUnknown remains exception-free at an untyped boundary", () => {
    expect(narrow.safeUnknown(null).ok).toBe(false);
    expect(
      narrow.safeUnknown({ model: "anthropic/claude-opus-5", messages: MESSAGES }).ok,
    ).toBe(true);

    const hostile = Object.defineProperty({}, "model", {
      get(): never {
        throw new Error("boom");
      },
    });
    expect(() => narrow.safeUnknown(hostile)).not.toThrow();
    expect(narrow.safeUnknown(hostile).ok).toBe(false);
  });
});

/**
 * The ready entry is `createChat(CHAT_PROVIDER_VALIDATORS)` and nothing else,
 * so "the same request compiles the same way through both" is a property, not
 * a coincidence. Asserting it is what stops the two drifting if the ready
 * entry ever grows a step of its own.
 */
describe("the ready entry and a narrow pack agree", () => {
  const PARITY = [
    {
      model: "anthropic/claude-opus-5" as const,
      system: "Be brief.",
      messages: [{ role: "user" as const, content: "hi" }],
      maxOutputTokens: 4096,
      reasoning: { budgetTokens: 2048 },
      temperature: 1,
    },
    {
      model: "google/gemini-2.5-flash" as const,
      messages: [{ role: "user" as const, content: "hi" }],
      maxOutputTokens: 128,
      stream: true,
    },
  ];

  test.each(PARITY.map((params) => [params.model, params] as const))(
    "%s produces a deep-equal body, request and warnings",
    (_model, params) => {
      const readyResult = chat(params);
      const narrowResult = narrow(params);

      // Enumerable properties ARE the wire body — compare them as such.
      expect({ ...(narrowResult as object) }).toEqual({ ...(readyResult as object) });
      expect(narrowResult.request).toEqual(readyResult.request);
      expect(narrowResult.warnings).toEqual(readyResult.warnings);
      expect(narrowResult.target).toBe(readyResult.target);
      expect(narrowResult.modelId).toBe(readyResult.modelId);

      const readySafe = chat.safe(params);
      const narrowSafe = narrow.safe(params);
      expect(narrowSafe.ok).toBe(readySafe.ok);
      expect(narrowSafe.warnings).toEqual(readySafe.warnings);
      if (readySafe.ok && narrowSafe.ok) {
        expect(narrowSafe.estimate).toEqual(readySafe.estimate);
      }
    },
  );

  test("…and the same failure, issue for issue", () => {
    const bad = {
      model: "anthropic/claude-opus-5" as const,
      messages: MESSAGES,
      maxOutputTokens: 2048,
      reasoning: { budgetTokens: 4096 },
    };
    const readyOutcome = chat.safe(bad);
    const narrowOutcome = narrow.safe(bad);
    expect(narrowOutcome.ok).toBe(false);
    expect(readyOutcome.ok).toBe(false);
    if (readyOutcome.ok || narrowOutcome.ok) return;
    expect(narrowOutcome.errors).toEqual(readyOutcome.errors);
  });
});

/**
 * The registration guards exist for callers the type system cannot reach —
 * JavaScript, a JSON-driven registry, a mis-imported binding. Every one of
 * them is a compile error in TypeScript, which is precisely why none of them
 * would otherwise be executed by anything.
 */
describe("createChat rejects a malformed registry", () => {
  test("a key that is not a chat provider id", () => {
    expect(() => createChat({ acme: anthropic } as never)).toThrow(TypeError);
    expect(() => createChat({ acme: anthropic } as never)).toThrow(
      /not a statically addressable chat provider/,
    );
  });

  test("a value that is not a validator", () => {
    expect(() => createChat({ anthropic: {} as never })).toThrow(/\.safe\(\)/);
    expect(() => createChat({ anthropic: undefined as never })).toThrow(/\.safe\(\)/);
  });

  test("a validator filed under another provider's key", () => {
    // The type-level brand catches this for every validator unmodel ships
    // (see test/types/chat.test-d.ts); the runtime check is what catches an
    // unbranded hand-written one, and a JavaScript caller.
    expect(() => createChat({ openai: anthropic } as never)).toThrow(TypeError);
    expect(() => createChat({ openai: anthropic } as never)).toThrow(
      /reports endpoint "anthropic\.chat"/,
    );
  });
});

/**
 * The replacement for the removed `ChatOptions.catalog` override.
 *
 * A catalog layered beside a concrete provider validator is a second authority
 * that can disagree with the first, so the override is gone. Registering a
 * differently-configured validator is the supported way to get the same
 * result — these are the two assertions the deleted `describe("options.catalog")`
 * block held, restated against the architecture that replaced it.
 */
describe("a custom catalog is a registered validator, not an option", () => {
  const OVERRIDE: Record<string, ModelInfo> = {
    "gpt-3.5-turbo": {
      id: "gpt-3.5-turbo",
      name: "Overridden 3.5",
      attachment: false,
      reasoning: false,
      toolCall: true,
      structuredOutput: true,
      openWeights: false,
      modalities: { input: ["text"], output: ["text"] },
      limit: { context: 128_000, output: 8192 },
    },
  };
  const custom = createChat({
    openai: createOpenAICompatible<string, never, "openai">({
      id: "openai",
      baseUrl: "https://api.openai.com/v1",
      catalog: OVERRIDE,
    }).chat,
  });

  test("the registered validator's catalog wins over the bundled one", () => {
    const params = {
      model: "openai/gpt-3.5-turbo" as const,
      messages: MESSAGES,
      tools: { t: { inputSchema: { type: "object" } } },
      maxOutputTokens: 8192,
    };
    // The bundled catalog says gpt-3.5-turbo cannot call tools and caps output
    // at 4096; the override says otherwise, and there is no second table.
    const bundled = chat.safe(params);
    expect(bundled.ok).toBe(false);
    if (!bundled.ok) {
      expect(bundled.errors.map((e) => e.code).sort()).toEqual([
        "over_output_limit",
        "unsupported_capability",
      ]);
    }

    const outcome = custom.safe(params);
    expect(outcome.ok, JSON.stringify(outcome.ok ? [] : outcome.errors)).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.warnings).toEqual([]);
  });

  test("a model the override omits is unknown, even though the bundled table has it", () => {
    const outcome = custom.safe({ model: "openai/gpt-5.2", messages: MESSAGES });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
    expect(chat.safe({ model: "openai/gpt-5.2", messages: MESSAGES }).warnings).toEqual([]);
  });
});
