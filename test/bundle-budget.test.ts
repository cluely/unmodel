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
 * Every category entry. All six ship a ready-made pack now, so each has its own
 * budget and its own composition test below rather than a shared kernel-only
 * one.
 *
 * **The kernel-only budget is retired, not lost.** Until this wave there was a
 * `UNIFIED_BUDGET_KIB = 18` that `image-edit` — the last entry with no pack —
 * was measured against, plus a "carries the kernel and nothing else" test over
 * the same list. Both now cover nothing: a list that is empty is a test that
 * passes by saying nothing, which is worse than no test. What they were
 * protecting has not gone away, and is asserted twice over instead:
 *
 * - the *rule* they encoded is in `test/import-graph.test.ts` (amendments
 *   A5–A7), which is where "a category entry sees only the kernel, itself and
 *   adapter leaves" belongs — it holds for entries with a pack too;
 * - the *bytes* are still pinned, per pack, by the six budgets below, each with
 *   a composition test that is strictly stricter than the retired one (exactly
 *   these providers, exactly these catalogs, no availability data, no retarget
 *   layer).
 *
 * A caller who wants the kernel-only weight builds their own pack with
 * `createImageEdit([…])`, and what that costs is a function of the adapters they
 * name — which is the proposition, and is not a number this file can pin.
 */
const ALL_UNIFIED_ENTRIES: string[] = [
  "image",
  "image-edit",
  "video",
  "speech",
  "transcribe",
  "music",
];

/**
 * `unmodel/speech`'s budget: the kernel plus fourteen TTS providers — each
 * one's validator, zod schema, constraint table and hand-written catalog.
 *
 * 371 KiB measured, pinned at 400 with the same ~10% headroom as everything
 * above. It is roughly twice what a "150–200 KiB" back-of-envelope suggested,
 * and the reason is worth writing down rather than rounding away: the fourteen
 * speech endpoints are validator-heavy rather than catalog-heavy (Deepgram
 * alone carries 105 Aura voices as catalog rows, and OpenAI's speech
 * constraints ride in the same 617-line table as its images and chat ones), so
 * the weight is code, not data. A caller who wants two providers builds their
 * own pack with `createSpeech([…])` and pays 40–60 KiB.
 *
 * **Why it moved from 360.** Nothing joined this graph: `core/unified/derive.ts`
 * grew by ~9 KiB when the transcribe wave added `resolveAudioInput`,
 * `resolveDiarization`, `toTimestampGranularity` and `toMilliseconds`, and every
 * pack pays for that module whole because it is emitted as one shared chunk.
 * Splitting `derive.ts` per category would buy those 9 KiB back and cost the
 * property its own header argues for — one file, one set of rules for what
 * "approximately" means, one test suite over all of them — so the number moves
 * instead. Every other pack moved by the same ~9 KiB and stayed inside its
 * headroom; this one was already at 98% of its budget.
 *
 * **Why it moved from 400.** The per-model wave: fourteen `modelParams` tables
 * joined this graph — 403 KiB measured, up 27 from 377. About a third of that
 * is the tables themselves (codec sets, language lists and ~110 `EXTRA`
 * witnesses, each of which is one object key holding `undefined` at run time)
 * and the rest is the prose that argues for them, which these bundles are
 * measured *unminified* and therefore pay for. Both halves are load-bearing:
 * the tables are read by the caller's types, by `applyExtras` and by
 * `test/unified/speech-presets.test.ts`, and a table whose per-model
 * distinctions are not explained is a table nobody can audit against the wire.
 * Pinned at 430, which keeps the ~6% headroom the 400 had.
 */
const SPEECH_PACK_BUDGET_KIB = 430;

/**
 * `unmodel/image`'s budget: the kernel plus fifteen text-to-image providers —
 * each one's validator, zod schema, constraint table and catalog.
 *
 * 747 KiB measured, pinned at 790. It is twice the speech pack, and the reason
 * is structural rather than careless: the image providers carry *size* tables
 * (per-model pixel grids, resolution enums, 69-value size lists, style
 * vocabularies) on top of the usual deny rules, several of them serve two
 * generation routes from one adapter, and two of them key off a generated
 * catalog rather than a hand-written one (see `IMAGE_PACK_CATALOGS`). A caller
 * who wants two providers builds their own pack with `createImage([…])` and pays
 * 40–80 KiB.
 *
 * **Bumped 740 → 790 for the per-model tables.** The measurement moved 697 →
 * 747 when every adapter gained a `modelParams` table: the `size` preset lists
 * are real strings and have to exist at run time, because the same array that
 * types `size` is the one `test/unified/image-presets.test.ts` compiles
 * exhaustively — a preset an editor suggests is only worth suggesting if it is
 * provably one the provider accepts, and a type alone cannot be swept. The
 * extras cost almost nothing beside them: each is one key whose value is a
 * `never` witness that minifies to a shared identifier.
 *
 * The headroom is the tightest in this file — ~6% rather than ~10% — and the
 * reason is worth writing down rather than fixing with a bigger number: the
 * measurement rose from 670 to 697 across the transcribe and image-edit waves
 * without a single module joining this graph, because `core/unified/derive.ts`
 * is one shared chunk that every pack pays for whole and it grew by ~14 KiB of
 * new derivations. Splitting it per category would buy those back and cost the
 * property its own header argues for — one file, one set of rules for what
 * "approximately" means, one test suite over all of them. If this one fails,
 * check `sourceModulesOf` for a *new provider* before touching the number.
 */
const IMAGE_PACK_BUDGET_KIB = 790;

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
 * 606 KiB measured, pinned at 670 with the same ~10% headroom as everything
 * above. It sits between the speech and image packs and for the same structural
 * reason the image one is large: video providers carry *size* tables (per-model
 * ratio enums with 30 pixel-pair members, resolution casings, duration × tier
 * matrices) on top of the usual deny rules, and this pack pays for every route
 * of every provider rather than one route each. `createVideo([…])` is the way
 * to pay for two providers instead of ten.
 *
 * **Bumped 610 → 670 with the per-model tables**, and the 35 KiB it cost is the
 * same trade the image pack made: the arrays that *type* `duration`,
 * `resolution` and `aspectRatio` are the arrays
 * `test/unified/video-presets.test.ts` sweeps, so they have to exist at run
 * time. Ten adapters × ~80 models is where it goes, and Runway's 13 shape lists
 * (with their 13-member pixel-pair reductions) and Kling's 15 rows across three
 * route families are the two biggest contributors. The `extras` objects are
 * `undefined`s and cost about what a name list would.
 */
const VIDEO_PACK_BUDGET_KIB = 670;

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

/**
 * `unmodel/transcribe`'s budget: the kernel plus eleven STT providers.
 *
 * 360 KiB measured, pinned at 390 with the same ~10% headroom as everything
 * above — within a few KiB of the speech pack, and for the same reason: these
 * are eleven long, check-heavy validators (AssemblyAI's `/v2/transcript` alone
 * carries fifty wire fields and thirteen cross-field rules) over small
 * hand-written catalogs. `createTranscribe([…])` is the way to pay for two
 * providers instead of eleven.
 *
 * **Why it moved from 390.** The per-model wave, and this is the pack it cost
 * the most: 395 KiB measured, up 29 from 366. The reason is the same fact the
 * paragraph above gives — these are the widest wire surfaces in the library, so
 * they are also the widest *extras* tables. AssemblyAI declares 34 keys,
 * Deepgram 29 across 38 generated rows, Speechmatics 19 with per-key nesting;
 * each is one `EXTRA` witness at run time plus the sentence that says which
 * models take it and why. Pinned at 420, keeping the ~6% headroom the 390 had.
 */
const TRANSCRIBE_PACK_BUDGET_KIB = 420;

/**
 * The one generated catalog this pack legitimately reaches.
 *
 * Load-bearing rather than leaked, and for the same reason as the image and
 * video packs' two: `mistral/audio-models.ts` supplements
 * `src/catalog/mistral.gen.ts`, which carries only the `voxtral-*-latest`
 * aliases and none of the dated transcription ids or the per-minute rates. A
 * *second* entry here means a provider barrel leaked in.
 */
const TRANSCRIBE_PACK_CATALOGS: string[] = ["src/catalog/mistral.gen.ts"];

/** The eleven providers `unmodel/transcribe`'s ready-made pack is allowed to reach. */
const TRANSCRIBE_PACK_PROVIDERS: string[] = [
  "assemblyai",
  "cartesia",
  "deepgram",
  "elevenlabs",
  "gladia",
  "inworld",
  "mistral",
  "openai",
  "revai",
  "soniox",
  "speechmatics",
];

/**
 * `unmodel/music`'s budget: the kernel plus two providers.
 *
 * 141 KiB measured, pinned at 150 with the same ~10% headroom. The smallest
 * pack in the library by a wide margin — two providers, one route each — and
 * the number is dominated by Stability's shared image/audio module graph and
 * ElevenLabs' 673-line composition-plan schema rather than by catalogs.
 *
 * **Bumped 140 → 150 with the per-model tables**, and not because this pack
 * gained anything of its own: `core/unified/derive.ts` is one shared chunk that
 * every pack pays for whole, and it grew by `parseSizeString`, `applyExtras`
 * and the size-arm of `resolveSizing`. The same ~1 KiB landed on all six packs;
 * this is the only one that was already inside a rounding error of its number.
 */
const MUSIC_PACK_BUDGET_KIB = 150;

/** The two providers `unmodel/music`'s ready-made pack is allowed to reach. */
const MUSIC_PACK_PROVIDERS: string[] = ["elevenlabs", "stability"];

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

/**
 * `unmodel/image-edit`'s budget: the kernel plus four image-to-image providers.
 *
 * 267 KiB measured, pinned at 295 with the same ~10% headroom as everything
 * above. Larger than the music pack and smaller than every other one, which is
 * what four providers should cost — and the number is dominated by three
 * providers' *editing* modules being long, check-heavy validators that also
 * carry their generation neighbours' vocabularies (Recraft's 900-line style
 * tables, Ideogram's 69-value resolution list, OpenAI's per-model media rules).
 * `createImageEdit([…])` is the way to pay for two providers instead of four.
 *
 * **Bumped 275 → 295 for the per-model tables**, the same ~17 KiB of `size`
 * preset lists the image pack pays for and for the same reason: the array that
 * types `size` is the array `test/unified/image-presets.test.ts` sweeps, so it
 * has to exist at run time. OpenAI's lists are shared with the generations
 * route through `openai/images-shared.ts` — deliberately, and pinned by the
 * composition assertion below: reaching them through `openai/image.ts` instead
 * would drag that endpoint's validator, schema and catalog into this pack.
 */
const IMAGE_EDIT_PACK_BUDGET_KIB = 295;

/**
 * The one generated catalog this pack legitimately reaches.
 *
 * Load-bearing rather than leaked, and for the same reason as in the image
 * pack: `openai/images-models.ts` builds the image catalog by supplementing
 * `src/catalog/openai.gen.ts`. A *second* entry here means a provider barrel
 * leaked in.
 */
const IMAGE_EDIT_PACK_CATALOGS: string[] = ["src/catalog/openai.gen.ts"];

/** The four providers `unmodel/image-edit`'s ready-made pack is allowed to reach. */
const IMAGE_EDIT_PACK_PROVIDERS: string[] = [
  "black-forest-labs",
  "ideogram",
  "openai",
  "recraft",
];

/**
 * Every pack's budget, keyed by entry name — the map the shared budget test
 * iterates, and the thing that makes "every category has a number" checkable
 * rather than a claim. The per-pack `describe`s below add what a number cannot
 * say: which providers, which catalogs, which endpoint modules.
 */
const PACK_BUDGET_KIB: Readonly<Record<string, number>> = {
  image: IMAGE_PACK_BUDGET_KIB,
  "image-edit": IMAGE_EDIT_PACK_BUDGET_KIB,
  video: VIDEO_PACK_BUDGET_KIB,
  speech: SPEECH_PACK_BUDGET_KIB,
  transcribe: TRANSCRIBE_PACK_BUDGET_KIB,
  music: MUSIC_PACK_BUDGET_KIB,
};

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
    expect(new Set(ALL_UNIFIED_ENTRIES).size).toBe(6);
    for (const name of ALL_UNIFIED_ENTRIES) {
      expect(existsSync(unifiedEntry(name)), `dist entry for unified/${name}`).toBe(true);
    }
  });

  /**
   * Every one of the six now ships a pack, so every one has a budget below.
   * Asserted as a *property of this file* rather than left to reading: a
   * seventh category, or a pack whose budget nobody wrote down, fails here
   * instead of shipping unmeasured.
   */
  test("every entry has a budget of its own", () => {
    expect(Object.keys(PACK_BUDGET_KIB).sort()).toEqual([...ALL_UNIFIED_ENTRIES].sort());
  });

  test.each(Object.entries(PACK_BUDGET_KIB))("unmodel/%s stays under %i KiB", (name, budget) => {
    const kib = transitiveBytes(unifiedEntry(name)) / 1024;
    expect(kib, `unified/${name} is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(budget);
  });

  /**
   * The property every pack shares, in one place: a pack is provider validators
   * plus the kernel plus the four-layer engine, and **never** the retarget layer
   * or the availability data. Both are dead weight in a media bundle — a
   * `Validated` from a unified call carries `.toSdk` and no `.toApi` — and both
   * are one careless barrel import away.
   *
   * The per-pack tests below add the parts that differ: which providers, which
   * catalogs, which endpoint modules.
   */
  test.each(ALL_UNIFIED_ENTRIES)("unmodel/%s carries no retarget or availability layer", (name) => {
    const modules = sourceModulesOf(unifiedEntry(name));
    // A vacuous scan would be worse than no scan.
    expect(modules).toContain(`src/unified/${name}.ts`);
    expect(modules).toContain("src/core/unified/kernel.ts");
    expect(modules).toContain("src/core/pipeline.ts");

    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);
    expect(modules.filter((m) => m.startsWith("src/catalog/availability/"))).toEqual([]);
    expect(modules.filter((m) => m.endsWith("/interop.ts"))).toEqual([]);
  });
});

describe("unmodel/speech (the first ready-made pack)", () => {
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
    // Six of the fourteen serve more than one category, so their adapters are
    // split per category and this pack imports only the speech half — see the
    // independence test below.
    const SPLIT = new Set([
      "cartesia",
      "deepgram",
      "elevenlabs",
      "inworld",
      "minimax",
      "openai",
    ]);
    for (const provider of SPEECH_PACK_PROVIDERS) {
      const leaf = SPLIT.has(provider) ? "unified-speech" : "unified";
      expect(modules).toContain(`src/providers/${provider}/${leaf}.ts`);
      expect(modules).toContain(`src/providers/${provider}/speech.ts`);
      // The barrel is never in a pack's graph: importing it would pull the
      // other categories' adapters — and their catalogs — in with it.
      if (SPLIT.has(provider)) {
        expect(modules).not.toContain(`src/providers/${provider}/unified.ts`);
      }
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
    // The eleven providers that serve more than one category split their
    // adapter per category, and each pack imports only its own half — which is
    // what the independence test below is measuring in bytes. The image-edit
    // wave added three: black-forest-labs, ideogram and recraft each grew an
    // editing adapter, and a single `unified.ts` holding both would have put
    // their edit validators in this pack for nothing.
    const SPLIT = new Set([
      "black-forest-labs",
      "bytedance",
      "google",
      "ideogram",
      "kling",
      "luma",
      "openai",
      "recraft",
      "runway",
      "stability",
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

describe("unmodel/transcribe (the fourth ready-made pack)", () => {
  /**
   * The composition assertion. Five of the eleven also serve a speech surface
   * and one also serves image and video, so an adapter that imported its
   * provider's barrel instead of the transcribe leaf would drag a second
   * category's validators and catalogs in without changing a single import in
   * `src/unified/transcribe.ts`.
   */
  test("it reaches exactly the eleven transcribe providers, through their adapters", () => {
    const modules = sourceModulesOf(unifiedEntry("transcribe"));
    expect(modules).toContain("src/unified/transcribe.ts");
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual(TRANSCRIBE_PACK_PROVIDERS);

    // Six of the eleven serve transcription only, so their adapter is the
    // unsuffixed leaf; the other five split per category.
    const SPLIT = new Set(["cartesia", "deepgram", "elevenlabs", "inworld", "openai"]);
    for (const provider of TRANSCRIBE_PACK_PROVIDERS) {
      const leaf = SPLIT.has(provider) ? "unified-transcribe" : "unified";
      expect(modules).toContain(`src/providers/${provider}/${leaf}.ts`);
      if (SPLIT.has(provider)) {
        expect(modules).not.toContain(`src/providers/${provider}/unified.ts`);
      }
      // Every provider's endpoint module is addressed as `transcribe.ts`, which
      // is the rename made structural: the pack cannot reach a provider except
      // through a file with the uniform name. Eight wire spellings —
      // `transcription`, `transcriptions`, `transcript`, `speech-to-text`,
      // `listen`, `pre-recorded`, `jobs`, `stt` — collapse onto one.
      expect(modules).toContain(`src/providers/${provider}/transcribe.ts`);
    }
  });

  test("its graph carries exactly one catalog, and no availability or retarget layer", () => {
    const modules = sourceModulesOf(unifiedEntry("transcribe"));
    expect(modules.filter((m) => m.startsWith("src/catalog/")).sort()).toEqual(
      TRANSCRIBE_PACK_CATALOGS,
    );
    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);
    expect(modules.filter((m) => m.endsWith("/interop.ts"))).toEqual([]);
    // The chat half of a provider that serves both is the loudest possible
    // leak: `mistral/index.ts` would bring the openai-compatible dialect in.
    expect(modules).not.toContain("src/providers/mistral/chat.ts");
    // …but the four-layer engine IS here: the pack ends in the providers' own
    // validators.
    expect(modules).toContain("src/core/pipeline.ts");
  });

  test("the speech and transcribe packs share five providers and no endpoints", () => {
    const transcribe = sourceModulesOf(unifiedEntry("transcribe"));
    const speech = sourceModulesOf(unifiedEntry("speech"));
    expect(transcribe).not.toContain("src/unified/speech.ts");
    expect(speech).not.toContain("src/unified/transcribe.ts");
    // The five shared providers contribute one endpoint each, per pack — this
    // is what the per-category adapter split buys, and it is the reason
    // `unmodel/speech` does not carry eleven STT validators.
    //
    // cartesia is the one exception, and it is the provider's own doing rather
    // than the adapter's: `cartesia/transcribe.ts` imports `CARTESIA_VERSION` from
    // `./speech`, so the TTS module rides along in this pack for one constant.
    // Pinned as an exception so that a *second* one has to be typed out here.
    for (const shared of ["cartesia", "deepgram", "elevenlabs", "inworld", "openai"]) {
      expect(speech).toContain(`src/providers/${shared}/speech.ts`);
      if (shared !== "cartesia") {
        expect(transcribe).not.toContain(`src/providers/${shared}/speech.ts`);
      }
    }
    for (const shared of ["cartesia", "deepgram", "elevenlabs", "inworld", "openai"]) {
      expect(transcribe).toContain(`src/providers/${shared}/transcribe.ts`);
      expect(speech).not.toContain(`src/providers/${shared}/transcribe.ts`);
    }
  });
});

describe("unmodel/music (the fifth and smallest ready-made pack)", () => {
  test("it reaches exactly the two music providers, through their adapters", () => {
    const modules = sourceModulesOf(unifiedEntry("music"));
    expect(modules).toContain("src/unified/music.ts");
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual(MUSIC_PACK_PROVIDERS);

    // Both serve more than one category, so both adapters are suffixed leaves,
    // and both endpoint modules are addressed as `music.ts` — the rename made
    // structural, exactly as in the other four packs.
    for (const provider of MUSIC_PACK_PROVIDERS) {
      expect(modules).toContain(`src/providers/${provider}/unified-music.ts`);
      expect(modules).toContain(`src/providers/${provider}/music.ts`);
      expect(modules).not.toContain(`src/providers/${provider}/unified.ts`);
    }
    // Stability's two audio-conditioned routes are wire-only in v1 — they live
    // in the same module as `music`, so what this pins is that no *adapter*
    // exists for them and no other Stability route joined the graph.
    expect(modules.filter((m) => /^src\/providers\/stability\/unified/.test(m))).toEqual([
      "src/providers/stability/unified-music.ts",
    ]);
  });

  test("its graph carries no generated catalog, availability data or retarget layer", () => {
    const modules = sourceModulesOf(unifiedEntry("music"));
    expect(modules.filter((m) => m.startsWith("src/catalog/"))).toEqual([]);
    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);
    expect(modules.filter((m) => m.endsWith("/interop.ts"))).toEqual([]);
    // ElevenLabs is in three packs; music must carry only its music endpoint.
    expect(modules).not.toContain("src/providers/elevenlabs/speech.ts");
    expect(modules).not.toContain("src/providers/elevenlabs/transcribe.ts");
    // Stability is in two; music must not carry the Stable Image routes.
    expect(modules).not.toContain("src/providers/stability/image.ts");
    expect(modules).toContain("src/core/pipeline.ts");
  });

  test("the six packs are independent — none pulls another's entry in", () => {
    for (const name of ALL_UNIFIED_ENTRIES) {
      const modules = sourceModulesOf(unifiedEntry(name));
      for (const other of ALL_UNIFIED_ENTRIES) {
        if (other === name) continue;
        expect(modules, `unified/${name} pulls unified/${other}`).not.toContain(
          `src/unified/${other}.ts`,
        );
      }
    }
  });
});

describe("unmodel/image-edit (the sixth and last ready-made pack)", () => {
  /**
   * The composition assertion. This pack is the one where the *per-category
   * adapter split* is doing the most work of all six: every one of its four
   * providers also serves `unmodel/image`, so an adapter that imported its
   * provider's barrel instead of the image-edit leaf would drag that provider's
   * whole generation surface — validators, size tables, catalogs — into a pack
   * that can never call it, without changing a single import in
   * `src/unified/image-edit.ts`.
   */
  test("it reaches exactly the four image-edit providers, through their adapters", () => {
    const modules = sourceModulesOf(unifiedEntry("image-edit"));
    expect(modules).toContain("src/unified/image-edit.ts");
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual(IMAGE_EDIT_PACK_PROVIDERS);

    for (const provider of IMAGE_EDIT_PACK_PROVIDERS) {
      // All four serve two categories, so all four adapters are suffixed
      // leaves and the barrel is never in this graph.
      expect(modules).toContain(`src/providers/${provider}/unified-image-edit.ts`);
      expect(modules).not.toContain(`src/providers/${provider}/unified.ts`);
      // Every provider's editing endpoint module is addressed as
      // `image-edit.ts`, which is the rename made structural: the pack cannot
      // reach a provider except through a file with the uniform name. Four wire
      // spellings — `images-edit`, `kontext`, `edit`, `transform` — collapse
      // onto one.
      expect(modules).toContain(`src/providers/${provider}/image-edit.ts`);
    }
  });

  /**
   * Two providers' *generation* endpoint modules ride along, and both are the
   * provider's own doing rather than the adapter's — the same shape as the
   * cartesia exception in the transcribe pack, and pinned as exceptions so that
   * a *third* one has to be typed out here:
   *
   * - `black-forest-labs/image-edit.ts` imports `bflModelUrl` and
   *   `BFL_OUTPUT_FORMATS` from `./image` (the model IS the route on that API,
   *   and the URL builder lives with the FLUX.2 endpoint);
   * - `ideogram/image-edit.ts` imports the rendering-speed, resolution and
   *   aspect-ratio enums from `./image`, because the editing routes share the
   *   generation route's vocabulary verbatim.
   *
   * Neither pulls a *catalog* that the pack does not already need, and neither
   * is an adapter reaching sideways — which is what the assertion below pins.
   */
  test("only the two documented generation modules ride along", () => {
    const modules = sourceModulesOf(unifiedEntry("image-edit"));
    const generation = modules.filter((m) => /^src\/providers\/[^/]+\/image\.ts$/.test(m)).sort();
    expect(generation).toEqual([
      "src/providers/black-forest-labs/image.ts",
      "src/providers/ideogram/image.ts",
    ]);
    // OpenAI's and Recraft's edit modules reach `./image` for *types* only, so
    // those two generation validators stay out — which is the difference a
    // type-only import makes, measured.
    expect(modules).not.toContain("src/providers/openai/image.ts");
    expect(modules).not.toContain("src/providers/recraft/image.ts");
  });

  test("its graph carries exactly one catalog, and no chat or speech surface", () => {
    const modules = sourceModulesOf(unifiedEntry("image-edit"));
    expect(modules.filter((m) => m.startsWith("src/catalog/")).sort()).toEqual(
      IMAGE_EDIT_PACK_CATALOGS,
    );
    // OpenAI is in five packs; this one must carry only its edit endpoint.
    expect(modules).not.toContain("src/providers/openai/chat.ts");
    expect(modules).not.toContain("src/providers/openai/speech.ts");
    expect(modules).not.toContain("src/providers/openai/transcribe.ts");
    expect(modules).not.toContain("src/providers/openai/video.ts");
    expect(modules).toContain("src/core/pipeline.ts");
  });

  test("the image and image-edit packs share four providers and no endpoints", () => {
    const edit = sourceModulesOf(unifiedEntry("image-edit"));
    const generate = sourceModulesOf(unifiedEntry("image"));
    expect(edit).not.toContain("src/unified/image.ts");
    expect(generate).not.toContain("src/unified/image-edit.ts");
    // The generation pack must not acquire an editing validator, which is the
    // failure the split exists to prevent in the other direction: `unmodel/image`
    // is the largest pack in the library and has the least room to spare.
    for (const provider of IMAGE_EDIT_PACK_PROVIDERS) {
      expect(generate).not.toContain(`src/providers/${provider}/unified-image-edit.ts`);
      expect(generate).not.toContain(`src/providers/${provider}/image-edit.ts`);
      expect(edit).not.toContain(`src/providers/${provider}/unified-image.ts`);
    }
  });
});
