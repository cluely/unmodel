/**
 * unmodel/perplexity — Perplexity's Sonar Chat Completions API (the sonar
 * model family), validated against the models.dev `perplexity` catalog.
 *
 * Endpoint: POST https://api.perplexity.ai/chat/completions, the documented
 * alias of the canonical route — "Perplexity's canonical Sonar API endpoint
 * is `POST /v1/sonar`. For OpenAI SDK compatibility, `POST /chat/completions`
 * is also accepted as an alias."
 * (https://docs.perplexity.ai/docs/legacy/sonar/openai-compatibility,
 * 2026-11-12). This module addresses the alias every OpenAI SDK integration
 * already posts to.
 *
 * Lifecycle: the Agent API (POST /v1/agent) supersedes this surface, which is
 * still served — "Sonar Chat Completions support ended on September 27, 2026.
 * Synchronous and streaming requests keep working: they are being
 * reformulated as Agent API requests"
 * (https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview,
 * 2026-11-12). The catalog marks every sonar id deprecated, so each warns
 * `deprecated_model`. Perplexity's suggested Agent API `effort` levels (the
 * field that replaces `model` there): "`sonar` → `fast`, `sonar-pro` →
 * `fast`, `sonar-reasoning-pro` → `low`, `sonar-deep-research` → `high`."
 * (https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to,
 * 2026-11-12).
 *
 * Content parts: user messages take the Sonar reference's chunks — `text`,
 * `image_url`, `file_url`, `pdf_url` and `video_url`, each URL field a `{ url }`
 * object or a plain string — beside the shared dialect's `input_audio` and
 * `file` parts. Whether a model takes a chunk's media is the catalog's call,
 * as on every oai-base overlay: `video_url` is shape-checked here and then
 * refused `unsupported_capability` on every sonar row, since none has video
 * input and Perplexity's media guide documents none — its only video section
 * is `return_videos`, a response option
 * (https://docs.perplexity.ai/docs/legacy/sonar/media, 2026-11-13).
 * `.toApi("openrouter" | "vercel")` forwards these chunks unchanged; compose
 * with that gateway's own validator to check them there.
 *
 * Not addressed by this module:
 * - the Agent API — Responses-shaped (`POST /v1/responses` is its alias), so
 *   it is a substrate question under docs/decisions.md §7, not this overlay;
 * - the Embeddings (POST /v1/embeddings, POST /v1/contextualizedembeddings)
 *   and Decisions (POST /v1/decisions) APIs — no unmodel surface takes either;
 * - the Orchestrator API (https://api.perplexity.ai/orchestrator/v1;
 *   `/router/v1` still works), which speaks Chat Completions, Responses and
 *   Anthropic Messages but is excluded under the public-API rule:
 *   "Orchestrator API is in private preview."
 *   (https://docs.perplexity.ai/docs/orchestrator/models, 2026-11-12).
 *
 * Known gap, an open owner decision recorded in docs/providers.md: the
 * pre-send `estimate.costUSD` (and so `maxCostUSD`) prices tokens only.
 * Perplexity also bills a per-request search fee and, on
 * `sonar-deep-research`, reasoning tokens, citation tokens and search
 * queries. `checkChat` reports the billed total instead (see below).
 */
import { z } from "zod";
import { createChatCompletionsSchema, createOpenAICompatible } from "../openai-compatible";
import {
  audioPartSchema,
  createMessagesSchema,
  filePartSchema,
  textPartSchema,
  type ChatCompletionsBodyBase,
  type ChatMessage,
  type ChatUserContentPart,
  type ChatUserMessage,
} from "../openai-compatible/wire";
import type {
  ChatCompletionLike as DialectChatCompletionLike,
  ChatFinishReason,
} from "../openai-compatible/check";
import type { ModelInfo } from "../../core/catalog-types";
import type { ResponseReport } from "../../core/report";
import type { StandardSchemaV1 } from "../../core/standard-schema";
import { models, provider } from "../../catalog/perplexity.gen";
import type { PerplexityTextModelId } from "../../catalog/perplexity.gen";
import { availability } from "../../catalog/availability/perplexity.gen";

const PERPLEXITY_BASE_URL = "https://api.perplexity.ai";

// ---------------------------------------------------------------------------
// Content chunks — mirror the Sonar reference's ChatMessageContentImageChunk,
// ChatMessageContentFileChunk, ChatMessageContentPDFChunk and
// ChatMessageContentVideoChunk (with its VideoURL) exactly
// (https://docs.perplexity.ai/api-reference/legacy/sonar-post, 2026-11-12).
// Each URL field is "anyOf: URL | string", where URL is `{ url: string }`. The
// media guide documents the file chunk: "Upload documents (PDF, DOC, DOCX,
// TXT, RTF) for analysis using URLs or base64 encoding. Files can be provided
// as publicly accessible URLs or base64 encoded bytes without any prefix."
// (https://docs.perplexity.ai/docs/legacy/sonar/media, 2026-11-12).
// ---------------------------------------------------------------------------

export interface ChatMessageContentImageChunk {
  type: "image_url";
  image_url: { url: string } | string;
}

export interface ChatMessageContentFileChunk {
  type: "file_url";
  /** A public URL, or base64 bytes with no `data:` prefix. */
  file_url: { url: string } | string;
  file_name?: string | null;
}

export interface ChatMessageContentPDFChunk {
  type: "pdf_url";
  pdf_url: { url: string } | string;
}

export interface VideoURL {
  url: string;
  /** An integer or a string; the reference's default is 25. */
  frame_interval?: string | number;
}

export interface ChatMessageContentVideoChunk {
  type: "video_url";
  video_url: VideoURL | string;
}

/**
 * The user content parts `perplexity.chat` accepts: the Sonar reference's
 * chunks plus the shared dialect's parts, which keep validating as they did
 * (the dialect's `image_url` object is one form of the reference's).
 */
export type PerplexityUserContentPart =
  | ChatUserContentPart
  | ChatMessageContentImageChunk
  | ChatMessageContentFileChunk
  | ChatMessageContentPDFChunk
  | ChatMessageContentVideoChunk;

/** A user message whose content takes {@link PerplexityUserContentPart}. */
export interface PerplexityChatUserMessage extends Omit<ChatUserMessage, "content"> {
  content: string | PerplexityUserContentPart[];
}

/** The messages `perplexity.chat` accepts: the dialect's, with user content widened. */
export type PerplexityChatMessage = Exclude<ChatMessage, ChatUserMessage> | PerplexityChatUserMessage;

/**
 * The `perplexity.chat` body: the shared dialect with the Sonar chunks in
 * user content. Every shared-dialect body is one of these, so anything
 * compiled for the openai-chat dialect still lands on it.
 */
export interface PerplexityChatCompletionsBody<ModelId extends string = string>
  extends Omit<ChatCompletionsBodyBase<ModelId>, "messages"> {
  messages: PerplexityChatMessage[];
}

const urlSchema = z.looseObject({ url: z.string() });

// One arm per `type`: the reference's image chunk stands in for the dialect's
// object-only arm (zod refuses a discriminated union with two `image_url`
// arms). Its `URL` has no `detail`; a sent one passes through loose. The
// dialect's `input_audio` and `file` arms stay, so what validated before
// still does.
const userContentSchema = z.union([
  z.string(),
  z.array(
    z.discriminatedUnion("type", [
      textPartSchema,
      z.looseObject({ type: z.literal("image_url"), image_url: z.union([urlSchema, z.string()]) }),
      audioPartSchema,
      filePartSchema,
      z.looseObject({
        type: z.literal("file_url"),
        file_url: z.union([urlSchema, z.string()]),
        file_name: z.string().nullable().optional(),
      }),
      z.looseObject({ type: z.literal("pdf_url"), pdf_url: z.union([urlSchema, z.string()]) }),
      z.looseObject({
        type: z.literal("video_url"),
        video_url: z.union([
          z.looseObject({
            url: z.string(),
            frame_interval: z.union([z.string(), z.number().int()]).optional(),
          }),
          z.string(),
        ]),
      }),
    ]),
  ),
]);

// Annotated: left inferred, every type-check that resolves `chat` re-infers
// these zod builders (~300 instantiations per unified call, bench:types).
const chatSchema: StandardSchemaV1 = createChatCompletionsSchema({
  messages: createMessagesSchema(userContentSchema),
});

// No deny rules shipped: logit_bias/n are absent from the documented
// /v1/sonar schema, but absence there is not proof the route rejects them
// (many compat servers silently ignore unknown params). Encode only once a
// recorded 400 fixture proves rejection. Tool calling needs no rule either —
// every catalog model is `toolCall: false`, so the built-in capability check
// already rejects `tools`.
const { chat, chatUrl, checkChat: checkDialectChat, estimateChatTokens } =
  createOpenAICompatible<
    PerplexityTextModelId,
    typeof availability,
    "perplexity",
    Record<string, ModelInfo>,
    PerplexityChatCompletionsBody<PerplexityTextModelId>
  >({
    id: "perplexity",
    baseUrl: PERPLEXITY_BASE_URL,
    // The shared dialect plus the Sonar reference's content chunks (above).
    schema: chatSchema,
    catalog: models,
    availability,
  });

/** POST target for perplexity.chat. */
export const CHAT_COMPLETIONS_URL = chatUrl;

/**
 * The response `perplexity.checkChat` reads: the shared dialect's fields plus
 * the two `usage` fields Perplexity adds that the checker consumes. Mirrors
 * the API reference's `UsageInfo.reasoning_tokens` ("Number of tokens used for
 * reasoning", integer or null) and `UsageInfo.cost.total_cost` ("Total cost
 * for the request in USD", a number) exactly
 * (https://docs.perplexity.ai/api-reference/legacy/sonar-post, 2026-11-12);
 * only the fields read are declared.
 */
export interface ChatCompletionLike extends DialectChatCompletionLike {
  usage?:
    | (NonNullable<DialectChatCompletionLike["usage"]> & {
        reasoning_tokens?: number | null;
        cost?: { total_cost?: number } | null;
      })
    | null;
}

/**
 * Post-generation report for a Sonar chat completion: the shared dialect's
 * truncation / content-filter / refusal warnings, usage, and the billed cost.
 * Never throws.
 *
 * - `costUSD` is Perplexity's own `usage.cost.total_cost` — "Total cost for
 *   the request in USD", a required field of every response's `usage`
 *   (https://docs.perplexity.ai/api-reference/legacy/sonar-post, 2026-11-12).
 *   Token rates alone miss the per-request search fee every Sonar model
 *   bills ("1 request × $5 ÷ 1,000 = $0.005" of the documented sample's
 *   "$0.005420" total, https://docs.perplexity.ai/docs/legacy/sonar/models/sonar,
 *   2026-11-12), so a response without `usage.cost` gets no `costUSD` rather
 *   than an undercount.
 * - `usage.reasoningTokens` is the top-level `usage.reasoning_tokens` — "They're
 *   reported separately from completion tokens in `usage.reasoning_tokens` and
 *   billed at their own rate." (https://docs.perplexity.ai/docs/resources/faq,
 *   2026-11-12).
 */
export function checkChat(res: ChatCompletionLike): ResponseReport<ChatFinishReason> {
  const { warnings, usage, finishReason } = checkDialectChat(res);
  const reasoning = res.usage?.reasoning_tokens;
  if (typeof reasoning === "number") usage.reasoningTokens = reasoning;
  const billed = res.usage?.cost?.total_cost;
  return {
    warnings,
    usage,
    ...(finishReason !== undefined && { finishReason }),
    ...(typeof billed === "number" && Number.isFinite(billed) && { costUSD: billed }),
  };
}

export { chat, estimateChatTokens, models, provider };
export type {
  PerplexityModelId,
  PerplexityTextModelId,
  PerplexityImageModelId,
  PerplexityAudioModelId,
  PerplexityVideoModelId,
} from "../../catalog/perplexity.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
