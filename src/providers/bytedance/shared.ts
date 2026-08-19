/**
 * Shared wire pieces for the BytePlus ModelArk (ByteDance Seed) generation
 * routes. Verified against
 * https://docs.byteplus.com/en/docs/ModelArk/1541523 (image generation API),
 * https://docs.byteplus.com/en/docs/ModelArk/1520757 (create a video
 * generation task) and https://docs.byteplus.com/en/docs/ModelArk/2191806
 * (region availability) on 2026-08-13.
 *
 * Auth is `Authorization: Bearer <ARK_API_KEY>` on every route — unmodel
 * never touches keys; add the header yourself when fetching.
 *
 * This is the INTERNATIONAL platform (BytePlus ModelArk). The mainland
 * platform (Volcengine ModelArk, ark.cn-beijing.volces.com) is a separate host
 * with its own `doubao-`-prefixed id space — the model BytePlus spells
 * `seedream-5-0-260128` is `doubao-seedream-5-0-260128` there — and is out of
 * scope. Note that both platforms read the key from `ARK_API_KEY`, so a
 * Volcengine key validates here without complaint and then fails to
 * authenticate against the BytePlus host these URLs point at.
 */

import type { PipelineContext } from "../../core/pipeline";
import { toBytes } from "../../core/media/bytes";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";
import { sniffImage, type SniffedImage } from "../../core/media/image";

/**
 * Region base URLs. ModelArk is region-isolated: an API key and an endpoint
 * created in one region cannot be called through the other region's URL.
 * https://docs.byteplus.com/en/docs/ModelArk/2191806
 */
export const ARK_AP_SOUTHEAST_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
export const ARK_EU_WEST_BASE_URL = "https://ark.eu-west.bytepluses.com/api/v3";

/**
 * Documented ModelArk region ids. BytePlus (international) only — the mainland
 * `cn-beijing` region on ark.cn-beijing.volces.com is out of scope; see the
 * module docstring.
 */
export type ArkRegion = "ap-southeast-1" | "eu-west-1";

/**
 * Base URL for a ModelArk region. `ap-southeast-1` (Johor) is the default in
 * every documented sample; `eu-west-1` (Dublin) currently serves the chat and
 * image generation APIs only — the video task API is AP-only.
 */
export function arkBaseUrl(region: ArkRegion = "ap-southeast-1"): string {
  return region === "eu-west-1" ? ARK_EU_WEST_BASE_URL : ARK_AP_SOUTHEAST_BASE_URL;
}

// ---------------------------------------------------------------------------
// Inline-image inspection
//
// Both routes accept an image as an HTTPS URL, a `data:image/<fmt>;base64,…`
// string, or (video only) an `asset://<ASSET_ID>` URI. Only the data-URI form
// carries bytes unmodel can inspect, so the documented per-image limits are
// enforced when — and only when — the caller inlines the image.
// ---------------------------------------------------------------------------

/**
 * The documented single-image input bounds of a route. `MediaRule` covers
 * bytes and max dimensions; the extra fields carry the bounds ModelArk states
 * that `MediaRule` has no slot for (a minimum dimension, a total-pixel range,
 * and an aspect-ratio range).
 */
export interface ArkImageRule {
  maxBytes?: number;
  /** Per-side minimum in pixels (exclusive when `minDimensionExclusive`). */
  minDimension?: number;
  /** `true` when the docs say "> N" rather than "[N, …]". */
  minDimensionExclusive?: boolean;
  maxDimension?: number;
  /** Inclusive width × height bounds. */
  minPixels?: number;
  maxPixels?: number;
  /** Inclusive width / height bounds. */
  minAspect?: number;
  maxAspect?: number;
}

/** True for the one input form whose bytes are inspectable. */
export function isInlineImage(url: unknown): url is string {
  return typeof url === "string" && url.startsWith("data:image/");
}

/**
 * Enforces a route's documented single-image bounds against one image input.
 * Anything that is not an inline data URI (an HTTPS URL, an `asset://` URI)
 * is skipped: the bytes are not present in the request.
 */
export function checkInlineImage(
  ctx: PipelineContext,
  url: unknown,
  path: Array<string | number>,
  model: string | undefined,
  rule: ArkImageRule,
  source: string,
): void {
  if (!isInlineImage(url)) return;

  const bytes = toBytes(url);
  const sniffed: SniffedImage | undefined = bytes === undefined ? undefined : sniffImage(bytes);
  const declaration = findMediaDeclaration(ctx.options.media, path);

  reportMediaIssues(ctx, {
    kind: "image",
    rule: {
      ...(rule.maxBytes !== undefined && { maxBytes: rule.maxBytes }),
      ...(rule.maxDimension !== undefined && {
        maxWidth: rule.maxDimension,
        maxHeight: rule.maxDimension,
      }),
    },
    path,
    ...(model !== undefined && { model }),
    ...(sniffed !== undefined && { sniffed }),
    ...(declaration !== undefined && { declaration }),
    source,
  });

  const width = sniffed?.width ?? declaration?.width;
  const height = sniffed?.height ?? declaration?.height;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return;

  const target = model !== undefined ? `"${model}"` : ctx.endpoint;
  const report = (message: string, meta: Record<string, unknown>): void => {
    ctx.report({
      code: "media_dimensions_exceeded",
      path,
      ...(model !== undefined && { model }),
      message,
      meta: { ...meta, source },
    });
  };

  const min = rule.minDimension;
  if (min !== undefined) {
    const under = rule.minDimensionExclusive
      ? width <= min || height <= min
      : width < min || height < min;
    if (under) {
      report(
        `image is ${width}x${height}; ${target} requires each side to be ${rule.minDimensionExclusive ? "greater than" : "at least"} ${min} pixels.`,
        { width, height, minDimension: min },
      );
    }
  }

  const pixels = width * height;
  if (rule.minPixels !== undefined && pixels < rule.minPixels) {
    report(
      `image is ${width}x${height} (${pixels} pixels); ${target} requires at least ${rule.minPixels} total pixels.`,
      { width, height, pixels, minPixels: rule.minPixels },
    );
  }
  if (rule.maxPixels !== undefined && pixels > rule.maxPixels) {
    report(
      `image is ${width}x${height} (${pixels} pixels); ${target} caps input images at ${rule.maxPixels} total pixels.`,
      { width, height, pixels, maxPixels: rule.maxPixels },
    );
  }

  const aspect = width / height;
  const { minAspect, maxAspect } = rule;
  if (
    (minAspect !== undefined && aspect < minAspect) ||
    (maxAspect !== undefined && aspect > maxAspect)
  ) {
    report(
      `image aspect ratio is ${round(aspect)} (${width}x${height}); ${target} accepts ${round(minAspect ?? 0)}–${round(maxAspect ?? 0)}.`,
      { width, height, aspect, ...(minAspect !== undefined && { minAspect }), ...(maxAspect !== undefined && { maxAspect }) },
    );
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Parses a `"<width>x<height>"` size string; undefined when not that shape. */
export function parsePixelSize(size: string): { width: number; height: number } | undefined {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (match === null) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}
