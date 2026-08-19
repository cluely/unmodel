/**
 * `unmodel/ai-sdk` — the one adapter the Vercel AI SDK needs, with **zero
 * dependency on `ai`**.
 *
 * `toSdk("ai-sdk")` emits tool schemas as plain JSON Schema. The SDK's
 * `inputSchema` accepts "Zod schema | JSON Schema", but the JSON-Schema path
 * requires the `jsonSchema()` wrapper from the `ai` package, which returns a
 * **symbol-branded** object. unmodel cannot produce one: `src/` never imports
 * a vendor SDK, and forging a brand would break the first time `ai` changes
 * its symbol.
 *
 * So the wrapper is taken as an **argument**. That is dependency-free, works
 * across `ai` versions, and is a single call at the boundary:
 *
 * ```ts
 * import { generateText, jsonSchema } from "ai";
 * import { openai } from "@ai-sdk/openai";
 * import { messages } from "unmodel/anthropic";
 * import { withJsonSchemaTools } from "unmodel/ai-sdk";
 *
 * const v = messages({ model: "claude-opus-5", max_tokens: 1024, messages: [...], tools: [...] });
 *
 * await generateText({
 *   model: openai("gpt-5.4"),
 *   ...withJsonSchemaTools(v.toSdk("ai-sdk"), jsonSchema),
 * });
 * ```
 *
 * Requests **without** tools need no adapter at all — spread the options
 * straight in.
 *
 * Note the collision the AI SDK's own naming invites: `toSdk("ai-sdk")`
 * formats for the `ai` npm package, while `toApi("vercel")` retargets to the
 * Vercel AI **Gateway** (a models.dev provider with its own HTTP API). Same
 * company, different things.
 */
import type { AiSdkChatOptions, AiSdkToolSpec } from "../core/translate/ai-sdk";

export type {
  AiSdkChatOptions,
  AiSdkChatResult,
  AiSdkFilePart,
  AiSdkModelMessage,
  AiSdkTextPart,
  AiSdkToolCallPart,
  AiSdkToolChoice,
  AiSdkToolOutput,
  AiSdkToolResultPart,
  AiSdkToolSpec,
} from "../core/translate/ai-sdk";

/** The shape of `ai`'s `jsonSchema` helper, structurally. */
export type JsonSchemaWrapper<S> = (schema: Record<string, unknown>) => S;

/**
 * Wraps each tool's plain JSON Schema with the caller's `jsonSchema` from
 * `ai`, leaving every other option untouched.
 *
 * Returns a **new** object; the input is not mutated, so the same validated
 * result can be formatted more than once.
 */
export function withJsonSchemaTools<O extends { tools?: Record<string, AiSdkToolSpec> }, S>(
  options: O,
  jsonSchema: JsonSchemaWrapper<S>,
): Omit<O, "tools"> & { tools?: Record<string, { description?: string; inputSchema: S }> } {
  const { tools, ...rest } = options;
  if (tools === undefined) {
    return rest as Omit<O, "tools"> & {
      tools?: Record<string, { description?: string; inputSchema: S }>;
    };
  }
  const wrapped: Record<string, { description?: string; inputSchema: S }> = {};
  for (const [name, tool] of Object.entries(tools)) {
    wrapped[name] = {
      ...(tool.description !== undefined && { description: tool.description }),
      inputSchema: jsonSchema(tool.inputSchema),
    };
  }
  return { ...(rest as Omit<O, "tools">), tools: wrapped };
}

/** Convenience alias for the common case: `withJsonSchemaTools(v.toSdk("ai-sdk"), jsonSchema)`. */
export type AiSdkChatOptionsWith<S> = Omit<AiSdkChatOptions, "tools"> & {
  tools?: Record<string, { description?: string; inputSchema: S }>;
};
