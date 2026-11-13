/**
 * Black Forest Labs FLUX tools — POST https://api.bfl.ai/v1/flux-tools/{tool}
 * (`outpainting-v1`, `erase-v1`, `deblur-v1`, `vto-v1`, `vto-v2`).
 *
 * Wire notes (verified against https://api.bfl.ai/openapi.json and
 * https://docs.bfl.ml/llms.txt on 2026-08-13):
 * - Each tool is a single fixed route with its own tiny schema, so each gets
 *   its own endpoint fn (mirroring the docs) rather than one discriminated
 *   union. Only `vto` takes a model selector, because v1 and v2 share one
 *   schema (Flux2KleinTryonInputs) and differ only in output resolution.
 * - The tools are FLUX.2-backed, so `safety_tolerance` is 0–7 here
 *   (`maximum: 7` on FluxOutpaintingInputs, Flux2EraseInputs,
 *   Flux2DeblurInputs and Flux2KleinTryonInputs, verified 2026-11-12; the
 *   FLUX.1 routes allow 0–6) and `output_format` defaults to "png" on
 *   outpainting/erase/deblur but "jpeg" on VTO. Every tool also takes the
 *   optional `user` every BFL schema carries.
 * - Outpainting differs from FLUX.1 Expand: instead of per-side margins it
 *   takes a target canvas (`width`/`height`, both REQUIRED, ≥ 64, product
 *   ≤ 4 MP) plus an optional reference offset; `mode` trades quality for
 *   speed and `auto_crop` decides whether an over-hanging input errors or is
 *   cropped. Its schema is closed (`additionalProperties: false`) and, unlike
 *   the other three tools, declares no `seed`, `webhook_url` or
 *   `webhook_secret`, so those are denied on it (verified 2026-11-12).
 * - Erase requires a black/white `mask` the same size as the image
 *   (white = remove); `dilate_pixels` grows it by 0–25 px.
 * - Pricing is per megapixel (./pricing.ts). Outpainting is estimated
 *   exactly from its canvas and `mode`; erase and deblur bill on the input's
 *   size, which the request does not carry, and VTO has no per-route rate, so
 *   those three estimate nothing.
 * - ASYNC-JOB API: the POST returns `{ id, polling_url }`; polling is
 *   transport — out of scope. Auth is an `x-key` header.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { DenyRule, EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import { bflModelUrl, bflUserField, BFL_OUTPUT_FORMATS, type BflOutputFormat } from "./image";
import { outpaintingCostUSD } from "./pricing";

const OPENAPI_URL = "https://api.bfl.ai/openapi.json";
const OUTPAINTING_SCHEMA_URL = `${OPENAPI_URL}#/components/schemas/FluxOutpaintingInputs`;
const OUTPAINTING_DOCS_URL = "https://docs.bfl.ml/flux_tools/flux_outpainting";

export const FLUX_OUTPAINTING_MODEL_ID = "flux-tools/outpainting-v1";
export const FLUX_ERASE_MODEL_ID = "flux-tools/erase-v1";
export const FLUX_DEBLUR_MODEL_ID = "flux-tools/deblur-v1";
export const DEFAULT_VTO_MODEL_ID = "flux-tools/vto-v2";

export const FLUX_OUTPAINTING_URL = bflModelUrl(FLUX_OUTPAINTING_MODEL_ID);
export const FLUX_ERASE_URL = bflModelUrl(FLUX_ERASE_MODEL_ID);
export const FLUX_DEBLUR_URL = bflModelUrl(FLUX_DEBLUR_MODEL_ID);

/** Quality/speed trade-off on the outpainting route. */
export const FLUX_OUTPAINTING_MODES = ["high", "fast"] as const;
export type FluxOutpaintingMode = (typeof FLUX_OUTPAINTING_MODES)[number];

/** Max mask dilation on the erase route (Flux2EraseInputs). */
export const FLUX_ERASE_MAX_DILATE_PIXELS = 25;

/** Smallest documented output side on the outpainting canvas. */
export const FLUX_TOOLS_MIN_DIMENSION = 64;

/**
 * Largest outpainting canvas, `width × height` in pixels: "The target canvas
 * area (`width × height`) cannot exceed 4 megapixels (4,194,304 pixels). …
 * Requests above this limit return `422`." (https://docs.bfl.ml/flux_tools/flux_outpainting,
 * verified 2026-11-12; the OpenAPI schema states only `minimum: 64` per side).
 */
export const FLUX_OUTPAINTING_MAX_PIXELS = 4_194_304;

// ---------------------------------------------------------------------------
// Shared tail: every tool schema carries moderation, output format and `user`;
// erase, deblur and VTO also take a seed and the webhook pair, which
// FluxOutpaintingInputs does not declare.
// ---------------------------------------------------------------------------

interface FluxToolCommonFields {
  /**
   * Moderation strictness 0 (strictest) – 7 (least strict). Default 2. Your
   * organization's approved ceiling may be lower (a 422 lists it).
   */
  safety_tolerance?: number;
  /** Output image format. */
  output_format?: BflOutputFormat | null;
  /** Opaque end-user identifier from the calling platform: 1–256 chars, no NUL. */
  user?: string | null;
}

/** Flux2EraseInputs, Flux2DeblurInputs and Flux2KleinTryonInputs only. */
interface FluxToolSeedWebhookFields {
  /** Optional seed for reproducibility. */
  seed?: number | null;
  /** URL (1–2083 chars) to receive the async result instead of polling. */
  webhook_url?: string | null;
  /** Secret for webhook signature verification. */
  webhook_secret?: string | null;
}

const commonShape = {
  safety_tolerance: z.number().int().min(0).max(7).optional(),
  output_format: z.enum(BFL_OUTPUT_FORMATS).nullable().optional(),
  user: bflUserField,
};

const seedWebhookShape = {
  seed: z.number().int().nullable().optional(),
  webhook_url: z.string().min(1).max(2083).nullable().optional(),
  webhook_secret: z.string().nullable().optional(),
};

// ---------------------------------------------------------------------------
// Outpainting (FluxOutpaintingInputs)
// ---------------------------------------------------------------------------

export interface FluxOutpaintingParams extends FluxToolCommonFields {
  /** Base64-encoded reference image or HTTP(S) image URL. REQUIRED. */
  input_image: string;
  /** Target output width, ≥ 64; `width × height` ≤ 4 MP. REQUIRED. */
  width: number;
  /** Target output height, ≥ 64; `width × height` ≤ 4 MP. REQUIRED. */
  height: number;
  /** Crop the input to the canvas instead of erroring when it overhangs. Default false. */
  auto_crop?: boolean;
  /** Experimental text guidance for the outpainted region. */
  prompt?: string | null;
  /** Left offset (px) of the reference image on the canvas; null centers it. */
  reference_offset_x?: number | null;
  /** Top offset (px) of the reference image on the canvas; null centers it. */
  reference_offset_y?: number | null;
  /** "high" (default, highest fidelity) or "fast". */
  mode?: FluxOutpaintingMode;
  /** Skip the image-aware prompt upsampler for lower latency. Default false. */
  disable_pup?: boolean;
  /** FluxOutpaintingInputs declares no seed (closed schema: a 422). */
  seed?: never;
  /** No webhook delivery on outpainting: poll the returned `polling_url`. */
  webhook_url?: never;
  /** No webhook delivery on outpainting: poll the returned `polling_url`. */
  webhook_secret?: never;
}

const outpaintingSchema = z.looseObject({
  ...commonShape,
  input_image: z.string().min(1, "input_image is required"),
  width: z
    .number()
    .int()
    .min(FLUX_TOOLS_MIN_DIMENSION, `width must be at least ${FLUX_TOOLS_MIN_DIMENSION} pixels`),
  height: z
    .number()
    .int()
    .min(FLUX_TOOLS_MIN_DIMENSION, `height must be at least ${FLUX_TOOLS_MIN_DIMENSION} pixels`),
  auto_crop: z.boolean().optional(),
  prompt: z.string().nullable().optional(),
  reference_offset_x: z.number().int().nullable().optional(),
  reference_offset_y: z.number().int().nullable().optional(),
  mode: z.enum(FLUX_OUTPAINTING_MODES).optional(),
  disable_pup: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Erase (Flux2EraseInputs)
// ---------------------------------------------------------------------------

export interface FluxEraseParams extends FluxToolCommonFields, FluxToolSeedWebhookFields {
  /** Base64-encoded input image or HTTP(S) image URL. REQUIRED. */
  image: string;
  /**
   * Black/white mask (base64 or URL) the same size as `image`: white pixels
   * mark the object to remove, black pixels are preserved. REQUIRED.
   */
  mask: string;
  /** Dilate the mask by 0–25 px before removal to cover object edges. Default 10. */
  dilate_pixels?: number;
}

const eraseSchema = z.looseObject({
  ...commonShape,
  ...seedWebhookShape,
  image: z.string().min(1, "image is required"),
  mask: z.string().min(1, "mask is required"),
  dilate_pixels: z
    .number()
    .int()
    .min(0, `dilate_pixels must be between 0 and ${FLUX_ERASE_MAX_DILATE_PIXELS}`)
    .max(
      FLUX_ERASE_MAX_DILATE_PIXELS,
      `dilate_pixels must be between 0 and ${FLUX_ERASE_MAX_DILATE_PIXELS}`,
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// Deblur (Flux2DeblurInputs)
// ---------------------------------------------------------------------------

export interface FluxDeblurParams extends FluxToolCommonFields, FluxToolSeedWebhookFields {
  /** Base64-encoded input image or HTTP(S) image URL. REQUIRED. No prompt needed. */
  image: string;
}

const deblurSchema = z.looseObject({
  ...commonShape,
  ...seedWebhookShape,
  image: z.string().min(1, "image is required"),
});

// ---------------------------------------------------------------------------
// Virtual try-on (Flux2KleinTryonInputs, shared by vto-v1 and vto-v2)
// ---------------------------------------------------------------------------

export interface FluxVtoParams extends FluxToolCommonFields, FluxToolSeedWebhookFields {
  /**
   * Route selector — stripped from the wire body. Defaults to
   * `flux-tools/vto-v2` (identical request shape, up to 4MP output).
   */
  model?: "flux-tools/vto-v1" | "flux-tools/vto-v2" | (string & {});
  /** Text prompt steering the try-on. REQUIRED. */
  prompt: string;
  /** Person image (maps internally to input_image). REQUIRED. */
  person: string;
  /** Image of one or more garments (maps internally to input_image_2). REQUIRED. */
  garment: string;
}

const vtoSchema = z.looseObject({
  ...commonShape,
  ...seedWebhookShape,
  model: z.string().optional(),
  prompt: z.string(),
  person: z.string().min(1, "person is required"),
  garment: z.string().min(1, "garment is required"),
});

// ---------------------------------------------------------------------------
// Constraints — outpainting's closed schema (see the module header).
// ---------------------------------------------------------------------------

const OUTPAINTING_CLOSED = `FluxOutpaintingInputs is closed (\`additionalProperties: false\`) and declares no \`seed\`, \`webhook_url\` or \`webhook_secret\` (${OUTPAINTING_DOCS_URL}: "The endpoint rejects unknown fields")`;

const OUTPAINTING_NO_WEBHOOK: DenyRule = {
  reason: `${OUTPAINTING_CLOSED}; the route delivers results only by polling the \`polling_url\` the POST returns`,
  source: OUTPAINTING_SCHEMA_URL,
};

const outpaintingConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  [FLUX_OUTPAINTING_MODEL_ID]: {
    deny: {
      seed: {
        reason: `${OUTPAINTING_CLOSED}; the route offers no seed`,
        source: OUTPAINTING_SCHEMA_URL,
      },
      webhook_url: OUTPAINTING_NO_WEBHOOK,
      webhook_secret: OUTPAINTING_NO_WEBHOOK,
    },
  },
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * "The target canvas area (`width × height`) cannot exceed 4 megapixels
 * (4,194,304 pixels)", and "Requests above this limit return `422`"
 * ({@link FLUX_OUTPAINTING_MAX_PIXELS}). Exactly 4 MP passes — the page allows
 * "at or below 4 MP". Fast mode's note that a canvas "right at the 4 MP limit
 * may be rejected because of the added padding" is hedged, so it is not
 * enforced.
 */
function checkOutpaintingCanvas(
  params: FluxOutpaintingParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const pixels = params.width * params.height;
  if (pixels <= FLUX_OUTPAINTING_MAX_PIXELS) return;
  ctx.report({
    code: "invalid_shape",
    path: ["width"],
    message: `\`width × height\` (${params.width}×${params.height} = ${pixels} px) exceeds the 4 MP outpainting canvas: "The target canvas area (\`width × height\`) cannot exceed 4 megapixels (4,194,304 pixels)." Any aspect ratio within 4,194,304 px is accepted.`,
    meta: { value: pixels, source: OUTPAINTING_DOCS_URL },
  });
}

/**
 * `auto_crop: false` (the default) makes an overhanging reference image an
 * error server-side, so a negative offset without auto_crop is worth calling
 * out — the offsets are documented as "negative values are allowed", so this
 * stays a warning-free no-op unless the offset provably pushes the reference
 * off the canvas on the axis unmodel can reason about (x/y origin only).
 */
function checkOutpaintingOffsets(
  params: FluxOutpaintingParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const pairs = [
    ["reference_offset_x", params.reference_offset_x, params.width] as const,
    ["reference_offset_y", params.reference_offset_y, params.height] as const,
  ];
  for (const [field, offset, extent] of pairs) {
    if (offset == null || typeof extent !== "number") continue;
    if (offset < extent) continue;
    ctx.report({
      code: "invalid_shape",
      path: [field],
      message: `\`${field}\` (${offset}) places the reference image entirely outside the ${extent}px canvas.`,
      meta: {
        value: offset,
        source: `${OPENAPI_URL}#/components/schemas/FluxOutpaintingInputs`,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — per-megapixel rates live in ./pricing.ts, not on the catalog
// rows: no tools row carries `cost.perImage`, so `estimate` yields nothing for
// erase, deblur and VTO, and outpainting computes its exact price.
// ---------------------------------------------------------------------------

function estimate(_params: unknown, info: ModelInfo | undefined) {
  const perImage = info?.cost?.perImage;
  return perImage === undefined ? {} : { costUSD: perImage };
}

/**
 * Exact: the `width × height` canvas is the billed output (see ./pricing.ts),
 * for every canvas the route accepts (≤ 4 MP — `checkOutpaintingCanvas`
 * refuses the rest). Runs only on params the schema accepted, so both sides
 * and `mode` are valid.
 */
function estimateOutpainting(params: FluxOutpaintingParams) {
  return { costUSD: outpaintingCostUSD(params) };
}

/**
 * The one `.toSdk("black-forest-labs")` target for this endpoint — BFL ships
 * no official JS SDK, so this is the wire body. Derived from the `sdk`
 * literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type BflSdkTargets<B> = { "black-forest-labs": () => B };

function finalizeTo(modelId: string) {
  return (params: object): unknown => {
    const body = { ...params };
    return toValidated(body, {
      url: bflModelUrl(modelId),
      method: "POST",
      headers: JSON_HEADERS,
    }, {
      sdk: { "black-forest-labs": () => body },
    });
  };
}

const outpaintingValidator = createValidator<FluxOutpaintingParams, unknown>({
  endpoint: "black-forest-labs.imageEditOutpainting",
  schema: outpaintingSchema,
  modelId: () => FLUX_OUTPAINTING_MODEL_ID,
  catalog: models,
  constraints: outpaintingConstraints,
  checks: [checkOutpaintingCanvas, checkOutpaintingOffsets],
  estimate: estimateOutpainting,
  finalize: finalizeTo(FLUX_OUTPAINTING_MODEL_ID),
});

const eraseValidator = createValidator<FluxEraseParams, unknown>({
  endpoint: "black-forest-labs.imageEditErase",
  schema: eraseSchema,
  modelId: () => FLUX_ERASE_MODEL_ID,
  catalog: models,
  estimate,
  finalize: finalizeTo(FLUX_ERASE_MODEL_ID),
});

const deblurValidator = createValidator<FluxDeblurParams, unknown>({
  endpoint: "black-forest-labs.imageEditDeblur",
  schema: deblurSchema,
  modelId: () => FLUX_DEBLUR_MODEL_ID,
  catalog: models,
  estimate,
  finalize: finalizeTo(FLUX_DEBLUR_MODEL_ID),
});

const vtoValidator = createValidator<FluxVtoParams, unknown>({
  endpoint: "black-forest-labs.imageEditVto",
  schema: vtoSchema,
  modelId: (params) => params.model ?? DEFAULT_VTO_MODEL_ID,
  catalog: models,
  estimate,
  finalize: (params) => {
    const { model, ...body } = params;
    return toValidated(body, {
      url: bflModelUrl(model ?? DEFAULT_VTO_MODEL_ID),
      method: "POST",
      headers: JSON_HEADERS,
    }, {
      sdk: { "black-forest-labs": () => body },
    });
  },
});

/** Fixed-route tools: no `model` wire field, so the body is the params. */
interface FluxToolValidator<P> {
  <T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions<T>,
  ): Validated<T, BflSdkTargets<T>>;
  safe<T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, BflSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * Validates params for `POST https://api.bfl.ai/v1/flux-tools/outpainting-v1`
 * — places the input image on a `width` × `height` canvas and generates the
 * surrounding region.
 *
 * The returned object's enumerable props are the exact fetch JSON body;
 * `.toSdk("black-forest-labs")` returns it unchanged (BFL ships no official JS SDK). The POST
 * returns an async job — poll `BFL_GET_RESULT_URL`. Auth is your job: add an
 * `x-key` header when fetching.
 */
export const imageEditOutpainting =
  outpaintingValidator as unknown as FluxToolValidator<FluxOutpaintingParams>;

/**
 * Validates params for `POST https://api.bfl.ai/v1/flux-tools/erase-v1` —
 * mask-driven object removal (white = remove, black = keep).
 */
export const imageEditErase = eraseValidator as unknown as FluxToolValidator<FluxEraseParams>;

/**
 * Validates params for `POST https://api.bfl.ai/v1/flux-tools/deblur-v1` —
 * blur removal; no prompt needed.
 */
export const imageEditDeblur = deblurValidator as unknown as FluxToolValidator<FluxDeblurParams>;

/**
 * Validates params for the FLUX virtual try-on routes
 * (`POST https://api.bfl.ai/v1/flux-tools/vto-v2`, default, or `/vto-v1`).
 * `model` is a route selector, stripped from the body into `.request.url`.
 */
export const imageEditVto = vtoValidator as unknown as {
  <T extends FluxVtoParams>(
    params: T & ExactKeys<T, FluxVtoParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>;
  safe<T extends FluxVtoParams>(
    params: T & ExactKeys<T, FluxVtoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, BflSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
