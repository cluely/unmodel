import type { ExactKeys, Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { withApiTarget } from "../../core/translate/media-retarget";
import type { MediaApiMember } from "../../retarget/types";
import {
  tts as ttsBase,
  type TextToSpeechParams,
  type TextToSpeechQuery,
  type TtsSdkTargets,
} from "./tts";
import { elevenlabsTtsToFal, type ElevenlabsTtsFalOverlap } from "./fal-target";

/**
 * `elevenlabs.tts`, with `.toApi("fal")` attached.
 *
 * Wired here rather than in `./tts.ts` so `unmodel/tts` — which reaches this
 * provider through `./unified-tts.ts` → `./tts` — pays nothing for a seam it
 * cannot call. See `core/translate/media-retarget.ts`.
 *
 * `model_id` is optional on this route and defaults to
 * `eleven_multilingual_v2`, so an omitted one still carries `.toApi`: the
 * default is a mapped model.
 */
export const tts = withApiTarget(
  ttsBase as unknown as Parameters<typeof withApiTarget<TextToSpeechParams, object>>[0],
  elevenlabsTtsToFal,
) as unknown as {
  <T extends TextToSpeechParams>(
    params: T & ExactKeys<T, TextToSpeechParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, keyof TextToSpeechQuery | "voice_id">, TtsSdkTargets> &
    MediaApiMember<
      ElevenlabsTtsFalOverlap,
      T["model_id"] extends string ? T["model_id"] : "eleven_multilingual_v2"
    >;
  safe<T extends TextToSpeechParams>(
    params: T & ExactKeys<T, TextToSpeechParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<Omit<T, keyof TextToSpeechQuery | "voice_id">, TtsSdkTargets> &
      MediaApiMember<
        ElevenlabsTtsFalOverlap,
        T["model_id"] extends string ? T["model_id"] : "eleven_multilingual_v2"
      >
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export { ELEVENLABS_TTS_FAL_OVERLAP, ELEVENLABS_TTS_FAL_REFUSALS } from "./fal-target";

export {
  textToSpeechUrl,
  TEXT_TO_SPEECH_BASE_URL,
  DEFAULT_TTS_MODEL_ID,
  TTS_OUTPUT_FORMATS,
  TTS_OPTIMIZE_STREAMING_LATENCY_LEVELS,
  TTS_SPEED_MIN,
  TTS_SPEED_MAX,
} from "./tts";
export type {
  TextToSpeechParams,
  TextToSpeechQuery,
  TextToSpeechSdkParams,
  TextToSpeechSdkRequest,
  TextToSpeechSdkVoiceSettings,
  ElevenlabsVoiceSettings,
  ElevenlabsPronunciationDictionaryLocator,
  ElevenlabsOutputFormat,
  ElevenlabsOptimizeStreamingLatency,
} from "./tts";

export {
  textToSpeechStreamInput,
  textToSpeechStreamInputUrl,
  toInitializeConnectionMessage,
  STREAM_INPUT_WS_BASE_URL,
  STREAM_INPUT_CHUNK_LENGTH_MIN,
  STREAM_INPUT_CHUNK_LENGTH_MAX,
  STREAM_INPUT_DEFAULT_CHUNK_LENGTH_SCHEDULE,
  STREAM_INPUT_INACTIVITY_TIMEOUT_DEFAULT,
  STREAM_INPUT_INACTIVITY_TIMEOUT_MAX,
} from "./text-to-speech-stream-input";
export type {
  TextToSpeechStreamInputParams,
  TextToSpeechStreamInputQuery,
  InitializeConnectionMessage,
  StreamInputVoiceSettings,
  StreamInputGenerationConfig,
  StreamInputPronunciationDictionaryLocator,
} from "./text-to-speech-stream-input";

export {
  speechToTextRealtime,
  speechToTextRealtimeUrl,
  SPEECH_TO_TEXT_REALTIME_WS_URL,
  REALTIME_STT_AUDIO_FORMATS,
  REALTIME_STT_ENTITY_CATEGORIES,
  REALTIME_STT_KEYTERM_MAX_CHARACTERS,
  REALTIME_STT_KEYTERMS_MAX,
} from "./speech-to-text-realtime";
export type {
  SpeechToTextRealtimeParams,
  ElevenlabsRealtimeAudioFormat,
  ElevenlabsRealtimeEntityCategory,
  ElevenlabsRealtimeEntitySelector,
  ElevenlabsCommitStrategy,
} from "./speech-to-text-realtime";

export {
  stt,
  toFormData,
  speechToTextUrl,
  SPEECH_TO_TEXT_URL,
  STT_KEYTERM_MAX_CHARACTERS,
  STT_KEYTERM_MAX_WORDS,
  STT_KEYTERMS_MAX,
  STT_MAX_FILE_BYTES,
} from "./stt";
export type { SpeechToTextParams, SpeechToTextSdkParams } from "./stt";

export {
  music,
  musicUrl,
  requestedDurationMs,
  MUSIC_URL,
  DEFAULT_MUSIC_MODEL_ID,
  MUSIC_OUTPUT_FORMATS,
  MUSIC_LENGTH_MS_MIN,
  MUSIC_LENGTH_MS_MAX,
  MUSIC_SECTION_MS_MIN,
  MUSIC_SECTION_MS_MAX,
  MUSIC_MAX_SECTIONS,
  MUSIC_MAX_LINES_PER_SECTION,
  MUSIC_MAX_STYLES,
  MUSIC_PROMPT_MAX_CHARACTERS,
} from "./music";
export type {
  MusicParams,
  MusicSdkParams,
  ElevenlabsCompositionPlan,
  ElevenlabsMusicSectionsPlan,
  ElevenlabsMusicChunksPlan,
  ElevenlabsMusicSection,
  ElevenlabsMusicChunk,
  ElevenlabsMusicAudioRef,
  ElevenlabsMusicSectionSource,
  ElevenlabsMusicTimeRange,
  ElevenlabsMusicOutputFormat,
} from "./music";

export {
  voiceClone,
  voiceCloneToFormData,
  VOICES_ADD_URL,
  VOICE_CLONE_MODEL_ID,
  VOICE_CLONE_LABEL_KEYS,
} from "./voice-clone";
export type {
  VoicesAddParams,
  VoicesAddSdkParams,
  ElevenlabsVoiceCloneLabelKey,
} from "./voice-clone";

export {
  voiceDesign,
  textToVoiceDesignUrl,
  TEXT_TO_VOICE_DESIGN_URL,
  DEFAULT_VOICE_DESIGN_MODEL_ID,
  VOICE_DESIGN_OUTPUT_FORMATS,
  VOICE_DESIGN_TEXT_MIN_CHARACTERS,
  VOICE_DESIGN_TEXT_MAX_CHARACTERS,
} from "./voice-design";
export type {
  TextToVoiceDesignParams,
  TextToVoiceDesignQuery,
  TextToVoiceDesignSdkParams,
  ElevenlabsVoiceDesignOutputFormat,
} from "./voice-design";

export { voiceDesignSave, TEXT_TO_VOICE_URL } from "./voice-design-save";
export type {
  CreateVoiceFromPreviewParams,
  CreateVoiceFromPreviewSdkParams,
} from "./voice-design-save";

/**
 * ## Dubbing — two addresses, one flow, and four traps
 *
 * `elevenlabs.dub` (multipart, `POST /v1/dubbing/project`) creates a project;
 * `elevenlabs.dubLanguage` (JSON, `POST /v1/dubbing/project/{id}/language`)
 * orders one dubbed language, and is the call that spends the rate. There is
 * no unified `dubbing` category and there deliberately will not be one until a
 * second vendor's request shape agrees with this one — see `docs/providers.md`.
 *
 * ```ts
 * import { dub, dubLanguage, dubToFormData } from "unmodel/elevenlabs";
 *
 * const project = dub({
 *   source_url: "https://example.com/promo.mp4",
 *   model_id: "dubbing_v2",
 *   source_language: "en",
 *   keyterms: ["Unmodel", "BCP-47"],
 * });
 * const created = await fetch(project.request.url, {
 *   method: "POST",
 *   headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 *   body: dubToFormData(project),
 * }).then((r) => r.json());
 *
 * // …poll GET /v1/dubbing/project/{project_id} until status === "ready"…
 *
 * const target = dubLanguage({ project_id: created.project_id, target_language: "es-MX" });
 * ```
 *
 * **1. The reference page you found is the wrong one.**
 * `elevenlabs.io/docs/api-reference/dubbing/create` 308-redirects to
 * `/legacy/dubbing/create`, and legacy `POST /v1/dubbing` has no `model_id`
 * field at all — Dubbing v2 is unreachable from it. unmodel serves the project
 * surface only: two addresses for one verb, one of which cannot reach the
 * current model, is not a choice worth offering.
 *
 * **2. Polling is TWO-level, with a third axis.** Project status is
 * `queued|preparing|processing|ready|failed`; each language target is
 * `queued|processing|completed|stale|failed`. A target can be `completed` and
 * hold a STALE output — compare `output_revision` against `revision`, which is
 * what `checkDubbingLanguage` does. `webhook_ids` (at most 3) is the documented
 * alternative to polling both levels. unmodel validates the two POSTs; polling
 * and downloads stay with your transport code.
 *
 * **3. The only v2 output is AUDIO.** `outputs.lossless_audio` is a signed,
 * time-limited URL for an audio track, and it is the whole of
 * `DubbingLanguageOutputs`. A dubbed VIDEO comes from the legacy
 * `GET /v1/dubbing/{dubbing_id}/audio/{language_code}` route or a Studio
 * render, neither of which this surface reaches.
 *
 * **4. Cost is not knowable at request time.** The rate is per minute of source
 * media per language target, and the body carries a Blob or a URL — never a
 * duration. `.safe().estimate` is `{}` on purpose; `checkDubbingProject` prices
 * it once the project GET reports `media.duration_s`.
 *
 * Five residency hosts exist (`api.us`, `api.eu.residency`, `api.in.residency`,
 * `api.sg.residency` alongside the default) — swap the origin yourself, the
 * same as the two realtime modules already say.
 *
 * DELIBERATELY NOT SERVED: legacy `POST /v1/dubbing` (cannot select v2, and
 * shipping both would put two addresses on one verb); the Studio resource
 * family (`/v1/dubbing/resource/*`, 13 paths — a timeline editor, the same
 * refusal HeyGen's `type: "studio"` gets); and the SDK's `v1DubbingRealtime`
 * types (no client, no matching REST path, no published connect URL — it needs
 * its own research pass before it can be typed from documents).
 */
export {
  dub,
  dubToFormData,
  DUBBING_PROJECT_URL,
  DUBBING_REFERENCE_MAX_CHARACTERS,
  DUBBING_WEBHOOK_IDS_MAX,
} from "./dubbing";
export type { DubbingProjectParams, DubbingProjectSdkParams } from "./dubbing";

export {
  dubLanguage,
  dubbingLanguageUrl,
  DUBBING_CLONING_STRENGTH_MIN,
  DUBBING_CLONING_STRENGTH_MAX,
  DUBBING_CLONING_STRENGTH_DEFAULT,
  DUBBING_TRANSLATIONS_MAX_ENTRIES,
  DUBBING_TRANSLATIONS_MAX_BYTES,
} from "./dubbing-language";
export type {
  DubbingLanguageParams,
  DubbingLanguageBody,
  DubbingLanguageSdkParams,
  DubbingVoiceSettings,
} from "./dubbing-language";

export {
  DUBBING_V1_LANGUAGES,
  DUBBING_V2_BASE_LANGUAGES,
  DUBBING_V2_DIALECTS,
  DUBBING_V2_LANGUAGES,
  DUBBING_TARGET_LANGUAGES,
} from "./dubbing-languages";
export type {
  ElevenlabsDubbingLanguage,
  ElevenlabsDubbingV1Language,
  ElevenlabsDubbingV2Language,
} from "./dubbing-languages";

export {
  KEYTERMS_MAX,
  KEYTERM_MAX_CHARACTERS,
  KEYTERM_MAX_WORDS,
  KEYTERM_DISALLOWED_CHARACTERS,
} from "./keyterms";

// No TTS checker: /v1/text-to-speech responds with raw audio bytes, not JSON.
// Likewise /v1/music, which returns the track's bytes.
export { checkTranscription, checkDubbingProject, checkDubbingLanguage } from "./check";
export type {
  ElevenlabsTranscriptionLike,
  ElevenlabsTranscriptLike,
  ElevenlabsDubbingProjectLike,
  ElevenlabsDubbingProjectStatus,
  ElevenlabsDubbingLanguageLike,
  ElevenlabsDubbingLanguageStatus,
  ElevenlabsDubbingErrorLike,
  ElevenlabsDubbingWarningLike,
} from "./check";

export { ttsConstraints, speechToTextConstraints } from "./constraints";

export {
  models,
  provider,
  TTS_MODEL_IDS,
  STT_MODEL_IDS,
  REALTIME_STT_MODEL_IDS,
  MUSIC_MODEL_IDS,
  VOICE_DESIGN_MODEL_IDS,
  DUBBING_MODEL_IDS,
  MUSIC_PER_AUDIO_MINUTE,
  DUBBING_V1_PER_AUDIO_MINUTE,
  DUBBING_V2_PER_AUDIO_MINUTE,
  VOICE_CHANGER_PER_AUDIO_MINUTE,
  SOUND_EFFECTS_PER_AUDIO_MINUTE,
} from "./models";
export type {
  ElevenlabsModelId,
  ElevenlabsTtsModelId,
  ElevenlabsSttModelId,
  ElevenlabsRealtimeSttModelId,
  ElevenlabsMusicModelId,
  ElevenlabsVoiceDesignModelId,
  ElevenlabsVoiceCloneModelId,
  ElevenlabsDubbingModelId,
} from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

/**
 * The fal bodies this provider's `.toApi("fal")` maps onto. One type-only
 * line, so a consumer emitting its own declarations can name the result — see
 * src/core/carriers.ts.
 */
export type { FalElevenMultilingualV2, FalElevenTurboV25, FalElevenV3 } from "./fal-target";
export type { ElevenlabsTtsFalOverlap } from "./fal-target";
export type { TtsSdkTargets } from "./tts";
