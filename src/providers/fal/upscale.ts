/**
 * `fal.upscale` — super-resolution for stills and clips, across fal's queue.
 *
 * `POST https://queue.fal.run/{endpoint}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`.
 *
 * ## Ten endpoints, two media, one address
 *
 * The only address in this provider whose OUTPUT modality is not fixed by the
 * verb: `fal-ai/aura-sr` returns an image and `fal-ai/seedvr/upscale/video`
 * returns a clip, so each catalog row's modality is read off that endpoint's own
 * response schema rather than asserted from the category. `fal-ai/seedvr/
 * upscale/image` and `fal-ai/seedvr/upscale/video` are the pair that makes the
 * point: same vendor, same product, same release, and the only thing separating
 * them is whether the source is `image_url` or `video_url`.
 *
 * ## Four endpoints have a real `model` field
 *
 * `topaz/upscale/image/precision`, `topaz/upscale/image/generative`,
 * `topaz/upscale/video/precision` and `fal-ai/esrgan` all declare a top-level
 * `model` naming the restoration NETWORK — `"Standard V2"`, `"Wonder 3.5"`,
 * `"Proteus"`, `"RealESRGAN_x4plus"` — and at Topaz it also selects the RATE.
 * This is the largest concentration of the `model` collision in the roster,
 * which is why the route selector is `endpoint`: if it were `model`, four of
 * these ten endpoints would silently lose the field that decides what they do.
 *
 * ```ts
 * const params = fal.upscale({
 *   endpoint: "topaz/upscale/image/generative",
 *   model: "Wonder 3.5",                     // the WIRE field, sent as written
 *   image_url: "https://example.com/still.png",
 *   upscale_factor: 4,
 * });
 * params.request.url;  // https://queue.fal.run/topaz/upscale/image/generative
 * params.model;        // "Wonder 3.5" — still on the body
 * ```
 *
 * Each is allow-listed per id in `data/fal/curation.json`
 * (`allowsModelProperty`) under risk R6: codegen hard-errors on a top-level
 * `model` property nobody reviewed.
 *
 * ## The multiplier has two spellings and one meaning
 *
 * Nine endpoints call it `upscale_factor` and `fal-ai/esrgan` calls it `scale`;
 * `fal-ai/recraft/upscale/crisp` has neither and picks its own output size. The
 * bounds differ everywhere — 1..4 at Clarity and Topaz, 1..8 at ESRGAN, 1..10
 * at SeedVR, 1.5..3 at FLUX — and each is checked from that endpoint's own IR
 * rather than from a category-wide schema, which is the whole reason
 * `FAL_UPSCALE_SHAPES` exists.
 *
 * ## Cost
 *
 * The category where `undefined` earns its keep hardest, and for one structural
 * reason: an upscaler is billed by the size of its OUTPUT, and the output's size
 * is the INPUT file's dimensions times the factor. A submit body carries a URL,
 * so unmodel never sees the input's dimensions and cannot compute the billed
 * quantity for any of the per-megapixel rows. Topaz bills per 24-megapixel
 * block and conditionally on `model`; FLUX bills per second of output by
 * resolution and mode; ESRGAN and AuraSR bill per COMPUTE second. Only
 * `fal-ai/recraft/upscale/crisp` publishes a flat per-image rate, and it is the
 * only row in this category that reaches `ModelCost`.
 */

import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { runFalChecks } from "./checks";
import { falCostUSD } from "./pricing";
import { falQueueUrl } from "./urls";
import { FAL_DOC_URLS, FAL_UPSCALE_ENDPOINTS, type FalUpscaleEndpointId } from "./gen/endpoints.gen";
import { FAL_UPSCALE_SHAPES } from "./gen/upscale-narrow.gen";
import { falUpscaleInputSchema } from "./gen/upscale-schema.gen";
import { upscaleModels } from "./gen/models-upscale.gen";
import type { FalUpscaleBodyById } from "./gen/upscale-wire.gen";

export { FAL_UPSCALE_ENDPOINTS, type FalUpscaleEndpointId } from "./gen/endpoints.gen";
export type { FalUpscaleBodyById, FalUpscaleResultById } from "./gen/upscale-wire.gen";

/**
 * One endpoint's request params: its published body, plus the route selector.
 *
 * Note what this does NOT strip: `model`, on the four endpoints that declare
 * one. `FalUpscaleBodyById["fal-ai/esrgan"]` types it as the six-value
 * checkpoint enum fal publishes, and it goes on the wire untouched.
 */
export type FalUpscaleArm<Id extends string> = { endpoint: Id } &
  (Id extends FalUpscaleEndpointId ? FalUpscaleBodyById[Id] : Record<string, unknown>);

/** The widest thing `fal.upscale` accepts — every curated endpoint's body, keyed. */
export type FalUpscaleParams = FalUpscaleArm<FalUpscaleEndpointId | (string & {})>;

/** `.toSdk("fal")` — the `{ input: body }` shape `@fal-ai/client` takes. */
type FalSdkTargets<B> = { fal: () => { input: B } };

function checkAll(
  params: FalUpscaleParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  runFalChecks(
    params.endpoint,
    FAL_UPSCALE_SHAPES,
    FAL_DOC_URLS,
    params as Readonly<Record<string, unknown>>,
    ctx,
  );
}

function estimate(params: FalUpscaleParams) {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  const costUSD = falCostUSD(endpoint, body);
  return costUSD === undefined ? {} : { costUSD };
}

function finalize(params: FalUpscaleParams): unknown {
  // `endpoint` comes off; `model` — where fal declares one — does not.
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  return toValidated(
    body,
    { url: falQueueUrl(endpoint), method: "POST", headers: JSON_HEADERS },
    { sdk: { fal: () => ({ input: body }) } },
  );
}

const validator = createValidator<FalUpscaleParams, unknown>({
  endpoint: "fal.upscale",
  schema: falUpscaleInputSchema,
  modelId: (params) => params.endpoint,
  catalog: upscaleModels,
  checks: [checkAll],
  estimate,
  finalize,
});

/**
 * Validates a `fal.upscale` submit body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body.
 * `endpoint` is stripped into `.request.url`; a `model` field, where the
 * endpoint declares one, is a real parameter naming the restoration network and
 * stays.
 *
 * The POST answers the queue ENVELOPE rather than an image or a clip — follow
 * the `response_url` it returns, and remember `status: "COMPLETED"` is not
 * success. See `./urls.ts`.
 *
 * Auth is yours to add: `Authorization: Key <FAL_KEY>`.
 */
export const upscale = validator as unknown as {
  <Id extends FalUpscaleEndpointId | (string & {}), T extends FalUpscaleArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalUpscaleArm<Id>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>;
  safe<Id extends FalUpscaleEndpointId | (string & {}), T extends FalUpscaleArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalUpscaleArm<Id>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
