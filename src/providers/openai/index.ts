export { chat, estimateChatTokens, CHAT_COMPLETIONS_URL } from "./chat";
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

export { image, IMAGES_GENERATIONS_URL } from "./image";
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

// Both multipart endpoints ship their own form-data builder (the field rules
// differ: image[] parts here, repeated name[] parts for transcription), so
// they are exported under distinct names.
export {
  imageEdit,
  toFormData as imageEditToFormData,
  IMAGES_EDITS_URL,
  DEFAULT_IMAGE_EDIT_MODEL_ID,
  MAX_EDIT_IMAGES,
  MASK_RULE,
} from "./images-edit";
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
} from "./images-edit";

export {
  imagesModels,
  imagesSupplementModels,
  GPT_IMAGE_PROMPT_MAX_CHARACTERS,
  DALL_E_2_PROMPT_MAX_CHARACTERS,
  DALL_E_3_PROMPT_MAX_CHARACTERS,
} from "./images-models";
export type { OpenaiImagesSupplementModelId } from "./images-models";

export { speech, AUDIO_SPEECH_URL } from "./speech";
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
} from "./speech";

export {
  transcription,
  toFormData as transcriptionToFormData,
  AUDIO_TRANSCRIPTIONS_URL,
  DIARIZE_CHUNKING_THRESHOLD_SECONDS,
  MAX_KNOWN_SPEAKERS,
} from "./transcription";
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
} from "./transcription";

export {
  speechModels,
  transcriptionModels,
  audioModels,
  SPEECH_MAX_INPUT_CHARACTERS,
} from "./audio-models";
export type {
  OpenaiSpeechModelId,
  OpenaiTranscriptionModelId,
  OpenaiAudioHandModelId,
} from "./audio-models";

export {
  videos,
  VIDEOS_URL,
  DEFAULT_VIDEO_MODEL_ID,
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
} from "./videos";
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
} from "./videos";
export { SORA_MODELS, SORA_RATE_PER_SECOND } from "./videos-models";
export type { SoraModelId } from "./videos-models";

export { realtimeSession, REALTIME_CLIENT_SECRETS_URL } from "./realtime";
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

export { checkChat, checkImages } from "./check";
export type { ChatCompletionLike, ChatChoiceLike, ImagesResponseLike } from "./check";

export {
  imageConstraints,
  imagesEditConstraints,
  speechConstraints,
  transcriptionConstraints,
  transcriptionFamilyRules,
  chatConstraints,
  chatFamilyRules,
  videosConstraints,
  SPEECH_RESPONSE_FORMATS,
  SPEECH_VOICES,
  TTS_1_VOICES,
  TRANSCRIPTION_RESPONSE_FORMATS,
  TRANSCRIPTION_FILE_FORMATS,
  TRANSCRIPTION_MAX_FILE_BYTES,
} from "./constraints";
export type { DallEModelId, GptImage2SnapshotId } from "./constraints";

export { models, provider } from "../../catalog/openai.gen";
export type {
  OpenaiModelId,
  OpenaiTextModelId,
  OpenaiImageModelId,
  OpenaiAudioModelId,
  OpenaiVideoModelId,
} from "../../catalog/openai.gen";
