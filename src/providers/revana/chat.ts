/**
 * `revana.chat` — Revana's OpenAI-compatible Chat Completions endpoint
 * (`POST https://api.revana.si/v1/chat/completions`), for the `kind: "text"`
 * models of its catalog.
 *
 * "Every OpenAI client library works unchanged: set the base URL and the key"
 * (https://revana.si/chat), so this is the shared OpenAI-compatible validator
 * over a catalog generated from Revana's own `GET /v1/models` — Revana is not
 * in models.dev — plus the endpoint's documented narrowing:
 *
 * > "text and image_url pictures only; function tools only … web search,
 * > audio, files and video input, predicted outputs and built-in tools are
 * > refused with `400 unsupported_parameter`."
 *
 * Each refusal below was also sent to the live endpoint on 2026-11-12 and the
 * message it answered is quoted in the rule. Audio and file content parts need
 * no rule of their own: every catalog row declares text and image input, and
 * the shared modality check refuses the rest by name.
 *
 * Two things the response carries that OpenAI's does not: `id` starts `chat_`,
 * and `usage.cost_usd` is what the request cost — exact, where the catalog's
 * rates are the base tier (some models bill more above a prompt size, at peak
 * hours or at `effort: "max"`; the generated rows say which).
 *
 * A dedicated LEAF rather than part of the provider barrel, for the reason
 * `stepfun/chat.ts` gives: a chat bundle must not pay for eight media
 * validators.
 */

import { createOpenAICompatible } from "../openai-compatible";
import type { ChatCompletionLike, ChatFinishReason } from "../openai-compatible/check";
import type { FamilyRule } from "../../core/constraint-types";
import type { ResponseReport } from "../../core/report";
import type { RevanaChatModelId } from "./gen/ids.gen";
import { chatModels } from "./gen/models-chat.gen";
import { REVANA_BASE_URL } from "./urls";

/** The page that states what the endpoint narrows. */
export const REVANA_CHAT_SOURCE = "https://revana.si/chat";

/** The three top-level params the endpoint names and refuses, on every model. */
const chatFamilyRules: readonly FamilyRule[] = [
  {
    family: "Revana language models",
    match: () => true,
    deny: {
      web_search_options: {
        reason: 'Revana answers `400 unsupported_parameter` — "web_search_options: Web search is not offered."',
        source: REVANA_CHAT_SOURCE,
      },
      prediction: {
        reason: 'Revana answers `400 unsupported_parameter` — "prediction: Predicted outputs are not offered."',
        source: REVANA_CHAT_SOURCE,
      },
      audio: {
        reason: 'Revana answers `400 unsupported_parameter` — "audio: Audio output is not offered."',
        source: REVANA_CHAT_SOURCE,
      },
    },
  },
];

const overlay = createOpenAICompatible<
  RevanaChatModelId,
  never,
  "revana"
>({
  id: "revana",
  baseUrl: REVANA_BASE_URL,
  catalog: chatModels,
  familyRules: chatFamilyRules,
  extraChecks: [
    // The two refusals a deny table cannot express: both depend on a VALUE.
    (params, _info, ctx) => {
      const record = params as { modalities?: unknown; tools?: unknown };
      if (Array.isArray(record.modalities) && record.modalities.some((m) => m !== "text")) {
        ctx.report({
          code: "unsupported_param",
          path: ["modalities"],
          model: params.model,
          message:
            '`modalities` may only be `["text"]` on Revana — it answers `400 unsupported_parameter`, "modalities: only text output is offered."',
          meta: { source: REVANA_CHAT_SOURCE },
        });
      }
      if (!Array.isArray(record.tools)) return;
      record.tools.forEach((tool, index) => {
        const type = (tool as { type?: unknown } | null)?.type;
        if (type === "function") return;
        ctx.report({
          code: "unsupported_param",
          path: ["tools", index, "type"],
          model: params.model,
          message:
            `\`tools[${index}].type\` is ${JSON.stringify(type)}; Revana offers function tools only and answers ` +
            '`400 unsupported_parameter`, "tools: only function tools are offered."',
          meta: { source: REVANA_CHAT_SOURCE },
        });
      });
    },
  ],
});

export const { chat, chatUrl, estimateChatTokens } = overlay;

/**
 * Post-generation inspection, with the cost Revana itself reports.
 *
 * Every Revana completion carries `usage.cost_usd` — "what it cost". That is
 * the charge; the catalog's rates are the base tier and miss the surcharges
 * some models carry (a long-prompt tier, peak hours, `effort: "max"`). So
 * where the response states its cost, `costUSD` IS that figure, and the
 * catalog-priced number is the fallback for a response that does not (a
 * stream read without `stream_options.include_usage`). Never throws.
 */
export function checkChat(res: ChatCompletionLike): ResponseReport<ChatFinishReason> {
  const report = overlay.checkChat(res);
  const charged = (res.usage as { cost_usd?: unknown } | null | undefined)?.cost_usd;
  return typeof charged === "number" ? { ...report, costUSD: charged } : report;
}

/** POST https://api.revana.si/v1/chat/completions */
export const CHAT_COMPLETIONS_URL = chatUrl;

export { chatModels };
