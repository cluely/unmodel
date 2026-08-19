/**
 * The flagship path, end to end: **a Claude request, retargeted to OpenRouter.**
 *
 * ```ts
 * const claude = messages({ model: "claude-opus-5", … });
 * const routed = claude.toApi("openrouter");
 * ```
 *
 * This is the case the whole translator exists for, and it exercises every
 * layer at once: the generated availability table (does OpenRouter serve this
 * model, and what does it call it), the endpoint table (which URL and which
 * dialect), the anthropic encoder, the openai-chat decoder, and the lossy
 * contract (what did the crossing cost, named param by param).
 *
 * It also pins the composition story from the design — the retargeted body is
 * **by construction** valid input to the target provider's own validator — as
 * a runtime assertion rather than a comment. `.toApi` deliberately skips the
 * catalog-aware layers (they would need OpenRouter's full generated catalog,
 * which is exactly the import the per-provider layout avoids), so
 * `chat(routed)` is the documented escape hatch for a caller who wants them.
 */
import { describe, expect, test } from "bun:test";

import { messages } from "../../src/providers/anthropic";
import { messages as anthropicMessages } from "../../src/providers/anthropic";
import { UnmodelValidationError } from "../../src/core/issues";
import { generateContent as googleGenerateContent } from "../../src/providers/google";
import { chat as openrouterChat } from "../../src/providers/openrouter";
import { chat as vercelChat } from "../../src/providers/vercel";
import { chat as deepinfraChat } from "../../src/providers/deepinfra";
import { chat as huggingfaceChat } from "../../src/providers/huggingface";
import { chat as siliconflowChat } from "../../src/providers/siliconflow";
import { chat as nvidiaChat } from "../../src/providers/nvidia";
import { chat as scalewayChat } from "../../src/providers/scaleway";
import { chat as friendliChat } from "../../src/providers/friendli";
import { chat as groqChat } from "../../src/providers/groq";
import { FACTORY_API_TARGET_IDS } from "../../src/retarget/ids";
import { availability as anthropicAvailability } from "../../src/catalog/availability/anthropic.gen";
import { availability as googleAvailability } from "../../src/catalog/availability/google.gen";
import { availability as openrouterAvailability } from "../../src/catalog/availability/openrouter.gen";
import { availability as vercelAvailability } from "../../src/catalog/availability/vercel.gen";
import { availability as deepinfraAvailability } from "../../src/catalog/availability/deepinfra.gen";
import { availability as huggingfaceAvailability } from "../../src/catalog/availability/huggingface.gen";
import { availability as siliconflowAvailability } from "../../src/catalog/availability/siliconflow.gen";
import { availability as nvidiaAvailability } from "../../src/catalog/availability/nvidia.gen";
import { availability as scalewayAvailability } from "../../src/catalog/availability/scaleway.gen";
import { availability as friendliAvailability } from "../../src/catalog/availability/friendli.gen";
import { availability as groqAvailability } from "../../src/catalog/availability/groq.gen";

/**
 * A Claude request that uses several Anthropic-only features on purpose, so
 * the warnings below are the real inventory of what crossing the dialect
 * boundary costs — not a happy-path demo.
 */
function claude() {
  return messages({
    model: "claude-opus-5",
    max_tokens: 2048,
    system: [
      { type: "text", text: "You are a careful research assistant.", cache_control: { type: "ephemeral" } },
    ],
    messages: [
      { role: "user", content: [{ type: "text", text: "Summarize today's AI news." }] },
    ],
    thinking: { type: "enabled", budget_tokens: 1024 },
    tools: [
      { type: "web_search_20250305", name: "web_search" },
      {
        name: "save_note",
        description: "Save a note for later.",
        input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    ],
    tool_choice: { type: "auto" },
    metadata: { user_id: "user-42" },
  });
}

describe("claude → openrouter", () => {
  test("the wire body is a chat-completions body carrying OpenRouter's spelling of the model", () => {
    const routed = claude().toApi("openrouter");

    // Enumerable properties are exactly the fetch body — `.request`,
    // `.warnings` and `.target` all ride non-enumerably.
    expect(JSON.parse(JSON.stringify(routed))).toEqual({
      model: "anthropic/claude-opus-5",
      messages: [
        { role: "system", content: "You are a careful research assistant." },
        { role: "user", content: "Summarize today's AI news." },
      ],
      max_completion_tokens: 2048,
      reasoning_effort: "low",
      tools: [
        {
          type: "function",
          function: {
            name: "save_note",
            description: "Save a note for later.",
            parameters: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        },
      ],
      tool_choice: "auto",
      user: "user-42",
    });
  });

  test("the request meta points at OpenRouter, with no auth header invented", () => {
    const routed = claude().toApi("openrouter");

    expect(routed.request).toEqual({
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(Object.keys(routed.request.headers)).not.toContain("authorization");
    expect(routed.target).toBe("openrouter");
  });

  test("every loss is named exactly once, and nothing is dropped silently", () => {
    const routed = claude().toApi("openrouter");

    expect(
      routed.warnings.map((w) => ({ code: w.code, path: w.path })).sort((a, b) =>
        `${a.code}|${a.path.join(".")}`.localeCompare(`${b.code}|${b.path.join(".")}`),
      ),
    ).toEqual([
      // thinking budget → reasoning_effort bucket
      { code: "approximated_param", path: ["thinking", "budget_tokens"] },
      // Anthropic's `cache_control` has no documented OpenRouter form here
      { code: "dropped_param", path: ["system", 0] },
      // the Anthropic-defined web_search tool
      { code: "dropped_tool", path: ["tools"] },
      // always emitted: the audit trail for the id respelling
      { code: "id_respelled", path: ["model"] },
    ]);

    for (const warning of routed.warnings) {
      expect(warning.from).toBe("anthropic.messages");
      expect(warning.to).toBe("openrouter.chat");
      expect(warning.message.length).toBeGreaterThan(20);
    }
  });

  test("warnings are non-enumerable, so the body stays exactly the body", () => {
    const routed = claude().toApi("openrouter");

    expect(Object.keys(routed)).not.toContain("warnings");
    expect(Object.getOwnPropertyDescriptor(routed, "warnings")?.enumerable).toBe(false);
    expect(Object.isFrozen(routed.warnings)).toBe(true);
  });

  test("the retargeted body is valid input to OpenRouter's own validator", () => {
    // The composition story, asserted: `.toApi` runs the target's schema and
    // constraint layers but not its catalog layers, so a caller who wants the
    // full catalog-aware pass pays for that catalog only by importing it.
    const routed = claude().toApi("openrouter");
    const result = openrouterChat.safe(routed);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.model).toBe("anthropic/claude-opus-5");
      expect(result.params.request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    }
  });

  test("a target the catalog does not have for this model fails with a named error", () => {
    const routed = claude().toApiSafe("cerebras" as never);

    expect(routed.ok).toBe(false);
    if (!routed.ok) {
      expect(routed.errors[0]?.code).toBe("unsupported_capability");
      expect(routed.errors[0]?.message).toMatch(
        /"claude-opus-5" is not served by cerebras according to the models\.dev catalog/,
      );
      // The message names what IS available, so the fix is one edit away.
      expect(routed.errors[0]?.message).toMatch(/openrouter/);
    }
  });
});

describe("openrouter → anthropic (the reverse crossing)", () => {
  test("a Claude request written in the OpenAI dialect goes home to /v1/messages", () => {
    const routed = openrouterChat({
      model: "anthropic/claude-opus-5",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
      max_completion_tokens: 256,
    }).toApi("anthropic");

    expect(JSON.parse(JSON.stringify(routed))).toEqual({
      model: "claude-opus-5",
      max_tokens: 256,
      system: "Be brief.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });
    expect(routed.request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(routed.request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(routed.warnings.map((w) => w.code)).toEqual(["id_respelled"]);
  });

  test("Anthropic's required max_tokens is invented, with a warning, when the source had none", () => {
    const routed = openrouterChat({
      model: "anthropic/claude-opus-5",
      messages: [{ role: "user", content: "Hello" }],
    }).toApi("anthropic");

    expect((routed as unknown as { max_tokens: number }).max_tokens).toBe(4096);
    const invented = routed.warnings.find((w) => w.path.join(".") === "max_tokens");
    expect(invented?.code).toBe("approximated_param");
    expect(invented?.message).toMatch(/requires `max_tokens`/);
  });
});

describe("openrouter → google (gemini)", () => {
  test("a Gemini request written in the OpenAI dialect goes home to generateContent", () => {
    const routed = openrouterChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
      max_completion_tokens: 256,
    }).toApi("google");

    // Gemini keeps the model id in the URL path, so it is absent from the body.
    expect(JSON.parse(JSON.stringify(routed))).toEqual({
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      systemInstruction: { parts: [{ text: "Be brief." }] },
      generationConfig: { maxOutputTokens: 256 },
    });
    expect(routed.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(routed.warnings.map((w) => w.code)).toEqual(["id_respelled"]);
  });

  test("a gemini target promised by a fleet overlay's data really has a codec", () => {
    // The Gemma rows: `deepinfra` (openai-chat) names `google` (gemini) as a
    // target, so `.toApi("google")` is in the *type* union. Before the codec
    // was wired, that compiled and then threw `TranslationUnavailableError` at
    // runtime — and `.toApiSafe` threw too. The generic guard below covers
    // every such row; this pins the one the finding named.
    const routed = deepinfraChat({
      model: "google/gemma-4-26B-A4B-it",
      messages: [{ role: "user", content: "Hello" }],
      max_completion_tokens: 128,
    }).toApi("google");

    expect(JSON.parse(JSON.stringify(routed))).toEqual({
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      generationConfig: { maxOutputTokens: 128 },
    });
    expect(routed.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent",
    );
    // A retarget into gemini offers the Google SDK's `{model, contents, config}`
    // shape — `DialectSdkTargets` resolving to `never` here used to leave
    // `toSdk` with an empty formatter map and a blank "Available:" list.
    expect(routed.toSdk("google")).toEqual({
      model: "gemma-4-26b-a4b-it",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      config: { maxOutputTokens: 128 },
    });
  });
});

/**
 * **Target-side re-validation** — design-types §4.4, and the stated reason
 * `.toApi` re-validates at all.
 *
 * Groq's OpenAI-compatibility page says `logprobs`, `logit_bias` and
 * `top_logprobs` "will result in a 400 error", and that `n` must equal 1.
 * Those are validation layer 3 (the target's hand-written deny/enum tables),
 * which `.toApi` runs against the *destination*. The catalog layers (2 and 4)
 * stay out because they would need groq's full generated catalog.
 */
describe("re-validating against the target (the groq case)", () => {
  function withLogprobs() {
    return deepinfraChat({
      model: "Qwen/Qwen3.6-27B",
      messages: [{ role: "user", content: "hi" }],
      logprobs: true,
      top_logprobs: 3,
      logit_bias: { "1": 1 },
    });
  }

  test("toApiSafe reports every param groq denies, by name and with the doc URL", () => {
    const result = withLogprobs().toApiSafe("groq");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.path.join("."))).toEqual([
      "logprobs",
      "logit_bias",
      "top_logprobs",
    ]);
    for (const issue of result.errors) {
      expect(issue.code).toBe("unsupported_param");
      // The target's spelling of the model, not the source's.
      expect(issue.model).toBe("qwen/qwen3.6-27b");
      expect(issue.message).toContain("400");
      expect((issue.meta as { source?: string }).source).toContain("console.groq.com/docs/openai");
    }
  });

  test("toApi throws rather than shipping a body groq will reject", () => {
    expect(() => withLogprobs().toApi("groq")).toThrow(UnmodelValidationError);
    expect(() => withLogprobs().toApi("groq")).toThrow(/deepinfra\.chat → groq\.chat/);
  });

  test("enum tables run too: groq accepts only n === 1", () => {
    const result = deepinfraChat({
      model: "Qwen/Qwen3.6-27B",
      messages: [{ role: "user", content: "hi" }],
      n: 3,
    }).toApiSafe("groq");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("invalid_enum_value");
    expect(result.errors[0]?.path).toEqual(["n"]);
  });

  test("a clean body still retargets, so the check is not a blanket refusal", () => {
    const routed = deepinfraChat({
      model: "Qwen/Qwen3.6-27B",
      messages: [{ role: "user", content: "hi" }],
    }).toApi("groq");

    expect(routed.model).toBe("qwen/qwen3.6-27b");
    expect(routed.request.url).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  test("a target with no deny tables is unaffected", () => {
    const routed = deepinfraChat({
      model: "Qwen/Qwen3.6-27B",
      messages: [{ role: "user", content: "hi" }],
      logprobs: true,
    }).toApi("openrouter");

    expect((routed as unknown as { logprobs?: boolean }).logprobs).toBe(true);
  });

  test("a family rule that does not match the target model does not fire", () => {
    // upstage's only deny is scoped to the solar-mini family. The one real
    // edge into upstage lands on solar-pro4, so the rule must NOT apply —
    // applying a family's denies to every model would reject requests the
    // target accepts. (The matching half is exercised in
    // src/retarget/target-constraints.test.ts, which does not depend on which
    // upstage models the catalog happens to carry.)
    const routed = openrouterChat({
      model: "upstage/solar-pro4",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "low",
    }).toApi("upstage");

    expect(routed.model).toBe("solar-pro4");
    expect((routed as unknown as { reasoning_effort?: string }).reasoning_effort).toBe("low");
  });
});

/**
 * **Promise vs delivery.** The generated availability data is what types
 * `.toApi`'s target union, so every edge in it is a *compile-time promise*. An
 * endpoint that declares no decoder for the target's dialect turns that
 * promise into a runtime `TranslationUnavailableError` — a failure mode the
 * type system was supposed to have eliminated.
 *
 * This sweeps every provider module that wires `.toApi` over every row of its
 * own table and asserts the promise holds for every statically reachable
 * target. Factory-configured targets are excluded by design (they are not in
 * the one-argument union) and are asserted to fail *structurally*, through the
 * safe form, rather than by throwing.
 */
describe("every declared .toApi edge has a codec", () => {
  const FACTORY = new Set(FACTORY_API_TARGET_IDS as readonly string[]);

  type Chat = (params: never) => {
    toApiSafe(target: string): { ok: boolean; errors?: Array<{ meta?: unknown }> };
  };

  const ENDPOINTS: ReadonlyArray<[string, Chat, Record<string, Record<string, unknown>>]> = [
    ["anthropic.messages", anthropicMessages as unknown as Chat, anthropicAvailability],
    ["google.generateContent", googleGenerateContent as unknown as Chat, googleAvailability],
    ["openrouter.chat", openrouterChat as unknown as Chat, openrouterAvailability],
    ["vercel.chat", vercelChat as unknown as Chat, vercelAvailability],
    ["deepinfra.chat", deepinfraChat as unknown as Chat, deepinfraAvailability],
    ["huggingface.chat", huggingfaceChat as unknown as Chat, huggingfaceAvailability],
    ["siliconflow.chat", siliconflowChat as unknown as Chat, siliconflowAvailability],
    ["nvidia.chat", nvidiaChat as unknown as Chat, nvidiaAvailability],
    ["scaleway.chat", scalewayChat as unknown as Chat, scalewayAvailability],
    ["friendli.chat", friendliChat as unknown as Chat, friendliAvailability],
    ["groq.chat", groqChat as unknown as Chat, groqAvailability],
  ];

  /** A minimal valid request for each dialect, carrying only the model id. */
  function request(endpoint: string, model: string): never {
    if (endpoint === "anthropic.messages") {
      return { model, max_tokens: 16, messages: [{ role: "user", content: "hi" }] } as never;
    }
    if (endpoint.endsWith(".generateContent")) {
      return { model, contents: [{ role: "user", parts: [{ text: "hi" }] }] } as never;
    }
    return { model, messages: [{ role: "user", content: "hi" }] } as never;
  }

  test.each(ENDPOINTS)("%s", (endpoint, validator, availability) => {
    const broken: string[] = [];
    for (const [model, targets] of Object.entries(availability)) {
      const validated = validator(request(endpoint, model));
      for (const target of Object.keys(targets)) {
        // `.toApiSafe` must never throw — that is the contract of the safe
        // form, and structural failures are results, not exceptions.
        const result = validated.toApiSafe(target);
        const structural = result.errors?.some(
          (issue) => (issue.meta as { structural?: boolean } | undefined)?.structural === true,
        );
        if (FACTORY.has(target)) {
          // Out of the one-argument union by design; must fail structurally.
          if (result.ok || structural !== true) broken.push(`${model} → ${target} (factory)`);
          continue;
        }
        if (!result.ok) broken.push(`${model} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
