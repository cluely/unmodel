import { z } from "zod";
import {
  createChatCompletionsSchema,
  messageRoleSchemas,
  refineMessageSequence,
} from "../openai-compatible/wire";
import type {
  ChatAssistantMessage,
  ChatCompletionsBodyBase,
  ChatDeveloperMessage,
  ChatFunctionMessage,
  ChatTextPart,
} from "../openai-compatible/wire";
import type { DeepseekTextModelId } from "../../catalog/deepseek.gen";

// ---------------------------------------------------------------------------
// Wire leaf for `deepseek.chat`: the request types and zod schema for the
// parts of POST https://api.deepseek.com/chat/completions where DeepSeek
// documents something other than the shared OpenAI-compatible dialect. The
// rest of the body is the dialect's (../openai-compatible/wire.ts), reused
// verbatim. Mirrors https://api-docs.deepseek.com/api/create-chat-completion
// and https://api-docs.deepseek.com/guides/vision exactly (both checked
// 2026-11-13); the quotes below are from the reference unless they say
// otherwise.
//
// Not typed yet, though the reference lists them (2026-11-13): the
// `latest_reminder` role, the assistant's `server_tool_calls`, and the
// `deepseek_web_search` / `deepseek_read_url` tools. They fail as
// `invalid_shape` until they get their own research pass — the web tools
// change what `tool_choice: "required"` means ("With the web tools declared,
// required is treated as auto"), which the thinking-mode rule in ./index.ts
// reads.
// ---------------------------------------------------------------------------

/** The image part: "detail string Possible values: low, high, original, auto". */
export interface ChatImagePart {
  type: "image_url";
  image_url: {
    /** "Either an http(s) URL of the image (max 8192 characters) or a base64-encoded data URL (data:image/jpeg;base64,...)." */
    url: string;
    /** "low downsamples the image to 512x512 (faster, cheaper). high, original, and auto keep the original image." */
    detail?: "low" | "high" | "original" | "auto";
  };
}

/**
 * The file part — flat, where the dialect nests a `file: {…}` object. "Exactly
 * one of file_id and file_data is required: passing neither returns a 400 error
 * ("file must have a file_id or file_data"); passing both returns a 400 error
 * ("file cannot have both file_id and file_data")." That rule is a check in
 * ./index.ts rather than a type, so its message can name the fix.
 */
export interface ChatFilePart {
  type: "file";
  /** "The ID of a file uploaded via the Files API, of the form file-api-.... Mutually exclusive with file_data." */
  file_id?: string;
  /** "A base64-encoded data URL of the image (data:image/jpeg;base64,...). Mutually exclusive with file_id." */
  file_data?: string;
  /** "An optional filename. Only valid together with file_data." */
  filename?: string;
}

/** A content part of a user, system or tool message: "Text content part, Image content part, File content part". */
export type ChatUserContentPart = ChatTextPart | ChatImagePart | ChatFilePart;

/**
 * The reference types system `content` as a string; the vision guide says
 * "Images are supported in user, system and tool messages. Images in assistant
 * messages return a 400 error." The wider page is typed, so an image the API
 * takes is never refused.
 */
export interface ChatSystemMessage {
  role: "system";
  content: string | ChatUserContentPart[];
  name?: string;
}

/** "Either a string, or an array of content parts (for image input)." */
export interface ChatUserMessage {
  role: "user";
  content: string | ChatUserContentPart[];
  name?: string;
}

/** "The contents of the tool message. Either a string, or an array of content parts (for image input)." */
export interface ChatToolMessage {
  role: "tool";
  content: string | ChatUserContentPart[];
  tool_call_id: string;
}

/**
 * DeepSeek's message union. `developer` and `function` are the dialect's: the
 * reference does not list them, and refusing a role the API may serve is the
 * one failure this library must never have.
 */
export type ChatMessage =
  | ChatSystemMessage
  | ChatDeveloperMessage
  | ChatUserMessage
  | ChatAssistantMessage
  | ChatToolMessage
  | ChatFunctionMessage;

/** The `deepseek.chat` body: the dialect's, with DeepSeek's messages and top-level extensions. */
export interface ChatCompletionsBody<ModelId extends string = DeepseekTextModelId>
  extends Omit<ChatCompletionsBodyBase<ModelId>, "messages" | "reasoning_effort"> {
  messages: ChatMessage[];
  /**
   * "Controls the switch between thinking and non-thinking mode. When thinking
   * is omitted or null, the mode follows reasoning_effort; if reasoning_effort
   * is also omitted, thinking is enabled. When this object is provided, type is
   * required and takes precedence over reasoning_effort for selecting the
   * mode." `type`: "If set to enabled, then use thinking mode. If set to
   * disabled, then use non-thinking model."
   */
  thinking?: { type: "enabled" | "disabled" } | null;
  /**
   * "Possible values: none, low, high, max … For compatibility with existing
   * software, minimal is accepted and mapped to low, and medium / xhigh are
   * accepted and mapped to high." `ultra` is from the thinking-mode guide's
   * mapping table ("ultra | max", https://api-docs.deepseek.com/guides/thinking_mode,
   * checked 2026-11-12), which the reference omits.
   */
  reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | null;
  /**
   * "A custom user_id. We recommend using only ASCII letters, digits,
   * underscores (_), and hyphens (-). The UTF-8 encoded value must not exceed
   * 512 bytes."
   */
  user_id?: string | null;
  /**
   * "DeepSeek extension. Set level to high to turn on basic risk control, which
   * reviews the model input and output." `level`: "high: basic risk control.
   * low: the default checks, the same as omitting safety_check."
   */
  safety_check?: { level: "low" | "high" } | null;
  /**
   * "DeepSeek extension. Set {"enabled": true} to have the response carry a
   * short title for the conversation." `enabled`: "Whether to return a
   * conversation title."
   */
  title?: { enabled: boolean } | null;
}

// ---------------------------------------------------------------------------
// Schema — loose everywhere, like the dialect's, so unknown keys pass through.
// ---------------------------------------------------------------------------

const contentSchema = z.union([
  z.string(),
  z.array(
    z.discriminatedUnion("type", [
      z.looseObject({ type: z.literal("text"), text: z.string() }),
      z.looseObject({
        type: z.literal("image_url"),
        image_url: z.looseObject({
          url: z.string(),
          detail: z.enum(["low", "high", "original", "auto"]).optional(),
        }),
      }),
      z.looseObject({
        type: z.literal("file"),
        file_id: z.string().optional(),
        file_data: z.string().optional(),
        filename: z.string().optional(),
      }),
    ]),
  ),
]);

const messagesSchema = z
  .array(
    z.discriminatedUnion("role", [
      z.looseObject({ role: z.literal("system"), content: contentSchema, name: z.string().optional() }),
      messageRoleSchemas.developer,
      z.looseObject({ role: z.literal("user"), content: contentSchema, name: z.string().optional() }),
      messageRoleSchemas.assistant,
      z.looseObject({ role: z.literal("tool"), content: contentSchema, tool_call_id: z.string() }),
      messageRoleSchemas.function,
    ]),
  )
  .superRefine(refineMessageSequence);

/** The `deepseek.chat` body schema: the dialect's shape with DeepSeek's messages and extensions. */
export const chatSchema = createChatCompletionsSchema({
  messages: messagesSchema,
  thinking: z.looseObject({ type: z.enum(["enabled", "disabled"]) }).nullable().optional(),
  user_id: z.string().nullable().optional(),
  safety_check: z.looseObject({ level: z.enum(["low", "high"]) }).nullable().optional(),
  title: z.looseObject({ enabled: z.boolean() }).nullable().optional(),
});
