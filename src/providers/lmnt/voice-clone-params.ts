/**
 * The voice-clone adapter's **data**: the model list and the per-model
 * narrowing table. A leaf for `unmodel/lmnt/values`, per the usual split.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceCloneModelParamTable } from "../../core/unified/vocabulary/voice-clone";

/**
 * The one voice-clone id — the synthetic route noun (POST /v1/ai/voice has no
 * model field; the 1.2 wire's `type` is response-only).
 */
export const MODELS = ["voice-clone"] as const;

export const VOICE_CLONE_DOCS = "https://docs.lmnt.com/api-reference/voice/create-voice";

/**
 * Excluded on purpose: `file` (← `samples`), `name` and `description` are
 * canonical words' wire spellings. `gender` is "a tag describing the gender
 * of this voice. Has no effect on voice creation" — free-form metadata.
 */
export const VOICE_CLONE_EXTRAS = {
  gender: EXTRA as string,
  tags: EXTRA as string[],
} as const;

export const LMNT_VOICE_CLONE_MODEL_PARAMS = {
  "voice-clone": {
    extras: VOICE_CLONE_EXTRAS,
  },
} as const satisfies VoiceCloneModelParamTable;
