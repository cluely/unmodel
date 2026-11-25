/**
 * The shared half of the three generated `higgsfield.*` addresses: the
 * factory that turns one address's tables into a validator.
 *
 * Not an address itself and not exported from `unmodel/higgsfield` — there is
 * no `higgsfield.submit`. Higgsfield serves every generation route from ONE
 * URL template, `POST https://api.higgsfield.ai/<endpoint>`, and
 * `docs/decisions.md` §2 says an address names what the caller is doing
 * (`image`, `video`), never the wire path. So each verb module is a header
 * and one call over this one, and they differ only in which ids they type and
 * which rows they carry.
 *
 * # Two parameters that are not body fields
 *
 * - `endpoint` — the route id. Higgsfield's bodies have no `model` field: the
 *   model IS the path, and Higgsfield's own pages label it "Endpoint ID". It
 *   is stripped into `.request.url`.
 * - `hf_webhook` — the completion webhook, which the API reads from the
 *   QUERY string and nowhere else. Stripped into `.request.url` too.
 *
 * # Nothing else is touched
 *
 * The validated object is the body the caller wrote: no key added, removed or
 * defaulted, and an explicit `null` stays one. That is the library's rule
 * everywhere, and Higgsfield gives it teeth: an `Idempotency-Key` replay
 * fingerprints the body, and "Array order, omitted fields, explicit `null`
 * values, and different URLs do matter"
 * (https://docs.higgsfield.ai/docs/concepts/idempotency.md) — an omitted
 * field and its explicit default are two different requests.
 *
 * `Idempotency-Key` and `Hf-Expires-After` are per-request headers the caller
 * chooses, so they are not parameters here: `./urls.ts` exports their names
 * and bounds.
 *
 * # One gate for every route, and it types no body key
 *
 * `gen/input-schema.gen.ts` is the pipeline schema of BOTH output types. A
 * finding from the pipeline's schema layer fails the request whatever
 * `options.severity` says, so that layer holds only what is true of every
 * request: `endpoint` and `hf_webhook` are strings. Every route is the same
 * URL template, so an image route's id at `higgsfield.video`, an id unmodel
 * deliberately does not type and an id newer than the snapshot all build a
 * request the API may fulfil, and a typed key there would refuse it. What a
 * route types, requires, ranges and enumerates is `./checks.ts`, per route.
 */

import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { findMediaDeclaration } from "../../core/media/check";
import { runSubmitChecks, type HiggsfieldCheckSpec, type HiggsfieldView } from "./checks";
import type { HiggsfieldEndpointId } from "./gen/endpoints.gen";
import { HIGGSFIELD_RATES } from "./gen/pricing.gen";
import { higgsfieldInputSchema } from "./gen/input-schema.gen";
import { HIGGSFIELD_CONTRADICTED_PRICING_CAVEAT, higgsfieldCostUSD } from "./pricing";
import type { HiggsfieldRate } from "./pricing-types";
import type { HiggsfieldEndpointShape } from "./shape-types";
import { submitUrl } from "./urls";

export interface SubmitSpec {
  /** The address: `"higgsfield.video"`. */
  readonly endpoint: string;
  /** The catalog rows of the address's output type. */
  readonly catalog: Record<string, ModelInfo>;
  /** The shape rows of the address's output type. */
  readonly shapes: Readonly<Record<string, HiggsfieldEndpointShape>>;
  /** The ids this address serves; narrower than `shapes` on a view. */
  readonly ids: readonly string[];
  /** Present on a narrower view. */
  readonly view?: HiggsfieldView;
  /** The other wide addresses' ids, for the signpost on a foreign id. */
  readonly elsewhere: Readonly<Record<string, readonly string[]>>;
}

/**
 * What an address serving the ids `Own` takes for the route `Id`: its own
 * body when the id is one of them, a loose body for an id unmodel has no row
 * for, and nothing at all for a generated id that belongs to another address.
 *
 * A by-id indexed access and not a union of arms: a union of a hundred object
 * types re-instantiates at every comparison site, and cannot express
 * `ExactKeys` per arm.
 */
export type HiggsfieldArm<Id extends string, Own extends string, BodyById> = {
  /** The route id — the path of `POST https://api.higgsfield.ai/<endpoint>`. Never sent in the body. */
  endpoint: Id;
  /** The `hf_webhook` query parameter: an HTTPS URL Higgsfield POSTs the outcome to. Never sent in the body. */
  hf_webhook?: string;
} & (Id extends Own
  ? BodyById[Id & keyof BodyById]
  : Id extends HiggsfieldEndpointId
    ? never
    : Record<string, unknown>);

/** The wire body of validated params: everything but the two URL parameters. */
export type HiggsfieldBody<T> = Omit<T, "endpoint" | "hf_webhook">;

/**
 * `.toSdk("higgsfield")` — the second argument of
 * `higgsfield.subscribe(endpoint, …)` in `@higgsfield/client/v2`, which sends
 * `input` as the flat body and builds `?hf_webhook=` from `webhook.url`
 * (`@higgsfield/client@0.2.6`, `dist/v2/client.js`).
 *
 * Without `hf_webhook` it is `{ input }`, which the client's
 * `SubscribeOptions` takes as written. With one (`Hook`) it also carries
 * `webhook: { url }`, so the client builds the same URL `.request.url` is —
 * and that value is NOT assignable to `SubscribeOptions`, on purpose: the
 * client types `webhook` as `{ url: string; secret: string }`
 * (`dist/v2/client.d.ts`), its v2 code never reads `secret`, and unmodel does
 * not invent one. Spread your own in:
 * `{ ...sdk, webhook: { ...sdk.webhook, secret } }`.
 */
export type HiggsfieldSdkTargets<T, Hook extends string = never> = {
  higgsfield: () => [Hook] extends [never]
    ? { input: HiggsfieldBody<T> }
    : string extends Hook
      ? { input: HiggsfieldBody<T>; webhook?: { url: string } }
      : { input: HiggsfieldBody<T>; webhook: { url: string } };
};

/**
 * The public call signature of an address serving the ids `Own`.
 *
 * `Hook` is inferred from `hf_webhook` alone and stays `never` when the
 * params carry none, which is what lets `.toSdk("higgsfield")` say whether it
 * has a `webhook`. `T` cannot answer that: it is inferred as the route's
 * whole arm, where `hf_webhook` is always an optional key. A literal URL makes
 * `webhook` definite; a plain `string` (which an optional property widens
 * `string | undefined` to) leaves it optional, because that value may be
 * absent.
 */
export interface SubmitValidator<Own extends string, BodyById> {
  <Id extends Own | (string & {}), T extends HiggsfieldArm<Id, Own, BodyById>, Hook extends string = never>(
    params: T & { endpoint: Id; hf_webhook?: Hook } & ExactKeys<T, HiggsfieldArm<Id, Own, BodyById>>,
    options?: ValidateOptions<T>,
  ): Validated<HiggsfieldBody<T>, HiggsfieldSdkTargets<T, Hook>>;
  safe<Id extends Own | (string & {}), T extends HiggsfieldArm<Id, Own, BodyById>, Hook extends string = never>(
    params: T & { endpoint: Id; hf_webhook?: Hook } & ExactKeys<T, HiggsfieldArm<Id, Own, BodyById>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<HiggsfieldBody<T>, HiggsfieldSdkTargets<T, Hook>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * What an address returns for a body a unified adapter compiled: the same
 * `Validated`, at a route id the type does not narrow by. `Wire` is the
 * adapter's body, `endpoint` included.
 *
 * Stated here and not taken as `ReturnType` of the validator, which a generic
 * call signature collapses. `webhook` is optional on `.toSdk("higgsfield")`
 * because a unified call can carry `hf_webhook` only through
 * `providerOptions.higgsfield`, which no type sees.
 */
export type HiggsfieldCompiledResult<Wire> = Validated<HiggsfieldBody<Wire>, HiggsfieldSdkTargets<Wire, string>>;

type AnyParams = { endpoint: string; hf_webhook?: string } & Record<string, unknown>;

const GATE_KEYS: ReadonlySet<string> = new Set(Object.keys(higgsfieldInputSchema.shape));

export function createSubmitValidator<Own extends string, BodyById>(spec: SubmitSpec): SubmitValidator<Own, BodyById> {
  const checkSpec: HiggsfieldCheckSpec = {
    shapes: spec.shapes,
    ids: spec.ids,
    elsewhere: spec.elsewhere,
    gateKeys: GATE_KEYS,
    ...(spec.view !== undefined && { view: spec.view }),
  };

  function check(params: AnyParams, _info: ModelInfo | undefined, ctx: PipelineContext): void {
    runSubmitChecks(checkSpec, params, ctx);
  }

  function estimate(params: AnyParams, _info: ModelInfo | undefined, ctx: PipelineContext): ValidateEstimate {
    const { endpoint, hf_webhook, ...body } = params;
    // An id this address does not serve was not checked, so it is not priced.
    if (!spec.ids.includes(endpoint)) return {};
    const rate: HiggsfieldRate | undefined = Object.hasOwn(HIGGSFIELD_RATES, endpoint)
      ? HIGGSFIELD_RATES[endpoint as keyof typeof HIGGSFIELD_RATES]
      : undefined;
    // A route billed on a source clip is priced from the duration the caller
    // declares for it; the body only links to the clip.
    const sourceSeconds =
      rate?.sourceParam === undefined ? undefined : findMediaDeclaration(ctx.options.media, [rate.sourceParam])?.durationSeconds;
    const costUSD = higgsfieldCostUSD(endpoint, body, sourceSeconds === undefined ? {} : { sourceSeconds });
    if (costUSD === undefined) return {};
    if (rate?.contradicted === true) {
      ctx.report({
        code: "unconfirmed_cost",
        path: [],
        model: endpoint,
        message:
          `The $${costUSD} estimate for ${endpoint} is computed from a rate Higgsfield contradicts itself on. ${HIGGSFIELD_CONTRADICTED_PRICING_CAVEAT} ` +
          "`POST estimateUrl(endpoint)` with the same body answers the amount for your account.",
        meta: { costUSD, source: rate.source, verified: rate.verified },
      });
    }
    return { costUSD };
  }

  function finalize(params: AnyParams): unknown {
    const { endpoint, hf_webhook, ...body } = params;
    return toValidated(
      body,
      { url: submitUrl(endpoint, hf_webhook), method: "POST", headers: JSON_HEADERS },
      {
        sdk: {
          higgsfield: () => (hf_webhook === undefined ? { input: body } : { input: body, webhook: { url: hf_webhook } }),
        },
      },
    );
  }

  const validator = createValidator<AnyParams, unknown>({
    endpoint: spec.endpoint,
    schema: higgsfieldInputSchema,
    // Only a route with a row is a catalog id. What any other value is — a
    // route another address types, one unmodel deliberately does not, a new
    // one, or no route id at all — the battery says, at `endpoint`.
    modelId: (params) => (Object.hasOwn(spec.catalog, params.endpoint) ? params.endpoint : undefined),
    catalog: spec.catalog,
    checks: [check],
    estimate,
    finalize,
  });
  return validator as unknown as SubmitValidator<Own, BodyById>;
}
