/**
 * Black Forest Labs FLUX.2 — POST https://api.bfl.ai/v1/{model}
 *
 * Wire notes (verified against https://api.bfl.ai/openapi.json and
 * https://docs.bfl.ml on 2026-08-13):
 * - The BFL API has no `model` body field: the model IS the route
 *   (/v1/flux-2-pro, /v1/flux-2-max, /v1/flux-2-flex, /v1/flux-2-klein-9b,
 *   /v1/flux-2-klein-4b, plus the -preview routes). unmodel takes `model` as
 *   a pseudo-param for catalog lookup, STRIPS it from the wire body, and
 *   interpolates it into `.request.url`. One `image()` endpoint fn covers the
 *   whole route family (rather than one fn per route) because every route
 *   shares the same submit/poll lifecycle and one of three near-identical
 *   input schemas — the per-route differences are expressed as Tier-A typed
 *   arms plus runtime deny constraints.
 * - This is an ASYNC-JOB API: the POST returns `{ id, polling_url }` (or a
 *   webhook acknowledgement), not image bytes. Polling
 *   `GET https://api.bfl.ai/v1/get_result?id=…` is transport and out of
 *   unmodel's scope; `BFL_GET_RESULT_URL` is exported for convenience.
 * - Per-route schema families: pro/max (Flux2Inputs) use `disable_pup` and up
 *   to 8 input images; flex (Flux2FlexInputs) uses `prompt_upsampling`,
 *   `guidance`, `steps`, `input_image_blob_path` and up to 8 input images;
 *   klein (Flux2KleinInputs) has no upsampling/guidance/steps controls and at
 *   most 4 input images.
 * - `width`/`height` carry ONE documented bound: `minimum: 64` (default 0 =
 *   automatic sizing). The FLUX.2 pages advertise "up to 4MP output" in prose
 *   but publish no maximum, no multiple-of rule and no aspect bound for these
 *   routes, so nothing beyond the ≥ 64 floor is enforced — over-narrowing here
 *   would reject sizes the API accepts. (The FLUX.1 routes DO document
 *   multiple-of-32 and 256–1440; see image-flux1.ts.)
 * - Pricing is megapixel-based ("from $X/MP"); the cost estimate is the
 *   documented 1MP text-to-image base price — actual cost can be higher for
 *   larger outputs or editing. The response's `cost` field is authoritative.
 * - Auth is an `x-key` header — unmodel never touches keys; add it yourself
 *   when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import { imageConstraints } from "./constraints";

export const BFL_API_BASE_URL = "https://api.bfl.ai";

/**
 * Async-job polling endpoint (`GET ?id=…`). Polling is transport — out of
 * unmodel's scope; exported so callers don't hard-code it.
 */
export const BFL_GET_RESULT_URL = `${BFL_API_BASE_URL}/v1/get_result`;

/**
 * Submit URL for a BFL model id — the model is the route, not a body field.
 * Multi-segment ids (the `flux-tools/…` routes) keep their separator: each
 * path segment is encoded individually.
 */
export function bflModelUrl(model: string): string {
  const path = model.split("/").map(encodeURIComponent).join("/");
  return `${BFL_API_BASE_URL}/v1/${path}`;
}

/** `output_format` values — OutputFormat enum in https://api.bfl.ai/openapi.json. */
export const BFL_OUTPUT_FORMATS = ["jpeg", "png", "webp"] as const;
export type BflOutputFormat = (typeof BFL_OUTPUT_FORMATS)[number];

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per route family, carrying exactly the params
// that route's input schema documents (api.bfl.ai/openapi.json, 2026-08-13).
// Params a route rejects are typed `never` so they fail at compile time.
// ---------------------------------------------------------------------------

interface Flux2CoreFields {
  /** Text prompt for image generation. */
  prompt: string;
  /** Input image (base64 or URL) for editing/reference workflows. */
  input_image?: string | null;
  input_image_2?: string | null;
  input_image_3?: string | null;
  input_image_4?: string | null;
  /** Optional seed for reproducibility. */
  seed?: number | null;
  /** Width in pixels, ≥ 64. Omit (server default 0) for automatic sizing. */
  width?: number | null;
  /** Height in pixels, ≥ 64. Omit (server default 0) for automatic sizing. */
  height?: number | null;
  /** Moderation strictness 0 (strictest) – 5 (least strict). Default 2. */
  safety_tolerance?: number;
  /** Output image format. Default "jpeg". */
  output_format?: BflOutputFormat | null;
  /** URL (1–2083 chars) to receive the async result instead of polling. */
  webhook_url?: string | null;
  /** Secret for webhook signature verification. */
  webhook_secret?: string | null;
}

/** pro/max routes (Flux2Inputs): `disable_pup`, up to 8 input images. */
interface Flux2ProMaxFields extends Flux2CoreFields {
  /**
   * pro/max apply prompt upsampling by default; set true to generate from
   * your prompt exactly as written.
   */
  disable_pup?: boolean;
  input_image_5?: string | null;
  input_image_6?: string | null;
  input_image_7?: string | null;
  input_image_8?: string | null;
  /** flex/kontext routes only — pro/max use `disable_pup`. */
  prompt_upsampling?: never;
  /** flux-2-flex only. */
  guidance?: never;
  /** flux-2-flex only. */
  steps?: never;
  /** flux-2-flex only. */
  input_image_blob_path?: never;
}

export interface Flux2ProBody extends Flux2ProMaxFields {
  model: "flux-2-pro";
}

export interface Flux2MaxBody extends Flux2ProMaxFields {
  model: "flux-2-max";
}

export interface Flux2ProPreviewBody extends Flux2ProMaxFields {
  model: "flux-2-pro-preview";
}

/** flex route (Flux2FlexInputs): guidance/steps knobs, `prompt_upsampling`. */
export interface Flux2FlexBody extends Flux2CoreFields {
  model: "flux-2-flex";
  /** Whether to use prompt upsampling. Default true. */
  prompt_upsampling?: boolean | null;
  /** Guidance scale, 1.5–10. Default 5. Higher = stronger prompt adherence. */
  guidance?: number | null;
  /** Generation steps, 1–50. Default 50. */
  steps?: number | null;
  /** Blob path to the input image. */
  input_image_blob_path?: string | null;
  input_image_5?: string | null;
  input_image_6?: string | null;
  input_image_7?: string | null;
  input_image_8?: string | null;
  /** pro/max routes only — flex uses `prompt_upsampling`. */
  disable_pup?: never;
}

/** klein routes (Flux2KleinInputs): no upsampling/guidance/steps, ≤4 images. */
interface Flux2KleinFields extends Flux2CoreFields {
  /** pro/max routes only. */
  disable_pup?: never;
  /** flex/kontext routes only. */
  prompt_upsampling?: never;
  /** flux-2-flex only. */
  guidance?: never;
  /** flux-2-flex only. */
  steps?: never;
  /** flux-2-flex only. */
  input_image_blob_path?: never;
  /** klein routes accept at most 4 input images. */
  input_image_5?: never;
  input_image_6?: never;
  input_image_7?: never;
  input_image_8?: never;
}

export interface Flux2Klein9bBody extends Flux2KleinFields {
  model: "flux-2-klein-9b";
}

export interface Flux2Klein9bPreviewBody extends Flux2KleinFields {
  model: "flux-2-klein-9b-preview";
}

export interface Flux2Klein4bBody extends Flux2KleinFields {
  model: "flux-2-klein-4b";
}

/** Escape hatch for routes unmodel doesn't know yet (unknown_model warning). */
export interface UnknownFlux2ModelBody {
  model: string & {};
  prompt: string;
  [key: string]: unknown;
}

export type Flux2Body =
  | Flux2ProBody
  | Flux2MaxBody
  | Flux2ProPreviewBody
  | Flux2FlexBody
  | Flux2Klein9bBody
  | Flux2Klein9bPreviewBody
  | Flux2Klein4bBody
  | UnknownFlux2ModelBody;

interface Flux2BodyByModel {
  "flux-2-pro": Flux2ProBody;
  "flux-2-max": Flux2MaxBody;
  "flux-2-pro-preview": Flux2ProPreviewBody;
  "flux-2-flex": Flux2FlexBody;
  "flux-2-klein-9b": Flux2Klein9bBody;
  "flux-2-klein-9b-preview": Flux2Klein9bPreviewBody;
  "flux-2-klein-4b": Flux2Klein4bBody;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type Flux2Arm<M extends string> = M extends keyof Flux2BodyByModel
  ? Flux2BodyByModel[M]
  : UnknownFlux2ModelBody;

// ---------------------------------------------------------------------------
// Schema — the loose union of every param any flux-2 route accepts; per-route
// narrowing happens in constraints.ts (runtime) and the Tier-A arms (types).
// ---------------------------------------------------------------------------

const flux2Schema = z.looseObject({
  model: z.string(),
  prompt: z.string(),
  disable_pup: z.boolean().optional(),
  prompt_upsampling: z.boolean().nullable().optional(),
  input_image: z.string().nullable().optional(),
  input_image_2: z.string().nullable().optional(),
  input_image_3: z.string().nullable().optional(),
  input_image_4: z.string().nullable().optional(),
  input_image_5: z.string().nullable().optional(),
  input_image_6: z.string().nullable().optional(),
  input_image_7: z.string().nullable().optional(),
  input_image_8: z.string().nullable().optional(),
  input_image_blob_path: z.string().nullable().optional(),
  seed: z.number().int().nullable().optional(),
  width: z.number().int().min(64, "width must be at least 64 pixels").nullable().optional(),
  height: z.number().int().min(64, "height must be at least 64 pixels").nullable().optional(),
  guidance: z.number().min(1.5).max(10).nullable().optional(),
  steps: z.number().int().min(1).max(50).nullable().optional(),
  safety_tolerance: z.number().int().min(0).max(5).optional(),
  output_format: z.enum(BFL_OUTPUT_FORMATS).nullable().optional(),
  webhook_url: z.string().min(1).max(2083).nullable().optional(),
  webhook_secret: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Estimation — the documented 1MP text-to-image base price (see models.ts).
// ---------------------------------------------------------------------------

function estimate(_params: Flux2Body, info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (model stripped — it lives in the URL) + .request.
// ---------------------------------------------------------------------------

/**
 * The one `.toSdk("black-forest-labs")` target for this endpoint — BFL ships
 * no official JS SDK, so this is the wire body. Derived from the `sdk`
 * literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type BflSdkTargets<B> = { "black-forest-labs": () => B };

function finalize(params: Flux2Body): unknown {
  const { model, ...body } = params;
  return toValidated(body, {
    url: bflModelUrl(model),
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { "black-forest-labs": () => body },
  });
}

const validator = createValidator<Flux2Body, unknown>({
  endpoint: "black-forest-labs.image",
  schema: flux2Schema,
  modelId: (params) => params.model,
  catalog: models,
  constraints: imageConstraints,
  estimate,
  finalize,
});

/**
 * Validates submit params for the FLUX.2 route family
 * (`POST https://api.bfl.ai/v1/{model}`). Known models get their exact
 * per-route param surface at compile time (e.g. `steps` is a compile error
 * for flux-2-pro); unknown models fall back to a loose arm with a runtime
 * unknown_model warning.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is a route selector, stripped from the body and interpolated into
 * `.request.url`. BFL has no official JS SDK, so `.toSdk("black-forest-labs")` returns the wire
 * body unchanged. The POST returns an async job (`{ id, polling_url }`), not
 * image bytes — poll `BFL_GET_RESULT_URL` (transport, out of unmodel's
 * scope). Auth is your job: add an `x-key` header when fetching.
 *
 * ```ts
 * const params = blackForestLabs.image({
 *   model: "flux-2-pro",
 *   prompt: "a tiny cabin in a snowy forest at dusk",
 *   width: 1024,
 *   height: 1024,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "x-key": process.env.BFL_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const { id, polling_url } = await res.json(); // then poll polling_url
 * ```
 */
export const image = validator as unknown as {
  <M extends Flux2Body["model"], T extends Flux2Arm<M>>(
    params: T & Flux2Arm<M> & { model: M } & ExactKeys<T, Flux2Arm<M>>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>;
  safe<M extends Flux2Body["model"], T extends Flux2Arm<M>>(
    params: T & Flux2Arm<M> & { model: M } & ExactKeys<T, Flux2Arm<M>>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
