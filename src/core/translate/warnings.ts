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

export interface TranslationWarning {
  code: TranslationWarningCode;
  /** Path in the SOURCE body, e.g. `["messages", 3, "content", 0]`. */
  path: Array<string | number>;
  /** Source endpoint id, e.g. `"anthropic.chat"`. */
  from: string;
  /** Target endpoint id, e.g. `"openrouter.chat"`. */
  to: string;
  /** Human-grade: names the param, both dialects, and why. */
  message: string;
  meta?: Record<string, unknown>;
}

/**
 * What a codec is handed to record losses. Codecs never build the envelope:
 * `from` / `to` name the route, which only the engine knows, so a codec
 * supplies exactly the three fields it *can* know (`code`, `path`, `message`,
 * plus optional `meta`).
 */
export type Warn = (warning: Omit<TranslationWarning, "from" | "to">) => void;

/**
 * Collects warnings for one translation and stamps `from`/`to` on each, so a
 * codec only supplies the parts it actually knows (`code`, `path`, `message`).
 */
export interface WarningSink {
  readonly warnings: TranslationWarning[];
  /** Records a warning; `from`/`to` are filled in from the sink's route. */
  push(warning: Omit<TranslationWarning, "from" | "to">): void;
  /** The `Warn` callback handed to codecs. */
  readonly warn: Warn;
}

export function createWarningSink(from: string, to: string): WarningSink {
  const warnings: TranslationWarning[] = [];
  const push = (warning: Omit<TranslationWarning, "from" | "to">): void => {
    warnings.push({ ...warning, from, to });
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
