import { z } from "zod";

// ---------------------------------------------------------------------------
// Wire leaf for the OpenAI-compatible Chat Completions dialect: the wire
// types and the zod schemas, and nothing else. This module imports only zod —
// no pipeline, no validator, no checks — so retarget/translate machinery can
// depend on the dialect without creating a cycle back through
// ./chat-completions.ts (which composes checks, estimates and finalize on top
// of these pieces). Enforced by test/import-graph.test.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wire types — mirror POST .../chat/completions exactly (verified against the
// OpenAPI-generated openai@7.4.0 types on 2026-08-12). These are the JSON
// body; nothing unmodel-specific lives here.
// ---------------------------------------------------------------------------

export interface ChatPromptCacheBreakpoint {
  mode: "explicit";
}

export interface ChatTextPart {
  type: "text";
  text: string;
  prompt_cache_breakpoint?: ChatPromptCacheBreakpoint;
}

export interface ChatImagePart {
  type: "image_url";
  image_url: {
    /** Either an http(s) URL or a base64 `data:` URL. */
    url: string;
    detail?: "auto" | "low" | "high";
  };
  prompt_cache_breakpoint?: ChatPromptCacheBreakpoint;
}

export interface ChatAudioPart {
  type: "input_audio";
  input_audio: {
    /** Base64 encoded audio data. */
    data: string;
    format: "wav" | "mp3";
  };
  prompt_cache_breakpoint?: ChatPromptCacheBreakpoint;
}

export interface ChatFilePart {
  type: "file";
  file: {
    file_data?: string;
    file_id?: string;
    filename?: string;
  };
  prompt_cache_breakpoint?: ChatPromptCacheBreakpoint;
}

export interface ChatRefusalPart {
  type: "refusal";
  refusal: string;
}

export type ChatUserContentPart = ChatTextPart | ChatImagePart | ChatAudioPart | ChatFilePart;

export interface ChatSystemMessage {
  role: "system";
  content: string | ChatTextPart[];
  name?: string;
}

export interface ChatDeveloperMessage {
  role: "developer";
  content: string | ChatTextPart[];
  name?: string;
}

export interface ChatUserMessage {
  role: "user";
  content: string | ChatUserContentPart[];
  name?: string;
}

export interface ChatFunctionToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatCustomToolCall {
  id: string;
  type: "custom";
  custom: { name: string; input: string };
}

export type ChatToolCall = ChatFunctionToolCall | ChatCustomToolCall;

export interface ChatAssistantMessage {
  role: "assistant";
  content?: string | Array<ChatTextPart | ChatRefusalPart> | null;
  name?: string;
  refusal?: string | null;
  audio?: { id: string } | null;
  tool_calls?: ChatToolCall[];
  /** @deprecated Replaced by `tool_calls`. */
  function_call?: { name: string; arguments: string } | null;
}

export interface ChatToolMessage {
  role: "tool";
  content: string | ChatTextPart[];
  tool_call_id: string;
}

/** @deprecated Legacy functions API; kept because the wire still accepts it. */
export interface ChatFunctionMessage {
  role: "function";
  name: string;
  content: string | null;
}

export type ChatMessage =
  | ChatSystemMessage
  | ChatDeveloperMessage
  | ChatUserMessage
  | ChatAssistantMessage
  | ChatToolMessage
  | ChatFunctionMessage;

export interface ChatFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean | null;
  };
}

export interface ChatCustomTool {
  type: "custom";
  custom: {
    name: string;
    description?: string;
    format?:
      | { type: "text" }
      | { type: "grammar"; grammar: { definition: string; syntax: "lark" | "regex" } };
  };
}

export type ChatTool = ChatFunctionTool | ChatCustomTool;

export type ChatToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } }
  | { type: "custom"; custom: { name: string } }
  | {
      type: "allowed_tools";
      allowed_tools: { mode: "auto" | "required"; tools: Array<Record<string, unknown>> };
    };

export type ChatResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        description?: string;
        schema?: Record<string, unknown>;
        strict?: boolean | null;
      };
    };

/**
 * The common OpenAI-compatible dialect of the Chat Completions body.
 * Providers compose on top: `ModelId` narrows `model` to their catalog union,
 * and provider-only params extend this via `interface X extends
 * Omit<ChatCompletionsBodyBase, ...>` (see openai/chat.ts).
 */
export interface ChatCompletionsBodyBase<ModelId extends string = string> {
  model: ModelId | (string & {});
  messages: ChatMessage[];
  frequency_penalty?: number | null;
  /** @deprecated Use `tool_choice`. */
  function_call?: "none" | "auto" | { name: string };
  /** @deprecated Use `tools`. */
  functions?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>;
  logit_bias?: Record<string, number> | null;
  logprobs?: boolean | null;
  max_completion_tokens?: number | null;
  /** @deprecated Use `max_completion_tokens`. */
  max_tokens?: number | null;
  n?: number | null;
  parallel_tool_calls?: boolean;
  presence_penalty?: number | null;
  /** Open string in the dialect; providers narrow it to their exact union. */
  reasoning_effort?: string | null;
  response_format?: ChatResponseFormat;
  /** @deprecated Determinism is best-effort only. */
  seed?: number | null;
  /** Open string in the dialect; providers narrow it to their exact union. */
  service_tier?: string | null;
  stop?: string | string[] | null;
  stream?: boolean | null;
  stream_options?: { include_obfuscation?: boolean; include_usage?: boolean } | null;
  temperature?: number | null;
  tool_choice?: ChatToolChoice;
  tools?: ChatTool[];
  top_logprobs?: number | null;
  top_p?: number | null;
  /** @deprecated On OpenAI itself, use `safety_identifier` / `prompt_cache_key`. */
  user?: string;
}

// ---------------------------------------------------------------------------
// Schema — loose everywhere so unknown keys pass through (the pipeline warns
// on unknown top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const textPartSchema = z.looseObject({ type: z.literal("text"), text: z.string() });
const imagePartSchema = z.looseObject({
  type: z.literal("image_url"),
  image_url: z.looseObject({
    url: z.string(),
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});
const audioPartSchema = z.looseObject({
  type: z.literal("input_audio"),
  input_audio: z.looseObject({ data: z.string(), format: z.enum(["wav", "mp3"]) }),
});
const filePartSchema = z.looseObject({
  type: z.literal("file"),
  file: z.looseObject({
    file_data: z.string().optional(),
    file_id: z.string().optional(),
    filename: z.string().optional(),
  }),
});
const refusalPartSchema = z.looseObject({ type: z.literal("refusal"), refusal: z.string() });

/** `string | ChatTextPart[]` — reusable for provider-only params (e.g. OpenAI's `prediction`). */
export const textContentSchema = z.union([z.string(), z.array(textPartSchema)]);
const userContentSchema = z.union([
  z.string(),
  z.array(
    z.discriminatedUnion("type", [textPartSchema, imagePartSchema, audioPartSchema, filePartSchema]),
  ),
]);

const toolCallSchema = z.discriminatedUnion("type", [
  z.looseObject({
    id: z.string(),
    type: z.literal("function"),
    function: z.looseObject({ name: z.string(), arguments: z.string() }),
  }),
  z.looseObject({
    id: z.string(),
    type: z.literal("custom"),
    custom: z.looseObject({ name: z.string(), input: z.string() }),
  }),
]);

const messageSchema = z.discriminatedUnion("role", [
  z.looseObject({ role: z.literal("system"), content: textContentSchema, name: z.string().optional() }),
  z.looseObject({ role: z.literal("developer"), content: textContentSchema, name: z.string().optional() }),
  z.looseObject({ role: z.literal("user"), content: userContentSchema, name: z.string().optional() }),
  z.looseObject({
    role: z.literal("assistant"),
    content: z
      .union([z.string(), z.array(z.discriminatedUnion("type", [textPartSchema, refusalPartSchema]))])
      .nullable()
      .optional(),
    name: z.string().optional(),
    refusal: z.string().nullable().optional(),
    audio: z.looseObject({ id: z.string() }).nullable().optional(),
    tool_calls: z.array(toolCallSchema).optional(),
    function_call: z.looseObject({ name: z.string(), arguments: z.string() }).nullable().optional(),
  }),
  z.looseObject({ role: z.literal("tool"), content: textContentSchema, tool_call_id: z.string() }),
  z.looseObject({ role: z.literal("function"), name: z.string(), content: z.string().nullable() }),
]);

/**
 * Structural rules zod's shape can't express: the array must be non-empty,
 * and every tool message must answer a tool_call id declared by a preceding
 * assistant message.
 */
export const messagesSchema = z.array(messageSchema).superRefine((msgs, ctx) => {
  if (msgs.length === 0) {
    ctx.addIssue({ code: "custom", message: "messages must contain at least one message." });
    return;
  }
  const declared = new Set<string>();
  msgs.forEach((message, index) => {
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) declared.add(call.id);
    }
    if (message.role === "tool" && !declared.has(message.tool_call_id)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "tool_call_id"],
        message: `tool message references tool_call_id "${message.tool_call_id}", but no preceding assistant message declares that tool call.`,
      });
    }
  });
});

/** Top-level shape of the common dialect; providers spread extras on top. */
const chatCompletionsBaseShape = {
  model: z.string(),
  messages: messagesSchema,
  frequency_penalty: z.number().nullable().optional(),
  function_call: z
    .union([z.literal("none"), z.literal("auto"), z.looseObject({ name: z.string() })])
    .optional(),
  functions: z
    .array(
      z.looseObject({
        name: z.string(),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  logit_bias: z.record(z.string(), z.number()).nullable().optional(),
  logprobs: z.boolean().nullable().optional(),
  max_completion_tokens: z.number().int().positive().nullable().optional(),
  max_tokens: z.number().int().positive().nullable().optional(),
  n: z.number().int().min(1).nullable().optional(),
  parallel_tool_calls: z.boolean().optional(),
  presence_penalty: z.number().nullable().optional(),
  // Open string: providers extend this enum over time; TS types carry the
  // current accurate per-provider union.
  reasoning_effort: z.string().nullable().optional(),
  response_format: z
    .discriminatedUnion("type", [
      z.looseObject({ type: z.literal("text") }),
      z.looseObject({ type: z.literal("json_object") }),
      z.looseObject({
        type: z.literal("json_schema"),
        json_schema: z.looseObject({
          name: z.string(),
          description: z.string().optional(),
          schema: z.record(z.string(), z.unknown()).optional(),
          strict: z.boolean().nullable().optional(),
        }),
      }),
    ])
    .optional(),
  seed: z.number().int().nullable().optional(),
  service_tier: z.string().nullable().optional(),
  stop: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  stream: z.boolean().nullable().optional(),
  stream_options: z
    .looseObject({
      include_obfuscation: z.boolean().optional(),
      include_usage: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  temperature: z.number().nullable().optional(),
  tool_choice: z
    .union([z.enum(["none", "auto", "required"]), z.looseObject({ type: z.string() })])
    .optional(),
  tools: z
    .array(
      z.discriminatedUnion("type", [
        z.looseObject({
          type: z.literal("function"),
          function: z.looseObject({
            name: z.string(),
            description: z.string().optional(),
            parameters: z.record(z.string(), z.unknown()).optional(),
            strict: z.boolean().nullable().optional(),
          }),
        }),
        z.looseObject({
          type: z.literal("custom"),
          custom: z.looseObject({ name: z.string(), description: z.string().optional() }),
        }),
      ]),
    )
    .optional(),
  top_logprobs: z.number().int().min(0).max(20).nullable().optional(),
  top_p: z.number().nullable().optional(),
  user: z.string().optional(),
};

/**
 * Builds the loose top-level schema for a Chat Completions endpoint: the
 * common-dialect shape plus any provider-only top-level params. Keys present
 * in the shape are what the pipeline's unknown-key warning is scoped to.
 */
export function createChatCompletionsSchema(
  extraShape: Record<string, z.ZodType> = {},
): z.ZodObject {
  return z.looseObject({ ...chatCompletionsBaseShape, ...extraShape });
}
