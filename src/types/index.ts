/**
 * `unmodel/types` — unmodel's **canonical vocabulary**, as types, with zero
 * runtime.
 *
 * Every export in this module is a `type`. The emitted JavaScript is an empty
 * module, pinned against a real build by `test/types-entries.test.ts`, so
 * importing it adds nothing to a bundle — it is the entry for the developer
 * who wants unmodel's shapes at compile time and is sending the request with
 * their own `fetch`, their own client, or a vendor SDK.
 *
 * ## What is here
 *
 * The **one standardized vocabulary** the unified surfaces speak:
 * {@link ChatParams}, {@link ImageParams}, {@link ImageEditParams},
 * {@link VideoParams}, {@link TtsParams}, {@link SttParams},
 * {@link MusicParams}, {@link SfxParams} — plus the words they are built from
 * ({@link AspectRatio}, {@link AudioFormat}, {@link Voice},
 * {@link Diarization}, {@link Dimensions}, the media input refs), the
 * `"provider/model"` ref unions ({@link ChatModelRef},
 * {@link ChatProviderId}), and the result vocabulary every validator returns
 * ({@link Issue}, {@link ValidateResult}, {@link ResponseReport},
 * {@link TranslationWarning}, {@link Retargeted}).
 *
 * ## What is NOT here
 *
 * **Provider wire types.** `MessagesBody`, `ChatCompletionsBody`,
 * `GenerateTtsBody`, `Flux2Body` and their ~2,000 siblings live on
 * `unmodel/<provider>/types`, one entry per provider, and they stay there on
 * purpose: an aggregate of every provider's wire surface is an ~900 KB
 * declaration file that every consumer of this entry would have to parse to
 * reach one interface. Import the provider you actually call:
 *
 * ```ts
 * import type { ChatBody as AnthropicChatBody } from "unmodel/anthropic/types";
 * import type { ImageBody } from "unmodel/openai/types";
 * ```
 *
 * Each provider entry re-exports its wire names verbatim (the address-vs-wire
 * law, `docs/decisions.md` §2) and adds one uniform `<Endpoint>Body` alias per
 * endpoint address it serves.
 *
 * ## The `satisfies` idiom
 *
 * The reason to reach for a type-only entry is to have your request checked
 * where you write it, without a validator in the call path:
 *
 * ```ts
 * import type { TtsParams } from "unmodel/types";
 *
 * const narration = {
 *   model: "openai/gpt-4o-mini-tts",
 *   text: "The lighthouse keeper checked the lamp.",
 *   voice: "alloy",
 *   speed: 1.1,
 * } satisfies TtsParams;
 * ```
 *
 * `satisfies` rather than an annotation, for the same reason the registries in
 * `src/cli-registry.ts` use it: the value keeps its literal type — `narration.
 * voice` is still `"alloy"`, not `Voice` — while every field is still checked
 * against the vocabulary. An annotation (`const narration: TtsParams = …`)
 * widens all of it.
 *
 * Runtime validation — the catalog lookups, the per-model constraint tables,
 * the cost estimate, `.request`, `.toSdk()`, `.toApi()` — is what
 * `unmodel/tts` and `unmodel/<provider>` are for. This entry is the
 * compile-time half, on its own, for free.
 */

// ---------------------------------------------------------------------------
// The unified chat vocabulary
//
// Sourced from `src/chat/types` type-only, exactly as the root entry does:
// `unmodel/chat`'s runtime composes 32 provider validators (~1.7 MB) and must
// never be reachable from here. Types cost nothing.
// ---------------------------------------------------------------------------

export type {
  ChatCache,
  ChatFilePart,
  ChatMediaDetail,
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
} from "../chat/types";

/**
 * The ref-keyed view of the chat layer: which dialect a `"provider/model"` ref
 * speaks, and the wire body `chat()` compiles it to.
 *
 * `ChatBody<"anthropic/claude-sonnet-4-5">` is `MessagesBody` with `model`
 * pinned; `ChatBody<"openai/gpt-5.2">` is the OpenAI-compatible body. It is
 * the *compiled* shape — the thing that goes on the wire — as opposed to
 * {@link ChatParams}, which is what you write.
 */
export type {
  ChatBody,
  ChatDialect,
  ChatDialectOf,
  ChatModelOf,
  ChatProviderOf,
  ChatSdkTargets,
} from "../chat/public-types";

// ---------------------------------------------------------------------------
// The six unified media vocabularies
//
// One name per category, plus the words each category adds. Shared words
// (`AspectRatio`, `ProviderOptions`, the media refs) are exported once, from
// the module that declares them, rather than from each category that
// re-exports them.
// ---------------------------------------------------------------------------

export type { ImageParams } from "../core/unified/vocabulary/image";

export type {
  ImageEditInput,
  ImageEditInputKind,
  ImageEditInputFor,
  ImageEditParams,
  ImageEditParamsFor,
} from "../core/unified/vocabulary/image-edit";

export type {
  VideoImageInput,
  VideoImageRole,
  VideoInput,
  VideoParams,
  VideoParamsBase,
} from "../core/unified/vocabulary/video";

export type { TtsParams, TtsParamsBase, Voice } from "../core/unified/vocabulary/tts";

export type {
  AudioDataInput,
  AudioFileIdInput,
  AudioFileInput,
  AudioInput,
  AudioInputFor,
  AudioInputKind,
  AudioUrlInput,
  Diarization,
  SttParams,
  SttParamsBase,
  SttParamsFor,
  TimestampGranularity,
} from "../core/unified/vocabulary/stt";

export type { MusicParams, MusicParamsBase } from "../core/unified/vocabulary/music";

export type { SfxParams, SfxParamsBase } from "../core/unified/vocabulary/sfx";

export type {
  StsAudioInput,
  StsParams,
  StsParamsBase,
} from "../core/unified/vocabulary/sts";

export type {
  VoiceCloneParams,
  VoiceCloneParamsBase,
  VoiceCloneParamsFor,
  VoiceSample,
  VoiceSampleDataInput,
  VoiceSampleFileIdInput,
  VoiceSampleFileInput,
  VoiceSampleFor,
  VoiceSampleInput,
  VoiceSampleInputFor,
  VoiceSampleKind,
  VoiceSampleLimits,
  VoiceVisibility,
} from "../core/unified/vocabulary/voice-clone";

export type {
  VoiceDesignParams,
  VoiceDesignParamsBase,
} from "../core/unified/vocabulary/voice-design";

// The words the categories share: sizing, delivery, and the four media refs
// every category's inputs are built from.
export type {
  AspectRatio,
  AspectRatioPreset,
  BlobRef,
  DataRef,
  Dimensions,
  FileIdRef,
  ImageOutputFormat,
  OutputDelivery,
  ProviderOptions,
  ResolutionTier,
  UrlRef,
  VideoResolution,
} from "../core/unified/vocabulary/common";

export type {
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatRequest,
} from "../core/unified/vocabulary/audio";

/** The per-model narrowing tables an adapter carries, and the category id. */
export type {
  ModelParams,
  ModelParamsBase,
  MusicModelParams,
  SfxModelParams,
  SttModelParams,
  TtsModelParams,
  VideoModelParams,
  VoiceCloneModelParams,
  VoiceDesignModelParams,
} from "../core/unified/vocabulary/model-params";

export type { CompileIssue, UnifiedCategory } from "../core/unified/types";

// ---------------------------------------------------------------------------
// The result vocabulary — what a validator hands back, in every layer
// ---------------------------------------------------------------------------

export type { Issue, IssueCode, IssueSeverity } from "../core/issues";
export type { ValidateEstimate, ValidateResult } from "../core/result";
export type { ResponseReport, UsageReport } from "../core/report";
export type {
  MediaDeclaration,
  MediaFacts,
  MediaPath,
  MediaPathFor,
  ValidateOptions,
  ValidateOptionsBase,
} from "../core/options";
export type {
  ExactKeys,
  RequestMeta,
  SocketMeta,
  Validated,
} from "../core/request";
export type {
  TranslationWarning,
  TranslationWarningCode,
  TranslationWarningMeta,
} from "../core/translate/warnings";
export type { DialectId } from "../core/translate/endpoints";

// ---------------------------------------------------------------------------
// Catalog and constraint shapes — the data every provider entry is checked
// against, as types
// ---------------------------------------------------------------------------

export type {
  Modality,
  ModelCost,
  ModelInfo,
  ModelLimit,
  ProviderInfo,
} from "../core/catalog-types";

export type {
  DenyRule,
  EndpointConstraints,
  FamilyRule,
  MediaRule,
} from "../core/constraint-types";

// ---------------------------------------------------------------------------
// Retargeting — the ids `.toApi()` / `.toSdk()` take and the shape they return
// ---------------------------------------------------------------------------

export type {
  ApiModelFor,
  ApiTargetId,
  ApiTargetsFor,
  FactoryApiTargetId,
  Retargeted,
  SdkTargetId,
  StaticApiTargetId,
} from "../retarget";
