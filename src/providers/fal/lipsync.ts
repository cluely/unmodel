/**
 * `fal.lipsync` — redubbing a video clip, across fal's queue.
 *
 * `POST https://queue.fal.run/{endpoint}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`.
 *
 * ## The smallest surface in this provider, and the sharpest `model` trap
 *
 * Eight endpoints, and six of them take exactly two parameters: `video_url`
 * and `audio_url`. What makes the category worth its own address is the
 * seventh: **`fal-ai/sync-lipsync/v2` has a real `model` body field**
 * (`"lipsync-2" | "lipsync-2-pro"`), and it stays on the wire. That is the
 * endpoint this whole provider's routing decision was made for — if the route
 * selector were called `model`, one of the two would silently eat the other,
 * and the request that went out would name a model the caller did not choose.
 *
 * So the selector is `endpoint`, `model` is an ordinary body field wherever fal
 * declares one, and `data/fal/curation.json` allow-lists it explicitly under
 * risk R6: codegen hard-errors on a top-level `model` property that nobody
 * reviewed.
 *
 * ```ts
 * const params = fal.lipsync({
 *   endpoint: "fal-ai/sync-lipsync/v2",
 *   model: "lipsync-2-pro",              // the WIRE field, sent as written
 *   video_url: "https://example.com/take-3.mp4",
 *   audio_url: "https://example.com/vo.wav",
 * });
 * params.request.url;  // https://queue.fal.run/fal-ai/sync-lipsync/v2
 * params.model;        // "lipsync-2-pro" — still on the body
 * ```
 *
 * ## `sync_mode` means two different things one directory apart
 *
 * On `fal-ai/flux/dev` `sync_mode` is a BOOLEAN and means "hand the bytes back
 * inline". On `fal-ai/sync-lipsync/v3` it is a five-arm string enum
 * (`cut_off | loop | bounce | silence | remap`) and means "what to do when the
 * audio and the clip are different lengths". Same name, same provider,
 * unrelated meanings — which is why this provider never hoists a shared "common
 * fal params" fragment, and why every bound and vocabulary is read per endpoint
 * from `FAL_LIPSYNC_SHAPES` rather than from a category-wide schema.
 *
 * ## Cost
 *
 * Mixed, and mostly computable in principle but not from a request body: fal
 * bills these per minute or per second of the OUTPUT clip, whose length is the
 * input clip's, which unmodel never sees. `veed/lipsync/v2` and
 * `fal-ai/kling-video/lipsync/audio-to-video` publish flat per-second rates and
 * reach `ModelCost.perVideoSecond`; `fal-ai/latentsync` is tiered (flat under
 * 40 seconds, per-second after) and `fal-ai/pixverse/lipsync` is conditional on
 * whether you supply audio at all. All of those answer `undefined` with a
 * reason from `falPriceNote`.
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
import { FAL_DOC_URLS, FAL_LIPSYNC_ENDPOINTS, type FalLipsyncEndpointId } from "./gen/endpoints.gen";
import { FAL_LIPSYNC_SHAPES } from "./gen/lipsync-narrow.gen";
import { falLipsyncInputSchema } from "./gen/lipsync-schema.gen";
import { lipsyncModels } from "./gen/models-lipsync.gen";
import type { FalLipsyncBodyById } from "./gen/lipsync-wire.gen";

export { FAL_LIPSYNC_ENDPOINTS, type FalLipsyncEndpointId } from "./gen/endpoints.gen";
export type { FalLipsyncBodyById, FalLipsyncResultById } from "./gen/lipsync-wire.gen";

/**
 * One endpoint's request params: its published body, plus the route selector.
 *
 * Note what this does NOT strip: `model`, on the one endpoint that declares
 * one. `FalLipsyncBodyById["fal-ai/sync-lipsync/v2"]` types it as the
 * two-value enum fal publishes, and it goes on the wire untouched.
 */
export type FalLipsyncArm<Id extends string> = { endpoint: Id } &
  (Id extends FalLipsyncEndpointId ? FalLipsyncBodyById[Id] : Record<string, unknown>);

/** The widest thing `fal.lipsync` accepts — every curated endpoint's body, keyed. */
export type FalLipsyncParams = FalLipsyncArm<FalLipsyncEndpointId | (string & {})>;

/** `.toSdk("fal")` — the `{ input: body }` shape `@fal-ai/client` takes. */
type FalSdkTargets<B> = { fal: () => { input: B } };

function checkAll(
  params: FalLipsyncParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  runFalChecks(
    params.endpoint,
    FAL_LIPSYNC_SHAPES,
    FAL_DOC_URLS,
    params as Readonly<Record<string, unknown>>,
    ctx,
  );
}

function estimate(params: FalLipsyncParams) {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  const costUSD = falCostUSD(endpoint, body);
  return costUSD === undefined ? {} : { costUSD };
}

function finalize(params: FalLipsyncParams): unknown {
  // `endpoint` comes off; `model` — where fal declares one — does not.
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  return toValidated(
    body,
    { url: falQueueUrl(endpoint), method: "POST", headers: JSON_HEADERS },
    { sdk: { fal: () => ({ input: body }) } },
  );
}

const validator = createValidator<FalLipsyncParams, unknown>({
  endpoint: "fal.lipsync",
  schema: falLipsyncInputSchema,
  modelId: (params) => params.endpoint,
  catalog: lipsyncModels,
  checks: [checkAll],
  estimate,
  finalize,
});

/**
 * Validates a `fal.lipsync` submit body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body.
 * `endpoint` is stripped into `.request.url`; a `model` field, where the
 * endpoint declares one, is a real parameter and stays.
 *
 * The POST answers the queue ENVELOPE rather than a clip — follow the
 * `response_url` it returns, and remember `status: "COMPLETED"` is not success.
 * See `./urls.ts`.
 *
 * Auth is yours to add: `Authorization: Key <FAL_KEY>`.
 */
export const lipsync = validator as unknown as {
  <Id extends FalLipsyncEndpointId | (string & {}), T extends FalLipsyncArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalLipsyncArm<Id>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>;
  safe<Id extends FalLipsyncEndpointId | (string & {}), T extends FalLipsyncArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalLipsyncArm<Id>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
