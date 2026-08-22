/**
 * The voice-clone adapter's **data**: the model list and the per-model
 * narrowing table. A leaf for `unmodel/fish-audio/values`, per the
 * ./tts-params split.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceCloneModelParamTable } from "../../core/unified/vocabulary/voice-clone";

/**
 * The one voice-clone id — the synthetic `fast` (POST /model has no model
 * field; the id names the documented, and only, `train_mode`).
 */
export const MODELS = ["fast"] as const;

export const VOICE_CLONE_DOCS =
  "https://docs.fish.audio/api-reference/endpoint/model/create-model";

/**
 * Excluded on purpose: `title` (← `name`), `voices`/`texts` (← `samples`),
 * `visibility`, `description` are canonical words' wire spellings, and the
 * required consts `type`/`train_mode` are the adapter's to write.
 * `cover_image` IS here despite being a `Blob` — "required if the model is
 * public" — because a public model is expressible from the canonical
 * `visibility`, so its companion field must be reachable without the
 * providerOptions escape hatch.
 */
export const VOICE_CLONE_EXTRAS = {
  enhance_audio_quality: EXTRA as boolean,
  generate_sample: EXTRA as boolean,
  tags: EXTRA as string | string[] | null,
  cover_image: EXTRA as Blob | null,
} as const;

export const FISH_AUDIO_VOICE_CLONE_MODEL_PARAMS = {
  fast: {
    extras: VOICE_CLONE_EXTRAS,
  },
} as const satisfies VoiceCloneModelParamTable;
