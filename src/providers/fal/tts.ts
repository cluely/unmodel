/**
 * `fal.tts` — text to speech across fal's queue, at 23 endpoints.
 *
 * `POST https://queue.fal.run/{endpoint}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`.
 *
 * ## The widest disagreement in the provider, on the simplest operation
 *
 * Twenty-three endpoints from ten vendors, and they cannot agree on what to
 * call the words. Fourteen say `text`; nine — Kokoro, Gemini and MiniMax's 2.8
 * generation — say `prompt`, which everywhere else in this library means "a
 * description of what to make" rather than "the thing to say". The curated
 * `textParam` in `data/fal/curation.json` is what records which is which, and
 * it is hand-maintained because no rule reads it off a schema: both are plain
 * required strings.
 *
 * `fal-ai/qwen-3-tts/text-to-speech/1.7b` declares BOTH, and means different
 * things by them — `text` is spoken, `prompt` is a style instruction.
 *
 * ## `fal-ai/gemini-tts` has a real `model` field
 *
 * `"gemini-2.5-flash-tts" | "gemini-2.5-pro-tts"`, and it doubles the price.
 * The `fal-ai/sync-lipsync/v2` situation in the speech category: the route is
 * selected by the `endpoint` pseudo-param and `model` stays an ordinary body
 * field, allow-listed per id under risk R6.
 *
 * ## `output_format` is not always a format
 *
 * At `fal-ai/gemini-tts` it is `wav | mp3 | ogg_opus` — a codec. At
 * `fal-ai/minimax/speech-02-hd` it is `url | hex`, which decides whether the
 * audio comes back as a link or as a hex string: a DELIVERY switch wearing a
 * codec's name. At `xai/tts/v1` it is an OBJECT with `codec`, `sample_rate` and
 * `bit_rate` inside it. Three endpoints, one parameter name, three unrelated
 * meanings — which is why this provider never hoists a shared "common fal
 * params" fragment and why every bound and vocabulary is read per endpoint from
 * `FAL_TTS_SHAPES`.
 *
 * ## Cost
 *
 * The best-priced category at fal, and the only one where an estimate is exact:
 * twenty-two of the twenty-three endpoints publish a flat per-1,000-character
 * rate, the request states the characters, and `falCostUSD` multiplies. The
 * exception is `fal-ai/gemini-tts`, which fal quotes per million input and
 * output TOKENS with a doubling for the pro model — no request body counts
 * those, so it answers `undefined` with a reason from `falPriceNote`.
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
import { FAL_DOC_URLS, FAL_TTS_ENDPOINTS, type FalTtsEndpointId } from "./gen/endpoints.gen";
import { FAL_TTS_SHAPES } from "./gen/tts-narrow.gen";
import { falTtsInputSchema } from "./gen/tts-schema.gen";
import { ttsModels } from "./gen/models-tts.gen";
import type { FalTtsBodyById } from "./gen/tts-wire.gen";

export { FAL_TTS_ENDPOINTS, type FalTtsEndpointId } from "./gen/endpoints.gen";
export type { FalTtsBodyById, FalTtsResultById } from "./gen/tts-wire.gen";

/**
 * One endpoint's request params: its published body, plus the route selector.
 *
 * The narrowing is what makes twenty-three voice catalogs usable from one
 * address: `FalTtsBodyById["fal-ai/kokoro/japanese"]["voice"]` is that
 * endpoint's own five-value enum, and `fal-ai/kokoro/french`'s is the single
 * literal `"ff_siwis"`.
 */
export type FalTtsArm<Id extends string> = { endpoint: Id } &
  (Id extends FalTtsEndpointId ? FalTtsBodyById[Id] : Record<string, unknown>);

/** The widest thing `fal.tts` accepts — every curated endpoint's body, keyed. */
export type FalTtsParams = FalTtsArm<FalTtsEndpointId | (string & {})>;

/** `.toSdk("fal")` — the `{ input: body }` shape `@fal-ai/client` takes. */
type FalSdkTargets<B> = { fal: () => { input: B } };

function checkAll(params: FalTtsParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  runFalChecks(
    params.endpoint,
    FAL_TTS_SHAPES,
    FAL_DOC_URLS,
    params as Readonly<Record<string, unknown>>,
    ctx,
  );
}

function estimate(params: FalTtsParams) {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  const costUSD = falCostUSD(endpoint, body);
  return costUSD === undefined ? {} : { costUSD };
}

function finalize(params: FalTtsParams): unknown {
  // `endpoint` comes off; `model` — at `fal-ai/gemini-tts` — does not.
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  return toValidated(
    body,
    { url: falQueueUrl(endpoint), method: "POST", headers: JSON_HEADERS },
    { sdk: { fal: () => ({ input: body }) } },
  );
}

const validator = createValidator<FalTtsParams, unknown>({
  endpoint: "fal.tts",
  schema: falTtsInputSchema,
  modelId: (params) => params.endpoint,
  catalog: ttsModels,
  checks: [checkAll],
  estimate,
  finalize,
});

/**
 * Validates a `fal.tts` submit body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body.
 * `endpoint` is stripped into `.request.url`; `model`, at the one endpoint that
 * declares one, is a real parameter and stays.
 *
 * The POST answers the queue ENVELOPE rather than audio — follow the
 * `response_url` it returns, and the RESULT document is where `audio.url`
 * lives. See `./urls.ts`.
 *
 * Auth is yours to add: `Authorization: Key <FAL_KEY>`.
 */
export const tts = validator as unknown as {
  <Id extends FalTtsEndpointId | (string & {}), T extends FalTtsArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalTtsArm<Id>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>;
  safe<Id extends FalTtsEndpointId | (string & {}), T extends FalTtsArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalTtsArm<Id>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
