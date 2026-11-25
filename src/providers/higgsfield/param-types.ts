/**
 * The types of the per-route UNIFIED rows `scripts/codegen-higgsfield.ts`
 * emits: `gen/image-params.gen.ts`, `gen/image-edit-params.gen.ts` and
 * `gen/video-params.gen.ts`, one per category pack that addresses
 * `higgsfield/<route id>`.
 *
 * Type-only, and a separate file from `./shape-types.ts` on purpose: those are
 * the WIRE rows (what a route takes on `POST /<endpoint>`) and
 * `unmodel/higgsfield/types` republishes them, while these are the rows the
 * canonical vocabulary reads and they name the kernel's own row types. Keeping
 * the two apart keeps the kernel's vocabulary out of the provider's types
 * entry.
 *
 * Each row extends the kernel's row for its category — the fields that narrow
 * a caller's types (`ratios`, `tiers`, `durations`, `resolutions`, `extras`) —
 * with the wire facts the adapter compiles by. The adapters branch on these
 * fields and never on a route id: Higgsfield's roster moves weekly, and a
 * route the next refresh adds has a row the day it lands.
 */

import type { ImageOutputFormat, ResolutionTier, VideoResolution } from "../../core/unified/vocabulary/common";
import type { ModelParams, VideoModelParams } from "../../core/unified/vocabulary/model-params";
import type { VideoImageRole } from "../../core/unified/vocabulary/video";

/** What every Higgsfield row carries, whichever pack reads it. */
export interface HiggsfieldParamRowBase {
  /**
   * The wire parameters the adapter writes from a canonical word that THIS
   * route declares, in the route's own order. A canonical word whose parameter
   * is not here is refused, naming the route.
   */
  readonly keys: readonly string[];
  /**
   * The route's published bounds on a numeric canonical word, keyed by the
   * CANONICAL name (`n`, not `batch_size`). Stated for pickers; the route's own
   * validator enforces them.
   */
  readonly bounds?: Readonly<Partial<Record<"seed" | "n" | "duration", { readonly min?: number; readonly max?: number }>>>;
}

/** The two things a picture route may spell beside its shape: how many, and in which encoding. */
export interface HiggsfieldPictureFields {
  /** Where `n` lands: `batch_size` on Higgsfield's own routes, `series_amount` on Kling Image's series routes. */
  readonly countWire?: "batch_size" | "series_amount";
  /** The counts the route offers, where it lists them (Soul renders 1 or 4 and nothing between). */
  readonly counts?: readonly number[];
  /** Omitting the count is a wire error at this route: the Kling Image series routes require it. */
  readonly countRequired?: true;
  /** Canonical encoding → the route's spelling of it (`"jpeg"` → `"jpg"`), where the route has an `output_format`. */
  readonly formatWire?: Readonly<Partial<Record<ImageOutputFormat, string>>>;
}

/**
 * One text-to-image route's row.
 *
 * `tiers` is always present. It is EMPTY both where the route has no
 * `resolution` parameter and where it has one with no canonical tier in it:
 * Soul's is `720p | 1080p`, a pixel class the image vocabulary has no word
 * for, and it is reached through `providerOptions.higgsfield.resolution`.
 */
export interface HiggsfieldImageParamRow extends ModelParams, HiggsfieldParamRowBase, HiggsfieldPictureFields {
  /** Canonical tier → the route's spelling of it. Absent where `tiers` is empty. */
  readonly tierWire?: Readonly<Partial<Record<ResolutionTier, string>>>;
}

/**
 * One picture-editing route's row.
 *
 * No `tiers`: `ImageEditParams` has no `resolution`, so a route's own
 * `resolution` is one of its `extras` here, in the route's own vocabulary.
 */
export interface HiggsfieldImageEditParamRow extends ModelParams, HiggsfieldParamRowBase, HiggsfieldPictureFields {
  /**
   * Where the picture to edit lands. `image_urls` is a list: the one canonical
   * picture is sent as a one-element array.
   */
  readonly imageWire: "image_url" | "image_urls";
}

/**
 * One video route's row.
 *
 * `durations`, `resolutions` and `ratios` are EMPTY where the route has no
 * such parameter, which types the canonical word `never` for it. `durations`
 * is ABSENT where the route takes a range (`bounds.duration`).
 */
export interface HiggsfieldVideoParamRow extends VideoModelParams, HiggsfieldParamRowBase {
  /** Canonical tier → the route's spelling of it (`"480p"` → `"480P"`). Absent where `resolutions` is empty. */
  readonly resolutionWire?: Readonly<Partial<Record<VideoResolution, string>>>;
  /** The picture roles this route has a parameter for. */
  readonly roles: readonly VideoImageRole[];
  /** Role → the parameter it lands on. `reference` is a list. */
  readonly roleWire?: {
    readonly first?: "image_url" | "first_frame_url";
    readonly last?: "end_image_url" | "last_image_url" | "last_frame_url";
    readonly reference?: "image_urls";
  };
  /**
   * Where the source clip lands, where the route takes one. `video_urls` is a
   * list: the one canonical clip is sent as a one-element array.
   */
  readonly videoWire?: "video_url" | "video_urls";
}
