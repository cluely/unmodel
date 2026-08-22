/**
 * `unmodel/inworld/types` — every `inworld` type, and nothing else.
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
 * import type { RealtimeTranscribeConfigBody } from "unmodel/inworld/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies RealtimeTranscribeConfigBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`TtsVoiceBody`, `TranscribeBody`,
 *   `InworldAudioConfig`, …) — re-exported verbatim, because they are how you
 *   find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`RealtimeTranscribeConfigBody`,
 *   `RealtimeVoiceContextBody`, `SttBody`, …) — one per endpoint address this
 *   provider serves, named after the word you already type at
 *   `unmodel/inworld` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/inworld`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `inworld.realtimeTranscribeConfig` → `RealtimeTranscribeConfigBody`
 * - `inworld.realtimeVoiceContext` → `RealtimeVoiceContextBody`
 * - `inworld.stt` → `SttBody`
 * - `inworld.tts` → `TtsBody`
 * - `inworld.voiceClone` → `VoiceCloneBody`
 * - `inworld.voiceDesign` → `VoiceDesignBody`
 * - `inworld.voiceDesignPublish` → `VoiceDesignPublishBody`
 */

import type { InworldRealtimeTranscribeConfig, TranscribeBody } from "./stt";
import type { InworldVoiceContextConfig } from "./realtime";
import type { TtsVoiceBody } from "./tts";
import type { VoicesCloneBody } from "./voice-clone";
import type { VoicesDesignBody } from "./voice-design";
import type { VoicesPublishBody } from "./voice-design-publish";

export type {
  TtsVoiceBody,
  InworldAudioConfig,
  InworldAudioEncoding,
  InworldSampleRateHertz,
  InworldDeliveryMode,
  InworldTimestampType,
  InworldApplyTextNormalization,
  InworldSynthesisContext,
} from "./tts";

export type {
  TranscribeBody,
  TranscribeConfigCheckOptions,
  InworldAssemblyaiConfig,
  InworldAudioContent,
  InworldGroqConfig,
  InworldRealtimeTranscribeConfig,
  InworldSonioxConfig,
  InworldSonioxContext,
  InworldSttAudioEncoding,
  InworldSttV1Config,
  InworldTranscribeConfig,
  InworldVoiceProfileConfig,
} from "./stt";

export type {
  InworldTimestampTransportStrategy,
  InworldVoiceContextConfig,
  RealtimeTranscribeFrame,
  RealtimeVoiceContextFrame,
} from "./realtime";

export type {
  VoicesCloneBody,
  InworldVoiceSample,
  InworldAudioProcessingConfig,
  InworldLangCode,
} from "./voice-clone";

export type { VoicesDesignBody, InworldVoiceDesignConfig } from "./voice-design";

export type { VoicesPublishBody } from "./voice-design-publish";

export type {
  InworldModelId,
  InworldSttModelId,
  InworldSttVendor,
  InworldTtsModelId,
  InworldVoiceModelId,
} from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
//
// `Body` is the uniform suffix even for the socket surfaces
// (`RealtimeTranscribeConfigBody`, `RealtimeVoiceContextBody`), whose params
// are a connection query set or a first configuration message rather than an
// HTTP body. The alias follows the ADDRESS; the wire name beside it is what
// says which bytes go where.
// ---------------------------------------------------------------------------

export type RealtimeTranscribeConfigBody = InworldRealtimeTranscribeConfig;
export type RealtimeVoiceContextBody = InworldVoiceContextConfig;
export type SttBody = TranscribeBody;
export type TtsBody = TtsVoiceBody;
export type VoiceCloneBody = VoicesCloneBody;
export type VoiceDesignBody = VoicesDesignBody;
export type VoiceDesignPublishBody = VoicesPublishBody;
