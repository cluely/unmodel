/**
 * `unmodel/video` — the canonical vocabulary for video generation.
 *
 * Text-to-video, image-to-video, and video-to-video are one category rather
 * than three, because they are one *route* at every provider that offers more
 * than one of them: adding a `keyframes` block is how you turn a Luma text
 * request into an image request, not a different endpoint. What varies is
 * which inputs a given model accepts, and that is a per-model fact an adapter
 * reports — not a shape the caller should have to pick up front.
 */
import type { AspectRatio, DataRef, ProviderOptions, UrlRef } from "./common";

export type { AspectRatio, AspectRatioPreset, ProviderOptions } from "./common";

/** The three resolutions worth naming, plus the two everyone markets. */
export type VideoResolution = "480p" | "720p" | "1080p" | "1440p" | "4k";

/**
 * What an input image is *for*.
 *
 * The same `{ url }` means three different things depending on this field —
 * the opening frame, the closing frame, or a style/subject reference — and
 * every provider that supports more than one puts them in different wire
 * slots. Omitted means `"first"`, which is what an unlabelled image means
 * everywhere.
 */
export type VideoImageRole = "first" | "last" | "reference";

/** One image input, tagged with the job it does. */
export type VideoImageInput = (UrlRef | (DataRef & { mimeType: string })) & {
  role?: VideoImageRole;
};

/** A source clip, for extend / restyle / reframe routes. */
export type VideoInput = UrlRef | Pick<DataRef, "data">;

export interface VideoParams {
  /**
   * Optional: an image-to-video request with a first frame and no prompt is a
   * legitimate request at several providers, and requiring an empty string
   * would be a lie about what was sent.
   */
  prompt?: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * Seconds. A plain number, because that is the only spelling that means the
   * same thing everywhere — providers variously take `5`, `"5"`, `"5s"` and a
   * closed enum, and `derive.ts` has one encoder per spelling.
   */
  duration?: number;
  resolution?: VideoResolution;
  aspectRatio?: AspectRatio;
  /**
   * One image, or several with distinct roles. The array form is what
   * first-and-last-frame interpolation needs; a bare object is the common
   * image-to-video case.
   */
  image?: VideoImageInput | readonly VideoImageInput[];
  video?: VideoInput;
  negativePrompt?: string;
  seed?: number;
  n?: number;
  providerOptions?: ProviderOptions;
}
