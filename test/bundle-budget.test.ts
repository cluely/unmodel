/**
 * Per-entry byte budgets, asserted against a **real build**.
 *
 * `test/import-graph.test.ts` proves *what* each entry imports; this proves the
 * *consequence*. The design names it the real backstop for the import-graph
 * rules, because those are enforced by a regex over import statements and are
 * therefore defeatable by a re-export or a barrel added later — whereas a
 * transitive byte count is not defeatable by anything except actually shipping
 * less code.
 *
 * **On bumping these numbers.** The budgets have ~10% headroom over what the
 * tree measures today, so a failure means a real, large addition to an entry's
 * graph, not drift. The design flags in as many words that "someone will be
 * tempted to bump rather than investigate": before you raise a number, find
 * out *which module* joined the graph and whether that entry should be paying
 * for it. Codegen growth from a models.dev refresh is the one routine reason a
 * budget legitimately moves, and it moves the catalog-heavy entries
 * (openrouter, vercel) first.
 *
 * The measurement walks `dist/`'s static import graph rather than stat-ing one
 * file, because tsdown splits shared code into chunks — `providers/anthropic/index.js`
 * on its own is a few hundred bytes and would assert nothing.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

/**
 * Committed budgets, in KiB of unminified ESM (chunk graph, `zod` excluded —
 * it is a real dependency, not part of unmodel's own weight).
 *
 * | entry | why it is pinned |
 * |---|---|
 * | anthropic | the flagship cross-dialect path: encoder + the openai-chat codec |
 * | groq | the leanest chat overlay — the floor everything else is measured against |
 * | google | gemini codec + the largest hand-written constraint tables |
 * | deepinfra | a fleet overlay that now pays for the gemini codec (`.toApi("google")`) |
 * | openrouter | the ceiling: 2 codecs + the largest generated catalog and table |
 * | vercel | same shape as openrouter, second-largest catalog |
 */
const BUDGET_KIB: Readonly<Record<string, number>> = {
  anthropic: 150,
  groq: 125,
  google: 235,
  deepinfra: 190,
  openrouter: 400,
  vercel: 355,
};

const FROM_IMPORT = /^[ \t]*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/gm;

/** Total bytes of an entry chunk plus every chunk it statically pulls in. */
function transitiveBytes(entry: string): number {
  const seen = new Set<string>();
  const visit = (file: string): number => {
    if (seen.has(file)) return 0;
    seen.add(file);
    let bytes = statSync(file).size;
    for (const match of readFileSync(file, "utf8").matchAll(FROM_IMPORT)) {
      const specifier = match[1] as string;
      // Bare specifiers are externals (`zod`, `node:*`) — not our weight.
      if (!specifier.startsWith(".")) continue;
      bytes += visit(resolve(dirname(file), specifier));
    }
    return bytes;
  };
  return visit(entry);
}

const entryFile = (id: string): string => join(DIST, "providers", id, "index.js");

// CI runs `bun test` before `bun run build`, and `dist/` is gitignored, so the
// suite builds on demand rather than depending on run order. `clean: true` in
// tsdown.config.ts makes this idempotent with the later CI build step.
const built = existsSync(entryFile("anthropic")) || (await $`bun run build`.quiet().then(() => true));

describe("per-entry bundle budgets", () => {
  test("the build is present, so the budgets below assert something", () => {
    expect(built).toBe(true);
    for (const id of Object.keys(BUDGET_KIB)) {
      expect(existsSync(entryFile(id)), `dist entry for ${id}`).toBe(true);
    }
  });

  test.each(Object.entries(BUDGET_KIB))("providers/%s stays under %i KiB", (id, budget) => {
    const kib = transitiveBytes(entryFile(id)) / 1024;
    expect(kib, `providers/${id} is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(budget);
  });

  test("a lean overlay does not silently acquire a codec", () => {
    // cerebras declares no decoders: its availability data names only
    // OpenAI-compatible targets, so it must stay materially smaller than an
    // overlay that does pay for one. A relative assertion, so it survives
    // catalog growth that lifts every entry at once.
    const lean = transitiveBytes(entryFile("cerebras"));
    const withCodec = transitiveBytes(entryFile("deepinfra"));
    expect(lean).toBeLessThan(withCodec);
  });
});
