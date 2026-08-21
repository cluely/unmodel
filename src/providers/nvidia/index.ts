/**
 * unmodel/nvidia — NVIDIA's OpenAI-compatible NIM chat completions API
 * (build.nvidia.com hosted endpoints), validated against the models.dev
 * `nvidia` catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { decodeGemini } from "../google/interop";
import { models, provider } from "../../catalog/nvidia.gen";
import type { NvidiaTextModelId } from "../../catalog/nvidia.gen";
import { availability } from "../../catalog/availability/nvidia.gen";

// `provider.api` from the generated catalog; matches the documented base
// https://integrate.api.nvidia.com/v1 (https://docs.api.nvidia.com/nim/,
// checked 2026-08-13).
const NVIDIA_BASE_URL = provider.api;

const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<
  NvidiaTextModelId,
  typeof availability,
  "nvidia"
>({
  id: "nvidia",
  baseUrl: NVIDIA_BASE_URL,
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

/** POST target for nvidia.chat. */
export const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, models, provider };
export type {
  NvidiaModelId,
  NvidiaTextModelId,
  NvidiaImageModelId,
  NvidiaAudioModelId,
  NvidiaVideoModelId,
} from "../../catalog/nvidia.gen";
