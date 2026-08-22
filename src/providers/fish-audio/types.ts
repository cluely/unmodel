/**
 * `unmodel/fish-audio/types` — every `fish-audio` type, and nothing else.
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
 * import type { TtsBody } from "unmodel/fish-audio/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies TtsBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`TtsBody`) — re-exported verbatim, because they are
 *   how you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`TtsBody`) — one per endpoint address
 *   this provider serves, named after the word you already type at
 *   `unmodel/fish-audio` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/fish-audio`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `fish-audio.tts` → `TtsBody` (already the wire name — see below)
 * - `fish-audio.voiceClone` → `VoiceCloneBody`
 * - `fish-audio.voiceDesign` → `VoiceDesignBody` (already the wire name)
 */

import type { CreateModelParams } from "./voice-clone";

export type {
  TtsBody,
  FishAudioFormat,
  FishAudioLatency,
  FishAudioMp3Bitrate,
  FishAudioOpusBitrate,
  FishAudioProsodyControl,
  FishAudioReferenceAudio,
} from "./tts";

export type { CreateModelParams, FishAudioVisibility } from "./voice-clone";

export type { VoiceDesignBody } from "./voice-design";

export type {
  FishAudioModelId,
  FishAudioTtsModelId,
  FishAudioVoiceDesignModelId,
  FishAudioVoiceCloneModelId,
} from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
//
// No alias is declared for `fish-audio.tts` or `fish-audio.voiceDesign`: the
// category name is ALREADY this provider's wire name (`TtsBody`,
// `VoiceDesignBody`), re-exported above. The wire name wins — an alias here
// would be a rename, and the law forbids it.
// ---------------------------------------------------------------------------

export type VoiceCloneBody = CreateModelParams;
