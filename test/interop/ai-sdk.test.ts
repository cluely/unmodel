/**
 * `toSdk("ai-sdk")` on real endpoints, plus the `unmodel/ai-sdk` adapter.
 *
 * The unit-level shape rules live in `src/core/translate/ai-sdk.test.ts`; this
 * file asserts the wiring — that every chat endpoint family declares the
 * target, that each one keys `providerOptions` with its own provider, and that
 * the emitted options can actually be handed to `generateText` (which is what
 * the `withJsonSchemaTools` round-trip stands in for, since `ai` is not a
 * dependency and never will be).
 */
import { describe, expect, test } from "bun:test";

import { chat as anthropicChat } from "../../src/providers/anthropic";
import { chat as googleChat } from "../../src/providers/google";
import { chat as openaiChat } from "../../src/providers/openai";
import { chat as groqChat } from "../../src/providers/groq";
import { withJsonSchemaTools } from "../../src/ai-sdk";
import type { AiSdkChatOptions } from "../../src/core/translate/ai-sdk";

describe("every chat endpoint family declares the target", () => {
  test("anthropic.chat", () => {
    const options = anthropicChat({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: "Be brief.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      thinking: { type: "enabled", budget_tokens: 2048 },
    }).toSdk("ai-sdk");

    expect<AiSdkChatOptions>(options).toEqual({
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ],
      maxOutputTokens: 4096,
      providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } },
    });
  });

  test("google.chat", () => {
    const options = googleChat({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
    }).toSdk("ai-sdk");

    expect<AiSdkChatOptions>(options).toEqual({
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      maxOutputTokens: 512,
      temperature: 0.7,
    });
  });

  test("openai.chat", () => {
    const options = openaiChat({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hello" }],
      max_completion_tokens: 256,
    }).toSdk("ai-sdk");

    expect<AiSdkChatOptions>(options).toEqual({
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      maxOutputTokens: 256,
    });
  });

  test("a fleet overlay (groq), keyed by its own provider id", () => {
    const options = groqChat({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "Hello" }],
      service_tier: "auto",
    }).toSdk("ai-sdk");

    expect<AiSdkChatOptions>(options).toEqual({
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      providerOptions: { groq: { serviceTier: "auto" } },
    });
  });

  test("the target is named when an unknown one is asked for", () => {
    const validated = anthropicChat({
      model: "claude-opus-5",
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(() => (validated.toSdk as (t: string) => unknown)("vercel")).toThrow(
      /"vercel" is not an SDK target for this endpoint\. Available: anthropic, ai-sdk\./,
    );
  });
});

describe("warnings", () => {
  test("ride non-enumerably, so spreading into generateText carries options only", () => {
    const options = anthropicChat({
      model: "claude-opus-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: [{ type: "text", text: "Search please." }] }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }).toSdk("ai-sdk");

    // No cast: `.toSdk("ai-sdk")` is typed `AiSdkChatResult`, so the documented
    // audit trail is readable without one. `warnings` is still non-enumerable,
    // which is what the spread below asserts.
    expect(Object.keys({ ...options })).toEqual(["messages", "maxOutputTokens"]);
    expect(options.warnings.map((w) => w.code)).toEqual(["dropped_tool"]);
  });
});

describe("withJsonSchemaTools", () => {
  const validated = anthropicChat({
    model: "claude-opus-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: [{ type: "text", text: "Note this." }] }],
    tools: [
      {
        name: "save_note",
        description: "Save a note.",
        input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    ],
  });

  /** Stands in for `ai`'s symbol-branded `jsonSchema()` — the whole reason the
   *  wrapper is taken as an argument instead of imported. */
  const brand = Symbol("vercel.ai.schema");
  const jsonSchema = (schema: Record<string, unknown>): { [brand]: true; schema: Record<string, unknown> } => ({
    [brand]: true,
    schema,
  });

  test("wraps every tool's schema and leaves the rest of the options alone", () => {
    const wrapped = withJsonSchemaTools(validated.toSdk("ai-sdk"), jsonSchema);

    expect(wrapped.tools?.["save_note"]).toEqual({
      description: "Save a note.",
      inputSchema: {
        [brand]: true,
        schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    });
    expect(wrapped.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Note this." }] }]);
    expect(wrapped.maxOutputTokens).toBe(1024);
  });

  test("a request without tools passes through untouched — no adapter needed", () => {
    const plain = anthropicChat({
      model: "claude-opus-5",
      max_tokens: 32,
      messages: [{ role: "user", content: "hi" }],
    }).toSdk("ai-sdk");

    expect(withJsonSchemaTools(plain, jsonSchema)).toEqual({ ...plain } as never);
    expect("tools" in withJsonSchemaTools(plain, jsonSchema)).toBe(false);
  });

  test("does not mutate its input, so a result can be formatted more than once", () => {
    const options = validated.toSdk("ai-sdk");
    withJsonSchemaTools(options, jsonSchema);

    expect(options.tools?.["save_note"]?.inputSchema).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    });
  });
});
