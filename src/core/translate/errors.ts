/**
 * Retarget failures that are *structural* rather than data-driven.
 *
 * Its own module (importing nothing) so the root entry point can export the
 * class without dragging the endpoint table and the retarget engine into every
 * consumer's bundle.
 */

/**
 * Thrown when a retarget is impossible in this build rather than invalid for
 * this request: an unknown provider id, a factory-configured target reached
 * through the one-argument call, or a dialect pair whose codec has not
 * shipped.
 *
 * Thrown by `.toApi` only. `.toApiSafe` reports the identical message through
 * `result.errors` (with `meta.structural === true`) and never throws — these
 * failures are reachable from typed, compiling code, because the generated
 * availability union promises edges whose codec a given build may not ship, so
 * making them the one case `safe()` still throws on would defeat the form.
 */
export class TranslationUnavailableError extends Error {
  override readonly name: string = "TranslationUnavailableError";

  /** Cross-realm/cross-copy safe alternative to `instanceof`. */
  static isInstance(error: unknown): error is TranslationUnavailableError {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "TranslationUnavailableError"
    );
  }
}
