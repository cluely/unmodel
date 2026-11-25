/** OpenRouter extends Chat Completions with URL-shaped video content. */
import type {
  ChatCompletionsBodyBase,
  ChatMessage,
  ChatUserContentPart,
  ChatUserMessage,
  ChatVideoUrlPart,
} from "../openai-compatible/wire";
import type { OpenrouterTextModelId } from "../../catalog/openrouter.gen";

export interface OpenRouterUserMessage extends Omit<ChatUserMessage, "content"> {
  content: string | Array<ChatUserContentPart | ChatVideoUrlPart>;
}

export interface OpenRouterChatBody<ModelId extends string = OpenrouterTextModelId>
  extends Omit<ChatCompletionsBodyBase<ModelId>, "messages"> {
  messages: Array<Exclude<ChatMessage, ChatUserMessage> | OpenRouterUserMessage>;
}
