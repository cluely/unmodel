/**
 * The music adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/stability/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { MusicModelParamTable } from "../../core/unified/vocabulary/music";

/**
 * The two Stable Audio 2.x models this route serves.
 *
 * `stable-audio-3` is in the catalog and deliberately absent here: it is served
 * by the async `/v2beta/audio/stable-audio/*` routes, and `stability.music`'s
 * own `checkAudioModel` rejects it — a ref that cannot work should not
 * autocomplete.
 */
export const MODELS = ["stable-audio-2", "stable-audio-2.5"] as const;

export const API_REFERENCE_URL = "https://api.stability.ai/v2alpha/openapi";

/**
 * `output_format` — a codec, full stop. `wav` is where a canonical
 * `pcm_s16le` lands, since that is the only thing a WAV file of generated
 * audio contains.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", pcm_s16le: "wav" },
  containers: { pcm_s16le: ["wav"] },
  unavailable: ["sampleRate", "bitrate"],
  source: API_REFERENCE_URL,
};

/**
 * Both Stable Audio 2.x ids, with the same two-codec row.
 *
 * `output_format` is `"mp3" | "wav"`, which is `mp3` and `pcm_s16le` in
 * canonical spelling — the narrowest codec list in the library, and the reason
 * `outputFormat: "opus"` is a compile error here and fine on
 * `elevenlabs/music_v1`.
 *
 * `steps` and `cfg_scale` are the diffusion knobs the vocabulary has no word
 * for. They are identical keys on both rows because both models take them; what
 * differs is the *range*, which is a run-time fact `checkSteps` already owns
 * and a row deliberately does not duplicate.
 */
export const STABILITY_MUSIC_EXTRAS = {
  /** Sampling steps; 30–100 on stable-audio-2, 4–8 on 2.5, and it moves the price. */
  steps: EXTRA as number,
  /** How closely to follow the prompt. */
  cfg_scale: EXTRA as number,
} as const;

export const ROW = { codecs: ["mp3", "pcm_s16le"], extras: STABILITY_MUSIC_EXTRAS } as const;

export const STABILITY_MUSIC_MODEL_PARAMS = {
  "stable-audio-2": ROW,
  "stable-audio-2.5": ROW,
} as const satisfies MusicModelParamTable;
