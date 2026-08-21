/**
 * unmodel/friendli — Friendli Serverless Endpoints' OpenAI-compatible Chat
 * Completions endpoint, validated against the generated models.dev catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { decodeGemini } from "../google/interop";
import { models, provider } from "../../catalog/friendli.gen";
import type { FriendliTextModelId } from "../../catalog/friendli.gen";
import { availability } from "../../catalog/availability/friendli.gen";

// `provider.api` from the generated catalog; matches the documented base
// (https://friendli.ai/docs/guides/serverless_endpoints/introduction):
// https://api.friendli.ai/serverless/v1
const FRIENDLI_BASE_URL = provider.api;

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<FriendliTextModelId, typeof availability, "friendli">({
    id: provider.id,
    baseUrl: FRIENDLI_BASE_URL,
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

/** POST https://api.friendli.ai/serverless/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  FriendliModelId,
  FriendliTextModelId,
  FriendliImageModelId,
  FriendliAudioModelId,
  FriendliVideoModelId,
} from "../../catalog/friendli.gen";
