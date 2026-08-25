/**
 * `fal.threeD` — 3D asset generation across fal's queue.
 *
 * `POST https://queue.fal.run/{endpoint}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`.
 *
 * ## Nineteen endpoints, seven vendors, two moods
 *
 * The verb is `threeD` rather than `3d` because an endpoint id's second segment
 * is a module EXPORT NAME — `src/cli.test.ts` derives the CLI registry from
 * `Object.entries` over each provider's index — and `3d` is not an identifier.
 * The category id, the package subpath (`unmodel/3d`) and `endpointLabel` all
 * stay `3d`; only the things that have to be typed as identifiers are spelled
 * `threeD`. Same rule the generated file names follow (`three-d-wire.gen.ts`).
 *
 * Nine endpoints take a `prompt`, ten take an image, and
 * `fal-ai/hyper3d/rodin/v2.5` takes either — which is the whole reason the
 * unified row carries an `inputs` list rather than the adapter reading a wire
 * name and guessing.
 *
 * ## The image has four wire names and one of them is a list
 *
 * `image_url` at Tripo, Trellis, Meshy, Hi3D and TripoSR; `input_image_url` at
 * every Hunyuan3D route; `front_image_url` at
 * `tripo3d/tripo/v2.5/multiview-to-3d`, whose other three angles are optional
 * siblings; and `image_urls` — an ARRAY of up to five views — at Rodin. Each is
 * checked from that endpoint's own IR rather than from a category-wide schema,
 * which is what `FAL_THREE_D_SHAPES` is for.
 *
 * ## One endpoint has a real `model` field
 *
 * `hitem3d/hi3d/v3.0/image-to-3d` declares a top-level `model` — a
 * `const "hi3dv3.0"` naming the checkpoint — and it goes on the wire untouched
 * while `endpoint` routes. Allow-listed per id in `data/fal/curation.json`
 * (`allowsModelProperty`) under risk R6.
 *
 * ```ts
 * const params = fal.threeD({
 *   endpoint: "tripo3d/h3.1/text-to-3d",
 *   prompt: "a brass astrolabe on a walnut stand",
 *   texture_quality: "detailed",
 * });
 * params.request.url;  // https://queue.fal.run/tripo3d/h3.1/text-to-3d
 * ```
 *
 * ## Cost
 *
 * Sixteen of the nineteen publish a CONDITIONAL rate — the price of a mesh
 * turns on whether you asked for textures, and at Tripo on the texture quality
 * and the geometry quality and the quad flag, each stacking. Those live in the
 * hand pricing table and reach a caller as an estimate rather than a `ModelCost`
 * row, because a scalar that ignores `texture` would be wrong by a factor of
 * three at Hunyuan3D. Two publish a flat per-generation rate (`fal-ai/trellis`
 * at $0.02, `fal-ai/triposr` at $0.07) and one — `fal-ai/hunyuan3d/v2/turbo` —
 * publishes no rate at all, which its `unpriced` reason says in so many words.
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
import { FAL_DOC_URLS, FAL_THREE_D_ENDPOINTS, type FalThreeDEndpointId } from "./gen/endpoints.gen";
import { FAL_THREE_D_SHAPES } from "./gen/three-d-narrow.gen";
import { falThreeDInputSchema } from "./gen/three-d-schema.gen";
import { threeDModels } from "./gen/models-three-d.gen";
import type { FalThreeDBodyById } from "./gen/three-d-wire.gen";

export { FAL_THREE_D_ENDPOINTS, type FalThreeDEndpointId } from "./gen/endpoints.gen";
export type { FalThreeDBodyById, FalThreeDResultById } from "./gen/three-d-wire.gen";

/**
 * One endpoint's request params: its published body, plus the route selector.
 *
 * Note what this does NOT strip: `model`, on the one endpoint that declares one.
 * `FalThreeDBodyById["hitem3d/hi3d/v3.0/image-to-3d"]` types it as the const
 * fal publishes, and it goes on the wire untouched.
 */
export type FalThreeDArm<Id extends string> = { endpoint: Id } &
  (Id extends FalThreeDEndpointId ? FalThreeDBodyById[Id] : Record<string, unknown>);

/** The widest thing `fal.threeD` accepts — every curated endpoint's body, keyed. */
export type FalThreeDParams = FalThreeDArm<FalThreeDEndpointId | (string & {})>;

/** `.toSdk("fal")` — the `{ input: body }` shape `@fal-ai/client` takes. */
type FalSdkTargets<B> = { fal: () => { input: B } };

function checkAll(
  params: FalThreeDParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  runFalChecks(
    params.endpoint,
    FAL_THREE_D_SHAPES,
    FAL_DOC_URLS,
    params as Readonly<Record<string, unknown>>,
    ctx,
  );
}

function estimate(params: FalThreeDParams) {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  const costUSD = falCostUSD(endpoint, body);
  return costUSD === undefined ? {} : { costUSD };
}

function finalize(params: FalThreeDParams): unknown {
  // `endpoint` comes off; `model` — where fal declares one — does not.
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  return toValidated(
    body,
    { url: falQueueUrl(endpoint), method: "POST", headers: JSON_HEADERS },
    { sdk: { fal: () => ({ input: body }) } },
  );
}

const validator = createValidator<FalThreeDParams, unknown>({
  endpoint: "fal.threeD",
  schema: falThreeDInputSchema,
  modelId: (params) => params.endpoint,
  catalog: threeDModels,
  checks: [checkAll],
  estimate,
  finalize,
});

/**
 * Validates a `fal.threeD` submit body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body.
 * `endpoint` is stripped into `.request.url`; a `model` field, where the
 * endpoint declares one, is a real parameter naming the checkpoint and stays.
 *
 * The POST answers the queue ENVELOPE rather than a mesh — follow the
 * `response_url` it returns, and remember `status: "COMPLETED"` is not success.
 * See `./urls.ts`. The mesh itself arrives as `model_mesh`, `model_glb` or a
 * `model_urls` map of containers, depending on the endpoint.
 *
 * Auth is yours to add: `Authorization: Key <FAL_KEY>`.
 */
export const threeD = validator as unknown as {
  <Id extends FalThreeDEndpointId | (string & {}), T extends FalThreeDArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalThreeDArm<Id>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>;
  safe<Id extends FalThreeDEndpointId | (string & {}), T extends FalThreeDArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalThreeDArm<Id>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
