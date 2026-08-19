// Core types and helpers shared by every provider module. This entry
// deliberately imports no provider code so bundlers can tree-shake:
// import validators from "unmodel/openai", "unmodel/anthropic",
// "unmodel/google" and catalog data from "unmodel/catalog".

export {
  UnmodelValidationError,
  formatIssues,
  formatIssuePath,
} from "./core/issues";
export type { Issue, IssueCode, IssueSeverity } from "./core/issues";

export type { ValidateEstimate, ValidateResult } from "./core/result";

export type { ResponseReport, UsageReport } from "./core/report";

export type { MediaDeclaration, ValidateOptions } from "./core/options";

export {
  heuristicTokenizer,
  PER_MESSAGE_TOKEN_OVERHEAD,
  estimateToolDefinitionTokens,
} from "./core/tokens";
export type { Tokenizer } from "./core/tokens";

export {
  computeCostUSD,
  computeCharacterCostUSD,
  computeAudioMinutesCostUSD,
} from "./core/cost";
export type { TokenBreakdown } from "./core/cost";

export type {
  Modality,
  ModelCost,
  ModelInfo,
  ModelLimit,
  ProviderInfo,
} from "./core/catalog-types";

export type {
  DenyRule,
  EndpointConstraints,
  FamilyRule,
  MediaRule,
} from "./core/constraint-types";

export { toValidated, toValidatedSocket, JSON_HEADERS, NO_HEADERS } from "./core/request";
export type {
  ApiRetargeter,
  ApiRetargetOutcome,
  ExactKeys,
  RequestMeta,
  SdkFormatters,
  SocketMeta,
  Validated,
  ValidatedInit,
  ValidatedSocket,
} from "./core/request";

// The translation layer's public vocabulary. The dialect CODECS are
// deliberately not exported from the root — re-exporting them here would make
// this entry pull all four dialects into every consumer's bundle, which is
// exactly what the per-dialect layout exists to avoid.
export { TranslationUnavailableError } from "./core/translate/errors";
export type { Decoder, Encoder, RetargetSpec, TargetValidation } from "./core/translate/retarget";
export { formatTranslationWarnings } from "./core/translate/warnings";
export type {
  TranslationWarning,
  TranslationWarningCode,
  Warn,
} from "./core/translate/warnings";
export type { DialectId, TargetEndpoint } from "./core/translate/endpoints";
// The IR vocabulary, type-only: enough to write a codec or read a warning's
// meta, with no runtime weight and no dialect pulled in.
export type {
  ChatIR,
  DecodeContext,
  IRCacheBreakpoint,
  IRData,
  IRMessage,
  IRNativeTool,
  IRPart,
  IRReasoning,
  IRResponseFormat,
  IRSettings,
  IRTextBlock,
  IRTool,
  IRToolChoice,
  IRToolOutput,
} from "./core/translate/ir";
// The `toSdk("ai-sdk")` option shape. The `withJsonSchemaTools` adapter that
// pairs with it lives on its own subpath, `unmodel/ai-sdk`, so a consumer who
// does not use the AI SDK never resolves it.
export type {
  AiSdkChatOptions,
  AiSdkChatResult,
  AiSdkFilePart,
  AiSdkModelMessage,
  AiSdkTextPart,
  AiSdkToolCallPart,
  AiSdkToolChoice,
  AiSdkToolOutput,
  AiSdkToolResultPart,
  AiSdkToolSpec,
} from "./core/translate/ai-sdk";
export type {
  AvailabilityEntry,
  AvailabilityMap,
  AvailabilityNarrows,
  AvailabilityTarget,
} from "./core/translate/availability-types";
export type {
  ApiModelFor,
  ApiTargetId,
  ApiTargetsFor,
  FactoryApiTargetId,
  Retargeted,
  SdkTargetId,
  StaticApiTargetId,
} from "./retarget";

export { resolveModelInfo } from "./core/catalog-lookup";

export { createValidator, constraintsFor } from "./core/pipeline";
export type {
  IssueInput,
  PipelineContext,
  PipelineSpec,
  Validator,
} from "./core/pipeline";

export { toBytes, base64ToBytes } from "./core/media/bytes";
export { sniffImage } from "./core/media/image";
export type { SniffedImage } from "./core/media/image";
export { findMediaDeclaration, reportMediaIssues } from "./core/media/check";
export type { MediaCheckInput } from "./core/media/check";
