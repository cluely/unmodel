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

/**
 * `unmodel/chat`'s budget, measured the same way and pinned separately because
 * it is not a provider entry: it is the one entry that carries a catalog
 * covering *every* provider.
 *
 * 558 KiB measured, of which 433 KiB is `src/catalog/chat-profiles.gen.ts`
 * inlined — the slim per-model profile table (324 KB of source) that makes
 * `chat()` catalog-aware without a subpath the caller has to know about. The
 * remaining ~125 KiB is the three dialect codecs, the translation hub, the four
 * constraint tables and the pipeline. Headroom is ~8%, matching the provider
 * budgets: a failure here means a real addition, and the routine legitimate
 * cause is a models.dev refresh growing the profile table.
 *
 * The number is only half the guarantee. `chat entry's graph` below pins the
 * *composition* — no per-provider catalog, no availability data — which is what
 * stops the budget from being met by luck while the wrong modules are inside.
 */
const CHAT_BUDGET_KIB = 600;

/**
 * The six unified media entries (`unmodel/image`, `unmodel/video`, …).
 *
 * Their whole proposition is that you name the adapters you want and the
 * bundle contains those providers and no others — so the number that matters
 * is not how big they are but that they are **kernel-only**. Today they carry
 * `createUnified`, the issue sink, the warning sink and the two error classes,
 * and nothing else exists that they could carry.
 *
 * The budget is 18 KiB against 15.6–16.8 KiB measured — the same ~10% headroom
 * as every number above, set from what the tree measures rather than from a
 * round figure. (A 15 KiB pin was the original target; reaching it would have
 * meant deleting doc comments from `kernel.ts`, which is measured unminified
 * and is where the compile/merge/remap contract is written down. Trading
 * documentation for a number that already proves what it needs to prove is a
 * bad trade, and the composition test below is the assertion doing the real
 * work anyway.)
 */
const UNIFIED_BUDGET_KIB = 18;

const UNIFIED_ENTRIES: string[] = [
  "image",
  "image-edit",
  "video",
  "speech",
  "transcribe",
  "music",
];

const FROM_IMPORT = /^[ \t]*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/gm;

/** Every dist chunk an entry statically pulls in, the entry included. */
function transitiveChunks(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(FROM_IMPORT)) {
      const specifier = match[1] as string;
      // Bare specifiers are externals (`zod`, `node:*`) — not our weight.
      if (!specifier.startsWith(".")) continue;
      visit(resolve(dirname(file), specifier));
    }
  };
  visit(entry);
  return [...seen];
}

/** Total bytes of an entry chunk plus every chunk it statically pulls in. */
function transitiveBytes(entry: string): number {
  return transitiveChunks(entry).reduce((total, file) => total + statSync(file).size, 0);
}

/**
 * The `src/` modules an entry's chunks were built from.
 *
 * rolldown emits a `//#region <source path>` marker ahead of every module it
 * inlines, which is a far better handle than chunk filenames: a generated
 * catalog small enough to be merged into its consumer leaves no `*.gen-*.js`
 * file behind, and a filename-only check would call that a pass.
 */
const REGION = /^\/\/#region (src\/.+)$/gm;

function sourceModulesOf(entry: string): string[] {
  const modules = new Set<string>();
  for (const chunk of transitiveChunks(entry)) {
    for (const match of readFileSync(chunk, "utf8").matchAll(REGION)) {
      modules.add(match[1] as string);
    }
  }
  return [...modules].sort();
}

const entryFile = (id: string): string => join(DIST, "providers", id, "index.js");
const chatEntry = (): string => join(DIST, "chat", "index.js");
const unifiedEntry = (name: string): string => join(DIST, "unified", `${name}.js`);

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

describe("unmodel/chat", () => {
  test(`stays under ${CHAT_BUDGET_KIB} KiB`, () => {
    expect(existsSync(chatEntry()), "dist entry for chat").toBe(true);
    const kib = transitiveBytes(chatEntry()) / 1024;
    expect(kib, `chat is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(CHAT_BUDGET_KIB);
  });

  /**
   * The composition assertion, and the reason the number above means anything.
   *
   * `unmodel/chat` carries one catalog on purpose — the slim `chat-profiles`
   * table. Two other kinds of generated data are one careless import away and
   * would each be invisible in a passing budget for a while:
   *
   * - **a per-provider full catalog** (`src/catalog/<id>.gen.ts`). The near
   *   miss is real: wiring google's chat constraint table pulled
   *   `src/catalog/google.gen.ts` in for 44 KiB and zero findings, which is
   *   what this test caught.
   * - **the availability layer** (`src/catalog/availability/**`, ~290 KB in
   *   total). `unmodel/chat` has no `.toApi`, so any of it here is pure weight.
   */
  test("its graph contains no availability data and no per-provider catalog", () => {
    const modules = sourceModulesOf(chatEntry());
    // A vacuous scan would be worse than no scan.
    expect(modules).toContain("src/chat/index.ts");
    expect(modules).toContain("src/catalog/chat-profiles.gen.ts");

    expect(modules.filter((m) => m.startsWith("src/catalog/availability/"))).toEqual([]);

    const CHAT_TABLES = new Set([
      "src/catalog/chat-profiles.gen.ts",
      "src/catalog/chat-refs.gen.ts",
    ]);
    const catalogs = modules.filter(
      (m) => /^src\/catalog\/.*\.gen\.ts$/.test(m) && !CHAT_TABLES.has(m),
    );
    expect(catalogs).toEqual([]);
  });

  test("it reaches exactly three codecs — one per dialect it compiles to", () => {
    // Each codec is ~20 KiB. A fourth means a dialect was added (fine, update
    // this) or a provider barrel leaked in (not fine).
    const codecs = sourceModulesOf(chatEntry()).filter((m) => m.endsWith("/interop.ts"));
    expect(codecs.sort()).toEqual([
      "src/providers/anthropic/interop.ts",
      "src/providers/google/interop.ts",
      "src/providers/openai-compatible/interop.ts",
    ]);
  });
});

describe("unified media entries", () => {
  test("all six are built, so the assertions below assert something", () => {
    for (const name of UNIFIED_ENTRIES) {
      expect(existsSync(unifiedEntry(name)), `dist entry for unified/${name}`).toBe(true);
    }
  });

  test.each(UNIFIED_ENTRIES)("unmodel/%s stays under the kernel budget", (name) => {
    const kib = transitiveBytes(unifiedEntry(name)) / 1024;
    expect(kib, `unified/${name} is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      UNIFIED_BUDGET_KIB,
    );
  });

  /**
   * The composition assertion, and the one doing the real work.
   *
   * A byte budget catches a provider leaking in *eventually*; this catches it
   * in the diff that causes it, and names the module. Every one of the six is
   * the kernel plus a handful of core leaves — no provider, no catalog, no
   * availability data, no zod — and the moment that stops being true, the
   * entry has stopped being what it is sold as.
   *
   * The one legitimate way this list grows is a category entry importing a
   * provider `unified.ts` adapter, which is the ready-made pack. That is a
   * deliberate change with a budget change attached, which is exactly the
   * conversation this test exists to force.
   */
  test.each(UNIFIED_ENTRIES)("unmodel/%s carries the kernel and nothing else", (name) => {
    const modules = sourceModulesOf(unifiedEntry(name));
    // A vacuous scan would be worse than no scan.
    expect(modules).toContain(`src/unified/${name}.ts`);
    expect(modules).toContain("src/core/unified/kernel.ts");

    expect(modules.filter((m) => m.startsWith("src/providers/"))).toEqual([]);
    expect(modules.filter((m) => m.startsWith("src/catalog/"))).toEqual([]);
    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);

    // Every remaining module is either the entry itself or a core leaf. The
    // four-layer engine in `core/pipeline.ts` is deliberately absent: the
    // kernel delegates validation to the provider's own validator, so it needs
    // the severity rules (`core/issue-sink.ts`) and not the engine.
    expect(modules.filter((m) => m === "src/core/pipeline.ts")).toEqual([]);
    for (const module of modules) {
      expect(
        module.startsWith("src/core/") || module === `src/unified/${name}.ts`,
        `${module} is neither core nor the entry`,
      ).toBe(true);
    }
  });
});
