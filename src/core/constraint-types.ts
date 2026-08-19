/**
 * Hand-maintained per-model constraint tables. These encode what neither
 * models.dev nor the provider SDK types know: params a specific model
 * rejects, narrowed enum values, media limits. Every rule must carry a
 * `reason` (surfaced verbatim in the error message) and a `source`
 * (docs URL or recorded-fixture reference) so entries never rot unexplained.
 */
export interface DenyRule {
  reason: string;
  source: string;
  /**
   * The API accepts the param and silently ignores it rather than rejecting
   * the request. Such rules are still reported (a silent no-op is worth
   * knowing about) but as an `unsupported_param` *warning*, so requests the
   * API does fulfil keep validating. Omit for params the API rejects.
   */
  ignored?: boolean;
}

export interface MediaRule {
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxDurationSeconds?: number;
  /** Allowed formats, lowercase (e.g. ["png", "jpeg", "webp"]). */
  formats?: readonly string[];
}

export interface EndpointConstraints {
  /** Top-level params this model rejects even though types/docs may allow them. */
  deny?: Record<string, DenyRule>;
  /** Narrowed allowed values for enum-ish params, keyed by param name. */
  enums?: Record<string, readonly (string | number)[]>;
  /** Limits applied to media found in the params. */
  media?: Partial<Record<"image" | "audio" | "video", MediaRule>>;
  /** Fixed token cost charged per attached image, for estimation. */
  imageTokens?: number;
}

/** Prefix/pattern rule for high-cardinality endpoints (chat-scale model lists). */
export interface FamilyRule extends EndpointConstraints {
  /** Human-readable family label used in messages, e.g. "reasoning models". */
  family: string;
  match: (modelId: string) => boolean;
}
