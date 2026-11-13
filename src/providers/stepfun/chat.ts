/**
 * `stepfun.chat` — StepFun's (阶跃星辰) OpenAI-compatible Chat Completions
 * endpoint ("step-*" models), validated against the generated models.dev
 * catalog. This is the first-party China platform, api.stepfun.com
 * (models.dev's "stepfun"); models.dev's "stepfun-ai" is StepFun's
 * international platform, api.stepfun.ai ("StepFun (Global)").
 *
 * A dedicated LEAF, not part of ../stepfun's barrel body, for the same reason
 * anthropic, google, openai, minimax and alibaba have one:
 * `src/chat/providers.ts` imports the chat validator directly from here, so
 * the ready `unmodel/chat` entry never walks the provider barrel — which
 * re-exports the speech validator that a chat bundle must not pay for (pinned
 * by `test/bundle-budget.test.ts`'s chat-graph enumeration).
 */
import { createOpenAICompatible, type ChatCompletionsBodyBase } from "../openai-compatible";
import { models, provider } from "../../catalog/stepfun.gen";
import type { StepfunTextModelId } from "../../catalog/stepfun.gen";
import { availability } from "../../catalog/availability/stepfun.gen";
import type { ModelInfo } from "../../core/catalog-types";
import type { PipelineContext } from "../../core/pipeline";
// In a leaf so the retarget engine could run them against a `.toApi("stepfun")`
// without importing this module. See ./constraints.ts.
import { chatFamilyRules } from "./constraints";

/**
 * The ASR reference: "POST https://api.stepfun.ai/v1/audio/asr/sse" and
 * "Supports `stepaudio-3-asr-max` and `stepaudio-2.5-asr`" (retrieved
 * 2026-11-12).
 */
const ASR_SSE_DOCS = "https://platform.stepfun.ai/docs/en/api-reference/audio/asr-sse.md";

/**
 * Catalog ids StepFun serves on a route that is not POST /v1/chat/completions,
 * each with that route. models.dev files `stepaudio-2.5-asr` audio-in /
 * text-out, which is how it reaches this chat catalog; ASR_SSE_DOCS lists it on
 * the SSE route, and its model page
 * (https://platform.stepfun.ai/docs/en/guides/models/stepaudio-2.5-asr.md,
 * 2026-11-12) names only that route and WSS /v1/realtime/asr/stream.
 *
 * The runtime twin of the `stepfun:` entries in `chatScopeExclude`
 * (data/availability-overrides.json), which withdraws the `unmodel/chat` ref —
 * codegen cannot read `src/`, a check cannot read the data file, so the ids are
 * stated twice and pinned against each other in ./index.test.ts.
 */
const NON_CHAT_ROUTES: Readonly<Record<string, string>> = {
  "stepaudio-2.5-asr": "POST /v1/audio/asr/sse",
};

export const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<StepfunTextModelId, typeof availability, "stepfun">({
    id: provider.id,
    // Generated from models.dev: https://api.stepfun.com/v1
    baseUrl: provider.api,
    catalog: models,
    availability,
    familyRules: chatFamilyRules,
    extraChecks: [checkChatCompletionsRoute],
  });

export { models, provider };

/**
 * Names the route a non-chat catalog id is actually served on. A WARNING, not
 * an error — the openai.chat signpost's policy (src/providers/openai/chat.ts):
 * the substrate never refuses what the API might fulfil, and the typed refusal
 * is `unmodel/chat`'s, by the ref not existing.
 */
function checkChatCompletionsRoute(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  const route = Object.hasOwn(NON_CHAT_ROUTES, model) ? NON_CHAT_ROUTES[model] : undefined;
  if (route === undefined) return;
  ctx.report({
    code: "unsupported_capability",
    severity: "warning",
    path: ["model"],
    model,
    message:
      `"${model}" is served by ${route}, not POST /v1/chat/completions — StepFun's ASR ` +
      `reference lists it on that route only. unmodel has no validator for ${route}; send it ` +
      `yourself, or pick a chat model. The request is sent as written all the same.`,
    meta: { route, source: ASR_SSE_DOCS },
  });
}
