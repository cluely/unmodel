/**
 * The voice-clone adapter's **data**: the model list and the per-model
 * narrowing table. A leaf for `unmodel/minimax/values`, per the usual split.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceCloneModelParamTable } from "../../core/unified/vocabulary/voice-clone";
import type { MinimaxClonePrompt } from "./voice-clone";
import type { MinimaxLanguageBoost } from "./models";

/**
 * The one voice-clone id — the synthetic route noun (POST /v1/voice_clone has
 * no model field of its own; the preview `model` is a speech id and rides on
 * `providerOptions.minimax` — see the extras note below).
 */
export const MODELS = ["voice-clone"] as const;

export const VOICE_CLONE_DOCS =
  "https://platform.minimax.io/docs/api-reference/voice-cloning-clone";

/**
 * Excluded on purpose: `file_id` (← `samples`), `voice_id` (← `voiceId`),
 * `need_noise_reduction` (← `noiseReduction`) and `text_validation`
 * (← `samples[0].transcript` — the "expected transcript of the cloning
 * sample") are canonical words' wire spellings. So is the billed preview
 * synthesis pair `text` + `model` — but for a harder reason: an extra is a
 * TOP-LEVEL key, and this wire's `model` collides head-on with the canonical
 * `"provider/model"` ref (an extras entry named `model` would copy the ref
 * into the body). The preview therefore rides on `providerOptions.minimax`
 * — `{ text, model }` — the escape hatch that exists precisely for wire
 * spellings the vocabulary already owns. `language_boost` (the preview's
 * language hint) and `clone_prompt` (example-driven timbre steering) stay
 * reachable here.
 */
export const VOICE_CLONE_EXTRAS = {
  clone_prompt: EXTRA as MinimaxClonePrompt,
  language_boost: EXTRA as MinimaxLanguageBoost | null,
  accuracy: EXTRA as number,
  need_volume_normalization: EXTRA as boolean,
  aigc_watermark: EXTRA as boolean,
} as const;

export const MINIMAX_VOICE_CLONE_MODEL_PARAMS = {
  "voice-clone": {
    extras: VOICE_CLONE_EXTRAS,
  },
} as const satisfies VoiceCloneModelParamTable;
