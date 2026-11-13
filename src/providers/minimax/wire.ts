import { z } from "zod";
import {
  audioPartSchema,
  createChatCompletionsSchema,
  createMessagesSchema,
  filePartSchema,
  textPartSchema,
  type ChatAudioPart,
  type ChatCompletionsBodyBase,
  type ChatFilePart,
  type ChatMessage,
  type ChatPromptCacheBreakpoint,
  type ChatTextPart,
  type ChatUserMessage,
} from "../openai-compatible/wire";

// ---------------------------------------------------------------------------
// Wire leaf for `minimax.chat`: where MiniMax's OpenAI-compatible Chat
// Completions body is wider than the shared dialect, as types and a zod
// schema, and nothing else. MiniMax's media endpoints keep their wire in
// their own modules (./tts, ./video, …).
//
// The one widening is the user turn's content parts. Mirror
// openapi-chat-openai.json `MessageContentPart` exactly
// (https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json,
// checked 2026-11-12): `type` is "text" | "image_url" | "video_url", and
// "`MiniMax-M3.1-Flash` and `MiniMax-M3` support text, image, and video
// content parts". The shared dialect's union stays as it is, because the
// other oai-base members document no `video_url` and no `detail: "default"`.
// Whether a model takes video at all is the catalog's call, checked per
// model by the shared modality check.
// ---------------------------------------------------------------------------

/** `MessageContentPart` with `type: "image_url"` (openapi-chat-openai.json, 2026-11-12). */
export interface MinimaxChatImagePart {
  type: "image_url";
  image_url: {
    /** "Image URL or Base64 data URL." Up to 10 MB per image. */
    url: string;
    /**
     * Image resolution — `low`, `default` or `high`, defaulting to `default`.
     * `auto` is the shared dialect's value, not MiniMax's; it stays accepted
     * because MiniMax does not document refusing it, and narrowing it away
     * would refuse requests that validate today.
     */
    detail?: "auto" | "low" | "default" | "high";
    /** "Longest-side pixel limit for the image." An integer ≥ 1. */
    max_long_side_pixel?: number;
  };
  prompt_cache_breakpoint?: ChatPromptCacheBreakpoint;
}

/** `MessageContentPart` with `type: "video_url"` (openapi-chat-openai.json, 2026-11-12). */
export interface MinimaxChatVideoPart {
  type: "video_url";
  video_url: {
    /**
     * "Video URL, Base64 data URL, or Files API reference in the form
     * `mm_file://{file_id}`." URL or Base64 videos up to 50 MB; Files API
     * videos up to 512 MB.
     */
    url: string;
    /** "Controls per-frame video resolution. Defaults to default." */
    detail?: "low" | "default" | "high";
    /** "Video frame sampling rate. Defaults to 1. Range [0.2, 5]." */
    fps?: number;
    /** "Longest-side pixel limit for video frames." An integer ≥ 1. */
    max_long_side_pixel?: number;
  };
}

/**
 * What a MiniMax user turn's content array takes. `input_audio` and `file`
 * are the shared dialect's and stay in the shape: MiniMax says "audio input
 * is not currently supported", and it is the catalog's modality check that
 * refuses such a part on a model without that input.
 */
export type MinimaxChatUserContentPart =
  | ChatTextPart
  | MinimaxChatImagePart
  | MinimaxChatVideoPart
  | ChatAudioPart
  | ChatFilePart;

export interface MinimaxChatUserMessage extends Omit<ChatUserMessage, "content"> {
  content: string | MinimaxChatUserContentPart[];
}

export type MinimaxChatMessage = Exclude<ChatMessage, ChatUserMessage> | MinimaxChatUserMessage;

/**
 * The `minimax.chat` body: the shared dialect with MiniMax's user content
 * parts. Every shared-dialect body is one of these, so anything compiled for
 * the openai-chat dialect still lands on it.
 */
export interface MinimaxChatCompletionsBody<ModelId extends string = string>
  extends Omit<ChatCompletionsBodyBase<ModelId>, "messages"> {
  messages: MinimaxChatMessage[];
}

// ---------------------------------------------------------------------------
// Schema — loose like the shared dialect's, so unknown keys pass through.
// ---------------------------------------------------------------------------

const imagePartSchema = z.looseObject({
  type: z.literal("image_url"),
  image_url: z.looseObject({
    url: z.string(),
    detail: z.enum(["auto", "low", "default", "high"]).optional(),
    max_long_side_pixel: z.number().int().min(1).optional(),
  }),
});

const videoPartSchema = z.looseObject({
  type: z.literal("video_url"),
  video_url: z.looseObject({
    url: z.string(),
    detail: z.enum(["low", "default", "high"]).optional(),
    fps: z.number().min(0.2).max(5).optional(),
    max_long_side_pixel: z.number().int().min(1).optional(),
  }),
});

const userContentSchema = z.union([
  z.string(),
  z.array(
    z.discriminatedUnion("type", [
      textPartSchema,
      imagePartSchema,
      videoPartSchema,
      audioPartSchema,
      filePartSchema,
    ]),
  ),
]);

/** The loose top-level schema `minimax.chat` validates against. */
export const chatCompletionsSchema = createChatCompletionsSchema({
  messages: createMessagesSchema(userContentSchema),
});
