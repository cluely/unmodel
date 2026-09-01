/**
 * `fal.sfx` — sound-effect generation across fal's queue, at 6 endpoints.
 *
 * `POST https://queue.fal.run/{endpoint}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`.
 *
 * ## fal files sound effects under `text-to-audio`, beside music and speech
 *
 * The category fal publishes for `fal-ai/elevenlabs/sound-effects/v2` is
 * exactly the one it publishes for `fal-ai/lyria2`. A generator that trusted it
 * would put a door creak and a three-minute song behind one address, so the
 * verb comes from `data/fal/curation.json` and fal's own category is carried
 * into the manifest only so the audit command can diff the roster. `fal.music`
 * says the same thing from the other side.
 *
 * ## Five vendors, and one of them is a NARROWED reseller
 *
 * ElevenLabs, Sonilo, CassetteAI, Stability and Mirelo. The ElevenLabs route
 * here is not the same surface as `elevenlabs.sfx`: `duration_seconds` caps at
 * **22** rather than 30, `output_format` is a body field rather than a query
 * param, `text` is capped at 450 characters, and there is no `model_id` because
 * the endpoint IS the model. Reaching the same model two ways and getting two
 * different request surfaces is the comparison `unmodel/sfx` exists to make
 * cheap; it is pinned in the golden tree rather than described.
 *
 * ## The length is the category, and it has three different absences
 *
 * `duration_seconds` at ElevenLabs, `duration` at the other four — both in
 * seconds, so unlike music there is no unit conversion. What differs is what
 * omitting it means: ElevenLabs guesses from the prompt, Sonilo generates 8
 * seconds, Mirelo 10, Stable Audio 30, and CassetteAI answers 422 because the
 * field is REQUIRED there. `checkRequired` in the shared battery is what
 * reports that last one, naming the field.
 *
 * ## Cost
 *
 * Three of the six publish a flat per-request rate (fal's "per audio" and "per
 * generation" wording) and those estimate exactly. The other three bill by the
 * LENGTH of the generated audio, which is the model's answer rather than the
 * request's question whenever `duration` is left off, so those answer
 * `undefined` with a reason from `falPriceNote`.
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
import { FAL_DOC_URLS, FAL_SFX_ENDPOINTS, type FalSfxEndpointId } from "./gen/endpoints.gen";
import { FAL_SFX_SHAPES } from "./gen/sfx-narrow.gen";
import { falSfxInputSchema } from "./gen/sfx-schema.gen";
import { sfxModels } from "./gen/models-sfx.gen";
import type { FalSfxBodyById } from "./gen/sfx-wire.gen";

export { FAL_SFX_ENDPOINTS, type FalSfxEndpointId } from "./gen/endpoints.gen";
export type { FalSfxBodyById, FalSfxResultById } from "./gen/sfx-wire.gen";

/** One endpoint's request params: its published body, plus the route selector. */
export type FalSfxArm<Id extends string> = { endpoint: Id } &
  (Id extends FalSfxEndpointId ? FalSfxBodyById[Id] : Record<string, unknown>);

/** The widest thing `fal.sfx` accepts — every curated endpoint's body, keyed. */
export type FalSfxParams = FalSfxArm<FalSfxEndpointId | (string & {})>;

/** `.toSdk("fal")` — the `{ input: body }` shape `@fal-ai/client` takes. */
type FalSdkTargets<B> = { fal: () => { input: B } };

function checkAll(params: FalSfxParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  runFalChecks(
    params.endpoint,
    FAL_SFX_SHAPES,
    FAL_DOC_URLS,
    params as Readonly<Record<string, unknown>>,
    ctx,
  );
}

function estimate(params: FalSfxParams) {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  const costUSD = falCostUSD(endpoint, body);
  return costUSD === undefined ? {} : { costUSD };
}

function finalize(params: FalSfxParams): unknown {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  return toValidated(
    body,
    { url: falQueueUrl(endpoint), method: "POST", headers: JSON_HEADERS },
    { sdk: { fal: () => ({ input: body }) } },
  );
}

const validator = createValidator<FalSfxParams, unknown>({
  endpoint: "fal.sfx",
  schema: falSfxInputSchema,
  modelId: (params) => params.endpoint,
  catalog: sfxModels,
  checks: [checkAll],
  estimate,
  finalize,
});

/**
 * Validates a `fal.sfx` submit body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body,
 * with `endpoint` stripped into `.request.url`.
 *
 * The POST answers the queue ENVELOPE rather than audio — follow the
 * `response_url` it returns, and remember `status: "COMPLETED"` is not success.
 * See `./urls.ts`.
 *
 * Auth is yours to add: `Authorization: Key <FAL_KEY>`.
 */
export const sfx = validator as unknown as {
  <Id extends FalSfxEndpointId | (string & {}), T extends FalSfxArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalSfxArm<Id>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>;
  safe<Id extends FalSfxEndpointId | (string & {}), T extends FalSfxArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalSfxArm<Id>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
