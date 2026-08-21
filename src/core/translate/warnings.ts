/**
 * The lossy-translation contract for `.toApi()`.
 *
 * Stated normatively, because "it mostly works" is not a contract:
 *
 * - `.toApi()` **never throws** on a lossy translation and **never silently
 *   drops**. Every removal or approximation produces exactly one
 *   `TranslationWarning`.
 * - `warnings.length === 0` therefore *means* the translation was lossless,
 *   and is asserted as such by the golden-fixture suite.
 * - `warnings` rides on the result **non-enumerably**, alongside `.request` —
 *   the enumerable properties of a retargeted result stay exactly the wire
 *   body, so `JSON.stringify(result)` is still the fetch body.
 * - Messages follow `Issue`'s discipline from `../issues`: always name the
 *   param, both dialects, and the concrete reason.
 * - The *source* validation's own warnings are **not** merged in. They
 *   describe the request you wrote; these describe what translating it cost.
 */

import type { DialectId } from "./endpoints";

export type TranslationWarningCode =
  /** No equivalent on the target dialect; the param was removed. */
  | "dropped_param"
  /** Mapped to a near-equivalent whose semantics differ (e.g. budget → effort). */
  | "approximated_param"
  /** A content block had no target representation and was removed. */
  | "dropped_content"
  /** A provider-defined tool (web_search, googleSearch, …) has no target equivalent. */
  | "dropped_tool"
  /** Gemini's `functionCall` parts carry no id; one was synthesized. */
  | "synthesized_tool_call_id"
  /** From generated availability metadata: the target serves less than the source. */
  | "capability_narrowed"
  /** Always emitted. The audit trail for the model-id respelling. */
  | "id_respelled";

/**
 * The machine-readable half of a warning, **per code**.
 *
 * `meta` used to be `Record<string, unknown>`, which meant the documented
 * deliverable of the whole translation layer completed nothing and every read
 * needed a cast: `w.meta?.tool` was `unknown`, and `w.meta?.tol` was silently
 * fine. Six of the seven codes emit a genuinely small, stable key set — these
 * were extracted from every warning literal in `src/`, not guessed — so they
 * are written down and narrowed on `code`, which is what the contract above
 * already tells a consumer to do.
 *
 * `approximated_param` is the deliberate exception and stays an open bag: it
 * has ~24 distinct shapes across ~40 producers (every "here is what you asked
 * for, here is what the target could do" pair, plus spreads), so a closed
 * union there would be a per-site enumeration that rots on the first new
 * approximation. Its three recurring keys are named so they complete, and the
 * `Record` tail keeps the rest legal.
 */
export interface TranslationWarningMeta {
  dropped_param: {
    /** The source param that was removed. */
    param?: string;
    /** The dialect that owns it, when the param came from a passthrough bucket. */
    dialect?: DialectId;
    /** The provider named by a `providerOptions` bucket that cannot fire. */
    provider?: string;
    /** How many of something were dropped (e.g. extra `n` candidates). */
    n?: number;
    /** A dropped sub-field's value, e.g. an image part's `detail`. */
    detail?: string;
    /** The dropped `top_k` value, kept so a caller can re-apply it. */
    top_k?: number;
  };
  approximated_param: {
    /** What the caller asked for. */
    requested?: unknown;
    /** What the target could actually express. */
    achieved?: unknown;
    /** The doc or table the approximation was taken from. */
    source?: string;
  } & Readonly<Record<string, unknown>>;
  dropped_content: {
    /** The dropped block's provider-side handle (file id, url, …). */
    ref?: string;
    dialect?: DialectId;
    provider?: string;
    /** IANA MIME type of the dropped attachment. */
    mediaType?: string;
    /** The part kind, when the block has no better name. */
    kind?: string;
    /** The tool whose call/result block was dropped. */
    tool?: string;
  };
  dropped_tool: {
    /** The provider-defined tool's name, as `nativeToolName` derived it. */
    tool?: string;
    dialect?: DialectId;
    provider?: string;
  };
  synthesized_tool_call_id: { id: string; name: string };
  capability_narrowed: {
    /** The target's smaller context window, in tokens. */
    context?: number;
    /** Input kinds the target does not serve. */
    drops?: readonly string[];
  };
  /** `from` is optional because a body need not carry a model id at all. */
  id_respelled: { from?: string; to: string };
}

/**
 * One recorded loss.
 *
 * A discriminated union rather than a flat interface, so `meta` is the payload
 * that goes with `code` — see {@link TranslationWarningMeta}. Narrow on `code`
 * before reading `meta`; that is the same discipline the contract above states
 * in prose, now checked.
 */
export type TranslationWarning = {
  [C in TranslationWarningCode]: {
    code: C;
    /** Path in the SOURCE body, e.g. `["messages", 3, "content", 0]`. */
    path: Array<string | number>;
    /** Source endpoint id, e.g. `"anthropic.chat"`. */
    from: string;
    /** Target endpoint id, e.g. `"openrouter.chat"`. */
    to: string;
    /** Human-grade: names the param, both dialects, and why. */
    message: string;
    meta?: TranslationWarningMeta[C];
  };
}[TranslationWarningCode];

/**
 * `Omit` over a union collapses it to one arm with a union-typed `code` and a
 * union-typed `meta`, which is exactly the pairing this type exists to keep —
 * so the distributive form is load-bearing, not stylistic.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a codec supplies: everything but the route, which only the engine knows. */
export type TranslationWarningInput = DistributiveOmit<TranslationWarning, "from" | "to">;

/**
 * What a codec is handed to record losses. Codecs never build the envelope:
 * `from` / `to` name the route, which only the engine knows, so a codec
 * supplies exactly the three fields it *can* know (`code`, `path`, `message`,
 * plus optional `meta`).
 */
export type Warn = (warning: TranslationWarningInput) => void;

/**
 * Collects warnings for one translation and stamps `from`/`to` on each, so a
 * codec only supplies the parts it actually knows (`code`, `path`, `message`).
 */
export interface WarningSink {
  readonly warnings: TranslationWarning[];
  /** Records a warning; `from`/`to` are filled in from the sink's route. */
  push(warning: TranslationWarningInput): void;
  /** The `Warn` callback handed to codecs. */
  readonly warn: Warn;
}

export function createWarningSink(from: string, to: string): WarningSink {
  const warnings: TranslationWarning[] = [];
  const push = (warning: TranslationWarningInput): void => {
    warnings.push({ ...warning, from, to } as TranslationWarning);
  };
  return { warnings, push, warn: push };
}

/**
 * Attaches `warnings` to a wire body **non-enumerably**, so `Object.keys`,
 * `JSON.stringify` and spread still see only the body. The array is frozen:
 * a warning list you can mutate is a warning list nobody trusts.
 */
export function attachWarnings<T extends object>(
  body: T,
  warnings: readonly TranslationWarning[],
): T & { readonly warnings: readonly TranslationWarning[] } {
  Object.defineProperty(body, "warnings", {
    value: Object.freeze([...warnings]),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return body as T & { readonly warnings: readonly TranslationWarning[] };
}

/** Renders warnings for a log line or an error body. */
export function formatTranslationWarnings(warnings: readonly TranslationWarning[]): string {
  return warnings.map((w) => `  - [${w.code}] ${w.from} → ${w.to}: ${w.message}`).join("\n");
}
