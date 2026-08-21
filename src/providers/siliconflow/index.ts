/**
 * unmodel/siliconflow — SiliconFlow's (international) OpenAI-compatible Chat
 * Completions endpoint, validated against the generated models.dev catalog.
 *
 * This overlay covers the international `siliconflow` catalog; the mainland
 * `siliconflow-cn` catalog (api.siliconflow.cn) is a separate provider entry.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { decodeGemini } from "../google/interop";
import { models, provider } from "../../catalog/siliconflow.gen";
import type { SiliconflowTextModelId } from "../../catalog/siliconflow.gen";
import { availability } from "../../catalog/availability/siliconflow.gen";

// `provider.api` from the generated catalog (provider doc:
// https://cloud.siliconflow.com/models): https://api.siliconflow.com/v1
const SILICONFLOW_BASE_URL = provider.api;

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<SiliconflowTextModelId, typeof availability, "siliconflow">({
    id: provider.id,
    baseUrl: SILICONFLOW_BASE_URL,
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

/** POST https://api.siliconflow.com/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  SiliconflowModelId,
  SiliconflowTextModelId,
  SiliconflowImageModelId,
  SiliconflowAudioModelId,
  SiliconflowVideoModelId,
} from "../../catalog/siliconflow.gen";
