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
 * `deprecated_model`.
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
 * Known gaps, both owner decisions recorded in docs/providers.md:
 * - content parts: the API reference also documents `file_url`, `pdf_url`,
 *   `video_url` and string-form `image_url` chunks
 *   (https://docs.perplexity.ai/api-reference/legacy/sonar-post,
 *   2026-11-12). This overlay validates the shared dialect's parts and
 *   refuses those four as `invalid_shape`.
 * - the pre-send `estimate.costUSD` (and so `maxCostUSD`) prices tokens
 *   only. Perplexity also bills a per-request search fee and, on
 *   `sonar-deep-research`, reasoning tokens, citation tokens and search
 *   queries. `checkChat` reports the billed total instead (see below).
 */
import { createOpenAICompatible } from "../openai-compatible";
import type {
  ChatCompletionLike as DialectChatCompletionLike,
  ChatFinishReason,
} from "../openai-compatible/check";
import type { ResponseReport } from "../../core/report";
import { models, provider } from "../../catalog/perplexity.gen";
import type { PerplexityTextModelId } from "../../catalog/perplexity.gen";
import { availability } from "../../catalog/availability/perplexity.gen";

const PERPLEXITY_BASE_URL = "https://api.perplexity.ai";

// No deny rules shipped: logit_bias/n are absent from the documented
// /v1/sonar schema, but absence there is not proof the route rejects them
// (many compat servers silently ignore unknown params). Encode only once a
// recorded 400 fixture proves rejection. Tool calling needs no rule either —
// every catalog model is `toolCall: false`, so the built-in capability check
// already rejects `tools`.
const { chat, chatUrl, checkChat: checkDialectChat, estimateChatTokens } =
  createOpenAICompatible<PerplexityTextModelId, typeof availability, "perplexity">({
    id: "perplexity",
    baseUrl: PERPLEXITY_BASE_URL,
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
