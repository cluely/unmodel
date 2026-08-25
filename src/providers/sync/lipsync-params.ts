/**
 * The lipsync adapter's **data**: the model list and the per-model narrowing
 * table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/sync/values` publishes these for client-side pickers and the adapter
 * imports this provider's validator, its zod schema and the compile helpers in
 * `core/unified/derive`. The adapter reads the very same objects, so what is
 * published and what is sent cannot drift.
 *
 * ## Every row says `["video"]`, and one model also has an avatar row
 *
 * `sync-3` appears here AND in `./avatar-params.ts`, because it is the one
 * sync. model that reads a still as well as a clip. Same id, two categories,
 * two rows — which is the split `unmodel/lipsync` and `unmodel/avatar` exist to
 * make, stated as data. (At fal the same product is two endpoint IDS,
 * `fal-ai/sync-lipsync/v3` and `…/v3/image-to-video`; here the model id does
 * not move and the input does.)
 *
 * ## The extras are sync.'s `options`, flattened
 *
 * `sync_mode`, `model_mode`, `prompt`, `temperature`,
 * `occlusion_detection_enabled` and `active_speaker_detection` live under
 * `options` on the wire and are declared flat here, with the adapter's
 * `applyExtras` nesting them back. Flat because that is how the same dials are
 * spelled at the other provider that serves this model — fal's
 * `fal-ai/sync-lipsync/v2` row declares a top-level `sync_mode` with the same
 * five arms, because fal flattened sync.'s options into its own schema. One
 * vendor, two providers, two nestings, one name: making the unified extra agree
 * with the name is what lets the two be compared at all.
 *
 * ## Four of the six extras are model-gated, and the row is the gate
 *
 * `temperature` is on `lipsync-2` and `lipsync-2-pro` only (expressiveness is
 * native to `sync-3` and absent from the legacy model); `occlusion_detection_enabled`
 * is on those two and the legacy one but not `sync-3`, which detects
 * obstructions automatically; `model_mode` and `prompt` are `react-1` only.
 * The matrix is published on https://sync.so/docs/models/lipsync — verified
 * 2026-08-25 — and sync. IGNORES an option a model does not take rather than
 * refusing it, which is why the wire-level check is a warning and this row is
 * where the refusal actually lives.
 */

import { EXTRA } from "../../core/unified/derive";
import type { LipsyncModelParamTable } from "../../core/unified/vocabulary/lipsync";
import type {
  SyncActiveSpeaker,
  SyncDubParams,
  SyncEmotion,
  SyncGenerationSegment,
  SyncModelMode,
  SyncSyncMode,
} from "./shared";

/** Every id `sync.lipsync` accepts — the `sync/…` lipsync ref union. */
export const MODELS = [
  "sync-3",
  "lipsync-2",
  "lipsync-2-pro",
  "lipsync-1.9.0-beta",
  "react-1",
] as const;

/** A clip, at every model. The still-driven arm is a different category. */
const INPUTS = ["video"] as const;

/**
 * The extras every lipsync model takes.
 *
 * `segments` and `dubParams` are here rather than under a canonical word for
 * the same reason: each is a whole request MODE with its own arity rule
 * (`segments` needs a `refId` on every voice input; `dubParams` forbids voice
 * inputs entirely), and neither has a second witness anywhere in the category.
 * The rules are checked by `sync.lipsync` itself once the extra lands.
 */
const COMMON_EXTRAS = {
  /** `options.sync_mode` — what to do when clip and track are different lengths. */
  sync_mode: EXTRA as SyncSyncMode,
  /** `options.active_speaker_detection` — which face, when there are several. */
  active_speaker_detection: EXTRA as SyncActiveSpeaker,
  /** Several voices over one clip, each on its own time range. */
  segments: EXTRA as readonly SyncGenerationSegment[],
  /** Translate the clip's OWN track and lip-sync to the result. */
  dubParams: EXTRA as SyncDubParams,
  /** Base filename for the output; sync. sanitizes it and appends `.mp4`. */
  outputFileName: EXTRA as string,
  /** HTTPS callback, signed `Sync-Signature`. */
  webhookUrl: EXTRA as string,
  /** Attach the generation to a Studio project. */
  projectId: EXTRA as string,
} as const;

/** `lipsync-2` and `lipsync-2-pro`: the two models with both tuning dials. */
const LIPSYNC_2_ROW = {
  sources: INPUTS,
  extras: {
    ...COMMON_EXTRAS,
    /** `options.temperature` — 0 least expressive, 1 most. Default 0.5. */
    temperature: EXTRA as number,
    /** `options.occlusion_detection_enabled` — slower, handles hands and mics. */
    occlusion_detection_enabled: EXTRA as boolean,
  },
} as const;

export const SYNC_LIPSYNC_MODEL_PARAMS = {
  // Obstruction detection and expressiveness are both native here, so neither
  // has a switch — the sharpest per-model narrowing this adapter has, and the
  // one a caller is most likely to trip over, because `temperature` reads like
  // a universal dial.
  "sync-3": { sources: INPUTS, extras: COMMON_EXTRAS },
  "lipsync-2": LIPSYNC_2_ROW,
  "lipsync-2-pro": LIPSYNC_2_ROW,
  "lipsync-1.9.0-beta": {
    sources: INPUTS,
    extras: {
      ...COMMON_EXTRAS,
      occlusion_detection_enabled: EXTRA as boolean,
    },
  },
  // The expressive model, and the only one that reads an emotion. `prompt` is
  // an ENUM of six single words rather than a sentence — "Only single word
  // emotions are supported at the moment" — which is why it is not the
  // canonical `prompt` some other category would recognise.
  "react-1": {
    sources: INPUTS,
    extras: {
      ...COMMON_EXTRAS,
      /** `options.model_mode` — lips, face or the whole head. */
      model_mode: EXTRA as SyncModelMode,
      /** `options.prompt` — one word, from a closed set of six emotions. */
      prompt: EXTRA as SyncEmotion,
    },
  },
} as const satisfies LipsyncModelParamTable;
