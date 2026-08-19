import { UnmodelValidationError } from "./issues";
import type { ValidateResult } from "./result";
import type { ApiModelFor, ApiTargetsFor, StaticApiTargetId } from "../retarget/ids";
import type { Retargeted } from "../retarget/types";

/**
 * Metadata for issuing the validated request over raw fetch. Auth headers
 * are deliberately absent — unmodel never touches API keys; add your own
 * `authorization` / `x-api-key` header.
 */
export interface RequestMeta {
  url: string;
  method: "POST";
  /** Static non-auth headers the endpoint requires (e.g. anthropic-version). */
  headers: Record<string, string>;
}

/**
 * `RequestMeta` for the WebSocket CONFIG surfaces (`wss://…`): a validator
 * that describes a socket's configuration rather than an HTTP body still
 * carries a `.request`, but the "request" is the opening handshake — an HTTP
 * GET upgrade, which has no body. What the config maps onto instead depends on
 * the provider: the URL query (Deepgram's live /v1/listen, /v2/listen and
 * /v1/speak) or the first message sent on the open socket (Soniox). Either
 * way `.url` is the socket to open, and auth is absent for the usual reason —
 * unmodel never touches keys.
 *
 * Deliberately a sibling of `RequestMeta` rather than a widening of its
 * `method`: endpoints that speak HTTP keep proving `.request.method === "POST"`
 * at the type level.
 */
export interface SocketMeta {
  url: string;
  /** The WebSocket opening handshake is an HTTP GET upgrade — never a body. */
  method: "GET";
  /**
   * Static non-auth headers for the handshake. Usually empty: browser
   * WebSocket clients cannot set headers, so these APIs authenticate with a
   * subprotocol or an in-band credential instead.
   */
  headers: Record<string, string>;
}

/**
 * Zero-argument formatters keyed by SDK target id, declared per endpoint as a
 * plain object literal whose type is taken with `typeof`. `keyof` this map is
 * the `toSdk` union, which is why SDK targets need no registry: they are a
 * static property of the *endpoint*, not of the model.
 *
 * ⚠️ Two type-level traps, both hit while prototyping this:
 *
 * 1. Never write `interface X extends Record<string, () => unknown>`. The
 *    inherited index signature collapses `keyof X` to `string`, and
 *    `toSdk("literally-anything")` type-checks.
 * 2. An `interface` *without* an index signature is not assignable to
 *    `Record<string, …>`, so it cannot satisfy this constraint either.
 *
 * Both are avoided by deriving the type from the runtime literal with
 * `typeof`, which is the only supported way to declare an endpoint's targets.
 */
export type SdkFormatters = Readonly<Record<string, () => unknown>>;

/**
 * `unknown` when the endpoint declares no API targets, so intersecting it is a
 * no-op and `.toApi` simply does not exist — that is how the ~106 media
 * endpoints opt out, at zero type cost.
 */
type ToApiMember<Avail, Model extends string> = [Avail] extends [never]
  ? unknown
  : {
      /**
       * Retargets this request to any provider that serves the same model —
       * its own included, where the retarget is the identity — returning a
       * fetch-ready body for the target's dialect.
       *
       * Throws `UnmodelValidationError` when the target's own re-validation
       * fails (schema + constraint layers — see `TargetValidation`), and
       * `TranslationUnavailableError` when the retarget is structurally
       * impossible in this build.
       */
      toApi<P extends ApiTargetsFor<Avail, Model>>(
        provider: P,
      ): Retargeted<P & StaticApiTargetId, ApiModelFor<Avail, Model, P>>;
      /**
       * `toApi` without exceptions for validation failures — needed because a
       * `safe()` caller has explicitly opted out of them.
       */
      toApiSafe<P extends ApiTargetsFor<Avail, Model>>(
        provider: P,
      ): ValidateResult<Retargeted<P & StaticApiTargetId, ApiModelFor<Avail, Model, P>>>;
    };

/**
 * The validated output: enumerable properties are the exact wire body (safe to
 * `JSON.stringify` or spread — `toSdk` / `toApi` / `toApiSafe` / `request` are
 * all non-enumerable), `.toSdk(target)` re-shapes it for one of the endpoint's
 * declared SDK targets, `.request` carries the fetch URL/method/static
 * headers, and `.toApi(provider)` retargets to any provider that serves the
 * same model (the home provider included, as the identity retarget).
 *
 * Four type parameters, and `Model` is separate from `Body` on purpose:
 * `toApi`'s union depends on the model id, and the model id is not always on
 * the body — `google.chat` and `elevenlabs.textToSpeech` strip it
 * into `.request.url`. `Validated<Body>` with one argument still means "wire
 * body + `.request`, no targets".
 */
export type Validated<
  Body,
  Sdk extends SdkFormatters = SdkFormatters,
  Avail = never,
  Model extends string = string,
> = Body & {
  toSdk<K extends Extract<keyof Sdk, string>>(target: K): ReturnType<Sdk[K]>;
  request: RequestMeta;
} & ToApiMember<Avail, Model>;

/** One target's retarget outcome, as produced by `createToApi`. */
export interface ApiRetargetOutcome {
  /** `"anthropic.chat → openrouter.chat"` — the label on thrown errors. */
  route: string;
  result: ValidateResult<object>;
  /**
   * Set when the retarget is *structurally* impossible in this build (unknown
   * provider id, a factory-configured target reached through the one-argument
   * call, a dialect pair whose codec has not shipped) rather than invalid for
   * this request.
   *
   * `.toApi` throws it verbatim, so the thrown type stays
   * `TranslationUnavailableError`. `.toApiSafe` does **not** — it reports the
   * same message through `result.errors`. A `safe()` caller opted out of
   * exceptions, and "this build ships no codec for that pair" is precisely the
   * kind of thing they opted out of catching: it is reachable from typed,
   * compiling code (the availability union promises the edge), so making them
   * wrap `safe()` in a `try` would defeat the point of the safe form.
   */
  structural?: Error;
}

/**
 * The runtime half of `.toApi`. Endpoints that offer retargeting pass one
 * (built by `createToApi`); endpoints that don't pass nothing, and then
 * `.toApi` is not defined at runtime either.
 */
export type ApiRetargeter = (target: string) => ApiRetargetOutcome;

export interface ValidatedInit<Sdk extends SdkFormatters> {
  /** SDK target id → zero-arg formatter. `keyof` this is the `toSdk` union. */
  sdk: Sdk;
  /** Present only on endpoints that offer retargeting. */
  api?: ApiRetargeter;
}

/**
 * Builds the validated result.
 *
 * The argument order is `(body, request, init)` — note that `request` moved
 * ahead of the SDK slot. That was deliberate when `.toSdk()` became
 * `.toSdk(target)`: it turns every stale call site into a compile error rather
 * than a silent mis-bind, which is what you want for a mechanical migration
 * across ~186 of them.
 */
export function toValidated<Body extends object, Sdk extends SdkFormatters>(
  body: Body,
  request: RequestMeta,
  init: ValidatedInit<Sdk>,
): Body & {
  toSdk<K extends Extract<keyof Sdk, string>>(target: K): ReturnType<Sdk[K]>;
  request: RequestMeta;
} {
  const out = { ...body };
  const { api } = init;
  Object.defineProperties(out, {
    toSdk: {
      value: (target: string): unknown => {
        // Object.hasOwn: a target named "constructor" must not resolve to an
        // inherited Object.prototype member and get called.
        const formatter = Object.hasOwn(init.sdk, target) ? init.sdk[target] : undefined;
        if (formatter === undefined) {
          throw new TypeError(
            `unmodel: "${target}" is not an SDK target for this endpoint. Available: ${Object.keys(init.sdk).join(", ")}.`,
          );
        }
        return formatter();
      },
      enumerable: false,
    },
    // Deep-copy the request meta so no two validations ever share a headers
    // object — mutating one result's headers (e.g. adding auth) must never
    // leak into another validation.
    request: {
      value: { ...request, headers: { ...request.headers } },
      enumerable: false,
    },
    ...(api !== undefined && {
      toApi: {
        value: (target: string): unknown => {
          const { route, result, structural } = api(target);
          // Structural first, so the thrown type stays
          // `TranslationUnavailableError` rather than collapsing into a
          // validation error that names no fixable param.
          if (structural !== undefined) throw structural;
          if (!result.ok) throw new UnmodelValidationError(route, result.errors, result.warnings);
          return result.params;
        },
        enumerable: false,
      },
      toApiSafe: {
        value: (target: string): ValidateResult<object> => api(target).result,
        enumerable: false,
      },
    }),
  });
  return out as Body & {
    toSdk<K extends Extract<keyof Sdk, string>>(target: K): ReturnType<Sdk[K]>;
    request: RequestMeta;
  };
}

/**
 * `Validated` for a WebSocket config surface: same enumerable-body/`toSdk`
 * contract, with `.request` describing the socket to open ({@link SocketMeta})
 * instead of an HTTP call. No `toApi` — retargeting a socket config across
 * providers is not a thing any dialect codec models.
 */
export type ValidatedSocket<Body, Sdk extends SdkFormatters = SdkFormatters> = Body & {
  toSdk<K extends Extract<keyof Sdk, string>>(target: K): ReturnType<Sdk[K]>;
  request: SocketMeta;
};

/**
 * {@link toValidated} for socket configs. The two casts are the whole point of
 * the function: the runtime behaviour is identical (spread the body, hang
 * non-enumerable `toSdk`/`request` off it, deep-copy the meta), only the
 * *type* of `.request` differs, so the plumbing is shared rather than copied
 * into every realtime module.
 */
export function toValidatedSocket<Body extends object, Sdk extends SdkFormatters>(
  body: Body,
  socket: SocketMeta,
  init: ValidatedInit<Sdk>,
): ValidatedSocket<Body, Sdk> {
  return toValidated(body, socket as unknown as RequestMeta, init) as unknown as ValidatedSocket<
    Body,
    Sdk
  >;
}

/** Frozen so any accidental by-reference mutation fails loudly in dev. */
export const JSON_HEADERS: Record<string, string> = Object.freeze({
  "content-type": "application/json",
});

/**
 * The handshake headers of a WebSocket config surface: none. Frozen for the
 * same reason as {@link JSON_HEADERS} — `toValidatedSocket` copies it, so a
 * caller mutating the copy never reaches this object.
 */
export const NO_HEADERS: Record<string, string> = Object.freeze({});

/**
 * The non-enumerable members every validated / retargeted result carries.
 * They are exempt from `ExactKeys` because the documented composition idiom
 * feeds one result straight into another validator:
 *
 * ```ts
 * const routed = chat({ model: "claude-opus-5", … }).toApi("openrouter");
 * const checked = openrouterChat(routed);   // full catalog-aware pass
 * ```
 *
 * At runtime that is already correct — these members are non-enumerable, so
 * the validator only ever sees the wire body — but at the type level they are
 * excess keys, and without this exemption "just pass it to the target
 * validator" would be advice that does not compile. The cost is that these
 * seven names are no longer caught as typos in a request literal, which is a
 * trade worth making: none of them is a wire param on any endpoint.
 *
 * `modelId` joined the list with `unmodel/chat`. Its result carries the *bare*
 * model id non-enumerably because the ref (`"google/gemini-3-pro"`) is not what
 * any wire body says, and the gemini dialect strips the id into the URL — so
 * composing a compiled chat result into google's own validator reads
 * `chat({ model: result.modelId, ...result })`, which only compiles if
 * `modelId` is exempt here. `target` was already exempt for the same reason;
 * `provider` deliberately is **not** and must never be added: openrouter takes
 * a real wire param called `provider` (its routing block), so exempting it
 * would silence a genuine typo on a real endpoint.
 */
type ValidatedMember =
  | "toSdk"
  | "toApi"
  | "toApiSafe"
  | "request"
  | "warnings"
  | "target"
  | "modelId";

/**
 * Rejects top-level keys that are not part of the endpoint's wire shape.
 * Intersect with the inferred params type in a validator's public cast:
 * `<T extends Body>(params: T & ExactKeys<T, Body>) => ...` turns excess
 * (typo'd) keys into a compile error instead of a silent pass-through.
 */
export type ExactKeys<T, Shape> = {
  [K in Exclude<keyof T, keyof Shape | ValidatedMember>]: never;
};
