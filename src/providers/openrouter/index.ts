/**
 * unmodel/openrouter — OpenRouter's OpenAI-compatible Chat Completions
 * endpoint (a multi-provider router), validated against the generated
 * models.dev catalog.
 *
 * OpenRouter accepts extra routing params beyond the OpenAI dialect
 * (`provider`, `transforms`, `route`, `models` fallbacks, ...). Those are
 * deliberately NOT added to the shared wire schema: the loose schema passes
 * them through to the wire body untouched and surfaces each as an
 * `unknown_param` warning, which is the intended behavior for
 * router-specific extensions.
 */
import { createOpenAICompatible } from "../openai-compatible";
// The two cross-dialect codecs this overlay's availability data actually
// reaches. Import-graph rule 3: an endpoint module may import another
// provider's `interop.ts` and nothing else of theirs, so this costs the two
// codec modules and their type-only wire imports — not anthropic's or
// google's validator, schema or catalog. The rest of the fleet declares no
// decoders at all, because their data names only OpenAI-compatible targets.
import { decodeAnthropic } from "../anthropic/interop";
import { decodeGemini } from "../google/interop";

import { models, provider } from "../../catalog/openrouter.gen";
import type { OpenrouterTextModelId } from "../../catalog/openrouter.gen";
import { availability } from "../../catalog/availability/openrouter.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<OpenrouterTextModelId, typeof availability, "openrouter">({
    id: provider.id,
    // Generated from models.dev: https://openrouter.ai/api/v1
    baseUrl: provider.api,
    catalog: models,
    availability,
    // 21 models in the generated table are also served by google
    // (gemini dialect) and 3 by anthropic (messages dialect).
    decoders: { "anthropic-messages": decodeAnthropic, gemini: decodeGemini },
  });

/** POST https://openrouter.ai/api/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  OpenrouterModelId,
  OpenrouterTextModelId,
  OpenrouterImageModelId,
  OpenrouterAudioModelId,
  OpenrouterVideoModelId,
} from "../../catalog/openrouter.gen";
