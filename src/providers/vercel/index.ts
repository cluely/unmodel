/**
 * unmodel/vercel — Vercel AI Gateway's OpenAI-compatible Chat Completions
 * endpoint, validated against the generated models.dev catalog.
 *
 * The gateway routes `creator/model` ids (e.g. "anthropic/claude-sonnet-4.5")
 * to many upstream providers; the catalog also lists image/audio/video and
 * embedding ids that are not chat-completions models.
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

import { models, provider } from "../../catalog/vercel.gen";
import type { VercelTextModelId } from "../../catalog/vercel.gen";
import { availability } from "../../catalog/availability/vercel.gen";

// The catalog has no `provider.api`; the documented OpenAI-compatible base is
// https://ai-gateway.vercel.sh/v1
// (https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions,
// checked 2026-08-13).
const VERCEL_BASE_URL = "https://ai-gateway.vercel.sh/v1";

const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<
  VercelTextModelId,
  typeof availability
>({
  id: provider.id,
  baseUrl: VERCEL_BASE_URL,
  catalog: models,
  availability,
  // 15 models in the generated table are also served by google
  // (gemini dialect) and 3 by anthropic (messages dialect).
  decoders: { "anthropic-messages": decodeAnthropic, gemini: decodeGemini },
});

/** POST https://ai-gateway.vercel.sh/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  VercelModelId,
  VercelTextModelId,
  VercelImageModelId,
  VercelAudioModelId,
  VercelVideoModelId,
} from "../../catalog/vercel.gen";
