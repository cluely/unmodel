/**
 * `unmodel/openai/types` — every `openai` type, and nothing else.
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
 * import type { ChatBody } from "unmodel/openai/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ChatBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`ChatCompletionsBody`, `ImagesBody`, `GptImage1Body`,
 *   …) — re-exported verbatim, because they are how you find the endpoint in
 *   the provider's own documentation;
 * - the **uniform category aliases** (`ChatBody`, `ImageBody`,
 *   `ImageEditBody`, …) — one per endpoint address this provider serves,
 *   named after the word you already type at `unmodel/openai` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/openai`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `openai.chat` → `ChatBody`
 * - `openai.image` → `ImageBody`
 * - `openai.imageEdit` → `ImageEditBody` (already the wire name — see below)
 * - `openai.realtimeSession` → `RealtimeSessionBody` (already the wire name — see below)
 * - `openai.stt` → `SttBody`
 * - `openai.tts` → `TtsBody`
 * - `openai.video` → `VideoBody`
 */

import type { ChatCompletionsBody } from "./chat";
import type { ImagesBody } from "./image";
import type { TranscriptionBody } from "./stt";
import type { SpeechBody } from "./tts";
import type { VideosBody } from "./video";

export type {
  OpenaiChatModelId,
  ChatCompletionsBody,
  ChatMessage,
  ChatSystemMessage,
  ChatDeveloperMessage,
  ChatUserMessage,
  ChatAssistantMessage,
  ChatToolMessage,
  ChatFunctionMessage,
  ChatUserContentPart,
  ChatTextPart,
  ChatImagePart,
  ChatAudioPart,
  ChatFilePart,
  ChatRefusalPart,
  ChatTool,
  ChatFunctionTool,
  ChatCustomTool,
  ChatToolCall,
  ChatFunctionToolCall,
  ChatCustomToolCall,
  ChatToolChoice,
  ChatResponseFormat,
  ChatWebSearchOptions,
} from "./chat";

export type {
  ImagesBody,
  GptImage1Body,
  GptImage1MiniBody,
  GptImage15Body,
  GptImage2Body,
  GptImage2Size,
  GptImage2SnapshotBody,
  DallE2Body,
  DallE3Body,
  UnknownImageModelBody,
} from "./image";

export type {
  ImageEditBody,
  GptImage1EditBody,
  GptImage1MiniEditBody,
  GptImage15EditBody,
  GptImage2EditBody,
  GptImage2SnapshotEditBody,
  ChatgptImageLatestEditBody,
  DefaultImageEditBody,
  DallE2EditBody,
  UnknownImageEditModelBody,
} from "./image-edit";

export type { OpenaiImagesSupplementModelId } from "./images-models";

export type {
  SpeechBody,
  SpeechVoice,
  Tts1Voice,
  SpeechResponseFormat,
  SpeechCustomVoice,
  Tts1Body,
  Tts1HdBody,
  Gpt4oMiniTtsBody,
  Gpt4oMiniTtsSnapshotBody,
  UnknownSpeechModelBody,
} from "./tts";

export type {
  TranscriptionBody,
  TranscriptionResponseFormat,
  TranscriptionChunkingStrategy,
  TranscriptionVadConfig,
  Whisper1Body,
  GptTranscribeBody,
  Gpt4oTranscribeBody,
  Gpt4oMiniTranscribeBody,
  Gpt4oMiniTranscribeSnapshotBody,
  Gpt4oTranscribeDiarizeBody,
  UnknownTranscriptionModelBody,
} from "./stt";

export type {
  OpenaiSpeechModelId,
  OpenaiTranscriptionModelId,
  OpenaiAudioHandModelId,
} from "./audio-models";

export type {
  VideosBody,
  VideoInputReference,
  SoraSeconds,
  SoraBaseSize,
  SoraProSize,
  Sora2Body,
  Sora2Snapshot20251006Body,
  Sora2Snapshot20251208Body,
  Sora2ProBody,
  Sora2ProSnapshot20251006Body,
  DefaultVideoModelBody,
  UnknownVideoModelBody,
} from "./video";

export type { SoraModelId } from "./videos-models";

export type {
  RealtimeSessionBody,
  RealtimeSessionSdkParams,
  OpenaiRealtimeModelId,
  RealtimeVoice,
  RealtimeAudioFormat,
  RealtimeAudioConfig,
  RealtimeAudioInput,
  RealtimeAudioOutput,
  RealtimeNoiseReduction,
  RealtimeTranscription,
  RealtimeTranscriptionArm,
  RealtimeTranscriptionModelId,
  RealtimeSessionArm,
  RealtimeTurnDetection,
  RealtimeServerVad,
  RealtimeSemanticVad,
  RealtimeFunctionTool,
  RealtimeMcpTool,
  RealtimeMcpToolFilter,
  RealtimeTool,
  RealtimeToolChoice,
  RealtimeTracing,
  RealtimeTruncation,
  RealtimePrompt,
  RealtimeReasoning,
} from "./realtime";

export type {
  ChatCompletionLike,
  ChatChoiceLike,
  ChatFinishReason,
  ImagesResponseLike,
} from "./check";

export type { DallEModelId, GptImage2SnapshotId } from "./constraints";

export type {
  OpenaiModelId,
  OpenaiTextModelId,
  OpenaiImageModelId,
  OpenaiAudioModelId,
  OpenaiVideoModelId,
} from "../../catalog/openai.gen";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
//
// `Body` is the uniform suffix even for the socket surfaces
// (`RealtimeSessionBody`), whose params are a connection query set or a first
// configuration message rather than an HTTP body. The alias follows the
// ADDRESS; the wire name beside it is what says which bytes go where.
//
// No alias is declared for `openai.imageEdit`, `openai.realtimeSession`: the
// category name is ALREADY this provider's wire name (`ImageEditBody`,
// `RealtimeSessionBody`), re-exported above. The wire name wins — an alias
// here would be a rename, and the law forbids it.
// ---------------------------------------------------------------------------

export type ChatBody = ChatCompletionsBody;
export type ImageBody<FutureModel extends string = never> = ImagesBody<FutureModel>;
export type SttBody<FutureModel extends string = never> = TranscriptionBody<FutureModel>;
export type TtsBody<FutureModel extends string = never> = SpeechBody<FutureModel>;
export type VideoBody<FutureModel extends string = never> = VideosBody<FutureModel>;
