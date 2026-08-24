/**
 * Caller-side sugar over a validated result's `.request`, kept out of
 * `core/request.ts` on purpose.
 *
 * Nothing in the library calls this — no validator, no codec, no adapter — so
 * folding it in beside `toValidated` would put it in the chunk every provider
 * entry loads, and `test/bundle-budget.test.ts` asks of any growth "whether
 * that entry should be paying for it". `unmodel/groq` should not: it never
 * builds a fetch call. As an import-free leaf reached only from the root entry
 * (its one import is type-only, so nothing survives to runtime), it costs the
 * provider and pack entries zero — the same move `inworld/audio-bytes.ts` and
 * `minimax/models.ts` document.
 */
import type { RequestMeta } from "./request";

/** The arguments a validated JSON request needs, minus credentials. */
export interface FetchArgs {
  url: string;
  method: "POST";
  /** A copy — mutate it freely; `.request.headers` is not reachable from here. */
  headers: Record<string, string>;
  /** `JSON.stringify` of the enumerable wire body. */
  body: string;
}

/**
 * The marker that makes a multipart result fail to compile. Never satisfied;
 * its single property name is the whole error message a caller sees.
 */
type MultipartEndpoint = {
  "unmodel: this endpoint sends multipart/form-data — build the body with its `toFormData` helper": never;
};

/**
 * Builds the four fetch arguments a validated request needs. It never calls
 * `fetch`, and it takes no auth parameter — unmodel never touches API keys, so
 * the `authorization` / `x-api-key` header is added at the call site:
 *
 * ```ts
 * const { url, ...init } = toRequestInit(r);
 * await fetch(url, { ...init, headers: { ...init.headers, authorization } });
 * ```
 *
 * It exists because url, method, static headers and the JSON framing are all
 * things the package already knows and the caller currently retypes — and
 * spreading a result to retype them silently drops `.request`, which is
 * non-enumerable by design.
 *
 * Two whole classes of endpoint cannot reach it, both at compile time: socket
 * configs, whose `SocketMeta.method` is `"GET"`, and the multipart endpoints,
 * which declare `ValidatedForm`. The runtime check is for the one endpoint
 * whose framing is not statically known — `recraft.imageEdit` picks multipart
 * per call, depending on whether an image arrived as a `Blob`.
 */
export function toRequestInit<T extends { request: RequestMeta }>(
  v: T & (T["request"] extends { body: "form" } ? MultipartEndpoint : unknown),
): FetchArgs {
  // The second half of the parameter type is a compile-time marker with no
  // members; `T` is the whole of the value.
  const { request } = v as T;
  if (request.body === "form") {
    throw new TypeError(
      "unmodel: this request is multipart/form-data — build its body with the endpoint's `toFormData` helper instead of `toRequestInit`.",
    );
  }
  return {
    url: request.url,
    method: request.method,
    // Copied: the internal headers object must never be handed to a caller
    // who is about to add an auth header to it.
    headers: { ...request.headers },
    // Non-enumerable members (`toSdk`, `request`, …) are skipped, so this is
    // exactly the wire body.
    body: JSON.stringify(v),
  };
}
