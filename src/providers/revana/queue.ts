/**
 * The shared half of every `revana.*Queue` address: the wire schema of
 * `POST /v1/queue/revana/{model_id}`, and the factory that turns one kind's
 * tables into a validator.
 *
 * # A second route, so a second set of addresses
 *
 * The queue route runs the jobs `POST /v1/generations` runs, and the two are
 * not interchangeable on the wire: a different URL per model, a body with no
 * `{ model, input }` wrapper, a different response, and a completion webhook
 * the generation route does not have. `docs/decisions.md` §2 gives an extra
 * route a qualified address named for what makes it different, so
 * `revana.video` has `revana.videoQueue` beside it, and likewise `image`,
 * `tts` and `music`.
 *
 * Only the four wide addresses have one. `imageEdit`, `upscale`, `lipsync` and
 * `avatar` are views that exist for the unified packs, and the packs compile
 * to the generation route; an edit, an upscale or an avatar request on the
 * queue is a request `imageQueue` or `videoQueue` already validates.
 *
 * # One battery, not two
 *
 * Admission is the generation route's — the queue answers that route's own
 * sentences — so these addresses run `./checks.ts` on the same tables and add
 * only what is the queue's: the two fields it reads its own way
 * (`checkQueueLeniencies`), and `fal_webhook`.
 *
 * # `model` and `fal_webhook` are not body fields
 *
 * Both are read from the URL: `model` is the path and `fal_webhook` the query
 * string, and the API answers `Unrecognized key` to a body carrying either. So
 * the validator takes both as params, strips them, and builds `.request.url`
 * from them — fal's `endpoint` precedent (`../fal/image.ts`). `model` is safe
 * as the name because no Revana input schema has a field called that.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { admittedQueueInput } from "./admitted";
import { REVANA_QUEUE_SOURCE, runGenerationChecks } from "./checks";
import { inputSchema, limitFields, type GenerationSpec, type RevanaSdkTargets } from "./generation";
import { revanaCostUSD } from "./pricing";
import { queueUrl } from "./urls";
import type { RevanaMediaModelId } from "./generation-wire";
import type { QueueBody, QueueRequest } from "./queue-wire";

/** The header a webhook delivery is signed in: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. */
export const REVANA_SIGNATURE_HEADER = "Revana-Signature";
/** `wh_<request id>` — "the same on every retry"; deduplicate on it. */
export const REVANA_WEBHOOK_ID_HEADER = "Revana-Webhook-Id";

const queueSchema = inputSchema.extend({
  model: z.string().min(1),
  fal_webhook: z.string().optional(),
  // A number as on the generation route, or fal's string. Which strings spell
  // a duration is ./checks.ts, where the refusal can say what would.
  duration: z.union([z.number().int().min(1).max(300), z.string()]).optional(),
  ...limitFields,
});

type AnyRequest = QueueRequest<string>;

/** What a queue address is built from: a wide generation address's tables. */
export type QueueSpec = Omit<GenerationSpec, "view">;

/**
 * The request a model id takes at a queue address that serves `Id` — the same
 * three-way split as `RequestFor` in `./generation.ts`.
 */
export type QueueRequestFor<Id extends string, M extends string> = M extends Id
  ? QueueRequest<M>
  : M extends RevanaMediaModelId
    ? never
    : QueueRequest<M>;

/** The body that request becomes: its input fields and limits, without the two URL params. */
export type QueueBodyFor<Id extends string, M extends string> = M extends Id
  ? QueueBody<M>
  : M extends RevanaMediaModelId
    ? never
    : QueueBody<M>;

/** `M` is inferred from `model` alone — see `Params` in `./generation.ts` for why. */
type Params<Id extends string, M extends string> = { model: M } & QueueRequestFor<Id, NoInfer<M>>;

/** The public call signature of a queue address serving the ids `Id`. */
export interface QueueValidator<Id extends string> {
  <M extends Id | (string & {})>(
    params: Params<Id, M>,
    options?: ValidateOptions,
  ): Validated<QueueBodyFor<Id, M>, RevanaSdkTargets<QueueBodyFor<Id, M>>>;
  safe<M extends Id | (string & {})>(
    params: Params<Id, M>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<QueueBodyFor<Id, M>, RevanaSdkTargets<QueueBodyFor<Id, M>>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

export function createQueueValidator<Id extends string>(spec: QueueSpec): QueueValidator<Id> {
  const checkSpec = { shapes: spec.shapes, elsewhere: spec.elsewhere, flat: true };

  function check(params: AnyRequest, _info: ModelInfo | undefined, ctx: PipelineContext): void {
    const { input: wrapped, ...input } = inputOf(params);
    if (params.fal_webhook !== undefined) checkWebhook(params.fal_webhook, params.model, ctx);
    if (wrapped !== undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `The queue route takes the input fields at the top of the body, "without a {model, input} wrapper" — ` +
          `the API answers 'Unrecognized key: "input"'. Move them up, or send this body to \`${ctx.endpoint.replace(/Queue$/, "")}\`.`,
        meta: { source: REVANA_QUEUE_SOURCE },
      });
    }
    runGenerationChecks({ model: params.model, input }, checkSpec, ctx);
  }

  function estimate(params: AnyRequest): ValidateEstimate {
    const { model } = params;
    const costUSD = revanaCostUSD(
      Object.hasOwn(spec.prices, model) ? spec.prices[model] : undefined,
      Object.hasOwn(spec.shapes, model) ? spec.shapes[model] : undefined,
      admittedQueueInput(inputOf(params)),
    );
    return costUSD === undefined ? {} : { costUSD };
  }

  function finalize(params: AnyRequest): unknown {
    const { model, fal_webhook, ...body } = params as Record<string, unknown> & AnyRequest;
    return toValidated(
      body,
      { url: queueUrl(model, fal_webhook), method: "POST", headers: JSON_HEADERS },
      { sdk: { revana: () => body } },
    );
  }

  const validator = createValidator<AnyRequest, unknown>({
    endpoint: spec.endpoint,
    schema: queueSchema,
    modelId: (params) => params.model,
    catalog: spec.catalog,
    checks: [check],
    estimate,
    finalize,
  });
  return validator as unknown as QueueValidator<Id>;
}

/** The input fields of a queue request: everything but the URL params and the two limits. */
function inputOf(params: AnyRequest): Record<string, unknown> {
  const { model, fal_webhook, max_cost_usd, max_wait_s, ...input } = params as Record<string, unknown> & AnyRequest;
  return input;
}

/** Loopback, link-local and the three private IPv4 blocks, as dotted quads. */
const PRIVATE_IPV4 = /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * `fal_webhook` — checked by the API at submit, before the body, and before
 * anything is created or charged (2026-11-12): "Webhook must be a reachable
 * public HTTPS URL on port 443 without credentials or fragments." "Redirects
 * and private addresses are permanently refused … credentials in URLs,
 * fragments and IPv6 targets are unsupported."
 *
 * Everything decidable from the string is decided here. That the host
 * resolves, and resolves to a public address, is the API's to find out.
 */
function checkWebhook(webhook: string, model: string, ctx: PipelineContext): void {
  const fault = webhookFault(webhook);
  if (fault === undefined) return;
  ctx.report({
    code: "invalid_shape",
    path: ["fal_webhook"],
    model,
    message:
      `\`fal_webhook\` ${fault}. Revana refuses the submit — "Webhook must be a reachable public HTTPS URL on ` +
      'port 443 without credentials or fragments" — before it creates or charges anything.',
    meta: { value: webhook, source: REVANA_QUEUE_SOURCE },
  });
}

function webhookFault(webhook: string): string | undefined {
  let url: URL;
  try {
    url = new URL(webhook);
  } catch {
    return "is not a URL";
  }
  if (url.protocol !== "https:") return "must be an `https:` URL";
  if (url.username !== "" || url.password !== "") return "must not carry credentials";
  if (webhook.includes("#")) return "must not have a fragment";
  // `URL` drops an explicit `:443` on https, so anything left is another port.
  if (url.port !== "") return `must be on port 443, not ${url.port}`;
  const host = url.hostname;
  if (host.startsWith("[")) return "must not be an IPv6 address";
  if (host === "localhost" || (IPV4.test(host) && PRIVATE_IPV4.test(host))) {
    return "must be a public address";
  }
  return undefined;
}
