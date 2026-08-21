// Naming contract for this subpath: `check*` is reserved for response
// helpers — they take the raw response and return a ResponseReport, never
// throwing (see checkChat below). The request-side members of
// `PipelineSpec.checks` are exported as `validate*` so they cannot be
// mistaken for one; `validateImages` in particular used to be `checkImages`,
// which collided with `unmodel/openai`'s response checker of that name.
export {
  chat,
  CHAT_URL,
  validateCapabilities,
  validateResponseFormatCompatibility,
  validateImages,
} from "./chat";
export type {
  ChatBody,
  CohereChatMessage,
  CohereUserMessage,
  CohereSystemMessage,
  CohereAssistantMessage,
  CohereToolMessage,
  CohereUserContentPart,
  CohereTextContent,
  CohereThinkingContent,
  CohereImageContent,
  CohereDocumentContent,
  CohereToolCall,
  CohereTool,
  CohereDocument,
  CohereResponseFormat,
  CohereThinking,
  CohereCitationOptions,
  CohereSdkMessage,
  CohereSdkUserContentPart,
  CohereV2ChatRequest,
} from "./chat";

export { checkChat } from "./check";
export type { ChatResponseLike, ChatUsageLike, CohereFinishReason } from "./check";

export { models, provider } from "../../catalog/cohere.gen";
export type {
  CohereModelId,
  CohereTextModelId,
  CohereImageModelId,
  CohereAudioModelId,
  CohereVideoModelId,
} from "../../catalog/cohere.gen";
