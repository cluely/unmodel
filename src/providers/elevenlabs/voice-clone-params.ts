/**
 * The voice-clone adapter's **data**: the model list and the per-model
 * narrowing table.
 *
 * A leaf rather than a section of the adapter beside it — the same split, for
 * the same reason, as ./tts-params: `unmodel/elevenlabs/values` publishes
 * these objects and the adapter reads the very same ones, so what is
 * published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceCloneModelParamTable } from "../../core/unified/vocabulary/voice-clone";
import type { ElevenlabsVoiceCloneLabelKey } from "./voice-clone";

/**
 * The one voice-clone id — the synthetic `ivc` (POST /v1/voices/add has no
 * model field; the id names the documented mode and reserves `pvc` for the
 * unvalidated Professional Voice Cloning flow).
 */
export const MODELS = ["ivc"] as const;

export const VOICE_CLONE_DOCS = "https://elevenlabs.io/docs/api-reference/voices/ivc/create";

/**
 * One extra: `labels`, the four-key metadata record. Everything else on this
 * wire is a canonical word's spelling — `name`, `files` (← `samples`),
 * `description`, `remove_background_noise` (← `noiseReduction`) — and the
 * canonical `language` is deliberately NOT compiled into `labels.language`:
 * a label is catalog metadata, not a conditioning input, and pretending
 * otherwise would report an exact mapping for a field the model never reads.
 */
export const VOICE_CLONE_EXTRAS = {
  labels: EXTRA as Partial<Record<ElevenlabsVoiceCloneLabelKey, string>> | null,
} as const;

export const ELEVENLABS_VOICE_CLONE_MODEL_PARAMS = {
  ivc: {
    extras: VOICE_CLONE_EXTRAS,
  },
} as const satisfies VoiceCloneModelParamTable;
