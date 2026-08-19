import type { IssueCode, IssueSeverity } from "./issues";
import type { Tokenizer } from "./tokens";

/**
 * Out-of-band metadata for media referenced in the params. Params stay
 * byte-for-byte wire-shaped, so anything the wire format can't carry
 * (e.g. the duration of a URL-referenced video) is declared here.
 */
export interface MediaDeclaration {
  /** Path to the media part inside the params object, e.g. ["contents", 0, "parts", 1]. */
  path: Array<string | number>;
  durationSeconds?: number;
  width?: number;
  height?: number;
  bytes?: number;
}

export interface ValidateOptions {
  /** Fail (over_budget) when the estimated worst-case cost exceeds this. */
  maxCostUSD?: number;
  /** Precise token counting; defaults to a ~4 chars/token heuristic. */
  tokenizer?: Tokenizer;
  /** Promote, demote, or silence individual issue codes. */
  severity?: Partial<Record<IssueCode, IssueSeverity | "off">>;
  /** Declared metadata for media the validator can't inspect from bytes. */
  media?: MediaDeclaration[];
}
