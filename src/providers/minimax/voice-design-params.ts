/**
 * The voice-design adapter's **data**: the model list and the per-model
 * narrowing table. A leaf for `unmodel/minimax/values`, per the usual split.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceDesignModelParamTable } from "../../core/unified/vocabulary/voice-design";

/**
 * The one voice-design id — the synthetic route noun (POST /v1/voice_design
 * has no model field).
 */
export const MODELS = ["voice-design"] as const;

export const VOICE_DESIGN_DOCS =
  "https://platform.minimax.io/docs/api-reference/voice-design-design";

/**
 * One extra: the optional caller-chosen `voice_id`. NOT the canonical
 * `voiceId` — that word is voice-clone's required input; on the design side
 * only MiniMax takes a handle at all, and an optional single-provider knob is
 * exactly what the extras bucket is for. `prompt` and `preview_text`
 * (← `previewText`) are canonical words' wire spellings.
 */
export const VOICE_DESIGN_EXTRAS = {
  voice_id: EXTRA as string,
} as const;

export const MINIMAX_VOICE_DESIGN_MODEL_PARAMS = {
  "voice-design": {
    extras: VOICE_DESIGN_EXTRAS,
  },
} as const satisfies VoiceDesignModelParamTable;
