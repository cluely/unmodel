/**
 * `minimax.chat` — MiniMax (minimax.io) chat over the OpenAI-compatible
 * dialect: POST https://api.minimax.io/v1/chat/completions. Params mirror the
 * wire format exactly; validation runs against the generated minimax catalog.
 * This is the international platform (the China platform is the separate
 * minimax-cn catalog).
 *
 * A dedicated LEAF, not part of ../minimax's barrel body, for the same reason
 * anthropic, google and openai have one: `src/chat/providers.ts` imports the
 * chat validator directly from here, so the ready `unmodel/chat` entry never
 * walks the provider barrel — which re-exports the speech, video and
 * voice-creation validators that a chat bundle must not pay for (pinned by
 * `test/bundle-budget.test.ts`'s chat-graph enumeration).
 */

import { createOpenAICompatible } from "../openai-compatible";
import type { ChatCompletionsBodyBase } from "../openai-compatible/wire";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/minimax.gen";
import type { MinimaxTextModelId } from "../../catalog/minimax.gen";
import { availability } from "../../catalog/availability/minimax.gen";
import { MINIMAX_M3_GENERATION, MINIMAX_OPENAI_COMPAT_DOC, chatFamilyRules } from "./constraints";
import { chatCompletionsSchema, type MinimaxChatCompletionsBody } from "./wire";

export const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<
  MinimaxTextModelId,
  typeof availability,
  "minimax",
  Record<string, ModelInfo>,
  MinimaxChatCompletionsBody<MinimaxTextModelId>
>({
  id: "minimax",
  // NOT provider.api: the models.dev snapshot records MiniMax's
  // Anthropic-compatible route (https://api.minimax.io/anthropic/v1). The
  // OpenAI-compatible base is https://api.minimax.io/v1, per
  // https://platform.minimax.io/docs/api-reference/text-openai-api
  baseUrl: "https://api.minimax.io/v1",
  // The shared dialect plus MiniMax's `video_url` user parts (./wire).
  schema: chatCompletionsSchema,
  catalog: models,
  availability,
  familyRules: chatFamilyRules,
  extraChecks: [checkTopPRange, checkFlashThinkingAlwaysOn],
});

/**
 * "| `top_p` | … `MiniMax-M3.1-Flash` and `MiniMax-M3` always use 0.95. If
 * passed, the value must be within (0, 1]. |" (text-openai-api, 2026-11-12) —
 * ignored once accepted, which the deny table reports, but bounded on the way
 * in, which a deny or enum table cannot say.
 */
function checkTopPRange(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const topP = params.top_p;
  if (typeof topP !== "number" || !MINIMAX_M3_GENERATION.has(params.model)) return;
  if (topP > 0 && topP <= 1) return;
  ctx.report({
    code: "invalid_shape",
    path: ["top_p"],
    model: params.model,
    message: `\`top_p\` must be within (0, 1] for "${params.model}"; got ${topP}.`,
    meta: { exclusiveMinimum: 0, maximum: 1, value: topP, source: MINIMAX_OPENAI_COMPAT_DOC },
  });
}

/**
 * MiniMax-M3.1-Flash always thinks. The Thinking Control table
 * (text-openai-api, 2026-11-12): "| `MiniMax-M3.1-Flash` | Thinking on |
 * Thinking on | **Returns `400`** — thinking cannot be disabled |", with the
 * error it quotes: "model \"MiniMax-M3.1-Flash\" requires adaptive thinking;
 * thinking.type=\"disabled\" (including reasoning.effort=none) is not allowed
 * (2013)". The `reasoning_effort: "none"` half is the Flash enum in
 * ./constraints; `thinking` is a nested object the shared dialect does not
 * type, so this half is read off the passed-through value. MiniMax-M3's
 * `disabled` is its documented off switch and stays accepted.
 */
function checkFlashThinkingAlwaysOn(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.model !== "MiniMax-M3.1-Flash") return;
  const thinking = (params as { thinking?: unknown }).thinking;
  if (typeof thinking !== "object" || thinking === null) return;
  if ((thinking as { type?: unknown }).type !== "disabled") return;
  ctx.report({
    code: "unsupported_param",
    path: ["thinking", "type"],
    model: params.model,
    message: `thinking cannot be turned off on "${params.model}"; it accepts only \`thinking: {type: "adaptive"}\` (the default); tune depth with \`reasoning_effort\`, whose lightest level is "low".`,
    meta: { source: MINIMAX_OPENAI_COMPAT_DOC },
  });
}
