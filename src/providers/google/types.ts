/**
 * `unmodel/google/types` — every `google` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That
 * is pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — with `fetch`, with the
 * vendor SDK, or through your own client:
 *
 * ```ts
 * import type { ChatBody } from "unmodel/google/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`GenerateContentBody`, `GenerateContentSdkParams`,
 *   `GenerateVideosBody`, …) — re-exported verbatim, because they are how you
 *   find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`ChatBody`, `ImageBody`, `SttBody`, …)
 *   — one per endpoint address this provider serves, named after the word you
 *   already type at `unmodel/google` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/google`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `google.chat` → `ChatBody`
 * - `google.image` → `ImageBody`
 * - `google.stt` → `SttBody`
 * - `google.tts` → `TtsBody`
 * - `google.video` → `VideoBody`
 */

import type { GenerateContentBody } from "./chat";
import type { GenerateImagesBody } from "./image";
import type { GenerateSttBody } from "./stt";
import type { GenerateTtsBody } from "./tts";
import type { GenerateVideosBody } from "./video";

export type {
  GenerateContentBody,
  GenerateContentSdkParams,
  ChatSdkTargets,
  GoogleCodeExecutionResult,
  GoogleContent,
  GoogleExecutableCode,
  GoogleFileData,
  GoogleFunctionCall,
  GoogleFunctionCallingConfig,
  GoogleFunctionDeclaration,
  GoogleFunctionResponse,
  GoogleGenerationConfig,
  GoogleAudioResponseFormat,
  GoogleHarmBlockThreshold,
  GoogleHarmCategory,
  GoogleImageAspectRatio,
  GoogleImageAspectRatioEnumName,
  GoogleImageConfig,
  GoogleImageResponseFormat,
  GoogleImageSize,
  GoogleImageSizeEnumName,
  GoogleInlineData,
  GoogleModality,
  GoogleMultiSpeakerVoiceConfig,
  GooglePart,
  GooglePrebuiltVoiceConfig,
  GoogleResponseFormatConfig,
  GoogleRole,
  GoogleSafetySetting,
  GoogleServiceTier,
  GoogleSpeakerVoiceConfig,
  GoogleSpeechConfig,
  GoogleTextResponseFormat,
  GoogleThinkingConfig,
  GoogleThinkingLevel,
  GoogleVoiceConfig,
  GoogleTool,
  GoogleToolCall,
  GoogleToolConfig,
  GoogleToolResponse,
  GoogleVideoMetadata,
} from "./chat";

export type {
  GenerateVideosBody,
  VeoParameterModelId,
  VeoParameterSpace,
  VeoParametersArm,
  GenerateVideosSdkConfig,
  GenerateVideosSdkImage,
  GenerateVideosSdkParams,
  VideoSdkTargets,
  GenerateVideosSdkReferenceImage,
  GenerateVideosSdkVideo,
  GoogleVeoImage,
  GoogleVeoInstance,
  GoogleVeoParameters,
  GoogleVeoReferenceImage,
  GoogleVeoVideo,
} from "./video";

export type {
  GenerateImagesBody,
  GenerateImagesSdkConfig,
  GenerateImagesSdkParams,
  ImageSdkTargets,
  GoogleImagenAspectRatio,
  GoogleImagenFastParameters,
  GoogleImagenImageSize,
  GoogleImagenInstance,
  GoogleImagenOutputOptions,
  GoogleImagenParameters,
  GoogleImagenPersonGeneration,
  ImagenFastBody,
  ImagenStandardBody,
  ImagenUltraBody,
  UnknownImagenBody,
} from "./image";

export type { GoogleVeoSupplementModelId } from "./veo-models";

export type { GoogleImagenModelId } from "./imagen-models";

export type {
  GenerateTtsBody,
  GenerateTtsSdkParams,
  TtsSdkTargets,
  GoogleTtsArm,
  GoogleTts25FlashBody,
  GoogleTts25ProBody,
  GoogleTts31FlashBody,
  GoogleTtsAudioResponseFormat,
  GoogleTtsCompressedAudioFormat,
  GoogleTtsContent,
  GoogleTtsGenerationConfigBase,
  GoogleTtsMultiSpeakerConfig,
  GoogleTtsMultiSpeakerVoiceConfig,
  GoogleTtsResponseFormatConfig,
  GoogleTtsResponseModalities,
  GoogleTtsSingleSpeakerConfig,
  GoogleTtsSpeakerVoiceConfigs,
  GoogleTtsSpeechConfig,
  GoogleTtsTextPart,
  GoogleTtsUncompressedAudioFormat,
  GoogleTtsUnspecifiedAudioFormat,
  NarrowedTtsGenerationConfig,
  UnknownTtsBody,
} from "./tts";

export type { GoogleTtsModelId } from "./tts-models";

export type {
  GenerateSttBody,
  GenerateSttSdkParams,
  SttSdkTargets,
  GoogleAudioTranscriptionConfig,
  GoogleSttArm,
  GoogleSttContent,
  GoogleSttFileAudioPart,
  GoogleSttGenerationConfigBase,
  GoogleSttInlineAudioPart,
  GoogleSttModelBody,
  GoogleSttPart,
  GoogleSttResponseModalities,
  GoogleSttTextPart,
  NarrowedSttGenerationConfig,
  UnknownSttBody,
} from "./stt";

export type { ChatResponseLike, GoogleFinishReason } from "./check";

import type { CreateMusicInteractionBody } from "./music";
export type { CreateMusicInteractionBody, GoogleLyriaArm } from "./music";

export type { TtsResponseLike, GoogleTtsFinishReason } from "./tts-check";

export type {
  GeminiAudioDelivery,
  GeminiAudioMimeType,
  GeminiAudioOutputEnumName,
  GeminiAudioOutputMimeSpelling,
  GeminiAudioOutputMimeType,
  GeminiCompressedAudioMimeType,
  GeminiImageRule,
  GeminiSttModelId,
  GeminiTtsLanguageCode,
  GeminiUncompressedAudioMimeType,
} from "./constraints";

export type { GeminiTtsVoiceName } from "./wire";

export type {
  GoogleModelId,
  GoogleTextModelId,
  GoogleImageModelId,
  GoogleAudioModelId,
  GoogleVideoModelId,
} from "../../catalog/google.gen";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ChatBody = GenerateContentBody;
export type ImageBody<FutureModel extends string = never> = GenerateImagesBody<FutureModel>;
/** `google.music`'s body — POST /v1beta/interactions with a Lyria model. */
export type MusicBody<FutureModel extends string = never> =
  CreateMusicInteractionBody<FutureModel>;
export type SttBody<FutureModel extends string = never> = GenerateSttBody<FutureModel>;
export type TtsBody<FutureModel extends string = never> = GenerateTtsBody<FutureModel>;
export type VideoBody = GenerateVideosBody;
