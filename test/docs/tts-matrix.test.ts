import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tts } from "../../src/unified/tts";
import {
  applyMachineTable,
  parseMachineTable,
  renderMachineTable,
  ttsMatrixRows,
  TTS_MATRIX_SAMPLES,
} from "../../scripts/gen-tts-matrix";

/**
 * The drift guard behind `docs/tts.md`.
 *
 * `docs/providers.md` is the sole precedent for a docs/ table in this repo and
 * it is unasserted prose: its counts ("fifteen", "All twelve") are true today
 * and nothing notices when they stop being. A second table with fifteen rows
 * of URLs would double that liability, so the machine columns of `docs/tts.md`
 * are generated from real `tts()` calls and this file re-runs them.
 *
 * Three things, and each maps to a way the doc could quietly go wrong:
 *
 *  1. **Complete.** The doc's row set is exactly the adapters `unmodel/tts`
 *     registers. A sixteenth provider lands in `src/unified/tts.ts` and
 *     nowhere else, so without this the doc silently ships one row short.
 *  2. **Live.** Every URL and method in the doc equals the one the adapter
 *     compiles *now*, not the one it compiled when the row was written. This
 *     is the assertion that makes the table worth reading.
 *  3. **Regenerated.** Re-rendering the table produces the committed bytes, so
 *     "I edited the generated half by hand" is a failing test rather than a
 *     change the next `bun run gen:tts-matrix` silently reverts.
 *
 * The samples come from the script rather than being restated here: a test
 * that asked different questions than the generator would prove the doc
 * matches a request nobody made.
 */

const DOC_PATH = join(resolve(import.meta.dir, "..", ".."), "docs", "tts.md");
const doc = readFileSync(DOC_PATH, "utf8");

describe("docs/tts.md machine columns", () => {
  test("names exactly the adapters unmodel/tts registers", () => {
    expect([...tts.providers].sort()).toEqual(TTS_MATRIX_SAMPLES.map((s) => s.provider).sort());
    expect(parseMachineTable(doc).map((r) => r.provider).sort()).toEqual([...tts.providers].sort());
  });

  test("carries nineteen rows, one per provider, none duplicated", () => {
    const rows = parseMachineTable(doc);
    expect(rows).toHaveLength(19);
    expect(new Set(rows.map((r) => r.provider)).size).toBe(19);
  });

  test.each(ttsMatrixRows())("$provider row matches the live .request", (live) => {
    const row = parseMachineTable(doc).find((r) => r.provider === live.provider);
    expect(row).toBeDefined();
    expect(row?.url).toBe(live.url);
    expect(row?.method).toBe(live.method);
  });

  test("is byte-identical to a fresh regeneration", () => {
    expect(applyMachineTable(doc, renderMachineTable(ttsMatrixRows()))).toBe(doc);
  });
});

describe("docs/tts.md hand-written columns", () => {
  /**
   * The hand-written half cannot be generated — auth has no API surface at all
   * — but the two columns that *cite* an API surface can be held to citing a
   * name that still exists, which is where a rename would otherwise leave the
   * doc pointing at nothing.
   */
  test.each(TTS_MATRIX_SAMPLES.map((s) => s.provider))(
    "%s cites the const that IS its adapter's delivery",
    async (provider) => {
      const cited = new RegExp(`^\\| \`${provider}\` \\| \`([A-Z0-9_]+)\` \\|`, "m").exec(doc);
      expect(cited).not.toBeNull();
      const name = cited?.[1] as string;

      // Asserted by reference, the way `test/values-entries.test.ts` asserts
      // the params tables: the doc names a const, and that const must be the
      // same object the adapter declares, not one that deep-equals it.
      const values = (await import(`../../src/providers/${provider}/values`)) as Record<string, unknown>;
      const dir = join(resolve(import.meta.dir, "..", ".."), "src", "providers", provider);
      const source = readdirSync(dir).find((file) =>
        file.endsWith(".ts") && readFileSync(join(dir, file), "utf8").includes(`export const ${name} =`),
      );
      expect(source).toBeDefined();
      const declaring = (await import(join(dir, source as string))) as Record<string, unknown>;
      expect(declaring[name]).toBe(values.TTS_DELIVERY);
    },
  );

  test("names checkTts for exactly the four providers that export one", async () => {
    const withChecker: string[] = [];
    for (const { provider } of TTS_MATRIX_SAMPLES) {
      const entry = (await import(`../../src/providers/${provider}/index`)) as Record<string, unknown>;
      if (typeof entry.checkTts === "function") withChecker.push(provider);
    }
    // minimax joined when its in-band `base_resp` envelope was verified against
    // platform.minimax.io (2026-08-26) — the recorded "no separately verified
    // error surface" exclusion was conditional, and the condition is now met.
    expect(withChecker.sort()).toEqual(["google", "minimax", "murf", "resemble"]);
    for (const provider of withChecker) {
      expect(doc).toContain(`| \`${provider}\` | \`checkTts\` from \`unmodel/${provider}\` |`);
    }
  });
});
