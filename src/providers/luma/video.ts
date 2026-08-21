/**
 * Luma Dream Machine video generation —
 * POST https://api.lumalabs.ai/dream-machine/v1/generations
 *
 * Wire notes (verified against https://docs.lumalabs.ai/docs/video-generation
 * and the `lumaai` npm SDK's generations resource types on 2026-08-13):
 * - Async job API: the response is a generation object with a `state`
 *   (queued/dreaming/completed/failed); poll GET /generations/{id} or use
 *   `callback_url`. Polling is out of unmodel's scope.
 * - Image-to-video and extend ride the same route via `keyframes`:
 *   `frame0`/`frame1` each take `{ type: "image", url }` or
 *   `{ type: "generation", id }` (extend only works on completed
 *   generations).
 * - Documented durations are "5s" and "9s" and documented resolutions are
 *   540p/720p/1080p/4k; the SDK types deliberately keep both fields open
 *   strings, so unmodel reports other values as invalid_enum_value (demote
 *   via `severity` if Luma ships new values before this table updates).
 * - No cost estimate: Luma publishes no current USD rate for these models
 *   (see ./models.ts).
 * - Auth is `Authorization: Bearer <LUMAAI_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels, type LumaVideoModelId } from "./models";
import {
  GENERATIONS_URL,
  LUMA_ASPECT_RATIOS,
  checkOpenEnum,
  type LumaAspectRatio,
} from "./shared";

/**
 * Both now live in `./shared.ts` — the image and reframe routes need them and
 * must not pay for this module to get them. Re-exported so `/generations` and
 * the ratio list keep their long-standing import site.
 */
export { GENERATIONS_URL, LUMA_ASPECT_RATIOS };
export type { LumaAspectRatio };

const VIDEO_GENERATION_DOCS = "https://docs.lumalabs.ai/docs/video-generation";

/** `GET /generations/concepts/list` — the documented camera-concept list. */
export const CONCEPTS_LIST_URL = `${GENERATIONS_URL}/concepts/list`;

/** Documented video durations — https://docs.lumalabs.ai/docs/video-generation */
export const LUMA_VIDEO_DURATIONS = ["5s", "9s"] as const;

/**
 * Video duration. The named presets are the documented enum
 * (`VideoModelOutputDuration`) and are what `checkDuration` accepts without an
 * issue; the `(string & {})` tail is deliberate — the spec types the field as
 * `anyOf: [enum, string]`, so a value Luma ships before this table catches up
 * stays sendable and is reported as a demotable `invalid_enum_value` rather
 * than a compile error.
 */
export type LumaVideoDuration = (typeof LUMA_VIDEO_DURATIONS)[number] | (string & {});

/**
 * Documented video resolutions. The values come from the spec's
 * `VideoModelOutputResolution` enum (docs.lumalabs.ai/reference/creategeneration);
 * the prose on docs/video-generation writes the third one as "1080" ("Resolution
 * can be 540p, 720p, 1080, 4k"), which its own JSON examples contradict — the
 * machine-readable enum is treated as authoritative.
 */
export const LUMA_VIDEO_RESOLUTIONS = ["540p", "720p", "1080p", "4k"] as const;

/**
 * Video resolution. The named presets are the documented enum
 * (`VideoModelOutputResolution`); the `(string & {})` tail keeps the field's
 * documented openness (`anyOf: [enum, string]`) — anything else validates as a
 * demotable `invalid_enum_value` instead of failing to compile.
 */
export type LumaVideoResolution = (typeof LUMA_VIDEO_RESOLUTIONS)[number] | (string & {});

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** A keyframe: a completed generation to extend, or an image URL. */
export type LumaKeyframe = { type: "generation"; id: string } | { type: "image"; url: string };

export interface LumaKeyframes {
  /** Starting frame (image-to-video / extend-forward). */
  frame0?: LumaKeyframe;
  /** Ending frame (end-frame guidance / extend-backward). */
  frame1?: LumaKeyframe;
}

export interface LumaConcept {
  /** Camera-motion concept key; list them via GET /generations/concepts. */
  key: string;
}

export interface GenerationsParams {
  model: LumaVideoModelId | (string & {});
  /** The text prompt. */
  prompt?: string;
  aspect_ratio?: LumaAspectRatio;
  /** "5s" or "9s" (documented values); other strings warn at runtime. */
  duration?: LumaVideoDuration;
  /** "540p" | "720p" | "1080p" | "4k" (documented values). */
  resolution?: LumaVideoResolution;
  /** Whether the video should loop. */
  loop?: boolean;
  /** Image-to-video / extend inputs. */
  keyframes?: LumaKeyframes;
  /** Camera-motion concepts. */
  concepts?: LumaConcept[];
  /**
   * POSTed a generation object when the job starts dreaming, completes, or
   * fails.
   */
  callback_url?: string;
  generation_type?: "video";
}

const keyframeSchema = z.union([
  z.looseObject({ type: z.literal("generation"), id: z.string().min(1) }),
  z.looseObject({ type: z.literal("image"), url: z.string().min(1) }),
]);

const videoSchema = z.looseObject({
  model: z.string(),
  prompt: z.string().optional(),
  aspect_ratio: z.enum(LUMA_ASPECT_RATIOS).optional(),
  duration: z.string().optional(),
  resolution: z.string().optional(),
  loop: z.boolean().optional(),
  keyframes: z
    .looseObject({
      frame0: keyframeSchema.optional(),
      frame1: keyframeSchema.optional(),
    })
    .optional(),
  concepts: z.array(z.looseObject({ key: z.string() })).optional(),
  callback_url: z.string().optional(),
  generation_type: z.literal("video").optional(),
});

// ---------------------------------------------------------------------------
// Checks — duration/resolution are open strings on the wire (the SDK allows
// future values), so documented-value enforcement lives here, demotable via
// severity overrides.
// ---------------------------------------------------------------------------

const checkDuration = checkOpenEnum<GenerationsParams>(
  "duration",
  LUMA_VIDEO_DURATIONS,
  VIDEO_GENERATION_DOCS,
);

const checkResolution = checkOpenEnum<GenerationsParams>(
  "resolution",
  LUMA_VIDEO_RESOLUTIONS,
  VIDEO_GENERATION_DOCS,
);

/**
 * The one `.toSdk("luma")` target for this endpoint — the `lumaai` SDK takes
 * wire-shaped params. Derived from the `sdk` literal in `finalize`; it must
 * stay an object type with no index signature, or `toSdk` would accept any
 * string.
 */
type LumaSdkTargets<B> = { luma: () => B };

function finalize(params: GenerationsParams): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: GENERATIONS_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { luma: () => body },
  });
}

const validator = createValidator<GenerationsParams, unknown>({
  endpoint: "luma.video",
  schema: videoSchema,
  modelId: (params) => params.model,
  // Route-scoped catalog: photon image models are not valid here and warn
  // as unknown_model.
  catalog: videoModels,
  checks: [checkDuration, checkResolution],
  // No estimate: no published USD pricing for these models (see ./models.ts).
  finalize,
});

/**
 * Validates raw wire params for Luma Dream Machine
 * `POST /dream-machine/v1/generations` (video generation, image-to-video via
 * `keyframes`, extend, loop).
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("luma")` returns the body unchanged in shape — the `lumaai` SDK's
 * `client.generations.create(body)` params are wire-shaped. Auth is your
 * job: add `authorization: Bearer <LUMAAI_API_KEY>` when fetching.
 *
 * ```ts
 * const params = luma.video({
 *   model: "ray-2",
 *   prompt: "A serene lake surrounded by mountains at sunset",
 *   aspect_ratio: "16:9",
 *   resolution: "720p",
 *   duration: "5s",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     authorization: `Bearer ${process.env.LUMAAI_API_KEY}`,
 *   },
 *   body: JSON.stringify(params),
 * });
 * const generation = await res.json(); // poll GET /generations/{id}
 * ```
 */
export const video = validator as unknown as {
  <T extends GenerationsParams>(
    params: T & ExactKeys<T, GenerationsParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, LumaSdkTargets<T>>;
  safe<T extends GenerationsParams>(
    params: T & ExactKeys<T, GenerationsParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, LumaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
