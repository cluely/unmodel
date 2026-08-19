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
import type { TranslationWarning } from "../core/translate/warnings";
import type { DialectBody, DialectOf, DialectSdkTargets } from "./dialects";
import type { ApiTargetId } from "./ids";

/**
 * The retargeted request for provider `P` serving that provider's model `M`.
 *
 * **No `.toApi` on the result — one hop only.** `a.toApi("openrouter").toApi("groq")`
 * is semantically identical to `a.toApi("groq")`, and supporting it would
 * force every dialect module to carry every provider's availability map. The
 * second hop is a compile error, by construction.
 */
export type Retargeted<P extends ApiTargetId, M extends string> = DialectBody<DialectOf<P>, M> & {
  /** SDK targets of the *target's* dialect. Non-enumerable. */
  toSdk<K extends DialectSdkTargets<DialectOf<P>>>(target: K): unknown;
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
