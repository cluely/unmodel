/**
 * Composition: a compiled `unmodel/chat` result, fed straight into the real
 * provider validator for the dialect it compiled to.
 *
 * This is the strongest available statement that the compiled body is *correct*
 * rather than merely well-formed. The provider validators are the modules that
 * mirror each wire format exactly — they carry that provider's zod schema, its
 * generated catalog, its hand-written constraint tables and its capability
 * checks — so `ok: true` from one of them means the compiled request would be
 * accepted by an endpoint unmodel models in full detail, not just by this
 * entry's own (necessarily thinner) view of it.
 *
 * It is also the documented escape hatch, so it has to keep compiling: the
 * README's answer to "how do I get unified authoring *and* full provider-exact
 * validation?" is exactly the three calls below. Spreading works at runtime
 * because everything that is not the wire body is non-enumerable, and it works
 * at the type level because those members are exempt from `ExactKeys` — which
 * is why `modelId` had to join that exemption list.
 *
 * Note what the target does **not** do here: respell the model. A `.toApi`
 * retarget looks the id up in the availability table and rewrites it, but a
 * chat ref already carries the provider's own spelling (`"groq/llama-3.1-8b-instant"`
 * → `"llama-3.1-8b-instant"`), so the id that goes to groq is the one groq's
 * catalog is keyed by, with no translation in between.
 */
import { describe, expect, test } from "bun:test";

import { chat } from "../../src/chat/index";
import { chat as anthropicChat } from "../../src/providers/anthropic";
import { chat as googleChat } from "../../src/providers/google";
import { chat as groqChat } from "../../src/providers/groq";

describe("anthropic-messages", () => {
  test("a compiled Claude request validates against unmodel/anthropic", () => {
    const compiled = chat({
      model: "anthropic/claude-opus-5",
      messages: [
        { role: "user", content: "What is the capital of France?" },
        { role: "assistant", content: "Paris." },
        { role: "user", content: "And of Japan?" },
      ],
      system: "Answer in one word.",
      // Comfortably above the thinking budget: Anthropic counts thinking
      // tokens against `max_tokens` and its own validator enforces that, which
      // is precisely the kind of provider-exact check composing buys you.
      maxOutputTokens: 8192,
      reasoning: { budgetTokens: 2048 },
    });
    expect(compiled.warnings).toEqual([]);

    const checked = anthropicChat.safe({ ...compiled });
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    if (!checked.ok) return;
    expect(checked.params.model).toBe("claude-opus-5");
    expect(checked.params.request.url).toBe(compiled.request.url);
  });

  test("tools and a tool round-trip survive the crossing", () => {
    const compiled = chat({
      model: "anthropic/claude-opus-5",
      messages: [
        { role: "user", content: "Weather in Paris?" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "call_1", toolName: "weather", input: { city: "Paris" } },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "weather",
              output: { type: "json", value: { tempC: 17 } },
            },
          ],
        },
      ],
      maxOutputTokens: 128,
      tools: {
        weather: {
          description: "Current weather for a city.",
          inputSchema: { type: "object", properties: { city: { type: "string" } } },
        },
      },
      toolChoice: "auto",
    });
    expect(compiled.warnings).toEqual([]);

    const checked = anthropicChat.safe({ ...compiled });
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
  });
});

describe("openai-chat", () => {
  test("a compiled groq request validates against unmodel/groq", () => {
    const compiled = chat({
      model: "groq/llama-3.1-8b-instant",
      messages: [{ role: "user", content: "Say hi." }],
      maxOutputTokens: 32,
      temperature: 0.7,
      stopSequences: ["\n\n"],
    });
    expect(compiled.warnings).toEqual([]);
    // The ref carried groq's own spelling, so nothing was respelled on the way.
    expect(compiled.model).toBe("llama-3.1-8b-instant");

    const checked = groqChat.safe({ ...compiled });
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
  });
});

describe("gemini", () => {
  test("a compiled Gemini request validates against unmodel/google", () => {
    const compiled = chat({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Say hi." }],
      system: "Be terse.",
      maxOutputTokens: 32,
      temperature: 0.4,
    });
    expect(compiled.warnings).toEqual([]);

    // Gemini's body has no `model` — it lives in the URL — so the id has to be
    // put back for a validator whose params are model-carrying. `.modelId` is
    // the documented way, and is `ExactKeys`-exempt so this literal compiles.
    const checked = googleChat.safe({ model: compiled.modelId, ...compiled });
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    if (!checked.ok) return;
    expect(checked.params.request.url).toBe(compiled.request.url);
  });
});
