/**
 * unmodel/longcat — Meituan's LongCat platform, OpenAI-compatible Chat
 * Completions endpoint (the LongCat model family, e.g. LongCat-2.0),
 * validated against the generated models.dev catalog.
 *
 * The platform docs (https://longcat.chat/platform/docs/, checked 2026-08-13)
 * state the API is "fully compatible with the OpenAI API specification" and
 * give the full chat path https://api.longcat.chat/openai/v1/chat/completions
 * (an Anthropic-format endpoint also exists under /anthropic; this module
 * covers only the OpenAI dialect).
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/longcat.gen";
import type { LongcatTextModelId } from "../../catalog/longcat.gen";
import { availability } from "../../catalog/availability/longcat.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<LongcatTextModelId, typeof availability, "longcat">({
    id: provider.id,
    // The generated catalog's `api` field stops at /openai; the documented
    // chat path is /openai/v1/chat/completions
    // (https://longcat.chat/platform/docs/), so the factory base includes /v1.
    baseUrl: "https://api.longcat.chat/openai/v1",
    catalog: models,
    availability,
    // The catalog's `temperature: false` on LongCat rows means the value is
    // fixed, not refused — no LongCat reference has ever said a value is
    // rejected (checked 2026-11-12):
    // - https://longcat.chat/platform/docs/api/model-params: "Fixed to 1.0
    //   when thinking is enabled and 0.7 when thinking is disabled. Other
    //   values are not rejected — they are overridden with the default for the
    //   current thinking state." and top_p "0.95 (0, 1]" (adjustable);
    // - LongCat-2.0, the flag's own source,
    //   https://raw.githubusercontent.com/anomalyco/models.dev/dev/providers/longcat/models/LongCat-2.0.toml:
    //   "temperature is fixed (1.0 with thinking on, 0.7 off) and other values
    //   are overridden; top_p (0, 1] and top_k [-1, 100] are accepted";
    // - LongCat-2.5-Preview, the one reference that documented it,
    //   https://web.archive.org/web/20260925143949/https://longcat.chat/platform/docs/zh/api/chat:
    //   "temperature number optional 采样温度，范围 0 ~ 1 。"
    fixedSampling: "overridden",
  });

/** POST https://api.longcat.chat/openai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  LongcatModelId,
  LongcatTextModelId,
  LongcatImageModelId,
  LongcatAudioModelId,
  LongcatVideoModelId,
} from "../../catalog/longcat.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
