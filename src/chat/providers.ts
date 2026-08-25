/**
 * Concrete provider validators behind `unmodel/chat`.
 *
 * Compilation varies by wire dialect, but validation varies by provider: two
 * OpenAI-compatible endpoints can accept the same body shape while enforcing
 * different model catalogs and hand-written rules. This registry is the seam
 * between those two decisions. The ready-made `unmodel/chat` entry imports all
 * providers it can address; callers that want one provider and its smaller
 * graph continue to import `unmodel/<provider>` directly.
 */
import type { ChatProviderRegistry } from "./factory";

import { chat as alibabaChat } from "../providers/alibaba/chat";
import { chat as anthropicChat } from "../providers/anthropic/chat";
import { chat as basetenChat } from "../providers/baseten";
import { chat as cerebrasChat } from "../providers/cerebras";
import { chat as deepinfraChat } from "../providers/deepinfra";
import { chat as deepseekChat } from "../providers/deepseek";
import { chat as fireworksAiChat } from "../providers/fireworks-ai";
import { chat as friendliChat } from "../providers/friendli";
import { chat as googleChat } from "../providers/google/chat";
import { chat as groqChat } from "../providers/groq";
import { chat as huggingfaceChat } from "../providers/huggingface";
import { chat as inceptionChat } from "../providers/inception";
import { chat as longcatChat } from "../providers/longcat";
import { chat as metaChat } from "../providers/meta";
import { chat as minimaxChat } from "../providers/minimax/chat";
import { chat as mistralChat } from "../providers/mistral";
import { chat as moonshotaiChat } from "../providers/moonshotai";
import { chat as nebiusChat } from "../providers/nebius";
import { chat as novitaAiChat } from "../providers/novita-ai";
import { chat as nvidiaChat } from "../providers/nvidia";
import { chat as openaiChat } from "../providers/openai/chat";
import { chat as openrouterChat } from "../providers/openrouter";
import { chat as perplexityChat } from "../providers/perplexity";
import { chat as sarvamChat } from "../providers/sarvam";
import { chat as scalewayChat } from "../providers/scaleway";
import { chat as siliconflowChat } from "../providers/siliconflow";
import { chat as stepfunChat } from "../providers/stepfun/chat";
import { chat as togetheraiChat } from "../providers/togetherai";
import { chat as upstageChat } from "../providers/upstage";
import { chat as vercelChat } from "../providers/vercel";
import { chat as xaiChat } from "../providers/xai/chat";
import { chat as zhipuaiChat } from "../providers/zhipuai";

/** Provider id -> the exact validator exported by that provider subpath. */
export const CHAT_PROVIDER_VALIDATORS = {
  alibaba: alibabaChat,
  anthropic: anthropicChat,
  baseten: basetenChat,
  cerebras: cerebrasChat,
  deepinfra: deepinfraChat,
  deepseek: deepseekChat,
  "fireworks-ai": fireworksAiChat,
  friendli: friendliChat,
  google: googleChat,
  groq: groqChat,
  huggingface: huggingfaceChat,
  inception: inceptionChat,
  longcat: longcatChat,
  meta: metaChat,
  minimax: minimaxChat,
  mistral: mistralChat,
  moonshotai: moonshotaiChat,
  nebius: nebiusChat,
  "novita-ai": novitaAiChat,
  nvidia: nvidiaChat,
  openai: openaiChat,
  openrouter: openrouterChat,
  perplexity: perplexityChat,
  sarvam: sarvamChat,
  scaleway: scalewayChat,
  siliconflow: siliconflowChat,
  stepfun: stepfunChat,
  togetherai: togetheraiChat,
  upstage: upstageChat,
  vercel: vercelChat,
  xai: xaiChat,
  zhipuai: zhipuaiChat,
  // Not `Record<ChatProviderId, unknown>`: that only pins the key set. The
  // branded registry type also checks that each *value* is the validator for
  // the key it sits under, so a transposed line in this hand-written table —
  // which would address the wrong host and price against the wrong catalog,
  // silently, for every `unmodel/chat` caller — is a compile error here.
} as const satisfies Required<ChatProviderRegistry>;

export type ChatProviderValidatorRegistry = typeof CHAT_PROVIDER_VALIDATORS;
