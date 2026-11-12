/**
 * The shared half of every `revana.*` media address: the wire schema of
 * `POST /v1/generations`, and the factory that turns one kind's tables into a
 * validator.
 *
 * Not an address itself and not exported from `unmodel/revana` — there is no
 * `revana.generation`. Revana serves image, video, speech and music from ONE
 * route, and `docs/decisions.md` §2 says an address names what the caller is
 * doing (`video`, `tts`), never the wire path. So each verb module is three
 * lines over this one, and they differ only in which ids they type and which
 * rows they carry.
 *
 * # The schema is deliberately the union
 *
 * Revana documents three input schemas and picks one by `model`
 * (`./generation-wire.ts`). No single zod object is any model's schema, so this one is
 * layer 1 only: every key the API's validators recognise, with its primitive
 * type and the bounds that hold for every model. Which of them a given model
 * takes, and with which values, is `./checks.ts`.
 *
 * Both objects are loose — an unknown key passes through with a warning —
 * for the reason every wire schema in this library is: a router that added
 * eleven models in one afternoon (2026-11-12) will add a field before unmodel
 * hears about it.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { runGenerationChecks, type RevanaView } from "./checks";
import { revanaCostUSD } from "./pricing";
import type { RevanaListedPrice, RevanaModelShape } from "./shape-types";
import { GENERATIONS_URL } from "./urls";
import type { GenerationRequest, RevanaMediaModelId } from "./generation-wire";

/** `ModelInput.seed`: `minimum: 0`, `maximum: 4294967295`. */
const MAX_SEED = 4_294_967_295;
/** `maxLength: 4096` on every media URL. */
const MAX_URL_LENGTH = 4096;
/** `GenerationRequest.max_wait_s`: `maximum: 86400`. */
const MAX_WAIT_SECONDS = 86_400;

const url = z.string().max(MAX_URL_LENGTH);
const urls = z.array(url).min(1);

const inputSchema = z.looseObject({
  // "maxLength: 30000" on ModelInput and SeedanceInput. The tighter caps
  // (music 3000, Nemesis 5000) and the `minLength: 1` that NemesisInput alone
  // lacks are per model, in ./checks.ts.
  prompt: z.string().max(30_000).optional(),
  negative_prompt: z.string().max(5000).optional(),
  image_url: url.optional(),
  end_image_url: url.optional(),
  image_urls: urls.optional(),
  video_url: url.optional(),
  audio_url: url.optional(),
  resolution: z.string().optional(),
  aspect_ratio: z.string().optional(),
  duration: z.number().int().min(1).max(300).optional(),
  audio: z.boolean().optional(),
  quality: z.string().optional(),
  seed: z.number().int().min(0).max(MAX_SEED).optional(),
  num_images: z.number().int().min(1).max(10).optional(),
  n: z.number().int().min(1).max(10).optional(),
  lyrics: z.string().min(1).max(5000).optional(),
  style: z.string().min(1).max(1000).optional(),
  instrumental: z.boolean().optional(),
  task: z.enum(["video_edit", "video_extend"]).optional(),
  // Speech — recognised by the API's validator, absent from its OpenAPI document.
  text: z.string().min(1).optional(),
  voice: z.string().optional(),
  dialogue: z
    .array(z.strictObject({ text: z.string().min(1), voice: z.string().optional() }))
    .min(1)
    .optional(),
  stability: z.number().min(0).max(1).optional(),
  similarity_boost: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.7).max(1.2).optional(),
  language_code: z.string().optional(),
  // SeedanceInput.
  video_urls: urls.optional(),
  audio_urls: urls.optional(),
  // NemesisInput.
  roles: z.array(z.string()).min(1).optional(),
  target_frame: z.boolean().optional(),
  guide: z.string().optional(),
  sound: z.string().optional(),
  face_mesh: z.boolean().optional(),
});

const generationSchema = z.looseObject({
  model: z.string().min(1),
  input: inputSchema,
  task: z.enum(["video_edit", "video_extend"]).optional(),
  // "exclusiveMinimum: 0". The document's `maximum: 100` is not enforced by
  // the API (101 priced normally on 2026-11-12), so it is not enforced here.
  max_cost_usd: z.number().positive().optional(),
  max_wait_s: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional(),
});

type AnyRequest = GenerationRequest<string>;

/**
 * The one `.toSdk("revana")` target. Revana ships no client SDK of its own
 * (its queue page points at fal's, with a URL rewrite), so the target is the
 * wire body unchanged.
 */
type RevanaSdkTargets<B> = { revana: () => B };

export interface GenerationSpec {
  /** The address: `"revana.video"`. */
  readonly endpoint: string;
  /** This kind's catalog rows. */
  readonly catalog: Record<string, ModelInfo>;
  /** This kind's shape rows. */
  readonly shapes: Readonly<Record<string, RevanaModelShape>>;
  /** This kind's listed prices. */
  readonly prices: Readonly<Record<string, RevanaListedPrice>>;
  /** Present on the four narrower views. */
  readonly view?: RevanaView;
  /** The other media addresses' ids, for the signpost on a foreign model id. */
  readonly elsewhere: Readonly<Record<string, readonly string[]>>;
}

/**
 * The request a model id takes at an address that serves `Id`: its own arm
 * when the id is one of them, the loose arm for an id unmodel has no row for,
 * and nothing at all for a known id that belongs to another address.
 */
export type RequestFor<Id extends string, M extends string> = M extends Id
  ? GenerationRequest<M>
  : M extends RevanaMediaModelId
    ? never
    : GenerationRequest<M>;

/**
 * What a call site passes for a model id `M` at an address serving `Id`.
 *
 * `M` is inferred from `model` ALONE (`NoInfer` keeps the rest of the body
 * out of it), and only then is the body's type computed — for that one id.
 * That ordering is the whole design: resolving the request type against the
 * id UNION first, which is what a second inferred type parameter costs, makes
 * TypeScript build every model's input for every call and give up ("union
 * type that is too complex to represent").
 *
 * A side effect worth having: with no inferred body type, an object literal
 * is checked against the concrete request, so an excess key is an error at
 * any depth — `input: { promt: "…" }` does not compile, and neither does a
 * typo at the top level.
 */
type Params<Id extends string, M extends string> = { model: M } & RequestFor<Id, NoInfer<M>>;

/** The public call signature of a media address serving the ids `Id`. */
export interface GenerationValidator<Id extends string> {
  <M extends Id | (string & {})>(
    params: Params<Id, M>,
    options?: ValidateOptions,
  ): Validated<RequestFor<Id, M>, RevanaSdkTargets<RequestFor<Id, M>>>;
  safe<M extends Id | (string & {})>(
    params: Params<Id, M>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<RequestFor<Id, M>, RevanaSdkTargets<RequestFor<Id, M>>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

export function createGenerationValidator<Id extends string>(
  spec: GenerationSpec,
): GenerationValidator<Id> {
  function check(params: AnyRequest, _info: ModelInfo | undefined, ctx: PipelineContext): void {
    runGenerationChecks(params as unknown as Record<string, unknown>, spec, ctx);
  }

  function estimate(params: AnyRequest): ValidateEstimate {
    const { model } = params;
    const costUSD = revanaCostUSD(
      Object.hasOwn(spec.prices, model) ? spec.prices[model] : undefined,
      Object.hasOwn(spec.shapes, model) ? spec.shapes[model] : undefined,
      params.input as Record<string, unknown>,
    );
    return costUSD === undefined ? {} : { costUSD };
  }

  function finalize(params: AnyRequest): unknown {
    const body = { ...params };
    return toValidated(
      body,
      { url: GENERATIONS_URL, method: "POST", headers: JSON_HEADERS },
      { sdk: { revana: () => body } },
    );
  }

  const validator = createValidator<AnyRequest, unknown>({
    endpoint: spec.endpoint,
    schema: generationSchema,
    modelId: (params) => params.model,
    catalog: spec.catalog,
    checks: [check],
    estimate,
    finalize,
  });
  return validator as unknown as GenerationValidator<Id>;
}
