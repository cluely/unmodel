/**
 * unmodel/huggingface — Hugging Face Inference Providers' OpenAI-compatible
 * Chat Completions router, validated against the generated models.dev
 * catalog. Model ids are Hub repo ids (e.g. "moonshotai/Kimi-K2.5"), and an
 * optional ":provider" suffix (e.g. ":groq") selects a specific downstream
 * provider — suffixed ids validate with an unknown_model warning since the
 * catalog tracks the bare repo ids.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { decodeGemini } from "../google/interop";
import { models, provider } from "../../catalog/huggingface.gen";
import type { HuggingfaceTextModelId } from "../../catalog/huggingface.gen";
import { availability } from "../../catalog/availability/huggingface.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<HuggingfaceTextModelId, typeof availability, "huggingface">({
    id: provider.id,
    // Generated from models.dev: https://router.huggingface.co/v1
    baseUrl: provider.api,
    catalog: models,
    availability,
    // The gemini codec this overlay's availability data actually reaches:
    // 2 Gemma rows are also served by google (gemini dialect), so `.toApi("google")`
    // is in the generated type union and must have a decoder behind it —
    // a promised edge with no codec throws `TranslationUnavailableError`.
    // Import-graph rule 3: one codec module and its type-only wire imports,
    // not google's validator, schema or catalog.
    decoders: { gemini: decodeGemini },
  });

/** POST https://router.huggingface.co/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  HuggingfaceModelId,
  HuggingfaceTextModelId,
  HuggingfaceImageModelId,
  HuggingfaceAudioModelId,
  HuggingfaceVideoModelId,
} from "../../catalog/huggingface.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
