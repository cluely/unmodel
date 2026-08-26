/**
 * unmodel/scaleway — Scaleway Generative APIs' OpenAI-compatible Chat
 * Completions endpoint, validated against the generated models.dev catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { decodeGemini } from "../google/interop";
import { models, provider } from "../../catalog/scaleway.gen";
import type { ScalewayTextModelId } from "../../catalog/scaleway.gen";
import { availability } from "../../catalog/availability/scaleway.gen";

// `provider.api` from the generated catalog; matches the documented base
// (https://www.scaleway.com/en/docs/generative-apis/): https://api.scaleway.ai/v1
const SCALEWAY_BASE_URL = provider.api;

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<ScalewayTextModelId, typeof availability, "scaleway">({
    id: provider.id,
    baseUrl: SCALEWAY_BASE_URL,
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

/** POST https://api.scaleway.ai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  ScalewayModelId,
  ScalewayTextModelId,
  ScalewayImageModelId,
  ScalewayAudioModelId,
  ScalewayVideoModelId,
} from "../../catalog/scaleway.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
