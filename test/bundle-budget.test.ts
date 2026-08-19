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
 * The unified media entries (`unmodel/image`, `unmodel/video`, …) that are
 * still **kernel-only**.
 *
 * Their whole proposition is that you name the adapters you want and the
 * bundle contains those providers and no others — so the number that matters
 * is not how big they are but what they carry: `createUnified`, the issue
 * sink, the warning sink and the two error classes.
 *
 * The budget is 18 KiB against 15.6–16.8 KiB measured — the same ~10% headroom
 * as every number above, set from what the tree measures rather than from a
 * round figure. (A 15 KiB pin was the original target; reaching it would have
 * meant deleting doc comments from `kernel.ts`, which is measured unminified
 * and is where the compile/merge/remap contract is written down. Trading
 * documentation for a number that already proves what it needs to prove is a
 * bad trade, and the composition test below is the assertion doing the real
 * work anyway.)
 *
 * `speech`, `image` and `video` are deliberately **not** in this list any more:
 * they are the categories that ship a ready-made pack, so their entries
 * legitimately import fourteen, fifteen and ten adapters. Each gets its own
 * budget and its own, stricter composition test below — the point of which is
 * that the *rest* of the rule still holds (exactly those providers, no
 * catalogs beyond the load-bearing ones, no availability data), so "the entry
 * imports providers now" cannot quietly become "the entry imports anything".
 */
const UNIFIED_BUDGET_KIB = 18;

const UNIFIED_ENTRIES: string[] = ["image-edit", "transcribe", "music"];

/** Every category entry, packs included — for the "it was built at all" check. */
const ALL_UNIFIED_ENTRIES: string[] = [...UNIFIED_ENTRIES, "speech", "image", "video"];

/**
 * `unmodel/speech`'s budget: the kernel plus fourteen TTS providers — each
 * one's validator, zod schema, constraint table and hand-written catalog.
 *
 * 327 KiB measured, pinned at 360 with the same ~10% headroom as everything
 * above. It is roughly twice what a "150–200 KiB" back-of-envelope suggested,
 * and the reason is worth writing down rather than rounding away: the fourteen
 * speech endpoints are validator-heavy rather than catalog-heavy (Deepgram
 * alone carries 105 Aura voices as catalog rows, and OpenAI's speech
 * constraints ride in the same 617-line table as its images and chat ones), so
 * the weight is code, not data. A caller who wants two providers builds their
 * own pack with `createSpeech([…])` and pays 40–60 KiB.
 */
const SPEECH_PACK_BUDGET_KIB = 360;

/**
 * `unmodel/image`'s budget: the kernel plus fifteen text-to-image providers —
 * each one's validator, zod schema, constraint table and catalog.
 *
 * 670 KiB measured, pinned at 740 with the same ~10% headroom as everything
 * above. It is twice the speech pack, and the reason is structural rather than
 * careless: the image providers carry *size* tables (per-model pixel grids,
 * resolution enums, 69-value size lists, style vocabularies) on top of the
 * usual deny rules, several of them serve two generation routes from one
 * adapter, and two of them key off a generated catalog rather than a
 * hand-written one (see `IMAGE_PACK_CATALOGS`). A caller who wants two
 * providers builds their own pack with `createImage([…])` and pays 40–80 KiB.
 */
const IMAGE_PACK_BUDGET_KIB = 740;

/**
 * The two generated catalogs this pack legitimately reaches, and nothing else.
 *
 * Both are load-bearing rather than leaked: `openai/images-models.ts` builds
 * the image catalog by supplementing `src/catalog/openai.gen.ts` (models.dev no
 * longer tracks dall-e), and `google/constraints.ts` — which `google/image.ts`
 * has always imported — reads `src/catalog/google.gen.ts`. A *third* entry here
 * means a provider barrel leaked in, which is the failure this pins.
 */
const IMAGE_PACK_CATALOGS: string[] = ["src/catalog/google.gen.ts", "src/catalog/openai.gen.ts"];

/**
 * `unmodel/video`'s budget: the kernel plus ten video providers — twenty-one
 * endpoint modules between them, because six of the ten serve more than one
 * route and Kling alone contributes five.
 *
 * 556 KiB measured, pinned at 610 with the same ~10% headroom as everything
 * above. It sits between the speech and image packs and for the same structural
 * reason the image one is large: video providers carry *size* tables (per-model
 * ratio enums with 30 pixel-pair members, resolution casings, duration × tier
 * matrices) on top of the usual deny rules, and this pack pays for every route
 * of every provider rather than one route each. `createVideo([…])` is the way
 * to pay for two providers instead of ten.
 */
const VIDEO_PACK_BUDGET_KIB = 610;

/**
 * The two generated catalogs this pack legitimately reaches.
 *
 * Both are load-bearing rather than leaked, and both for the same reason as in
 * the image pack: `google/veo-models.ts` supplements `src/catalog/google.gen.ts`
 * (models.dev carries only the veo-3.1 family) and `openai/videos-models.ts`
 * merges the hand-written Sora rows over `src/catalog/openai.gen.ts`. A *third*
 * entry here means a provider barrel leaked in.
 */
const VIDEO_PACK_CATALOGS: string[] = ["src/catalog/google.gen.ts", "src/catalog/openai.gen.ts"];

/** The ten providers `unmodel/video`'s ready-made pack is allowed to reach. */
const VIDEO_PACK_PROVIDERS: string[] = [
  "bytedance",
  "google",
  "kling",
  "lightricks",
  "luma",
  "minimax",
  "openai",
  "pixverse",
  "runway",
  "vidu",
];

/**
 * The fifteen providers `unmodel/image`'s ready-made pack is allowed to reach.
 *
 * google is on this list for its Imagen adapter only: `google/unified.ts`
 * imports `./image` and `./constraints`, never `.`, so the gemini chat codec
 * and the translate layer stay out — which the composition test below is what
 * actually holds down.
 */
const IMAGE_PACK_PROVIDERS: string[] = [
  "black-forest-labs",
  "bria",
  "bytedance",
  "google",
  "ideogram",
  "kling",
  "krea",
  "leonardo",
  "luma",
  "openai",
  "recraft",
  "reve",
  "runway",
  "stability",
  "vidu",
];

/** The fourteen providers `unmodel/speech`'s ready-made pack is allowed to reach. */
const SPEECH_PACK_PROVIDERS: string[] = [
  "cartesia",
  "deepgram",
  "elevenlabs",
  "fish-audio",
  "hume",
  "inworld",
  "lmnt",
  "minimax",
  "murf",
  "openai",
  "resemble",
  "rime",
  "smallest-ai",
  "speechify",
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
    expect(ALL_UNIFIED_ENTRIES).toHaveLength(6);
    for (const name of ALL_UNIFIED_ENTRIES) {
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

describe("unmodel/speech (the first ready-made pack)", () => {
  test(`stays under ${SPEECH_PACK_BUDGET_KIB} KiB`, () => {
    const kib = transitiveBytes(unifiedEntry("speech")) / 1024;
    expect(kib, `unified/speech is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      SPEECH_PACK_BUDGET_KIB,
    );
  });

  /**
   * The composition assertion, in the shape the kernel-only one had before a
   * pack existed: the *list* is what does the work, not the byte count.
   *
   * A pack that reaches a fifteenth provider, or that drags in a generated
   * catalog because someone imported `providers/<p>/index.ts` instead of the
   * adapter leaf, fails here in the diff that causes it — which is the whole
   * reason the adapters import `./speech` and not `.`.
   */
  test("it reaches exactly the fourteen speech providers, through their adapters", () => {
    const modules = sourceModulesOf(unifiedEntry("speech"));
    expect(modules).toContain("src/unified/speech.ts");
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual(SPEECH_PACK_PROVIDERS);

    // One adapter leaf per provider, and it is what pulled the provider in.
    // openai and minimax serve more than one category, so their adapters are
    // split per category and this pack imports only the speech half — see the
    // independence test below.
    const SPLIT = new Set(["openai", "minimax"]);
    for (const provider of SPEECH_PACK_PROVIDERS) {
      const leaf = SPLIT.has(provider) ? "unified-speech" : "unified";
      expect(modules).toContain(`src/providers/${provider}/${leaf}.ts`);
      expect(modules).toContain(`src/providers/${provider}/speech.ts`);
    }
  });

  test("its graph carries no generated catalog, availability data or retarget layer", () => {
    const modules = sourceModulesOf(unifiedEntry("speech"));
    // Every TTS provider here keys off a hand-written catalog in its own
    // directory, so a `src/catalog/*.gen.ts` in this graph means a provider
    // barrel leaked in — 40–400 KiB of data for zero findings.
    expect(modules.filter((m) => m.startsWith("src/catalog/"))).toEqual([]);
    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);
    expect(modules.filter((m) => m.endsWith("/interop.ts"))).toEqual([]);
    // …but the four-layer engine IS here now, unlike in a kernel-only entry:
    // the pack's whole point is ending in the providers' own validators.
    expect(modules).toContain("src/core/pipeline.ts");
  });
});

describe("unmodel/image (the second ready-made pack)", () => {
  test(`stays under ${IMAGE_PACK_BUDGET_KIB} KiB`, () => {
    const kib = transitiveBytes(unifiedEntry("image")) / 1024;
    expect(kib, `unified/image is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      IMAGE_PACK_BUDGET_KIB,
    );
  });

  /**
   * The composition assertion, and the one doing the real work: a pack that
   * reaches a sixteenth provider, or that drags in a generated catalog because
   * someone imported `providers/<p>/index.ts` instead of the adapter leaf,
   * fails here in the diff that causes it.
   */
  test("it reaches exactly the fifteen image providers, through their adapters", () => {
    const modules = sourceModulesOf(unifiedEntry("image"));
    expect(modules).toContain("src/unified/image.ts");
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual(IMAGE_PACK_PROVIDERS);

    // One adapter leaf per provider, and it is what pulled the provider in.
    // The seven providers that serve more than one category split their
    // adapter per category, and each pack imports only its own half — which is
    // what the independence test below is measuring in bytes.
    const SPLIT = new Set([
      "bytedance",
      "google",
      "kling",
      "luma",
      "openai",
      "runway",
      "vidu",
    ]);
    for (const provider of IMAGE_PACK_PROVIDERS) {
      const leaf = SPLIT.has(provider) ? "unified-image" : "unified";
      expect(modules).toContain(`src/providers/${provider}/${leaf}.ts`);
      // The barrel is never in a pack's graph: importing it would pull the
      // other categories' adapters — and their catalogs — in with it.
      if (SPLIT.has(provider)) {
        expect(modules).not.toContain(`src/providers/${provider}/unified.ts`);
      }
    }
    // Every provider's generation endpoint module is addressed as `image.ts`,
    // which is the rename made structural: the pack cannot reach a provider
    // except through a file with the uniform name.
    for (const provider of IMAGE_PACK_PROVIDERS) {
      if (provider === "vidu") continue; // its route file is image-from-reference.ts
      expect(modules).toContain(`src/providers/${provider}/image.ts`);
    }
    expect(modules).toContain("src/providers/vidu/image-from-reference.ts");
  });

  test("its graph carries exactly two catalogs, and no availability or retarget layer", () => {
    const modules = sourceModulesOf(unifiedEntry("image"));
    // The failure this pins is a provider barrel: `google/unified.ts` importing
    // `.` instead of `./image` would put the gemini chat codec, the translate
    // hub and three more catalogs into a pack that can never call them.
    expect(modules.filter((m) => m.startsWith("src/catalog/")).sort()).toEqual(IMAGE_PACK_CATALOGS);
    expect(modules.filter((m) => m.startsWith("src/catalog/availability/"))).toEqual([]);
    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);
    expect(modules.filter((m) => m.endsWith("/interop.ts"))).toEqual([]);
    expect(modules).not.toContain("src/providers/google/chat.ts");
    // …but the four-layer engine IS here: the pack ends in the providers' own
    // validators.
    expect(modules).toContain("src/core/pipeline.ts");
  });

  test("the two packs are independent — neither pulls the other in", () => {
    const image = sourceModulesOf(unifiedEntry("image"));
    const speech = sourceModulesOf(unifiedEntry("speech"));
    expect(image).not.toContain("src/unified/speech.ts");
    expect(speech).not.toContain("src/unified/image.ts");
    // openai is in both packs and must contribute only the endpoint each pack
    // needs. This is what the per-category adapter split buys, and it is worth
    // 39 KiB: one module exporting both adapters is one *entry* chunk holding
    // both, so `unmodel/speech` carried OpenAI's image catalog — and the
    // generated `src/catalog/openai.gen.ts` behind it — for nothing.
    expect(image).not.toContain("src/providers/openai/speech.ts");
    expect(speech).not.toContain("src/providers/openai/image.ts");
    expect(speech.filter((m) => m.startsWith("src/catalog/"))).toEqual([]);
  });
});

describe("unmodel/video (the third ready-made pack)", () => {
  test(`stays under ${VIDEO_PACK_BUDGET_KIB} KiB`, () => {
    const kib = transitiveBytes(unifiedEntry("video")) / 1024;
    expect(kib, `unified/video is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      VIDEO_PACK_BUDGET_KIB,
    );
  });

  /**
   * The composition assertion. This pack is the one where "exactly these
   * providers" is doing the most work: seven of the ten also serve an image or
   * speech surface, so an adapter that imported its provider's barrel instead
   * of the video leaf would drag a second category's validators and catalogs in
   * without changing a single import in `src/unified/video.ts`.
   */
  test("it reaches exactly the ten video providers, through their adapters", () => {
    const modules = sourceModulesOf(unifiedEntry("video"));
    expect(modules).toContain("src/unified/video.ts");
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual(VIDEO_PACK_PROVIDERS);

    // pixverse and lightricks serve video only, so their adapter is the
    // unsuffixed leaf; the other eight split per category.
    const SINGLE = new Set(["pixverse", "lightricks"]);
    for (const provider of VIDEO_PACK_PROVIDERS) {
      const leaf = SINGLE.has(provider) ? "unified" : "unified-video";
      expect(modules).toContain(`src/providers/${provider}/${leaf}.ts`);
      if (!SINGLE.has(provider)) {
        expect(modules).not.toContain(`src/providers/${provider}/unified.ts`);
      }
      // Every provider's primary generation endpoint is addressed as
      // `video.ts`, which is the rename made structural: the pack cannot reach
      // a provider except through a file with the uniform name.
      expect(modules).toContain(`src/providers/${provider}/video.ts`);
    }
  });

  test("its graph carries exactly two catalogs, and no availability or retarget layer", () => {
    const modules = sourceModulesOf(unifiedEntry("video"));
    expect(modules.filter((m) => m.startsWith("src/catalog/")).sort()).toEqual(VIDEO_PACK_CATALOGS);
    expect(modules.filter((m) => m.startsWith("src/catalog/availability/"))).toEqual([]);
    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);
    expect(modules.filter((m) => m.endsWith("/interop.ts"))).toEqual([]);
    expect(modules).not.toContain("src/providers/google/chat.ts");
    // …but the four-layer engine IS here: the pack ends in the providers' own
    // validators.
    expect(modules).toContain("src/core/pipeline.ts");
  });

  test("the three packs are independent — none pulls another's endpoints in", () => {
    const video = sourceModulesOf(unifiedEntry("video"));
    const image = sourceModulesOf(unifiedEntry("image"));
    const speech = sourceModulesOf(unifiedEntry("speech"));
    for (const other of ["image", "speech"]) {
      expect(video).not.toContain(`src/unified/${other}.ts`);
    }
    expect(image).not.toContain("src/unified/video.ts");
    expect(speech).not.toContain("src/unified/video.ts");
    // The seven shared providers contribute one category each, per pack.
    for (const shared of ["openai", "google", "luma", "kling", "runway", "vidu", "bytedance"]) {
      expect(video).not.toContain(`src/providers/${shared}/image.ts`);
      expect(image).not.toContain(`src/providers/${shared}/video.ts`);
    }
    expect(video).not.toContain("src/providers/openai/speech.ts");
    expect(video).not.toContain("src/providers/minimax/speech.ts");
    expect(speech).not.toContain("src/providers/minimax/video.ts");
  });
});
