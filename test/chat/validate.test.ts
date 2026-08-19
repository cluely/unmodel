/**
 * The pipeline's contract: what fails, how it fails, and what the failure says.
 *
 * Three things are pinned here that nothing else pins.
 *
 * **The structural/validation split.** A ref naming cohere, azure or a typo is
 * not a request with a bad param — there *is* no request, because no body can
 * be built at all. Those follow the contract `.toApi` established: the throwing
 * form throws `TranslationUnavailableError` so the thrown type names the
 * structural cause; the `safe` form reports the same message through `errors`
 * with `meta.structural`, because a caller who asked for `safe` opted out of
 * exceptions and this is exactly the kind they opted out of catching. A missing
 * slash is the one arm that is *not* structural: the fix is in the string the
 * caller typed, so it is an ordinary shape error.
 *
 * **The messages themselves.** `refs.ts` writes four genuinely different
 * remedies — use the provider's own subpath, use its factory, both, or check
 * the id — and collapsing them into "unsupported provider" costs the user an
 * afternoon. Each one is asserted to name the thing it wants them to do.
 *
 * **Severity overrides reach every layer, except the one they must not.**
 * `options.severity` is the documented way to run a stricter or looser build;
 * it has to work on catalog warnings, constraint errors and context warnings
 * alike. It must *not* be able to silence a structural failure into an
 * `ok: true` result with no body in it — which is why those issues are built
 * outside the severity sink.
 */
import { describe, expect, test } from "bun:test";

import { chat } from "../../src/chat/index";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { UnmodelValidationError } from "../../src/core/issues";

const MESSAGES = [{ role: "user" as const, content: "hi" }];

describe("structural failures", () => {
  const STRUCTURAL: ReadonlyArray<readonly [string, string, string]> = [
    // [ref, what the message must name, why it is out of reach]
    ["cohere/command-r", "unmodel/cohere", "a fifth dialect with no codec"],
    ["azure/gpt-5.2", "`endpoint`", "factory-configured: the URL embeds a resource endpoint"],
    ["google-vertex/gemini-3-pro", "`project`", "factory-configured: project + location"],
    ["cloudflare-workers-ai/x", "`accountId`", "factory-configured: an account id"],
    [
      "amazon-bedrock/anthropic.claude-opus-5",
      "two independent reasons",
      "factory-configured AND no converse codec",
    ],
    ["acme/gpt-5", "not a provider `unmodel/chat` can send to", "not a provider at all"],
  ];

  test.each(STRUCTURAL)("chat(%s) throws TranslationUnavailableError", (model, needle) => {
    let thrown: unknown;
    try {
      chat({ model, messages: MESSAGES });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TranslationUnavailableError);
    expect((thrown as Error).message).toContain(needle);
  });

  test.each(STRUCTURAL)("chat.safe(%s) reports it instead of throwing", (model, needle) => {
    const outcome = chat.safe({ model, messages: MESSAGES });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors).toHaveLength(1);
    const issue = outcome.errors[0];
    expect(issue?.path).toEqual(["model"]);
    expect(issue?.meta?.["structural"]).toBe(true);
    expect(issue?.message).toContain(needle);
  });

  test("the factory message names the config keys, not just 'unsupported'", () => {
    const outcome = chat.safe({ model: "azure/gpt-5.2", messages: MESSAGES });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // Names the config the ref cannot carry AND where to go instead.
    expect(outcome.errors[0]?.message).toContain("unmodel/azure");
    expect(outcome.errors[0]?.message).toContain("factory-configured");
  });

  test("a severity override cannot silence one into an ok:true with no body", () => {
    const outcome = chat.safe(
      { model: "cohere/command-r", messages: MESSAGES },
      { severity: { unsupported_capability: "off", unknown_model: "off", invalid_shape: "off" } },
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("a ref with no provider is a shape error, not a structural one", () => {
  test("chat() throws UnmodelValidationError, not TranslationUnavailableError", () => {
    let thrown: unknown;
    try {
      chat({ model: "gpt-5", messages: MESSAGES });
    } catch (error) {
      thrown = error;
    }
    expect(UnmodelValidationError.isInstance(thrown)).toBe(true);
    expect(thrown).not.toBeInstanceOf(TranslationUnavailableError);
  });

  test("the message shows the fix and explains the first-slash rule", () => {
    const outcome = chat.safe({ model: "gpt-5", messages: MESSAGES });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const issue = outcome.errors[0];
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.path).toEqual(["model"]);
    expect(issue?.message).toContain('"openai/gpt-5"');
    expect(issue?.message).toContain("FIRST slash");
  });

  test("a slashed model id is a ref, not a bug", () => {
    const result = chat({
      model: "openrouter/anthropic/claude-opus-5",
      messages: MESSAGES,
    });
    expect(result.target).toBe("openrouter");
    expect(result.modelId).toBe("anthropic/claude-opus-5");
    expect(result.request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });
});

describe("layer 1", () => {
  test("an empty messages array is rejected", () => {
    const outcome = chat.safe({ model: "openai/gpt-5.2", messages: [] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors[0]?.path).toEqual(["messages"]);
  });

  test("temperature is the canonical 0–2 scale, and 3 is outside the vocabulary", () => {
    // Not clamped: clamping would mean two different rules for "too hot"
    // depending on which provider the ref named.
    const outcome = chat.safe({ model: "openai/gpt-5.2", messages: MESSAGES, temperature: 3 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors[0]?.code).toBe("invalid_shape");
    expect(outcome.errors[0]?.path).toEqual(["temperature"]);

    // 1.4 IS in range — and targeting Anthropic clamps it with a named warning
    // rather than rescaling, which is the whole reason the scale is declared.
    const clamped = chat({
      model: "anthropic/claude-opus-5",
      messages: MESSAGES,
      maxOutputTokens: 32,
      temperature: 1.4,
    });
    expect(clamped.temperature).toBe(1);
    expect(clamped.warnings.map((w) => w.code)).toEqual(["approximated_param"]);
  });

  test("bare base64 without a mediaType is rejected at the part's own path", () => {
    const outcome = chat.safe({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: [{ type: "file", data: "aGVsbG8=" }] }],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors[0]?.path).toEqual(["messages", 0, "content", 0, "mediaType"]);
    expect(outcome.errors[0]?.message).toContain("bare base64");
  });

  test("…while a data: URL and an http(s) URL need no mediaType", () => {
    for (const data of ["data:image/png;base64,aGVsbG8=", "https://example.com/cat.png"]) {
      const outcome = chat.safe({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: [{ type: "file", data }] }],
      });
      expect(outcome.ok, `${data}: ${JSON.stringify(outcome)}`).toBe(true);
    }
  });

  test("a mistyped role names the roles that exist", () => {
    const outcome = chat.safe({
      model: "openai/gpt-5.2",
      // @ts-expect-error — "assistent" is not a role; the schema is closed here.
      messages: [{ role: "assistent", content: "hi" }],
    });
    expect(outcome.ok).toBe(false);
  });

  test("an unknown top-level key is a warning, not a rejection", () => {
    const outcome = chat.safe({
      model: "openai/gpt-5.2",
      messages: MESSAGES,
      maxTokens: 128,
    } as never);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const issue = outcome.warnings.find((w) => w.code === "unknown_param");
    expect(issue?.path).toEqual(["maxTokens"]);
    expect(issue?.message).toContain("unmodel/chat");
  });
});

describe("severity overrides", () => {
  const DEPRECATED = { model: "openai/gpt-3.5-turbo" as const, messages: MESSAGES };

  test("a warning can be promoted to an error", () => {
    expect(chat.safe(DEPRECATED).ok).toBe(true);
    const strict = chat.safe(DEPRECATED, { severity: { deprecated_model: "error" } });
    expect(strict.ok).toBe(false);
  });

  test("a warning can be silenced entirely", () => {
    const quiet = chat.safe(DEPRECATED, { severity: { deprecated_model: "off" } });
    expect(quiet.ok).toBe(true);
    if (!quiet.ok) return;
    expect(quiet.warnings).toEqual([]);
  });

  test("a layer-2 capability error can be demoted to a warning", () => {
    const params = {
      model: "openai/gpt-3.5-turbo" as const,
      messages: MESSAGES,
      tools: { weather: { inputSchema: { type: "object" } } },
    };
    expect(chat.safe(params).ok).toBe(false);

    const lenient = chat.safe(params, { severity: { unsupported_capability: "warning" } });
    expect(lenient.ok, JSON.stringify(lenient)).toBe(true);
    if (!lenient.ok) return;
    expect(lenient.warnings.map((w) => w.code)).toContain("unsupported_capability");
    // Demoted, not skipped: the tools are still on the compiled body.
    expect(lenient.params.tools).toHaveLength(1);
  });

  test("a layer-3 deny error can be demoted too", () => {
    const params = {
      model: "groq/llama-3.1-8b-instant" as const,
      messages: MESSAGES,
      providerOptions: { groq: { logprobs: true } },
    };
    expect(chat.safe(params).ok).toBe(false);
    expect(chat.safe(params, { severity: { unsupported_param: "off" } }).ok).toBe(true);
  });

  test("the tokenizer option reaches layer 4", () => {
    // A tokenizer that counts one token per character blows a 16385-token
    // window with a 20k-character prompt that the ~4 chars/token default fits.
    const params = {
      model: "openai/gpt-3.5-turbo" as const,
      messages: [{ role: "user" as const, content: "x".repeat(20_000) }],
    };
    expect(chat.safe(params).ok).toBe(true);
    const precise = chat.safe(params, { tokenizer: { count: (text) => text.length } });
    expect(precise.ok).toBe(false);
    if (precise.ok) return;
    expect(precise.errors.some((e) => e.code === "over_context")).toBe(true);
  });
});

describe("error aggregation in the throwing form", () => {
  test("every error issue is on the thrown error, and in the message", () => {
    let thrown: unknown;
    try {
      chat({
        model: "openai/gpt-3.5-turbo",
        messages: MESSAGES,
        // Three independent layer-2 failures, plus a deprecation warning.
        tools: { weather: { inputSchema: { type: "object" } } },
        responseFormat: { type: "json-schema", schema: { type: "object" } },
        maxOutputTokens: 8192,
      });
    } catch (error) {
      thrown = error;
    }
    expect(UnmodelValidationError.isInstance(thrown)).toBe(true);
    const error = thrown as UnmodelValidationError;
    expect(error.issues.map((i) => i.code).sort()).toEqual([
      "over_output_limit",
      "unsupported_capability",
      "unsupported_capability",
    ]);
    // Warnings ride along rather than being thrown away.
    expect(error.warnings.map((w) => w.code)).toContain("deprecated_model");
    expect(error.message).toContain("Invalid params for unmodel/chat");
    expect(error.message).toContain("maxOutputTokens");
    expect(error.message).toContain("responseFormat");
  });

  test("warnings alone never throw — they ride on the result", () => {
    const result = chat({ model: "openai/gpt-3.5-turbo", messages: MESSAGES });
    expect(result.model).toBe("gpt-3.5-turbo");
  });
});
