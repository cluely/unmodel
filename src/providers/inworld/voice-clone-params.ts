/**
 * The voice-clone adapter's **data**: the model list and the per-model
 * narrowing table. A leaf for `unmodel/inworld/values`, per the usual split.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceCloneModelParamTable } from "../../core/unified/vocabulary/voice-clone";
import type { InworldLangCode } from "./voice-clone";

/**
 * The one voice-clone id — the synthetic route noun (POST voices:clone has no
 * model field and Inworld documents no mode name).
 */
export const MODELS = ["voice-clone"] as const;

export const VOICE_CLONE_DOCS =
  "https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/clone-voice";

/**
 * Excluded on purpose: `displayName` (← `name`), `voiceSamples`
 * (← `samples`), `languageCode` (← `language`), `description` and
 * `audioProcessingConfig.removeBackgroundNoise` (← `noiseReduction`) are
 * canonical words' wire spellings. `langCode` is the legacy 16-value enum —
 * kept reachable for wire-familiar callers, refused by the validator when
 * `languageCode` is also present.
 */
export const VOICE_CLONE_EXTRAS = {
  tags: EXTRA as string[],
  langCode: EXTRA as InworldLangCode,
} as const;

export const INWORLD_VOICE_CLONE_MODEL_PARAMS = {
  "voice-clone": {
    extras: VOICE_CLONE_EXTRAS,
  },
} as const satisfies VoiceCloneModelParamTable;
