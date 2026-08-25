/**
 * `fal.avatar` — making a still speak, across fal's queue.
 *
 * `POST https://queue.fal.run/{endpoint}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`.
 *
 * ## Why this is not `fal.lipsync`
 *
 * `fal-ai/sync-lipsync/v3` and `fal-ai/sync-lipsync/v3/image-to-video` are one
 * vendor's one model behind two routes, and they land at two different
 * addresses here. The reason is the only thing that differs, and it is the
 * whole request: one takes `video_url` and preserves a performance, the other
 * takes `image_url` and invents one. A single address would mean one validator
 * whose required parameter is a clip at six endpoints and a still at eight, and
 * whose type could say neither.
 *
 * ## Two of the eight take no picture at all
 *
 * `veed/avatars/audio-to-video` and `argil/avatars/audio-to-video` are the
 * interesting rows: their performer is a catalogued id (`avatar_id`,
 * `avatar`) out of a closed enum of trained presenters, so there is no
 * `image_url` on the wire and nowhere for a still to go. They are the reason
 * `unmodel/avatar` narrows `image` per model rather than requiring it — see
 * `core/unified/vocabulary/avatar.ts` — and at THIS surface they are simply
 * two endpoints whose published body has different keys, which the generated
 * `FAL_AVATAR_SHAPES` rows already say.
 *
 * ## Cost
 *
 * The best-priced category in this provider: five of the eight publish a flat
 * per-second or per-minute rate. Five reach `ModelCost.perVideoSecond` or are
 * stated as `per_video_minute`; only `fal-ai/longcat-single-avatar` is
 * conditional (on `resolution`). Even the flat ones bill on a duration the
 * request does not carry — the clip's length follows the input audio's — so
 * `falCostUSD` still answers `undefined` and the rate reaches a caller through
 * the catalog row rather than through an estimate.
 *
 * ```ts
 * const params = fal.avatar({
 *   endpoint: "fal-ai/sync-lipsync/v3/image-to-video",
 *   image_url: "https://example.com/headshot.png",
 *   audio_url: "https://example.com/vo.wav",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Key ${process.env.FAL_KEY}` },
 *   body: JSON.stringify(params),
 * });
 * const { response_url } = await res.json(); // then GET that; never construct it
 * ```
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
import { FAL_DOC_URLS, FAL_AVATAR_ENDPOINTS, type FalAvatarEndpointId } from "./gen/endpoints.gen";
import { FAL_AVATAR_SHAPES } from "./gen/avatar-narrow.gen";
import { falAvatarInputSchema } from "./gen/avatar-schema.gen";
import { avatarModels } from "./gen/models-avatar.gen";
import type { FalAvatarBodyById } from "./gen/avatar-wire.gen";

export { FAL_AVATAR_ENDPOINTS, type FalAvatarEndpointId } from "./gen/endpoints.gen";
export type { FalAvatarBodyById, FalAvatarResultById } from "./gen/avatar-wire.gen";

/**
 * One endpoint's request params: its published body, plus the route selector.
 *
 * The by-id map is what makes `avatar_id` typed as VEED's 28-value enum on
 * `veed/avatars/audio-to-video` and a compile error everywhere else — a union
 * of arms could not do it, because `ExactKeys` against a union reads `keyof` as
 * the key intersection. See `./image.ts` for the measurement.
 */
export type FalAvatarArm<Id extends string> = { endpoint: Id } &
  (Id extends FalAvatarEndpointId ? FalAvatarBodyById[Id] : Record<string, unknown>);

/** The widest thing `fal.avatar` accepts — every curated endpoint's body, keyed. */
export type FalAvatarParams = FalAvatarArm<FalAvatarEndpointId | (string & {})>;

/** `.toSdk("fal")` — the `{ input: body }` shape `@fal-ai/client` takes. */
type FalSdkTargets<B> = { fal: () => { input: B } };

function checkAll(
  params: FalAvatarParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  runFalChecks(
    params.endpoint,
    FAL_AVATAR_SHAPES,
    FAL_DOC_URLS,
    params as Readonly<Record<string, unknown>>,
    ctx,
  );
}

function estimate(params: FalAvatarParams) {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  const costUSD = falCostUSD(endpoint, body);
  return costUSD === undefined ? {} : { costUSD };
}

function finalize(params: FalAvatarParams): unknown {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  return toValidated(
    body,
    { url: falQueueUrl(endpoint), method: "POST", headers: JSON_HEADERS },
    { sdk: { fal: () => ({ input: body }) } },
  );
}

const validator = createValidator<FalAvatarParams, unknown>({
  endpoint: "fal.avatar",
  schema: falAvatarInputSchema,
  modelId: (params) => params.endpoint,
  catalog: avatarModels,
  checks: [checkAll],
  estimate,
  finalize,
  promptPath: ["prompt"],
});

/**
 * Validates a `fal.avatar` submit body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body —
 * `endpoint` is a route selector, stripped from the body and interpolated into
 * `.request.url`. The POST answers the queue ENVELOPE rather than a clip:
 * follow the `response_url` it hands back, and remember `status: "COMPLETED"`
 * is not success. See `./urls.ts`.
 *
 * Auth is yours to add: `Authorization: Key <FAL_KEY>`.
 */
export const avatar = validator as unknown as {
  <Id extends FalAvatarEndpointId | (string & {}), T extends FalAvatarArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalAvatarArm<Id>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>;
  safe<Id extends FalAvatarEndpointId | (string & {}), T extends FalAvatarArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalAvatarArm<Id>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
