export {
  stt,
  TRANSCRIPT_URL,
  TRANSCRIPT_URL_EU,
  UPLOAD_URL,
  DEFAULT_SPEECH_MODELS,
  ASSEMBLYAI_DOMAINS,
  PROMPT_MAX_WORDS,
  KEYTERM_MAX_WORDS,
  CUSTOM_SPELLING_FROM_MAX_WORDS,
  STATIC_ENTITY_MAX_LABELS,
  STATIC_ENTITY_MAX_TERMS_PER_LABEL,
  STATIC_ENTITY_MAX_TERM_CHARACTERS,
  STATIC_ENTITY_MAX_LABEL_CHARACTERS,
} from "./stt";
export type {
  TranscriptBody,
  AssemblyaiSpeechModel,
  AssemblyaiSpeakerOptions,
  AssemblyaiLanguageDetectionOptions,
  AssemblyaiDomain,
} from "./stt";

export { checkTranscript } from "./check";
export type { AssemblyaiTranscriptStatus, TranscriptResponseLike } from "./check";

export { models, provider } from "./models";
export type { AssemblyaiModelId } from "./models";
