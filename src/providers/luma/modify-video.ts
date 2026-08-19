/**
 * Luma Dream Machine Modify Video — the video-editing route.
 * POST https://api.lumalabs.ai/dream-machine/v1/generations/video/modify
 *
 * Wire notes (verified against https://docs.lumalabs.ai/docs/modify-video and
 * the OpenAPI definition embedded in
 * https://docs.lumalabs.ai/reference/modifyvideo on 2026-08-13):
 * - Style-transfer and prompt-based editing over an input video: `media.url`
 *   is the source clip, `first_frame.url` is an optional (but per the guide
 *   "preferred") already-modified first frame to steer the result.
 * - `mode` picks how tightly the output tracks the source, on a documented
 *   nine-step scale: adhere_1..3 (subtle retexturing) → flex_1..3 (bigger
 *   stylistic changes, recognizable subjects) → reimagine_1..3 (loosest).
 * - Input limits are per model: ray-2 accepts up to 10s, ray-flash-2 up to
 *   15s, both up to 100 mb. unmodel cannot read a remote URL, so those ride
 *   the constraint table as published metadata rather than enforced checks.
 * - Async job API: the response is a generation object with a `state`; poll
 *   GET /generations/{id} or use `callback_url`.
 * - No cost estimate: the rate is per million pixels and the request carries
 *   no dimensions (see ./pricing.ts, which exports the arithmetic).
 * - Auth is `Authorization: Bearer <LUMAAI_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels, type LumaVideoModelId } from "./models";
import { DREAM_MACHINE_BASE_URL, mediaSchema, type LumaMedia } from "./shared";

export const MODIFY_VIDEO_URL = `${DREAM_MACHINE_BASE_URL}/generations/video/modify`;

export const MODIFY_VIDEO_DOCS = "https://docs.lumalabs.ai/docs/modify-video";

/**
 * How closely the output tracks the source video —
 * https://docs.lumalabs.ai/docs/modify-video.
 */
export const LUMA_MODIFY_MODES = [
  "adhere_1",
  "adhere_2",
  "adhere_3",
  "flex_1",
  "flex_2",
  "flex_3",
  "reimagine_1",
  "reimagine_2",
  "reimagine_3",
] as const;
export type LumaModifyMode = (typeof LUMA_MODIFY_MODES)[number];

/**
 * Per-model rules: the `mode` enum, plus the documented input ceilings
 * ("| ray-2 | 10s | 100 mb |", "| ray-flash-2 | 15s | 100mb |"). "100 mb" is
 * read as 100 MB decimal — the guide does not disambiguate MB from MiB. The
 * media limits are published metadata, not enforced checks: the request
 * carries only a URL, which unmodel never fetches.
 */
export const modifyVideoConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "ray-2": {
    enums: { mode: LUMA_MODIFY_MODES },
    media: { video: { maxDurationSeconds: 10, maxBytes: 100_000_000 } },
  },
  "ray-flash-2": {
    enums: { mode: LUMA_MODIFY_MODES },
    media: { video: { maxDurationSeconds: 15, maxBytes: 100_000_000 } },
  },
};

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

export interface ModifyVideoParams {
  model: LumaVideoModelId | (string & {});
  /** The source video to modify. */
  media: LumaMedia;
  /** How closely to track the source. */
  mode: LumaModifyMode | (string & {});
  /** Text guiding how the video should be modified. */
  prompt?: string;
  /** Optional already-modified first frame used to steer the result. */
  first_frame?: LumaMedia;
  /** POSTed a generation object when the job progresses. */
  callback_url?: string;
  /** Defaults to "modify_video" server-side. */
  generation_type?: "modify_video";
}

const modifyVideoSchema = z.looseObject({
  model: z.string(),
  media: mediaSchema,
  mode: z.string(),
  prompt: z.string().optional(),
  first_frame: mediaSchema.optional(),
  callback_url: z.string().optional(),
  generation_type: z.literal("modify_video").optional(),
});

/**
 * The one `.toSdk("luma")` target for this endpoint — the `lumaai` SDK takes
 * wire-shaped params. Derived from the `sdk` literal in `finalize`; it must
 * stay an object type with no index signature, or `toSdk` would accept any
 * string.
 */
type LumaSdkTargets<B> = { luma: () => B };

function finalize(params: ModifyVideoParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: MODIFY_VIDEO_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { luma: () => body },
  });
}

const validator = createValidator<ModifyVideoParams, unknown>({
  endpoint: "luma.modifyVideo",
  schema: modifyVideoSchema,
  modelId: (params) => params.model,
  // Route-scoped catalog: photon image models are not valid here and warn as
  // unknown_model.
  catalog: videoModels,
  constraints: modifyVideoConstraints,
  // No estimate: the published rate is per million pixels (see ./pricing.ts).
  finalize,
});

/**
 * Validates raw wire params for Luma Dream Machine
 * `POST /dream-machine/v1/generations/video/modify` (style transfer and
 * prompt-based video editing).
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("luma")` returns the body unchanged in shape. Auth is your job: add
 * `authorization: Bearer <LUMAAI_API_KEY>` when fetching.
 *
 * ```ts
 * const params = luma.modifyVideo({
 *   model: "ray-2",
 *   media: { url: "https://example.com/video.mp4" },
 *   first_frame: { url: "https://example.com/frame.png" },
 *   mode: "flex_1",
 *   prompt: "turn the street into a rainy neon alley",
 * });
 * ```
 */
export const modifyVideo = validator as unknown as {
  <T extends ModifyVideoParams>(
    params: T & ExactKeys<T, ModifyVideoParams>,
    options?: ValidateOptions,
  ): Validated<T, LumaSdkTargets<T>>;
  safe<T extends ModifyVideoParams>(
    params: T & ExactKeys<T, ModifyVideoParams>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, LumaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
