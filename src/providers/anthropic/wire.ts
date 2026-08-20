import { z } from "zod";
import type { AnthropicModelId } from "../../catalog/anthropic.gen";

// ---------------------------------------------------------------------------
// Wire leaf for POST /v1/messages: the wire types and the zod schema, and
// nothing else. This module imports only zod and type-only catalog ids — no
// pipeline, no validator, no checks — so retarget/translate machinery can
// depend on the Anthropic dialect without creating a cycle back through
// ./chat.ts. Enforced by test/import-graph.test.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wire types — mirror POST /v1/messages exactly (the wire substrate; the
// unified surface compiles to this).
// ---------------------------------------------------------------------------

export interface CacheControlEphemeral {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

export interface TextBlock {
  type: "text";
  text: string;
  cache_control?: CacheControlEphemeral | null;
  citations?: Array<Record<string, unknown>> | null;
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface Base64ImageSource {
  type: "base64";
  media_type: ImageMediaType;
  data: string;
}

export interface UrlImageSource {
  type: "url";
  url: string;
}

export interface FileImageSource {
  type: "file";
  file_id: string;
}

export type ImageSource = Base64ImageSource | UrlImageSource | FileImageSource;

export interface ImageBlock {
  type: "image";
  source: ImageSource;
  cache_control?: CacheControlEphemeral | null;
}

export type DocumentSource =
  | { type: "base64"; media_type: "application/pdf"; data: string }
  | { type: "text"; media_type: "text/plain"; data: string }
  | { type: "url"; url: string }
  | { type: "file"; file_id: string }
  | { type: "content"; content: string | Array<TextBlock | ImageBlock> };

export interface DocumentBlock {
  type: "document";
  source: DocumentSource;
  title?: string | null;
  context?: string | null;
  citations?: { enabled: boolean } | null;
  cache_control?: CacheControlEphemeral | null;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: CacheControlEphemeral | null;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: string | Array<TextBlock | ImageBlock | DocumentBlock>;
  is_error?: boolean;
  cache_control?: CacheControlEphemeral | null;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface RedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | DocumentBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | RedactedThinkingBlock;

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/** Client (custom) tool definition. */
export interface CustomTool {
  type?: "custom" | null;
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown> | null;
    required?: string[] | null;
    [key: string]: unknown;
  };
  strict?: boolean;
  cache_control?: CacheControlEphemeral | null;
}

/** Anthropic-defined / server tool (web_search_*, code_execution_*, bash_*, ...). */
export interface ServerTool {
  type: string;
  name: string;
  [key: string]: unknown;
}

export type Tool = CustomTool | ServerTool;

export type ToolChoice =
  | { type: "auto"; disable_parallel_tool_use?: boolean }
  | { type: "any"; disable_parallel_tool_use?: boolean }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
  | { type: "none" };

export type ThinkingConfig =
  | { type: "enabled"; budget_tokens: number; display?: "summarized" | "omitted" | null }
  | { type: "disabled" }
  | { type: "adaptive"; display?: "summarized" | "omitted" | null };

export interface MessagesBody {
  model: AnthropicModelId | (string & {});
  messages: MessageParam[];
  /**
   * Required by the API — hard cap on output (thinking + response text).
   * `0` populates the prompt cache without generating a response (pre-warm);
   * it cannot be combined with `stream: true`, extended thinking,
   * `output_config.format`, or forced tool use.
   */
  max_tokens: number;
  system?: string | TextBlock[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: ToolChoice;
  thinking?: ThinkingConfig;
  /**
   * Automatic prompt caching: applies a cache_control marker to the last
   * cacheable block in the request.
   */
  cache_control?: CacheControlEphemeral | null;
  metadata?: { user_id?: string | null };
  service_tier?: "auto" | "standard_only";
  output_config?: {
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    format?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /**
   * Container identifier for reuse across requests. The non-beta API accepts
   * only the string form; the object form is gated behind a beta header.
   */
  container?: string | Record<string, unknown> | null;
  /**
   * BETA — requires the `mcp-client` anthropic-beta header; the non-beta
   * /v1/messages endpoint rejects this param. unmodel's `.request` headers
   * do not include beta headers; add your own.
   */
  mcp_servers?: Array<Record<string, unknown>>;
  /**
   * BETA — requires the context-management anthropic-beta header; the
   * non-beta /v1/messages endpoint rejects this param. unmodel's `.request`
   * headers do not include beta headers; add your own.
   */
  context_management?: Record<string, unknown>;
  inference_geo?: string;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through; pipeline warns on unknown
// top-level keys by introspecting the shape).
// ---------------------------------------------------------------------------

const looseBlock = z.looseObject({ type: z.string() });

const messageSchema = z.looseObject({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(looseBlock)]),
});

/** Reads a string-valued field off a loosely-parsed block, if present. */
function stringField(block: Record<string, unknown>, key: string): string | undefined {
  const value = block[key];
  return typeof value === "string" ? value : undefined;
}

/** Loose top-level schema for POST /v1/messages. */
export const messagesSchema = z
  .looseObject({
    model: z.string(),
    messages: z.array(messageSchema).min(1, "messages must contain at least one message."),
    // 0 is valid: it pre-warms the prompt cache without generating output.
    max_tokens: z.int().nonnegative(),
    system: z.union([z.string(), z.array(looseBlock)]).optional(),
    temperature: z.number().min(0).max(1).optional(),
    top_p: z.number().optional(),
    top_k: z.int().optional(),
    stop_sequences: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
    tools: z.array(z.looseObject({})).optional(),
    tool_choice: z.looseObject({ type: z.enum(["auto", "any", "tool", "none"]) }).optional(),
    thinking: z
      .union([
        z.looseObject({ type: z.literal("enabled"), budget_tokens: z.int() }),
        z.looseObject({ type: z.literal("disabled") }),
        z.looseObject({ type: z.literal("adaptive") }),
      ])
      .optional(),
    cache_control: z.looseObject({ type: z.literal("ephemeral") }).nullable().optional(),
    metadata: z.looseObject({}).optional(),
    service_tier: z.enum(["auto", "standard_only"]).optional(),
    output_config: z.looseObject({}).optional(),
    container: z.unknown().optional(),
    mcp_servers: z.array(z.looseObject({})).optional(),
    context_management: z.looseObject({}).optional(),
    inference_geo: z.string().optional(),
  })
  .superRefine((params, ctx) => {
    const first = params.messages[0];
    if (first !== undefined && first.role !== "user") {
      ctx.addIssue({
        code: "custom",
        path: ["messages", 0, "role"],
        message: `Anthropic requires conversations to start with a "user" message; the first message has role "${first.role}".`,
      });
    }

    if (params.thinking?.type === "enabled" && params.thinking.budget_tokens < 1024) {
      ctx.addIssue({
        code: "custom",
        path: ["thinking", "budget_tokens"],
        message: `thinking.budget_tokens must be at least 1024; got ${params.thinking.budget_tokens}.`,
      });
    }

    // budget_tokens must be strictly less than max_tokens — thinking tokens
    // count toward the output cap. Interleaved thinking (a beta header this
    // body validator cannot see) legitimately exceeds it; if you use that
    // beta, downgrade this check via options.severity.
    if (params.thinking?.type === "enabled" && params.thinking.budget_tokens >= params.max_tokens) {
      ctx.addIssue({
        code: "custom",
        path: ["thinking", "budget_tokens"],
        message: `thinking.budget_tokens (${params.thinking.budget_tokens}) must be less than max_tokens (${params.max_tokens}); thinking tokens count toward max_tokens. Exception: the interleaved-thinking beta header allows budgets above max_tokens — downgrade this check via options.severity if you send it.`,
      });
    }

    // max_tokens: 0 pre-warms the prompt cache; the API documents these
    // combinations as invalid (prompt-caching docs, "Pre-warming the cache").
    if (params.max_tokens === 0) {
      if (params.stream === true) {
        ctx.addIssue({
          code: "custom",
          path: ["stream"],
          message:
            "`stream: true` cannot be combined with max_tokens: 0 (prompt-cache pre-warm generates no output to stream).",
        });
      }
      if (params.thinking?.type === "enabled") {
        ctx.addIssue({
          code: "custom",
          path: ["thinking"],
          message:
            'extended thinking (thinking.type "enabled") cannot be combined with max_tokens: 0 (prompt-cache pre-warm).',
        });
      }
      if (params.output_config?.["format"] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["output_config", "format"],
          message:
            "structured outputs (`output_config.format`) cannot be combined with max_tokens: 0 (prompt-cache pre-warm).",
        });
      }
      const forced = params.tool_choice?.type;
      if (forced === "any" || forced === "tool") {
        ctx.addIssue({
          code: "custom",
          path: ["tool_choice"],
          message: `forced tool use (tool_choice "${forced}") cannot be combined with max_tokens: 0 (prompt-cache pre-warm).`,
        });
      }
    }

    // Response prefill (trailing assistant message) is rejected while
    // thinking is on (thinking docs: "You can't pre-fill the assistant
    // response while thinking is on").
    const thinkingOn = params.thinking?.type === "enabled" || params.thinking?.type === "adaptive";
    const last = params.messages[params.messages.length - 1];
    if (thinkingOn && last !== undefined && last.role === "assistant") {
      ctx.addIssue({
        code: "custom",
        path: ["messages", params.messages.length - 1, "role"],
        message:
          'the final message has role "assistant" (response prefill), which Anthropic rejects while thinking is on; remove the trailing assistant message or disable thinking.',
      });
    }

    // Strict tool pairing (tool-use docs): every tool_use id in an assistant
    // message must be answered by a tool_result block in the IMMEDIATELY
    // following user message; tool_result blocks may only reference the
    // immediately preceding assistant message's tool_use ids and must come
    // FIRST in the user message's content array.
    params.messages.forEach((message, i) => {
      const content = message.content;
      if (!Array.isArray(content)) return;

      if (message.role === "assistant") {
        const next = params.messages[i + 1];
        const answered = new Set<string>();
        if (next !== undefined && next.role === "user" && Array.isArray(next.content)) {
          for (const block of next.content) {
            if (block.type !== "tool_result") continue;
            const id = stringField(block, "tool_use_id");
            if (id !== undefined) answered.add(id);
          }
        }
        content.forEach((block, j) => {
          if (block.type !== "tool_use") return;
          const id = stringField(block, "id");
          if (id !== undefined && !answered.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: ["messages", i, "content", j, "id"],
              message: `tool_use "${id}" is not answered by a tool_result block in the immediately following user message; Anthropic rejects tool_use ids without tool_result blocks immediately after.`,
            });
          }
        });
      }

      if (message.role === "user") {
        const prev = params.messages[i - 1];
        const prevIds = new Set<string>();
        if (prev !== undefined && prev.role === "assistant" && Array.isArray(prev.content)) {
          for (const block of prev.content) {
            if (block.type !== "tool_use") continue;
            const id = stringField(block, "id");
            if (id !== undefined) prevIds.add(id);
          }
        }
        let pastLeadingResults = false;
        const seen = new Set<string>();
        content.forEach((block, j) => {
          if (block.type !== "tool_result") {
            pastLeadingResults = true;
            return;
          }
          if (pastLeadingResults) {
            ctx.addIssue({
              code: "custom",
              path: ["messages", i, "content", j],
              message:
                "tool_result blocks must come FIRST in the user message's content array; any text must come after all tool results.",
            });
          }
          const id = stringField(block, "tool_use_id");
          if (id === undefined) return;
          if (!prevIds.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: ["messages", i, "content", j, "tool_use_id"],
              message: `tool_result "${id}" does not match a tool_use id in the immediately preceding assistant message; tool results must immediately follow their tool use turn.`,
            });
          } else if (seen.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: ["messages", i, "content", j, "tool_use_id"],
              message: `duplicate tool_result for tool_use "${id}"; each tool_use id must be answered exactly once.`,
            });
          }
          seen.add(id);
        });
      }
    });
  });
