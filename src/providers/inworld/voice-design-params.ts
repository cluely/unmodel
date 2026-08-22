/**
 * The voice-design adapter's **data**: the model list and the per-model
 * narrowing table. A leaf for `unmodel/inworld/values`, per the usual split.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceDesignModelParamTable } from "../../core/unified/vocabulary/voice-design";
import type { InworldLangCode } from "./voice-clone";

/**
 * The one voice-design id — the synthetic route noun (POST voices:design has
 * no model field; the flow is flagged a research preview).
 */
export const MODELS = ["voice-design"] as const;

export const VOICE_DESIGN_DOCS =
  "https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/design-voice";

/**
 * One extra: the legacy `langCode` enum, beside the canonical `language` →
 * `languageCode`. `designPrompt` (← `prompt`), `previewText` and
 * `voiceDesignConfig.numberOfSamples` (← `n`) are canonical words' wire
 * spellings and are excluded.
 */
export const VOICE_DESIGN_EXTRAS = {
  langCode: EXTRA as InworldLangCode,
} as const;

export const INWORLD_VOICE_DESIGN_MODEL_PARAMS = {
  "voice-design": {
    extras: VOICE_DESIGN_EXTRAS,
  },
} as const satisfies VoiceDesignModelParamTable;
