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
  // The unit constructors that go with `computeAudioMinutesCostUSD`. Exported
  // beside it because the function now takes `Minutes`, so a caller outside
  // this package needs a way to produce one — and naming the conversion is the
  // point: a bare `number` there was one omitted `/ 60` away from a 60x bill.
  minutes,
  minutesFromMilliseconds,
  minutesFromSeconds,
} from "./core/cost";
export type { Minutes, TokenBreakdown } from "./core/cost";

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
  DialectSdkMap,
  DialectSdkResult,
  FactoryApiTargetId,
  GeminiSdkParams,
  Retargeted,
  SdkTargetId,
  StaticApiTargetId,
} from "./retarget";

/**
 * The unified chat vocabulary, **type-only**.
 *
 * `unmodel/chat`'s runtime lives behind its own subpath because it composes
 * all 32 concrete provider chat validators, their catalogs and their available
 * retarget tables — ~1.7 MB that this entry must never acquire. (The
 * discovery-only profile snapshot is ~22% of that; the validators are the
 * rest. `unmodel/chat/factory` is the 135 KiB alternative for applications
 * that register only the providers they call.) The *types* cost nothing, and
 * `ChatParams` is
 * exactly the sort of thing an application declares in a shared module far away
 * from the call that validates it, so `import type { ChatParams } from
 * "unmodel"` should work without reaching for the subpath.
 */
export type {
  ChatCache,
  ChatFilePart,
  ChatMessage,
  ChatModelRef,
  ChatNativeTool,
  ChatParams,
  ChatProviderId,
  ChatProviderOptions,
  ChatReasoning,
  ChatReasoningEffort,
  ChatReasoningPart,
  ChatResponseFormat,
  ChatServiceTier,
  ChatServiceTierFor,
  ChatTextPart,
  ChatToolCallPart,
  ChatToolChoice,
  ChatToolResultPart,
  ChatToolSpec,
} from "./chat/types";

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
