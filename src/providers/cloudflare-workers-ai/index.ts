/**
 * unmodel/cloudflare-workers-ai — Cloudflare Workers AI's OpenAI-compatible
 * Chat Completions endpoint, validated against the generated models.dev
 * catalog.
 *
 * Workers AI has no static base URL: the documented OpenAI-compatible base
 * embeds the caller's Cloudflare account id
 * (https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1, per
 * https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/,
 * checked 2026-08-13). So instead of a module-level `chat`, this overlay
 * exports `createCloudflare(accountId)`, which returns the standard
 * OpenAI-compatible surface (`chat`, `chatUrl`, `checkChat`,
 * `estimateChatTokens`) bound to that account's URL. The account id is a
 * routing path segment, not a credential — API tokens still never pass
 * through unmodel.
 */
import { createOpenAICompatible, type OpenAICompatibleProvider } from "../openai-compatible";
import { decodeGemini } from "../google/interop";
import { models, provider } from "../../catalog/cloudflare-workers-ai.gen";
import type { CloudflareWorkersAiTextModelId } from "../../catalog/cloudflare-workers-ai.gen";
import { availability } from "../../catalog/availability/cloudflare-workers-ai.gen";

/**
 * Builds a Workers AI validator bound to one Cloudflare account.
 *
 * ```ts
 * const { chat, chatUrl } = createCloudflare("023e105f4ecef8ad9ca31a8372d0c353");
 * // chatUrl === "https://api.cloudflare.com/client/v4/accounts/023e105f4ecef8ad9ca31a8372d0c353/ai/v1/chat/completions"
 * ```
 */
export function createCloudflare(
  accountId: string,
): OpenAICompatibleProvider<CloudflareWorkersAiTextModelId, typeof availability> {
  return createOpenAICompatible<CloudflareWorkersAiTextModelId, typeof availability, "cloudflare-workers-ai">({
    id: provider.id,
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`,
    catalog: models,
    availability,
    // The gemini codec this overlay's availability data actually reaches:
    // one Gemma row is also served by google (gemini dialect), so `.toApi("google")`
    // is in the generated type union and must have a decoder behind it —
    // a promised edge with no codec throws `TranslationUnavailableError`.
    // Import-graph rule 3: one codec module and its type-only wire imports,
    // not google's validator, schema or catalog.
    decoders: { gemini: decodeGemini },
  });
}

export { models, provider };
export type {
  CloudflareWorkersAiModelId,
  CloudflareWorkersAiTextModelId,
  CloudflareWorkersAiImageModelId,
  CloudflareWorkersAiAudioModelId,
  CloudflareWorkersAiVideoModelId,
} from "../../catalog/cloudflare-workers-ai.gen";
