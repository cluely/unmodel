/**
 * Shared wire pieces for the Luma Dream Machine API, transcribed from the
 * OpenAPI definition embedded in the API reference pages ("Dream Machine API"
 * version 1.1.0, e.g.
 * https://docs.lumalabs.ai/reference/creategeneration) — verified 2026-08-13.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";

export const DREAM_MACHINE_BASE_URL = "https://api.lumalabs.ai/dream-machine/v1";

/**
 * `POST /generations` — the video route, and the prefix the image and reframe
 * routes hang off (`/generations/image`, `/generations/…`).
 *
 * It lives here rather than in `./generations.ts` for a bundle reason, not a
 * tidiness one: `image-generations.ts` needs the prefix and the ratio list
 * below, and taking either from the video validator dragged that whole module
 * — its zod schema, its checks, its pricing table — into an entry that never
 * generates a video. This file imports zod and two core *types*, so a consumer
 * pays for what it names.
 */
export const GENERATIONS_URL = `${DREAM_MACHINE_BASE_URL}/generations`;

/**
 * Documented aspect ratios (lumaai SDK closed enum). One list, because Luma
 * documents the same seven for video, image and both reframe routes — a second
 * copy would be a silent divergence waiting for the next value Luma ships.
 */
export const LUMA_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21"] as const;
export type LumaAspectRatio = (typeof LUMA_ASPECT_RATIOS)[number];

/**
 * Enforces a documented value list on a field the spec deliberately leaves as
 * an open string (`VideoModelOutputResolution` and `VideoModelOutputDuration`
 * are both `anyOf: [enum, string]`, so the SDK accepts anything). Reported as
 * `invalid_enum_value`, which callers can demote via `severity` if Luma ships
 * a new value before this table catches up.
 */
export function checkOpenEnum<P>(
  field: string,
  allowed: readonly string[],
  source: string,
): (params: P, info: ModelInfo | undefined, ctx: PipelineContext) => void {
  const set = new Set(allowed);
  return (params, _info, ctx) => {
    const value = (params as Record<string, unknown>)[field];
    if (typeof value !== "string" || set.has(value)) return;
    ctx.report({
      code: "invalid_enum_value",
      path: [field],
      message: `\`${field}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(value)}.`,
      meta: { allowed: [...allowed], value, source },
    });
  };
}

/** Video models — every video route takes exactly these two. */
export const LUMA_VIDEO_MODEL_IDS = ["ray-2", "ray-flash-2"] as const;

/** Image models — every image route takes exactly these two. */
export const LUMA_IMAGE_MODEL_IDS = ["photon-1", "photon-flash-1"] as const;

/**
 * An input asset. The spec's `Media` schema is `{ url }` with `url` required;
 * Luma accepts only URLs here ("You should upload and use your own cdn image
 * urls, currently this is the only way to pass an image" —
 * https://docs.lumalabs.ai/docs/image-generation).
 */
export interface LumaMedia {
  url: string;
}

export const mediaSchema = z.looseObject({ url: z.string().min(1) });

/**
 * Crop/expand geometry shared by the two reframe routes. All values are
 * pixels — https://docs.lumalabs.ai/docs/reframe-video-image.
 */
export interface LumaReframeGeometry {
  /** Position of the source inside the reframed grid. */
  grid_position_x?: number;
  grid_position_y?: number;
  /** Crop bounds. */
  x_start?: number;
  x_end?: number;
  y_start?: number;
  y_end?: number;
  /** Size the source is resized to before reframing. */
  resized_width?: number;
  resized_height?: number;
}

export const reframeGeometryShape = {
  grid_position_x: z.number().int().optional(),
  grid_position_y: z.number().int().optional(),
  x_start: z.number().int().optional(),
  x_end: z.number().int().optional(),
  y_start: z.number().int().optional(),
  y_end: z.number().int().optional(),
  resized_width: z.number().int().optional(),
  resized_height: z.number().int().optional(),
} as const;
