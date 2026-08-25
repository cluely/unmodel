/**
 * The `.toApi("fal")` engine for **media** requests.
 *
 * A sibling of `./retarget.ts`, not a widening of it, because the two solve
 * different problems and the difference is not cosmetic:
 *
 * | | chat (`./retarget.ts`) | media (here) |
 * |---|---|---|
 * | destinations | ~36 providers | 1 (fal) |
 * | wire shapes | 4 dialects, codec pair per crossing | one hand mapping per **family** |
 * | availability | generated from models.dev | hand table — models.dev has no media availability |
 * | 92% of edges | same-dialect: respell `model`, swap URL | none: every edge crosses shapes |
 *
 * The last row is the whole story. Chat's engine is fast because most hops
 * change one string; there is no such hop here. `kling.video`'s
 * `{ model_name, mode, duration: "5" }` and fal's
 * `{ duration: "5", resolution: "1080p" }` at
 * `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` are the same request in two
 * vocabularies, and nothing but a hand-written, per-family function knows that.
 * So this engine carries no IR, no encoder, no decoder and no dialect table —
 * it is the plumbing around a `map` function that a provider supplies.
 *
 * ## The loss policy, stated normatively
 *
 * The same contract `core/translate/warnings.ts` sets for chat, applied to
 * shapes rather than dialects:
 *
 * - a param the target **cannot express** is an `error` — the retarget fails
 *   and names the param. It is never dropped silently, and never warned: a
 *   dropped `camera_control` produces a different video, not a lossier one.
 * - a param the target expresses **approximately** — a value snapped onto the
 *   target's enum, or derived from two of the source's fields — is exactly one
 *   `approximated_param` warning naming what was asked for and what was
 *   achieved.
 * - **zero warnings therefore means the mapping was exact**, and the golden
 *   fixtures assert it in both directions.
 *
 * ## Where this runs from, and why that matters
 *
 * Not from the endpoint module. Every media pack (`unmodel/video`,
 * `unmodel/tts`, …) reaches its providers' validators through their
 * `unified-<category>.ts` adapter leaves, and those leaves import
 * `./video` / `./tts` directly — so an `api:` wired inside `finalize` would put
 * this engine, and every family's mapping table, into twelve bundles that
 * cannot call `.toApi` at all. The seam is therefore
 * {@link withApiTarget}, applied in the provider's own entry
 * (`src/providers/<p>/index.ts`), which nothing but `unmodel/<p>` imports.
 * `test/bundle-budget.test.ts` asserts the consequence per pack.
 */
import type { Issue } from "../issues";
import { formatIssuePath } from "../issues";
import type { ApiRetargeter, ApiRetargetOutcome, RequestMeta, SdkFormatters } from "../request";
import { attachApi, toValidated } from "../request";
import type { ValidateOptions } from "../options";
import type { ValidateResult } from "../result";
import type { EndpointConstraints } from "../constraint-types";
import { TranslationUnavailableError } from "./errors";
import type { MediaTargetEndpoint } from "./media-endpoints";
import type { TranslationWarning, TranslationWarningInput, Warn } from "./warnings";
import { attachWarnings, createWarningSink } from "./warnings";

export { TranslationUnavailableError } from "./errors";

/**
 * What a family's `map` is handed.
 *
 * Two callbacks, and the split *is* the loss policy: `warn` records something
 * the target could still express, `unsupported` refuses something it cannot.
 * A mapper that only ever calls `warn` is claiming every crossing is
 * expressible, which is the failure mode this seam exists to prevent.
 */
export interface MediaMapContext {
  /**
   * Records an approximation. Codecs supply `code`, `path`, `message` and
   * `meta`; the route is stamped on by the engine.
   */
  readonly warn: Warn;
  /**
   * Refuses a source param the target has no way to express. The retarget
   * fails with this issue, so the message must name the param, the target
   * endpoint and the reason — the `Issue` discipline from `../issues`.
   */
  unsupported(input: { readonly path: Array<string | number>; readonly message: string }): void;
}

/**
 * One overlap row: a source model this target also serves, and how to say the
 * request in the target's vocabulary.
 *
 * `endpoints` is written as a literal tuple at the call site, which is what
 * lets the drift guard assert every id in it against fal's own curated roster,
 * and `ReturnType<row["map"]>` is what lets the *type* half of the table be
 * derived from the runtime half rather than restated — see `MediaApiMember` in
 * `src/retarget/types.ts`.
 *
 * ## Why a row may name more than one route
 *
 * At fal the endpoint id *is* the URL, so facts that are body params elsewhere
 * are path segments here. Kling's `mode` is the clearest case: `"pro"` and
 * `"std"` are `.../v3/pro/text-to-video` and `.../v3/standard/text-to-video`,
 * two endpoints, one model. So route selection is a function of the request,
 * not of the model id alone — and a mode the target has no endpoint for
 * (`"4k"`) is a refusal rather than a promotion to the nearest one, because
 * resolution and price are exactly the facts a retarget is supposed to
 * preserve.
 */
export interface MediaOverlapRow<Params, Body extends object = object> {
  /**
   * Every target route this row may resolve to — for fal, the endpoint ids
   * that ARE the URL path. The first is the canonical one, used when the row
   * declares no {@link route}.
   */
  readonly endpoints: readonly [string, ...string[]];
  /**
   * Picks the route for one request. Returns `undefined` only after calling
   * `ctx.unsupported`, which is what turns "fal has no endpoint for that mode"
   * into a named error instead of a silent substitution.
   */
  readonly route?: (params: Params, ctx: MediaMapContext) => string | undefined;
  /** Source params → the target's wire body. */
  readonly map: (params: Params, ctx: MediaMapContext) => Body;
}

export interface MediaRetargetSpec<Params extends object> {
  /** Source endpoint id, e.g. `"kling.video"` — the label on thrown errors. */
  readonly endpoint: string;
  /** Where the body is going. */
  readonly target: MediaTargetEndpoint;
  /** Reads the source model id out of the params the caller wrote. */
  readonly modelId: (params: Params) => string | undefined;
  /** Source model id → its overlap row. */
  readonly overlap: Readonly<Record<string, MediaOverlapRow<Params>>>;
  /**
   * Model ids this family **deliberately declines** to retarget, each with the
   * reason, so a caller who reaches for one is told why rather than told the
   * model is unknown.
   *
   * The deliberate-exclusion law: an overlap that would need a guess is worse
   * than no overlap, and the guess has to be recorded somewhere a reader will
   * find it. This is that somewhere.
   */
  readonly refusals?: Readonly<Record<string, string>>;
}

/**
 * SDK formatters for a retargeted media body.
 *
 * fal's is `{ input: body }` — the shape `@fal-ai/client`'s
 * `fal.queue.submit(endpointId, { input })` takes, and the same shape
 * `fal.video`'s own `toSdk("fal")` produces, so the two cannot drift.
 * An unknown target gets none, deliberately: a `toSdk` that exists and
 * produces the wrong shape is worse than one that does not exist.
 */
function defaultMediaSdkFor(target: MediaTargetEndpoint, body: object): SdkFormatters {
  switch (target.id) {
    case "fal":
      return { fal: () => ({ input: body }) };
    default:
      return {};
  }
}

/** A retarget that is impossible in this build rather than invalid for this request. */
function structuralFailure(route: string, target: string, message: string): ApiRetargetOutcome {
  return {
    route,
    result: {
      ok: false,
      errors: [
        {
          severity: "error",
          code: "unsupported_capability",
          path: ["model"],
          message,
          meta: { target, structural: true },
        },
      ],
      warnings: [],
    },
    structural: new TranslationUnavailableError(message),
  };
}

/**
 * Builds the `init.api` retargeter for one set of source params.
 *
 * Takes the *params* rather than the finalized body because the model id is
 * frequently not on a media wire body at all — `kling.videoV3` and
 * `elevenlabs.tts` both strip it into `.request.url` — and because a mapping is
 * clearer read against the vocabulary the caller actually wrote.
 */
export function createMediaToApi<Params extends object>(
  spec: MediaRetargetSpec<Params>,
): (params: Params) => ApiRetargeter {
  const { endpoint: source, target } = spec;

  return (params) => (requested) => {
    if (requested !== target.id) {
      return structuralFailure(
        `${source} → ${requested}`,
        requested,
        `unmodel: "${requested}" is not a \`.toApi\` target for ${source}. Media retargeting ships one destination today: "${target.id}".`,
      );
    }

    const modelId = spec.modelId(params);
    const route = `${source} → ${target.id}`;

    if (modelId !== undefined && spec.refusals !== undefined && Object.hasOwn(spec.refusals, modelId)) {
      return structuralFailure(
        route,
        target.id,
        `unmodel: ${route} does not carry "${modelId}" — ${spec.refusals[modelId]}`,
      );
    }

    // Object.hasOwn: a model id like "constructor" must not resolve to an
    // inherited Object.prototype member and be called as a mapping.
    const row =
      modelId !== undefined && Object.hasOwn(spec.overlap, modelId)
        ? spec.overlap[modelId]
        : undefined;
    if (row === undefined) {
      const known = Object.keys(spec.overlap);
      return {
        route,
        result: {
          ok: false,
          errors: [
            {
              severity: "error",
              code: "unsupported_capability",
              path: ["model"],
              ...(modelId !== undefined && { model: modelId }),
              message:
                `"${modelId ?? "(no model)"}" is not in the ${route} overlap table, so unmodel has no ` +
                `hand-verified mapping from this request to a fal endpoint. Mapped models: ${known.join(", ")}.`,
              meta: { target: target.id, available: known },
            },
          ],
          warnings: [],
        },
      };
    }

    // Warnings are buffered rather than stamped as they arrive, because their
    // `to` names the resolved fal endpoint and the route is not known until
    // `row.route` has run. `createWarningSink` stays the single place that
    // stamps a route onto a warning; this only defers when it is called.
    const buffered: TranslationWarningInput[] = [];
    const errors: Issue[] = [];
    const ctx: MediaMapContext = {
      warn: (warning) => {
        buffered.push(warning);
      },
      unsupported: ({ path, message }) => {
        errors.push({
          severity: "error",
          code: "unsupported_param",
          path: [...path],
          ...(modelId !== undefined && { model: modelId }),
          message,
          meta: { target: target.id },
        });
      },
    };

    const endpoint = row.route === undefined ? row.endpoints[0] : row.route(params, ctx);
    // A `route` that returns nothing has already refused; the fallback issue is
    // belt and braces so a mapping bug surfaces as a named error, not a body
    // addressed at the canonical route it just declined.
    if (endpoint === undefined && errors.length === 0) {
      ctx.unsupported({
        path: ["model"],
        message: `unmodel: ${route} has no fal endpoint for this request, and the mapping recorded no reason. This is a bug in unmodel's overlap table for "${modelId ?? "(no model)"}".`,
      });
    }
    const body = row.map(params, ctx);
    if (errors.length > 0 || endpoint === undefined) {
      return { route, result: { ok: false, errors, warnings: [] } };
    }

    const request: RequestMeta = {
      url: target.url(endpoint),
      method: "POST",
      headers: { ...target.headers },
    };
    const sink = createWarningSink(source, `${target.id}.${endpoint}`);
    for (const warning of buffered) sink.push(warning);
    const validated = toValidated(body, request, { sdk: defaultMediaSdkFor(target, body) });
    const out = attachWarnings(validated as object, sink.warnings);
    // Which target this became, for logging and for narrowing on the result.
    // Non-enumerable like everything else that is not the wire body.
    Object.defineProperty(out, "target", {
      value: target.id,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    const result: ValidateResult<object> = { ok: true, params: out, warnings: [], estimate: {} };
    return { route, result } satisfies ApiRetargetOutcome;
  };
}

/**
 * Refuses one source param the target endpoint cannot express.
 *
 * A helper rather than a message written per site, because the sentence is the
 * policy: every refusal names the param, the target endpoint, the reason fal
 * has no equivalent, and — this is the part callers argue with — why unmodel
 * does not simply drop it. Thirty hand-written variants of that sentence would
 * be thirty chances to soften it.
 *
 * `reason` completes "…, which <reason>", so write it as a verb phrase:
 * `"publishes no watermark field"`.
 */
export function refuseParam(
  ctx: MediaMapContext,
  path: Array<string | number>,
  endpoint: string,
  reason: string,
): void {
  ctx.unsupported({
    path,
    message:
      `\`${formatIssuePath(path)}\` cannot be carried to ${endpoint}, which ${reason}. ` +
      "unmodel refuses the retarget rather than dropping the parameter: a dropped parameter " +
      "produces a different result, not a lossier one.",
  });
}

/**
 * Records one approximation — a value the target expresses *nearly*.
 *
 * The counterpart of {@link refuseParam}, and the only other thing a mapping
 * may do with a param it cannot pass through verbatim. `requested` and
 * `achieved` ride on `meta` so a caller can render the pair without parsing
 * the sentence.
 */
export function approximateParam(
  ctx: MediaMapContext,
  path: Array<string | number>,
  detail: {
    readonly requested: unknown;
    readonly achieved: unknown;
    readonly message: string;
    /** The doc or table the approximation was taken from. */
    readonly source?: string;
  },
): void {
  ctx.warn({
    code: "approximated_param",
    path,
    message: detail.message,
    meta: {
      requested: detail.requested,
      achieved: detail.achieved,
      ...(detail.source !== undefined && { source: detail.source }),
    },
  });
}

/**
 * Refuses a string that fits the source's *character* limit but not the
 * target's *byte* limit.
 *
 * Its own helper because the trap is subtle enough to be worth one
 * implementation: several fal endpoints document a UTF-8 **byte** cap
 * (`fal-ai/pixverse/v6/text-to-video`: 2048 bytes) that its generated schema
 * does not carry, while the native side caps *characters*. A visually short
 * prompt of emoji or non-Latin text passes the source and 422s on the wire.
 * Truncating is not the alternative: a silently shortened prompt is a
 * different request.
 */
export function requireByteLength(
  ctx: MediaMapContext,
  path: Array<string | number>,
  value: string,
  maxBytes: number,
  endpoint: string,
): void {
  const bytes = new TextEncoder().encode(value).length;
  if (bytes <= maxBytes) return;
  ctx.unsupported({
    path,
    message:
      `\`${formatIssuePath(path)}\` is ${bytes} UTF-8 bytes, over the ${maxBytes}-byte cap ${endpoint} ` +
      "documents. The cap counts bytes, not characters, so emoji and non-Latin text can push a " +
      "visually short value over it. Shorten the text: unmodel will not truncate it for you.",
  });
}

/**
 * The minimum a validator has to be for {@link withApiTarget} to wrap it —
 * `createValidator`'s public surface, with the result left open.
 */
export interface RetargetableValidator<Params, Result extends object> {
  (params: Params, options?: ValidateOptions<Params>): Result;
  safe(params: Params, options?: ValidateOptions<Params>): ValidateResult<Result>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * Returns `validator` with `.toApi` / `.toApiSafe` hung off every result it
 * produces.
 *
 * **This is the media seam, and its placement is the design.** Chat wires
 * `api:` straight into `finalize`, which is free there — nothing imports a chat
 * endpoint module except its own entry and the `unmodel/chat` registry. Media
 * cannot: twelve category packs reach these same validators through their
 * adapter leaves, and none of them can call `.toApi` (a unified result's
 * declared type has no such member), so wiring it in `finalize` would put the
 * engine and every mapping table into twelve bundles as dead weight. Applying
 * it here — in `src/providers/<p>/index.ts`, the one module only `unmodel/<p>`
 * imports — keeps the packs at exactly the bytes they were.
 *
 * The wrapper is deliberately thin: it does not re-validate, re-shape or
 * re-order anything. `validator` produces the identical result it always did
 * and this adds two non-enumerable members to it, so the enumerable properties
 * are still exactly the wire body and `.request` still describes the *source*
 * endpoint. Mutating the result in place rather than rebuilding it is what
 * keeps that true: `toValidated` defines `request` non-configurable, and a
 * copy would have to re-derive it.
 */
export function withApiTarget<Params, Result extends object>(
  validator: RetargetableValidator<Params, Result>,
  api: (params: Params) => ApiRetargeter,
): RetargetableValidator<Params, Result> {
  const wrapped = (params: Params, options?: ValidateOptions<Params>): Result =>
    attachApi(validator(params, options), api(params));
  wrapped.safe = (params: Params, options?: ValidateOptions<Params>): ValidateResult<Result> => {
    const result = validator.safe(params, options);
    if (!result.ok) return result;
    return { ...result, params: attachApi(result.params, api(params)) };
  };
  wrapped.constraintsFor = (modelId: string): EndpointConstraints[] =>
    validator.constraintsFor(modelId);
  return wrapped;
}

export type { TranslationWarning };
