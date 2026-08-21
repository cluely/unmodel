import type { IssueCode, IssueSeverity } from "./issues";
import type { Tokenizer } from "./tokens";

/**
 * A media path whose FIRST segment is a real key of the params it addresses.
 *
 * Only the root is closed, and that is a measured trade rather than a
 * half-measure: a recursive depth-4 path type over the three chat dialect
 * bodies costs +20% types / +40% instantiations on those bodies alone, while
 * the root segment — `"messages"`, `"contents"`, `"image"` — is where the
 * realistic typo happens and is where a did-you-mean suggestion is possible.
 * Everything below the root stays `string | number`, and the runtime check in
 * `createValidator` is what catches a wrong index or a wrong nested key.
 */
export type MediaPathFor<P> =
  /**
   * The empty path is legal and means the params object itself — which is the
   * whole coordinate system on the realtime and streaming endpoints, where the
   * media is the socket rather than a field of the body. `deepgram.listenLive`
   * declares its stream duration at `path: []`.
   */
  | readonly []
  | readonly [Extract<keyof P, string>, ...Array<string | number>];

/**
 * Out-of-band metadata for media referenced in the params. Params stay
 * byte-for-byte wire-shaped, so anything the wire format can't carry
 * (e.g. the duration of a URL-referenced video) is declared here.
 *
 * `P` is the params type the path addresses, and defaults to `unknown`, which
 * restores the fully open `Array<string | number>` — so naming the type bare
 * (`MediaDeclaration`, `ValidateOptions`) is exactly what it always was.
 */
/**
 * The declared facts themselves — everything but the coordinate.
 *
 * Split out so the two public types below can be written as INTERSECTIONS.
 * That is load-bearing, not cosmetic: a generic type *reference* is compared by
 * measured variance, and `P` appears in a conditional check position
 * (`unknown extends P`), which makes it invariant — so
 * `MediaDeclaration<GoogleBody>` would not be assignable to
 * `MediaDeclaration<unknown>` even though the tuple is plainly assignable to
 * the array. An intersection has no variance fast path and is compared
 * structurally, which is what lets a validator that narrows its options sit in
 * a seam that does not (`CompiledCall.validate`, the chat registry).
 */
export interface MediaFacts {
  durationSeconds?: number;
  width?: number;
  height?: number;
  bytes?: number;
}

/**
 * The coordinate: closed at the root where the params type is known, fully
 * open where it is not.
 *
 * A path that names nothing is the quietest failure this library had: the
 * declaration is simply never found, so `durationSeconds` and `bytes` are
 * never applied and the call is reported clean. `createValidator` reports
 * `media_declaration_dropped` for it now, and where the params type is known
 * the first segment is a compile error with a did-you-mean.
 */
export type MediaPath<P> = unknown extends P ? readonly (string | number)[] : MediaPathFor<P>;

export type MediaDeclaration<P = unknown> = MediaFacts & { path: MediaPath<P> };

/** Everything on {@link ValidateOptions} that does not depend on the params type. */
export interface ValidateOptionsBase {
  /** Fail (over_budget) when the estimated worst-case cost exceeds this. */
  maxCostUSD?: number;
  /** Precise token counting; defaults to a ~4 chars/token heuristic. */
  tokenizer?: Tokenizer;
  /** Promote, demote, or silence individual issue codes. */
  severity?: Partial<Record<IssueCode, IssueSeverity | "off">>;
}

export type ValidateOptions<P = unknown> = ValidateOptionsBase & {
  /** Declared metadata for media the validator can't inspect from bytes. */
  media?: MediaDeclaration<P>[];
};
