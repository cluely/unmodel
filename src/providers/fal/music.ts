/**
 * `fal.music` — music generation across fal's queue, at 10 endpoints.
 *
 * `POST https://queue.fal.run/{endpoint}`, flat JSON body,
 * `Authorization: Key <FAL_KEY>`.
 *
 * ## fal files music under `text-to-audio`, which is why the verb is curated
 *
 * The category fal publishes for `fal-ai/lyria2` is the same one it publishes
 * for `fal-ai/elevenlabs/sound-effects/v2` and for every TTS endpoint that is
 * not filed under `text-to-speech`. A generator that trusted it would put sound
 * effects, speech and songs behind one address. So the verb comes from
 * `data/fal/curation.json` and fal's own category is carried into the manifest
 * only so the audit command can diff the roster.
 *
 * ## The length has four spellings and one of them is milliseconds
 *
 * `duration` at MiniMax Music 3, ACE-Step and Stable Audio 3; `seconds_total`
 * at Stable Audio 2.5; `music_duration` at DiffRhythm, where it is a two-member
 * string enum (`"95s" | "285s"`); and `music_length_ms` at ElevenLabs Music,
 * where a bare number means MILLISECONDS. That last one is the reason the
 * canonical word one layer up is `durationSeconds` rather than `duration`: a
 * caller who guessed wrong would get a track a thousand times too long with
 * nothing in the request to say so.
 *
 * ## Two endpoints require lyrics, and unmodel does not invent them
 *
 * `minimax/music-3` requires `lyrics` beside `prompt`, and
 * `fal-ai/minimax-music/v2` requires `lyrics_prompt`. Neither is a canonical
 * word — the vocabulary's `prompt` is a description of the music, not the words
 * — so a request that names only a prompt is refused by fal's own required
 * check, naming the field. That is the honest outcome: the alternative is
 * shipping an empty string and letting the model sing nothing.
 *
 * `fal-ai/diffrhythm` inverts it: `lyrics` is the required input and
 * `style_prompt` is the decoration, so the curated `textParam` is `lyrics` —
 * the one endpoint in this roster where the two words swap places.
 *
 * ## Cost
 *
 * Five of the ten publish a flat per-generation rate (fal's "per audio" and
 * "per generation" wording) and those estimate exactly. The rest bill by the
 * LENGTH of the generated audio — per second at MiniMax Music 3 and ACE-Step,
 * per ten seconds at DiffRhythm, per thirty at Lyria 2, per output minute
 * rounded up at ElevenLabs Music — and the length is the model's answer rather
 * than the request's question at most of them, so those answer `undefined` with
 * a reason from `falPriceNote`.
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
import { FAL_DOC_URLS, FAL_MUSIC_ENDPOINTS, type FalMusicEndpointId } from "./gen/endpoints.gen";
import { FAL_MUSIC_SHAPES } from "./gen/music-narrow.gen";
import { falMusicInputSchema } from "./gen/music-schema.gen";
import { musicModels } from "./gen/models-music.gen";
import type { FalMusicBodyById } from "./gen/music-wire.gen";

export { FAL_MUSIC_ENDPOINTS, type FalMusicEndpointId } from "./gen/endpoints.gen";
export type { FalMusicBodyById, FalMusicResultById } from "./gen/music-wire.gen";

/** One endpoint's request params: its published body, plus the route selector. */
export type FalMusicArm<Id extends string> = { endpoint: Id } &
  (Id extends FalMusicEndpointId ? FalMusicBodyById[Id] : Record<string, unknown>);

/** The widest thing `fal.music` accepts — every curated endpoint's body, keyed. */
export type FalMusicParams = FalMusicArm<FalMusicEndpointId | (string & {})>;

/** `.toSdk("fal")` — the `{ input: body }` shape `@fal-ai/client` takes. */
type FalSdkTargets<B> = { fal: () => { input: B } };

function checkAll(params: FalMusicParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  runFalChecks(
    params.endpoint,
    FAL_MUSIC_SHAPES,
    FAL_DOC_URLS,
    params as Readonly<Record<string, unknown>>,
    ctx,
  );
}

function estimate(params: FalMusicParams) {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  const costUSD = falCostUSD(endpoint, body);
  return costUSD === undefined ? {} : { costUSD };
}

function finalize(params: FalMusicParams): unknown {
  const { endpoint, ...body } = params as Record<string, unknown> & { endpoint: string };
  return toValidated(
    body,
    { url: falQueueUrl(endpoint), method: "POST", headers: JSON_HEADERS },
    { sdk: { fal: () => ({ input: body }) } },
  );
}

const validator = createValidator<FalMusicParams, unknown>({
  endpoint: "fal.music",
  schema: falMusicInputSchema,
  modelId: (params) => params.endpoint,
  catalog: musicModels,
  checks: [checkAll],
  estimate,
  finalize,
});

/**
 * Validates a `fal.music` submit body.
 *
 * The returned object's enumerable properties are the exact fetch JSON body,
 * with `endpoint` stripped into `.request.url`.
 *
 * The POST answers the queue ENVELOPE rather than a track — follow the
 * `response_url` it returns, and remember `status: "COMPLETED"` is not success.
 * See `./urls.ts`.
 *
 * Auth is yours to add: `Authorization: Key <FAL_KEY>`.
 */
export const music = validator as unknown as {
  <Id extends FalMusicEndpointId | (string & {}), T extends FalMusicArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalMusicArm<Id>>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>;
  safe<Id extends FalMusicEndpointId | (string & {}), T extends FalMusicArm<Id>>(
    params: T & { endpoint: Id } & ExactKeys<T, FalMusicArm<Id>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "endpoint">, FalSdkTargets<Omit<T, "endpoint">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
