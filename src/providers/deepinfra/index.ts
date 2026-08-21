/**
 * unmodel/deepinfra — DeepInfra's OpenAI-compatible chat completions API,
 * validated against the models.dev `deepinfra` catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { decodeGemini } from "../google/interop";
import { models, provider } from "../../catalog/deepinfra.gen";
import type { DeepinfraTextModelId } from "../../catalog/deepinfra.gen";
import { availability } from "../../catalog/availability/deepinfra.gen";

// The catalog has no `provider.api`; the documented OpenAI-compatible base is
// https://api.deepinfra.com/v1/openai (https://docs.deepinfra.com/chat/overview,
// checked 2026-08-13).
const DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<DeepinfraTextModelId, typeof availability, "deepinfra">({
    id: "deepinfra",
    baseUrl: DEEPINFRA_BASE_URL,
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

/** POST target for deepinfra.chat. */
export const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, models, provider };
export type {
  DeepinfraModelId,
  DeepinfraTextModelId,
  DeepinfraImageModelId,
  DeepinfraAudioModelId,
  DeepinfraVideoModelId,
} from "../../catalog/deepinfra.gen";
