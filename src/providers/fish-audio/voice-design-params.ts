/**
 * The voice-design adapter's **data**: the model list and the per-model
 * narrowing table. A leaf for `unmodel/fish-audio/values`, per the
 * ./tts-params split.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceDesignModelParamTable } from "../../core/unified/vocabulary/voice-design";

/** The one voice-design id — the required `model` header's only value. */
export const MODELS = ["voice-design-1"] as const;

export const VOICE_DESIGN_DOCS =
  "https://docs.fish.audio/api-reference/endpoint/openapi-v1/voice-design";

/**
 * Excluded on purpose: `instruction` (← `prompt`), `n`, `seed` and
 * `guidance_scale` (← `guidance`) are canonical words' wire spellings.
 * `reference_text` is an extra rather than the canonical `previewText`
 * because it is reference *content* for the generated voice, not the
 * candidates' script — the candidates speak model-chosen text.
 */
export const VOICE_DESIGN_EXTRAS = {
  reference_text: EXTRA as string | null,
  speed: EXTRA as number,
  num_step: EXTRA as number,
  instruct_guidance_scale: EXTRA as number,
} as const;

export const FISH_AUDIO_VOICE_DESIGN_MODEL_PARAMS = {
  "voice-design-1": {
    extras: VOICE_DESIGN_EXTRAS,
  },
} as const satisfies VoiceDesignModelParamTable;
