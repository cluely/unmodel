/**
 * The avatar adapter's **data**: one model, and the row that says why.
 *
 * A leaf rather than a section of the adapter beside it, for
 * `./lipsync-params.ts`'s reason: `unmodel/sync/values` publishes these for
 * client-side pickers, and the adapter reads the very same objects.
 *
 * ## One row, and it is the smallest interesting table in the library
 *
 * `sync-3` is the only sync. model that reads a still ("sync-3 is the only
 * model that supports image input" — https://sync.so/docs/models/sync-3.md,
 * verified 2026-08-25), so this table has one entry where its lipsync twin has
 * five. The same id is in both, with different rows — which is exactly the
 * shape `unmodel/avatar`'s `sources` mechanism was built for, and the reason
 * the category exists as a sibling of `unmodel/lipsync` rather than an arm of
 * it.
 *
 * ## `sources: ["image"]` makes `image` REQUIRED, and that is right here
 *
 * The other avatar rows in the library include two that take NO still
 * (`veed/avatars` and `argil/avatars` at fal, whose performer is a catalogued
 * id) and therefore say `sources: []`. sync. is the opposite case and says so:
 * there is nowhere to put a preset performer and no way to run without a face.
 *
 * ## Two extras are missing on purpose
 *
 * `sync_mode` and `temperature` are on every lipsync row and on none here.
 * `sync_mode` answers "what if the clip and the track are different lengths",
 * which a still cannot be asked — sync. ignores it for image inputs, and a row
 * that declared it would let an editor offer a dial that does nothing.
 * `temperature` is a `lipsync-2`-family field and `sync-3` is not in that
 * family. Both absences are typed rather than documented: the extras a row does
 * not name do not compile.
 */

import { EXTRA } from "../../core/unified/derive";
import type { AvatarModelParamTable } from "../../core/unified/vocabulary/avatar";
import type { SyncActiveSpeaker } from "./shared";

/** Every id `sync.avatar` accepts — one, and the type says so. */
export const MODELS = ["sync-3"] as const;

/** A still, and it is required. */
const INPUTS = ["image"] as const;

export const SYNC_AVATAR_MODEL_PARAMS = {
  "sync-3": {
    sources: INPUTS,
    extras: {
      /**
       * `options.active_speaker_detection` — which face in the picture speaks.
       *
       * The one dial that survives the move from clip to still, and it changes
       * shape doing it: `auto_detect: true` is NOT supported for image inputs,
       * so the usable form is `{ coordinates: [x, y], frame_number: 0 }` with
       * the coordinates in the image's NATIVE PIXEL space rather than
       * normalized. `sync.avatar`'s own `checkImageOptions` says so if the
       * caller reaches for auto-detect anyway.
       */
      active_speaker_detection: EXTRA as SyncActiveSpeaker,
      /** Base filename for the output; sync. sanitizes it and appends `.mp4`. */
      outputFileName: EXTRA as string,
      /** HTTPS callback, signed `Sync-Signature`. */
      webhookUrl: EXTRA as string,
      /** Attach the generation to a Studio project. */
      projectId: EXTRA as string,
    },
  },
} as const satisfies AvatarModelParamTable;
