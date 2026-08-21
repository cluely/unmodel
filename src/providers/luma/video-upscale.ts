/**
 * Luma Dream Machine Upscale —
 * POST https://api.lumalabs.ai/dream-machine/v1/generations/{id}/upscale
 *
 * Wire notes (verified against the OpenAPI definition embedded in
 * https://docs.lumalabs.ai/reference/upscalegeneration on 2026-08-13):
 * - Upscales an existing *completed* video generation; `id` is the generation
 *   to upscale and is a URL path param, so it rides in the params object and
 *   is stripped from the JSON body (it lives in `.request.url`).
 * - `resolution` is the same open-string type as the generate route
 *   (`anyOf: [enum, string]`), documented as 540p/720p/1080p/4k — Luma shipped
 *   "Upscale up to 4K" in https://docs.lumalabs.ai/changelog/upscale.
 * - The body carries no `model`: the upscale runs against whatever model
 *   produced the source generation, so no model-dependent checks apply.
 * - Async job API: poll GET /generations/{id} or use `callback_url`.
 * - Auth is `Authorization: Bearer <LUMAAI_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels } from "./models";
import { LUMA_VIDEO_RESOLUTIONS, type LumaVideoResolution } from "./video";
import { DREAM_MACHINE_BASE_URL, checkOpenEnum } from "./shared";

const UPSCALE_DOCS = "https://docs.lumalabs.ai/reference/upscalegeneration";

/** `POST /generations/{id}/upscale` for a generation id. */
export function upscaleUrl(generationId: string): string {
  return `${DREAM_MACHINE_BASE_URL}/generations/${encodeURIComponent(generationId)}/upscale`;
}

export interface UpscaleParams {
  /** The completed generation to upscale — a URL path param, not a body field. */
  id: string;
  /** "540p" | "720p" | "1080p" | "4k" (documented values). */
  resolution?: LumaVideoResolution;
  /** POSTed a generation object when the job progresses. */
  callback_url?: string;
  /** Defaults to "upscale_video" server-side. */
  generation_type?: "upscale_video";
}

const videoUpscaleSchema = z.looseObject({
  id: z.string().min(1, "id must be a non-empty generation id"),
  resolution: z.string().optional(),
  callback_url: z.string().optional(),
  generation_type: z.literal("upscale_video").optional(),
});

/**
 * The one `.toSdk("luma")` target for this endpoint — the `lumaai` SDK takes
 * wire-shaped params. Derived from the `sdk` literal in `finalize`; it must
 * stay an object type with no index signature, or `toSdk` would accept any
 * string.
 */
type LumaSdkTargets<B> = { luma: () => B };

function finalize(params: UpscaleParams): unknown {
  const { id, ...body } = params;
  return toValidated(body, {
    url: upscaleUrl(id),
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { luma: () => body },
  });
}

const validator = createValidator<UpscaleParams, unknown>({
  endpoint: "luma.videoUpscale",
  schema: videoUpscaleSchema,
  // No `model` on the wire: the source generation determines the model.
  modelId: () => undefined,
  catalog: videoModels,
  checks: [checkOpenEnum("resolution", LUMA_VIDEO_RESOLUTIONS, UPSCALE_DOCS)],
  finalize,
});

/**
 * Validates raw wire params for Luma Dream Machine
 * `POST /dream-machine/v1/generations/{id}/upscale`.
 *
 * The returned object's enumerable props are the exact fetch JSON body — `id`
 * is stripped and lives in `.request.url`.
 *
 * ```ts
 * const params = luma.videoUpscale({
 *   id: "123e4567-e89b-12d3-a456-426614174000",
 *   resolution: "4k",
 * });
 * ```
 */
export const videoUpscale = validator as unknown as {
  <T extends UpscaleParams>(
    params: T & ExactKeys<T, UpscaleParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "id">, LumaSdkTargets<Omit<T, "id">>>;
  safe<T extends UpscaleParams>(
    params: T & ExactKeys<T, UpscaleParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "id">, LumaSdkTargets<Omit<T, "id">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
