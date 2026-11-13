/**
 * unmodel/groq — Groq's OpenAI-compatible Chat Completions endpoint
 * (LPU-hosted Llama, gpt-oss, Qwen etc.), validated against the generated
 * models.dev catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import type { ChatCompletionsBodyBase } from "../openai-compatible";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import type { PipelineContext } from "../../core/pipeline";
import { models, provider } from "../../catalog/groq.gen";
import type { GroqTextModelId } from "../../catalog/groq.gen";
import { availability } from "../../catalog/availability/groq.gen";
// The deny/enum tables live in a leaf so the retarget engine can run them
// against a `.toApi("groq")` from another provider without importing this
// barrel. See ./constraints.ts.
import { GROQ_OPENAI_COMPAT_DOC, chatFamilyRules } from "./constraints";

// Per-model estimation constants. Only this validator's `estimate` reads them
// (target-side re-validation runs deny/enum tables), so they stay here rather
// than in the ./constraints leaf every retarget-bearing bundle imports.
//
// qwen/qwen3.8-27b: https://console.groq.com/docs/vision (checked 2026-11-12):
// "Each image counts as 2048 input tokens."
const chatConstraints = {
  "qwen/qwen3.8-27b": { imageTokens: 2048 },
} satisfies Partial<Record<GroqTextModelId, EndpointConstraints>>;

const { chat, chatUrl, checkChat, estimateChatTokens } = createOpenAICompatible<
  GroqTextModelId,
  typeof availability,
  "groq"
>({
  id: provider.id,
  // The generated catalog carries no `api` field for Groq; the documented
  // OpenAI-compatible base URL is https://api.groq.com/openai/v1
  // (https://console.groq.com/docs/openai).
  baseUrl: "https://api.groq.com/openai/v1",
  catalog: models,
  availability,
  constraints: chatConstraints,
  familyRules: chatFamilyRules,
  extraChecks: [
    // The same doc's fourth 400-field is nested, so the deny table can't
    // express it: "will result in a 400 error if they are supplied:
    // logprobs, logit_bias, top_logprobs, messages[].name".
    (params, _info, ctx) => {
      params.messages?.forEach((message, index) => {
        if ((message as { name?: unknown }).name !== undefined) {
          ctx.report({
            code: "unsupported_param",
            path: ["messages", index, "name"],
            model: params.model,
            message:
              "`messages[].name` is not supported by Groq's OpenAI-compatible endpoint and returns a 400 error",
            meta: { source: GROQ_OPENAI_COMPAT_DOC },
          });
        }
      });
    },
    checkChatCompletionsRoute,
  ],
});

/** POST https://api.groq.com/openai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  GroqModelId,
  GroqTextModelId,
  GroqImageModelId,
  GroqAudioModelId,
  GroqVideoModelId,
} from "../../catalog/groq.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

// ---------------------------------------------------------------------------
// Substrate signpost — the catalog ids this endpoint cannot serve
//
// models.dev files Groq's Whisper rows as text-out (audio in, text out) with
// limit 448/448, Whisper's decoder cap, so they sit in `GroqTextModelId` and
// the pipeline gates them like chat models. Groq serves them on its
// speech-to-text routes only. The doc below lists
// "| Transcriptions | Convert audio to text | https://api.groq.com/openai/v1/audio/transcriptions |"
// and "| Translations | Translate audio to English text | https://api.groq.com/openai/v1/audio/translations |",
// and its model table gives whisper-large-v3 "Translation Support | Yes" and
// whisper-large-v3-turbo "Translation Support | No".
//
// A WARNING, not an error, for the reason openai/chat.ts gives for its
// NON_CHAT_ROUTES: the substrate never refuses on routing. The pipeline's
// over_context / over_output_limit errors still fire on long requests, because
// 448 is a real model limit; openai's embedding rows carry the same
// coexistence. The typed refusal lives in `unmodel/chat`, which generates no
// ref for these ids (`chatScopeExclude`, data/availability-overrides.json).
// ./index.test.ts pins this table against that entry.
// ---------------------------------------------------------------------------

const GROQ_STT_DOC = "https://console.groq.com/docs/speech-to-text (checked 2026-11-12)";

interface NonChatRoute {
  match: RegExp;
  /** The routes Groq serves these ids on, as GROQ_STT_DOC lists them. */
  route: string;
}

const NON_CHAT_ROUTES: readonly NonChatRoute[] = [
  {
    match: /^whisper-large-v3-turbo$/,
    route:
      'POST https://api.groq.com/openai/v1/audio/transcriptions only (Groq marks its translation support "No")',
  },
  {
    // whisper-large-v3, and the family default: the doc's endpoint table.
    match: /^whisper-/,
    route:
      "POST https://api.groq.com/openai/v1/audio/transcriptions and POST https://api.groq.com/openai/v1/audio/translations",
  },
];

/**
 * Names the route a non-chat catalog id is actually served on. Runs on the
 * raw id, so it answers whether or not the catalog carries the row.
 */
function checkChatCompletionsRoute(
  params: ChatCompletionsBodyBase,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  const route = NON_CHAT_ROUTES.find((entry) => entry.match.test(model));
  if (route === undefined) return;
  ctx.report({
    code: "unsupported_capability",
    severity: "warning",
    path: ["model"],
    model,
    message:
      `"${model}" is a speech-to-text model: Groq serves it on ${route.route}, ` +
      `not POST ${CHAT_COMPLETIONS_URL}. unmodel ships no validator for Groq's audio routes; ` +
      "send it yourself, or pick a chat model. The request is sent as written all the same.",
    meta: { route: route.route, source: GROQ_STT_DOC },
  });
}
