/**
 * `fal.imageEdit` — image-to-image and instruction editing across fal's queue.
 *
 * `POST https://queue.fal.run/{endpoint}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`. The transport, the `endpoint` pseudo-param
 * and the one-schema-plus-IR division of labour are all exactly as `./image.ts`
 * documents them; what follows is what is different about editing.
 *
 * ## The input image is a REFERENCE, never bytes
 *
 * Every editing endpoint here takes its source as a string: an `https:` URL
 * fal fetches, or a `data:` URI carrying small inline bytes. unmodel does not
 * upload files, so a `Buffer`, a `Blob` or a local path is an error naming the
 * two things fal accepts — see `checkMediaRefs` in `./checks.ts`.
 *
 * Which parameter carries it is not uniform, and that is the category's
 * defining awkwardness:
 *
 * | endpoint | source parameter |
 * |---|---|
 * | most of the roster | `image_url` |
 * | `fal-ai/flux-pro/kontext/max/multi`, the nano-banana edits, seedream edits | `image_urls` (a LIST) |
 * | `fal-ai/flux-pro/v1/fill` | `image_url` **plus** `mask_url` — inpainting |
 * | `fal-ai/nano-banana-2/edit` | `image_urls`, and also `video_url` / `audio_url` references |
 *
 * The unified adapter branches on which of those a model's row declares; the
 * hand validator does not have to, because the generated IR already says which
 * parameter each endpoint has and the shared battery reads it.
 *
 * ## Editing prices differently from generating
 *
 * Several endpoints bill across INPUT and output megapixels rather than output
 * alone (`fal-ai/flux-2/edit` resizes inputs to 1 MP and charges for both), and
 * `bytedance/seedream/v5/pro/edit` adds a surcharge per input image beyond the
 * first. None of those is computable from a request body — the input's pixel
 * count is a property of a file at the far end of a URL — so those estimates
 * are `undefined` and `falPriceNote` says why.
 *
 * ```ts
 * const params = fal.imageEdit({
 *   endpoint: "fal-ai/flux-pro/kontext",
 *   prompt: "put the cabin in a snowstorm",
 *   image_url: "https://example.com/cabin.jpg",
 * });
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
import {
  FAL_DOC_URLS,
  FAL_IMAGE_EDIT_ENDPOINTS,
  type FalImageEditEndpointId,
} from "./gen/endpoints.gen";
import { FAL_IMAGE_EDIT_SHAPES } from "./gen/image-edit-narrow.gen";
import { falImageEditInputSchema } from "./gen/image-edit-schema.gen";
import { imageEditModels } from "./gen/models-image-edit.gen";
import type { FalImageEditBodyById } from "./gen/image-edit-wire.gen";

export { FAL_IMAGE_EDIT_ENDPOINTS, type FalImageEditEndpointId } from "./gen/endpoints.gen";
export type { FalImageEditBodyById, FalImageEditResultById } from "./gen/image-edit-wire.gen";

/**
 * One editing endpoint's request params: its published body, plus the route.
 *
 * A by-id indexed access rather than a union of arms, for the reasons measured
 * in `./image.ts`'s header — 2.85x the instantiations, and a union cannot
 * express either `ExactKeys` per arm or a dynamically-typed endpoint id.
 */
export type FalImageEditArm<Id extends string> = { endpoint: Id } &
  (Id extends FalImageEditEndpointId ? FalImageEditBodyById[Id] : Record<string, unknown>);

/** The widest thing `fal.imageEdit` accepts. */
export type FalImageEditParams = FalImageEditArm<FalImageEditEndpointId | (string & {})>;

/**
 * `.toSdk("fal")` — `fal.subscribe(id, { input: body })`, per fal's own client
 * documentation (https://fal.ai/docs/model-apis/client, read 2026-08-24).
 */
type FalSdkTargets<B> = { fal: () => { input: B } };

function checkAll(
  params: FalImageEditParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  runFalChecks(
    params.endpoint,
    FAL_IMAGE_EDIT_SHAPES,
    FAL_DOC_URLS,
    params as Readonly<Record<string, unknown>>,
    ctx,
  );
}

function estimate(params: FalImageEditParams) {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  const costUSD = falCostUSD(endpoint, body);
  return costUSD === undefined ? {} : { costUSD };
}

function finalize(params: FalImageEditParams): unknown {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  return toValidated(
    body,
    { url: falQueueUrl(endpoint), method: "POST", headers: JSON_HEADERS },
    { sdk: { fal: () => ({ input: body }) } },
  );
}

const validator = createValidator<FalImageEditParams, unknown>({
  endpoint: "fal.imageEdit",
  schema: falImageEditInputSchema,
  modelId: (params) => params.endpoint,
  catalog: imageEditModels,
  checks: [checkAll],
  estimate,
  finalize,
  promptPath: ["prompt"],
});

/**
 * Validates a `fal.imageEdit` submit body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body;
 * `endpoint` is stripped into `.request.url`. The POST answers the queue
 * envelope, not image bytes — follow its `response_url`, and remember that
 * `COMPLETED` does not mean success (see `./urls.ts`). Add
 * `Authorization: Key <FAL_KEY>` yourself.
 */
export const imageEdit = validator as unknown as {
  <Id extends FalImageEditEndpointId | (string & {}), T extends FalImageEditArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalImageEditArm<Id>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>;
  safe<Id extends FalImageEditEndpointId | (string & {}), T extends FalImageEditArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalImageEditArm<Id>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
