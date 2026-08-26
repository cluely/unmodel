export { chat, MESSAGES_URL, ANTHROPIC_VERSION } from "./chat";
export type {
  MessagesBody,
  MessageParam,
  ContentBlock,
  TextBlock,
  ImageBlock,
  ImageSource,
  Base64ImageSource,
  UrlImageSource,
  FileImageSource,
  ImageMediaType,
  DocumentBlock,
  DocumentSource,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
  CacheControlEphemeral,
  Tool,
  CustomTool,
  ServerTool,
  ToolChoice,
  ThinkingConfig,
} from "./chat";
export { checkChat } from "./check";
export type { AnthropicStopReason, MessageLike, MessageUsage } from "./check";
export { chatConstraints, chatFamilyRules } from "./constraints";

export { models, provider } from "../../catalog/anthropic.gen";
export type {
  AnthropicModelId,
  AnthropicTextModelId,
  AnthropicImageModelId,
  AnthropicAudioModelId,
  AnthropicVideoModelId,
} from "../../catalog/anthropic.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

export type { AnthropicChatResultKind, ChatSdkTargets, MessagesArm } from "./chat";
