/**
 * The avatar adapter's **data**: one model, one extra, and the extra is
 * REQUIRED on the wire.
 *
 * A leaf rather than a section of the adapter beside it, for
 * `./lipsync-params.ts`'s reason.
 *
 * ## `resolution` is the first required extra in this category
 *
 * `FabricInput.resolution` is in `required` and carries no `default`, so VEED
 * answers 422 without it. `unmodel/avatar` has no canonical word for output
 * size — deliberately, because the clip's shape follows the still's and its
 * length follows the audio's, so both are answers rather than questions — and
 * VEED is the one route in the category where the caller must nonetheless say
 * something. It rides as an extra, typed to the two values VEED takes, and
 * `veed/unified-avatar.ts` refuses the request by name when it is missing
 * rather than letting VEED answer with a 422.
 *
 * Inventing a default here was the alternative and it was rejected: the two
 * values are a 2× price difference ($0.08/sec at 480p, $0.15/sec at 720p), so
 * "unmodel picked one for you" is a line item.
 *
 * ## `sources: ["image"]` makes `image` REQUIRED, and that is right here
 *
 * The other rows in this category that say `sources: []` — `veed/avatars` and
 * `argil/avatars`, both reached through fal — animate a catalogued presenter
 * out of a closed enum. VEED has no such thing NATIVELY: `POST /v1/avatars`
 * answers a real 404 and the OpenAPI document declares no roster and no
 * `avatar_id`. So the same vendor is `sources: []` at fal and `sources:
 * ["image"]` here, because they are two different products.
 */

import { EXTRA } from "../../core/unified/derive";
import type { AvatarModelParamTable } from "../../core/unified/vocabulary/avatar";
import type { VeedResolution } from "./shared";

/** Every id `veed.avatar` accepts — one, and the URL says so. */
export const MODELS = ["fabric-1.0"] as const;

/** A still, and it is required. */
const INPUTS = ["image"] as const;

export const VEED_AVATAR_MODEL_PARAMS = {
  "fabric-1.0": {
    sources: INPUTS,
    extras: {
      /**
       * `resolution` — **required**, no default, and the field the price is
       * conditioned on. `"480p"` is $0.08 per second of output, `"720p"` is
       * $0.15.
       */
      resolution: EXTRA as VeedResolution,
    },
  },
} as const satisfies AvatarModelParamTable;
