/**
 * `unmodel/image-edit` — the canonical vocabulary for image-to-image.
 *
 * A separate category from `image` rather than an optional `image` field on
 * `ImageParams`, for the reason the two are separate endpoints almost
 * everywhere: the model lists differ, the wire routes differ, and half the
 * text-to-image params (`n`, `negativePrompt`, delivery) mean something else or
 * nothing at all once there is a source image. Merging them would produce a
 * type where most combinations are invalid, which is the type telling you it
 * is two types.
 */
import type {
  AspectRatio,
  BlobRef,
  DataRef,
  Dimensions,
  ImageOutputFormat,
  ProviderOptions,
  UrlRef,
} from "./common";

export type {
  AspectRatio,
  AspectRatioPreset,
  Dimensions,
  ImageOutputFormat,
  ProviderOptions,
} from "./common";

/**
 * The source image, in the three forms providers accept.
 *
 * `{ file }` is the multipart endpoints, `{ url }` the ones that fetch for
 * you, `{ data }` inline base64 (or a `data:` URL). An adapter narrows this to
 * whatever its route takes and reports the rest as `unsupported_param` naming
 * the form that route *does* accept — never a silent upload.
 */
export type ImageEditInput = BlobRef | UrlRef | Pick<DataRef, "data">;

interface ImageEditParamsBase {
  /**
   * Discriminant, so a future `"inpaint"` / `"upscale"` can join this category
   * without either widening `ImageEditParams` into a shape where half the
   * fields are conditional, or minting a seventh entry point.
   */
  operation: "edit";
  /** What to change. */
  prompt: string;
  image: ImageEditInput;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /** 0 = keep the source, 1 = ignore it. Providers spell this a dozen ways. */
  strength?: number;
  n?: number;
  seed?: number;
  outputFormat?: ImageOutputFormat;
  providerOptions?: ProviderOptions;
}

/**
 * An image-edit request. `aspectRatio` / `dimensions` are XOR for the same
 * reason as in `ImageParams`; both are optional here because the common case
 * is "same shape as the input", which is what omitting them means.
 *
 * A union of two complete object types, not `Base & (ArmA | ArmB)` — see the
 * note on `ImageParams` for the distributive-`Omit` trap the shorter spelling
 * walks into.
 */
export type ImageEditParams =
  | (ImageEditParamsBase & { aspectRatio?: AspectRatio; dimensions?: never })
  | (ImageEditParamsBase & { aspectRatio?: never; dimensions?: Dimensions });
