/**
 * unmodel/groq — Groq's OpenAI-compatible Chat Completions endpoint
 * (LPU-hosted Llama, gpt-oss, Qwen etc.), validated against the generated
 * models.dev catalog.
 */
import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/groq.gen";
import type { GroqTextModelId } from "../../catalog/groq.gen";
import { availability } from "../../catalog/availability/groq.gen";
// The deny/enum tables live in a leaf so the retarget engine can run them
// against a `.toApi("groq")` from another provider without importing this
// barrel. See ./constraints.ts.
import { GROQ_OPENAI_COMPAT_DOC, chatFamilyRules } from "./constraints";

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
