export {
  createAmazonBedrock,
  converseUrl,
  resolveBedrockModelInfo,
  checkCapabilities,
  checkMessageContent,
  checkPromptResourceParams,
  CONVERSE_DOCS,
} from "./chat";
export type {
  AmazonBedrockConfig,
  AmazonBedrockChat,
  AmazonBedrockProvider,
  ConverseParams,
  BedrockMessage,
  BedrockContentBlock,
  BedrockSystemContentBlock,
  BedrockImageBlock,
  BedrockImageFormat,
  BedrockVideoBlock,
  BedrockVideoFormat,
  BedrockDocumentBlock,
  BedrockDocumentFormat,
  BedrockDocumentSource,
  BedrockBytesSource,
  BedrockS3Location,
  BedrockCachePoint,
  BedrockToolUseBlock,
  BedrockToolResultBlock,
  BedrockToolResultContent,
  BedrockTool,
  BedrockToolSpecification,
  BedrockToolChoice,
  BedrockToolConfig,
  BedrockInferenceConfig,
  BedrockGuardrailConfig,
  BedrockOutputConfig,
} from "./chat";

export { checkChat } from "./check";
export type { ConverseResponseLike, ConverseStopReason, ConverseUsageLike } from "./check";

export { models, provider } from "../../catalog/amazon-bedrock.gen";
export type {
  AmazonBedrockModelId,
  AmazonBedrockTextModelId,
  AmazonBedrockImageModelId,
  AmazonBedrockAudioModelId,
  AmazonBedrockVideoModelId,
} from "../../catalog/amazon-bedrock.gen";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
