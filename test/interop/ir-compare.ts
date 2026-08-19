/**
 * Shared IR/warning comparison helpers for the golden suites.
 *
 * NOT a test file (no `.test.` in the name), so `bun test` never collects it —
 * which is the point: `test/interop/golden.test.ts` (dialect ↔ dialect) and
 * `test/chat/golden.test.ts` (unified → dialect) both assert *convergence*, and
 * two copies of the projection would let one suite quietly start ignoring a
 * field the other still compares.
 */
import type { ChatIR } from "../../src/core/translate/ir";
import type { TranslationWarning } from "../../src/core/translate/warnings";

/**
 * The comparable core of an IR.
 *
 * Four things are deliberately ignored:
 *
 * - `source` — which dialect (or, for `unmodel/chat`, which *target*) wrote
 *   the IR. Never part of the request.
 * - `passthrough` — dialect-owned params, by definition not shared.
 * - `model` — ids are not normalized across providers; that is the whole
 *   reason the availability tables exist.
 * - `settings.temperatureMax` — a property of the source dialect's scale
 *   (Anthropic 0–1, everyone else 0–2), not of the request.
 */
export function convergent(ir: ChatIR): unknown {
  const { source: _source, passthrough: _passthrough, model: _model, settings, ...rest } = ir;
  const { temperatureMax: _max, ...comparableSettings } = settings;
  return { ...rest, settings: comparableSettings };
}

/** `{code, path, meta}` sorted stably, which is what the fixtures commit. */
export function comparableWarnings(warnings: readonly TranslationWarning[]): unknown[] {
  return warnings
    .map((w) => ({ code: w.code, path: w.path, ...(w.meta !== undefined && { meta: w.meta }) }))
    .sort((a, b) => `${a.code}|${a.path.join(".")}`.localeCompare(`${b.code}|${b.path.join(".")}`));
}

/** The same sort applied to a fixture's committed expectations. */
export function sortedExpectedWarnings(expected: readonly unknown[]): unknown[] {
  return [...expected].sort((a, b) => {
    const key = (w: unknown): string => {
      const { code, path } = w as { code: string; path: Array<string | number> };
      return `${code}|${path.join(".")}`;
    };
    return key(a).localeCompare(key(b));
  });
}
