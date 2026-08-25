/**
 * What `.toApi(provider)` hands back.
 *
 * A full one-hop `Validated`-shaped object, not a plain `{ body, request }`
 * pair: the whole point of `.toApi` is "now go call that provider", and every
 * consumer of the result wants exactly what a normal validation gives — a
 * spreadable wire body, `.request`, an SDK formatter. A bare pair would force
 * `JSON.stringify(result.body)` at every call site and break the muscle memory
 * the library has already established.
 */
import type { RequestMeta } from "../core/request";
import type { ValidateResult } from "../core/result";
import type { TranslationWarning } from "../core/translate/warnings";
import type { DialectBody, DialectOf, DialectSdkResult, DialectSdkTargets } from "./dialects";
import type { ApiTargetId, MediaApiTargetId } from "./ids";

/**
 * The retargeted request for provider `P` serving that provider's model `M`.
 *
 * **No `.toApi` on the result — one hop only.** `a.toApi("openrouter").toApi("groq")`
 * is semantically identical to `a.toApi("groq")`, and supporting it would
 * force every dialect module to carry every provider's availability map. The
 * second hop is a compile error, by construction.
 */
export type Retargeted<P extends ApiTargetId, M extends string> = DialectBody<DialectOf<P>, M> & {
  /**
   * SDK targets of the *target's* dialect, shaped for the target that was
   * asked for. Non-enumerable.
   *
   * The result is keyed on `K`, not on the dialect, so `openai.chat.completions
   * .create(r.toSdk("openai"))` type-checks without a cast — and so a target
   * added to `DialectSdkMap`'s key set without a declared shape is a compile
   * error rather than a confident lie about the wrong one.
   */
  toSdk<K extends DialectSdkTargets<DialectOf<P>>>(target: K): DialectSdkResult<DialectOf<P>, M, K>;
  /** The target's URL, method and static non-auth headers. Non-enumerable. */
  request: RequestMeta;
  /** The provider this was retargeted to. Non-enumerable. */
  readonly target: P;
  /**
   * What the translation cost. Non-enumerable, so the enumerable properties
   * stay exactly the wire body. Empty means the translation was lossless —
   * that is a contract, not a coincidence (see `core/translate/warnings.ts`).
   */
  readonly warnings: readonly TranslationWarning[];
};

// ---------------------------------------------------------------------------
// Media retargeting — `.toApi("fal")` on a validated native media request
// ---------------------------------------------------------------------------

/**
 * What `.toApi("fal")` hands back: fal's own published body for the endpoint
 * the mapping resolved to, plus the same four non-enumerable members every
 * retargeted result carries.
 *
 * Deliberately NOT `Retargeted`: that type is keyed by chat *dialect*, and
 * media has none — every provider's body is its own shape, which is exactly
 * why the mapping is a hand table per family. `Body` is therefore supplied by
 * the family's overlap table rather than derived from a dialect map.
 *
 * **No second hop**, same as chat: `.toApi` is absent from the result, because
 * the only thing a fal body could retarget *to* is another fal body.
 */
export type MediaRetargeted<P extends MediaApiTargetId, Body extends object> = Body & {
  /**
   * `{ input: body }` — the shape `@fal-ai/client`'s
   * `fal.queue.submit(endpointId, { input })` takes, and the same shape
   * `fal.video`'s own `toSdk("fal")` produces. Non-enumerable.
   */
  toSdk<K extends P>(target: K): { input: Body };
  /**
   * fal's queue submit URL, method and static non-auth headers.
   * Non-enumerable. Auth is yours: `authorization: Key <FAL_KEY>`.
   */
  request: RequestMeta;
  /** The target this was retargeted to. Non-enumerable. */
  readonly target: P;
  /**
   * What the mapping cost. Non-enumerable, so the enumerable properties stay
   * exactly fal's wire body. Empty means the mapping was exact — a contract,
   * not a coincidence (see `core/translate/media-retarget.ts`).
   */
  readonly warnings: readonly TranslationWarning[];
};

/**
 * A family's overlap table, at the type level: the source model ids fal also
 * serves, each mapped to fal's body for the endpoint it lands on.
 *
 * Every table is *derived* from its runtime twin rather than written twice —
 * `{ [K in keyof typeof OVERLAP]: ReturnType<(typeof OVERLAP)[K]["map"]> }` —
 * so a mapping whose return type changes cannot leave the declared `.toApi`
 * result behind.
 */
export type MediaOverlapTable = Readonly<Record<string, object>>;

/**
 * The `.toApi` / `.toApiSafe` pair a media validator's result carries, or
 * `unknown` when this model has no mapping.
 *
 * `unknown` rather than a permissive union, and that is the one place this
 * differs from chat's `ToApiMember`. Chat degrades an unrecognised model to the
 * full target union because models.dev is a snapshot that lags a model's
 * release by days, and refusing to compile would be worse than a runtime
 * throw. There is no snapshot here: the overlap table is hand-written, and a
 * model that is not in it has no hand-verified mapping *by definition*. So
 * `.toApi` simply does not exist there — `kling.video({ model_name: "kling-v1", … }).toApi`
 * is a compile error naming a member that is not on the type, which is the
 * honest answer, and intersecting `unknown` costs nothing on the models that
 * do have one.
 */
export type MediaApiMember<Overlap extends MediaOverlapTable, Model extends string> =
  Model extends keyof Overlap
    ? Overlap[Model] extends object
      ? {
          /**
           * Retargets this validated request to fal, returning a fetch-ready
           * body for the fal endpoint that serves the same model.
           *
           * Throws `UnmodelValidationError` when the request uses something fal
           * cannot express (the mapping refuses rather than dropping it), and
           * `TranslationUnavailableError` when the retarget is structurally
           * impossible — an unknown target id, or a model this family
           * deliberately declines to carry.
           */
          toApi<P extends MediaApiTargetId>(target: P): MediaRetargeted<P, Overlap[Model]>;
          /**
           * `toApi` without exceptions for mapping failures — needed because a
           * `safe()` caller has explicitly opted out of them.
           */
          toApiSafe<P extends MediaApiTargetId>(
            target: P,
          ): ValidateResult<MediaRetargeted<P, Overlap[Model]>>;
        }
      : unknown
    : unknown;
