/**
 * `unmodel/elevenlabs/types` — every `elevenlabs` type, and nothing else.
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
 * import type { MusicBody } from "unmodel/elevenlabs/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies MusicBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`TextToSpeechParams`, `TextToSpeechSdkParams`,
 *   `TextToSpeechStreamInputParams`, …) — re-exported verbatim, because they
 *   are how you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`MusicBody`,
 *   `SpeechToTextRealtimeBody`, `SttBody`, …) — one per endpoint address this
 *   provider serves, named after the word you already type at
 *   `unmodel/elevenlabs` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/elevenlabs`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `elevenlabs.dub` → `DubBody`
 * - `elevenlabs.dubLanguage` → `DubLanguageBody`
 * - `elevenlabs.music` → `MusicBody`
 * - `elevenlabs.sfx` → `SfxBody`
 * - `elevenlabs.speechToTextRealtime` → `SpeechToTextRealtimeBody`
 * - `elevenlabs.stt` → `SttBody`
 * - `elevenlabs.textToSpeechStreamInput` → `TextToSpeechStreamInputBody`
 * - `elevenlabs.tts` → `TtsBody`
 * - `elevenlabs.voiceClone` → `VoiceCloneBody`
 * - `elevenlabs.voiceDesign` → `VoiceDesignBody`
 * - `elevenlabs.voiceDesignSave` → `VoiceDesignSaveBody`
 */

import type { DubbingProjectParams } from "./dubbing";
import type { DubbingLanguageParams } from "./dubbing-language";
import type { MusicParams } from "./music";
import type { SoundEffectsParams } from "./sound-effects";
import type { SpeechToTextRealtimeParams } from "./speech-to-text-realtime";
import type { SpeechToTextParams } from "./stt";
import type { TextToSpeechStreamInputParams } from "./text-to-speech-stream-input";
import type { TextToSpeechParams } from "./tts";
import type { VoicesAddParams } from "./voice-clone";
import type { TextToVoiceDesignParams } from "./voice-design";
import type { CreateVoiceFromPreviewParams } from "./voice-design-save";

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

export type {
  TextToSpeechStreamInputParams,
  TextToSpeechStreamInputQuery,
  InitializeConnectionMessage,
  StreamInputVoiceSettings,
  StreamInputGenerationConfig,
  StreamInputPronunciationDictionaryLocator,
} from "./text-to-speech-stream-input";

export type {
  SpeechToTextRealtimeParams,
  ElevenlabsRealtimeAudioFormat,
  ElevenlabsRealtimeEntityCategory,
  ElevenlabsRealtimeEntitySelector,
  ElevenlabsCommitStrategy,
} from "./speech-to-text-realtime";

export type { SpeechToTextParams, SpeechToTextSdkParams } from "./stt";

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

export type {
  SoundEffectsParams,
  SoundEffectsSdkParams,
  ElevenlabsSoundEffectsOutputFormat,
} from "./sound-effects";

export type {
  VoicesAddParams,
  VoicesAddSdkParams,
  ElevenlabsVoiceCloneLabelKey,
} from "./voice-clone";

export type {
  TextToVoiceDesignParams,
  TextToVoiceDesignQuery,
  TextToVoiceDesignSdkParams,
  ElevenlabsVoiceDesignOutputFormat,
} from "./voice-design";

export type {
  CreateVoiceFromPreviewParams,
  CreateVoiceFromPreviewSdkParams,
} from "./voice-design-save";

export type { DubbingProjectParams, DubbingProjectSdkParams } from "./dubbing";

export type {
  DubbingLanguageParams,
  DubbingLanguageBody,
  DubbingLanguageSdkParams,
  DubbingVoiceSettings,
} from "./dubbing-language";

export type {
  ElevenlabsDubbingLanguage,
  ElevenlabsDubbingV1Language,
  ElevenlabsDubbingV2Language,
} from "./dubbing-languages";

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

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
//
// `Body` is the uniform suffix even for the socket surfaces
// (`SpeechToTextRealtimeBody`, `TextToSpeechStreamInputBody`), whose params
// are a connection query set or a first configuration message rather than an
// HTTP body. The alias follows the ADDRESS; the wire name beside it is what
// says which bytes go where.
// ---------------------------------------------------------------------------

export type DubBody = DubbingProjectParams;
/**
 * The params `elevenlabs.dubLanguage` takes — `project_id` included, because
 * that is what you hand the validator. The bytes that actually go on the wire
 * are `DubbingLanguageBody`, which is this minus the path segment; the alias
 * follows the ADDRESS, the same way `TtsBody` keeps `voice_id`.
 */
export type DubLanguageBody = DubbingLanguageParams;
export type MusicBody = MusicParams;
export type SfxBody = SoundEffectsParams;
export type SpeechToTextRealtimeBody = SpeechToTextRealtimeParams;
export type SttBody = SpeechToTextParams;
export type TextToSpeechStreamInputBody = TextToSpeechStreamInputParams;
export type TtsBody = TextToSpeechParams;
export type VoiceCloneBody = VoicesAddParams;
export type VoiceDesignBody = TextToVoiceDesignParams;
export type VoiceDesignSaveBody = CreateVoiceFromPreviewParams;
