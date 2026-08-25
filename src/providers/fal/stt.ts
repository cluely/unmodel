/**
 * `fal.stt` — transcription across fal's queue, at 6 endpoints.
 *
 * `POST https://queue.fal.run/{endpoint}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`.
 *
 * ## Audio arrives as a REFERENCE, always
 *
 * Every endpoint here takes `audio_url` and nothing else: fal has no multipart
 * transcription route, so there is no `Blob` arm to offer and no upload step to
 * document. What a caller may send is an https URL fal will fetch, or a `data:`
 * URI carrying the bytes inline — the same two shapes every other file input at
 * this provider takes.
 *
 * ## Six endpoints, three surfaces
 *
 * `fal-ai/wizper` is Whisper v3 with fal's own chunker: a 99-language enum, a
 * `task` that also translates, and two `const` properties (`chunk_level`,
 * `version`) that lower to single-value enums. `fal-ai/speech-to-text` and its
 * turbo arm are the minimal surface — the audio and a punctuation switch, no
 * language field at all. The two ElevenLabs Scribe generations bring `diarize`,
 * which is the only place in this category the canonical `diarization` word has
 * anywhere to go, and Scribe v2 adds `keyterms` — which is also what makes its
 * price conditional.
 *
 * `fal-ai/whisper` is GONE, replaced by `fal-ai/wizper`; the `/stream` variants
 * of `fal-ai/speech-to-text` are excluded from the roster because a socket is a
 * different transport rather than a different model.
 *
 * ## Cost
 *
 * Priced by the DURATION of the input audio, which a submit body never carries
 * — it carries a URL. So the rates are transcribed and the estimates are
 * `undefined`: `$0.0008` per second at fal's own ASR, `$0.03` per minute at
 * Scribe v1, `+30%` at Scribe v2 when `keyterms` are used, and
 * `fal-ai/wizper` is billed per COMPUTE second, which is not predictable at all.
 * `falPriceNote` says which of those applies.
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
import { FAL_DOC_URLS, FAL_STT_ENDPOINTS, type FalSttEndpointId } from "./gen/endpoints.gen";
import { FAL_STT_SHAPES } from "./gen/stt-narrow.gen";
import { falSttInputSchema } from "./gen/stt-schema.gen";
import { sttModels } from "./gen/models-stt.gen";
import type { FalSttBodyById } from "./gen/stt-wire.gen";

export { FAL_STT_ENDPOINTS, type FalSttEndpointId } from "./gen/endpoints.gen";
export type { FalSttBodyById, FalSttResultById } from "./gen/stt-wire.gen";

/** One endpoint's request params: its published body, plus the route selector. */
export type FalSttArm<Id extends string> = { endpoint: Id } &
  (Id extends FalSttEndpointId ? FalSttBodyById[Id] : Record<string, unknown>);

/** The widest thing `fal.stt` accepts — every curated endpoint's body, keyed. */
export type FalSttParams = FalSttArm<FalSttEndpointId | (string & {})>;

/** `.toSdk("fal")` — the `{ input: body }` shape `@fal-ai/client` takes. */
type FalSdkTargets<B> = { fal: () => { input: B } };

function checkAll(params: FalSttParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  runFalChecks(
    params.endpoint,
    FAL_STT_SHAPES,
    FAL_DOC_URLS,
    params as Readonly<Record<string, unknown>>,
    ctx,
  );
}

function estimate(params: FalSttParams) {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  const costUSD = falCostUSD(endpoint, body);
  return costUSD === undefined ? {} : { costUSD };
}

function finalize(params: FalSttParams): unknown {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  return toValidated(
    body,
    { url: falQueueUrl(endpoint), method: "POST", headers: JSON_HEADERS },
    { sdk: { fal: () => ({ input: body }) } },
  );
}

const validator = createValidator<FalSttParams, unknown>({
  endpoint: "fal.stt",
  schema: falSttInputSchema,
  modelId: (params) => params.endpoint,
  catalog: sttModels,
  checks: [checkAll],
  estimate,
  finalize,
});

/**
 * Validates a `fal.stt` submit body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body,
 * with `endpoint` stripped into `.request.url`.
 *
 * The POST answers the queue ENVELOPE rather than a transcript — follow the
 * `response_url` it returns, and remember `status: "COMPLETED"` is not success.
 * See `./urls.ts`.
 *
 * Auth is yours to add: `Authorization: Key <FAL_KEY>`.
 */
export const stt = validator as unknown as {
  <Id extends FalSttEndpointId | (string & {}), T extends FalSttArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalSttArm<Id>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>;
  safe<Id extends FalSttEndpointId | (string & {}), T extends FalSttArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalSttArm<Id>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
