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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
 *
 * **google, 235 → 310.** The investigation this header demands was run rather
 * than skipped, and it names six modules — all of them google's own, none of
 * them a catalog, and all of them new *code* rather than a graph that leaked:
 * `unmodel/google` grew two endpoints. Measured at 286.3 KiB, up 55 from 231,
 * and the 55 is accounted for module by module (unminified ESM, so the prose
 * ships too):
 *
 * | module | KiB | what it is |
 * |---|---|---|
 * | `google/stt.ts` | 14.3 | the `google.stt` validator: part union, typed `audioTranscriptionConfig`, T1–T9, the audio-token estimate |
 * | `google/tts.ts` | 12.4 | the `google.tts` validator: the XOR speech arms, the audio-format union, S6/S12/S13 |
 * | `google/tts-checks.ts` | 9.7 | the speech battery `chat.ts` now CALLS instead of owning — a move, not an addition, plus the five new S7–S11 rules both surfaces gained |
 * | `google/tts-constraints.ts` | 6.3 | the 78-language table and the audio-format maps; import-free so `unmodel/tts` can reach them without a catalog |
 * | `google/audio-constraints.ts` | 5.2 | the audio input formats, caps, token rate and the 13+6 STT curation lists; likewise import-free |
 * | `google/tts-check.ts` | 4.8 | `checkTts`, priced off the three hand rows rather than the generated catalog |
 * | `google/tts-models.ts` | 2.0 | those three hand rows |
 *
 * Two of those seven are not really growth at all: `tts-checks.ts` and both
 * constraint leaves were already in this entry as bytes inside `chat.ts` and
 * `constraints.ts`, and the module boundary is what lets `google.tts` run the
 * identical rules without dragging the generated catalog. The genuinely new
 * weight is the two validators and their response checker, which is what two
 * endpoints cost. 310 restores the ~8% headroom the 235 had.
 */
const BUDGET_KIB: Readonly<Record<string, number>> = {
  anthropic: 150,
  groq: 125,
  google: 310,
  deepinfra: 190,
  openrouter: 400,
  vercel: 355,
};

/**
 * `unmodel/chat` is the ready-made 32-provider pack. It carries every concrete
 * provider validator, its catalog and (where offered) availability table so
 * provider `.toApi` survives the unified call — asserted for real, across a
 * dialect boundary, in `test/chat/compile.test.ts`. It also retains the public
 * slim profile export for discovery, which is ~379 KiB (22%) of the number
 * below for data no validation path reads.
 *
 * 1718.7 KiB measured; 1800 leaves ~4.5% headroom. Applications that need a
 * narrow graph use `unmodel/chat/factory` below.
 */
const CHAT_BUDGET_KIB = 1800;

/** Provider-free compiler/factory entry; 144.0 KiB measured, ~4% headroom. */
const CHAT_FACTORY_BUDGET_KIB = 150;

/**
 * `dist/chat/index.d.ts` on its own — declarations, not chunks.
 *
 * A separate number because a `.d.ts` regression is invisible to every other
 * gate: types erase, so no JS budget moves, `tsc` stays clean and every test
 * passes. This entry shipped at 891.9 KiB until `chat` was annotated with
 * `ChatValidator<ChatProviderValidatorRegistry>` — without the annotation
 * `const`-inference emits the whole 32-provider registry expansion twice, and
 * the second copy was 48% of the file. 455.0 KiB measured.
 */
const CHAT_DECLARATION_BUDGET_KIB = 500;

/**
 * `dist/catalog/index.d.ts` on its own, for the reason above and one specific
 * to this entry.
 *
 * `unmodel/catalog` is where the `ProviderId` type lives, so a project that
 * only wants to name a provider resolves this file. Its `catalog` export is
 * annotated `Record<ProviderId, ProviderCatalog>`, which erases all 184 `.gen`
 * namespaces from the declaration — dropping that annotation in favour of
 * `satisfies` (which is what keeps the literals, and is exactly what
 * `unmodel/catalog/typed` does) takes this file from ~4 KiB to ~3.6 MB: a
 * ~900x regression on the obvious specifier, invisible to `tsc`, invisible to
 * every JS budget, and paid by every downstream project. That is the same
 * trade docs/decisions.md §3 settled for `unmodel/chat`, and this number is
 * what makes "the cheap path is the only path" checkable. 4.3 KiB measured.
 */
const CATALOG_DECLARATION_BUDGET_KIB = 8;

/**
 * …and the opt-in entry's own ceiling, so the heavy half cannot grow unnoticed
 * either. 3607.1 KiB measured; 4200 leaves ~14% for catalog growth (the
 * snapshot gains providers between releases, and each one lands here).
 */
const TYPED_CATALOG_DECLARATION_BUDGET_KIB = 4200;

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
  "tts",
  "stt",
  "music",
];

/**
 * `unmodel/tts`'s budget: the kernel plus fourteen TTS providers — each
 * one's validator, zod schema, constraint table and hand-written catalog.
 *
 * 371 KiB measured, pinned at 400 with the same ~10% headroom as everything
 * above. It is roughly twice what a "150–200 KiB" back-of-envelope suggested,
 * and the reason is worth writing down rather than rounding away: the fourteen
 * speech endpoints are validator-heavy rather than catalog-heavy (Deepgram
 * alone carries 105 Aura voices as catalog rows, and OpenAI's speech
 * constraints ride in the same 617-line table as its images and chat ones), so
 * the weight is code, not data. A caller who wants two providers builds their
 * own pack with `createTts([…])` and pays 40–60 KiB.
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
 * `test/unified/tts-presets.test.ts`, and a table whose per-model
 * distinctions are not explained is a table nobody can audit against the wire.
 * Pinned at 430, which keeps the ~6% headroom the 400 had.
 *
 * **Bumped 430 → 500 when Gemini joined**, and the investigation this file's
 * header demands was run rather than skipped: 467.4 KiB measured, up 55 from
 * 412, and every one of those KiB is named below. Seven modules joined this
 * graph, all of them google's own, **none of them a catalog** — the zero-catalog
 * assertion below still holds, which is the thing that would actually have been
 * expensive:
 *
 * | module | what it is |
 * |---|---|
 * | `google/unified-tts.ts` | the adapter: the FORMAT spec, the 30-voice / 78-language rows, the speed gap |
 * | `google/tts.ts` | the `google.tts` validator this pack now ends in |
 * | `google/tts-checks.ts` | the shared speech battery it calls |
 * | `google/tts-constraints.ts` | the 78-language table and the audio-format maps — import-free, which is *why* no catalog came with them |
 * | `google/tts-models.ts` | the three hand rows (a generated catalog here would have cost ~90 KiB) |
 * | `google/wire.ts` | reached for `GEMINI_TTS_VOICES`, which is where `voiceName` is typed from |
 * | `google/model-path.ts` | six lines: `models/{id}:{method}` |
 *
 * `wire.ts` is the one that looks like a leak and is not: a wire leaf may not
 * import a constraints module, so the 30 preset voice names live there and both
 * the wire check and this adapter read the same array. Its zod schema constants
 * are dead code in this entry and stay as a ~1.6 KiB remnant, which was the
 * accepted price of not declaring the voices twice.
 */
const TTS_PACK_BUDGET_KIB = 500;

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
 * `unmodel/stt`'s budget: the kernel plus eleven STT providers.
 *
 * 360 KiB measured, pinned at 390 with the same ~10% headroom as everything
 * above — within a few KiB of the speech pack, and for the same reason: these
 * are eleven long, check-heavy validators (AssemblyAI's `/v2/transcript` alone
 * carries fifty wire fields and thirteen cross-field rules) over small
 * hand-written catalogs. `createStt([…])` is the way to pay for two
 * providers instead of eleven.
 *
 * **Why it moved from 390.** The per-model wave, and this is the pack it cost
 * the most: 395 KiB measured, up 29 from 366. The reason is the same fact the
 * paragraph above gives — these are the widest wire surfaces in the library, so
 * they are also the widest *extras* tables. AssemblyAI declares 34 keys,
 * Deepgram 29 across 38 generated rows, Speechmatics 19 with per-key nesting;
 * each is one `EXTRA` witness at run time plus the sentence that says which
 * models take it and why. Pinned at 420, keeping the ~6% headroom the 390 had.
 *
 * **Bumped 420 → 520 when Gemini joined**, and this is the one pack where the
 * bump is mostly *data* rather than code: 482.8 KiB measured, up 78 from 404.7.
 * Six google modules joined — `unified-stt.ts`, `stt.ts`, `audio-constraints.ts`,
 * `tts-checks.ts` (for the shared capability triple), `tts-constraints.ts` and
 * `wire.ts` — and with them **`src/catalog/google.gen.ts`**, which is ~55 of the
 * 78 KiB on its own and is now the second entry in {@link STT_PACK_CATALOGS}.
 *
 * That catalog is load-bearing rather than leaked, and the choice behind it was
 * made deliberately: `google.stt`'s Tier-A arms key off the generated flags
 * (`ModelsWhereFalse<GoogleCatalog, …>`), and the thirteen curated ids need no
 * doc correction to any field — so hand rows here would be a *second opinion on
 * generated data*, which is exactly what `google.tts`'s three rows are allowed
 * to be only because they carry a documented correction (32k context against
 * models.dev's 8192). `mistral.gen.ts` is here for the mirror-image reason: it
 * is supplemented, not replaced.
 */
const STT_PACK_BUDGET_KIB = 520;

/**
 * The two generated catalogs this pack legitimately reaches, and nothing else.
 *
 * Both are load-bearing rather than leaked:
 *
 * - `mistral/audio-models.ts` supplements `src/catalog/mistral.gen.ts`, which
 *   carries only the `voxtral-*-latest` aliases and none of the dated
 *   transcription ids or the per-minute rates;
 * - `google/stt.ts` reads `src/catalog/google.gen.ts` **directly** — the one
 *   endpoint in the audio packs that does. It is the choice the STT budget's
 *   note above argues: thirteen curated ids with nothing to doc-correct, whose
 *   Tier-A arms are keyed off the generated capability flags, so hand rows would
 *   be a second opinion on generated data rather than a correction to it.
 *
 * A *third* entry here means a provider barrel leaked in.
 */
const STT_PACK_CATALOGS: string[] = [
  "src/catalog/google.gen.ts",
  "src/catalog/mistral.gen.ts",
];

/** The twelve providers `unmodel/stt`'s ready-made pack is allowed to reach. */
const STT_PACK_PROVIDERS: string[] = [
  "assemblyai",
  "cartesia",
  "deepgram",
  "elevenlabs",
  "gladia",
  "google",
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
 *
 * **Bumped 150 → 160 with the type-tightening wave**, and the investigation
 * this file's header demands was run rather than skipped: the pack's module
 * graph is byte-for-byte the same **13 files** it was before (no module joined,
 * nothing re-exported), and the growth is +0.8 KiB inside `core/cost.ts` — the
 * `Minutes` unit brand's three one-line constructors and the paragraph
 * explaining why a bare `number` there was one omitted `/ 60` from a 60x
 * overcharge. Comments ship in an unminified ESM build, so documentation is
 * real bytes here. The same increment landed on the other five packs (image
 * 755.7 → 757.1, video 614.4 → 616.4, speech 409.8 → 412.2, transcribe 401.7 →
 * 404.7 KiB), all of which absorbed it inside their headroom.
 *
 * The reason it failed *here* is that the previous bump's own note was already
 * true again: measured at HEAD, this pack stood at **149.8 KiB against a 150
 * budget** — 99.9% consumed, so any addition to any shared chunk would have
 * tripped it. Restoring ~10% headroom is what a budget with none left needs;
 * the alternative on offer was deleting documentation to buy 0.2 KiB, which
 * would have made the number pass without making the bundle meaningfully
 * smaller.
 */
const MUSIC_PACK_BUDGET_KIB = 160;

/** The two providers `unmodel/music`'s ready-made pack is allowed to reach. */
const MUSIC_PACK_PROVIDERS: string[] = ["elevenlabs", "stability"];

/** The fifteen providers `unmodel/tts`'s ready-made pack is allowed to reach. */
const TTS_PACK_PROVIDERS: string[] = [
  "cartesia",
  "deepgram",
  "elevenlabs",
  "fish-audio",
  "google",
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
  tts: TTS_PACK_BUDGET_KIB,
  stt: STT_PACK_BUDGET_KIB,
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

/** TypeScript resolves `.js` specifiers in declarations to sibling `.d.ts`. */
function transitiveDeclarations(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(FROM_IMPORT)) {
      const specifier = match[1] as string;
      if (!specifier.startsWith(".")) continue;
      const resolved = resolve(dirname(file), specifier);
      const declaration = resolved.endsWith(".js")
        ? `${resolved.slice(0, -3)}.d.ts`
        : resolved;
      visit(existsSync(declaration) ? declaration : resolved);
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
const chatFactoryEntry = (): string => join(DIST, "chat", "factory.js");
const unifiedEntry = (name: string): string => join(DIST, "unified", `${name}.js`);

// CI runs `bun test` before `bun run build`, and `dist/` is gitignored, so the
// suite builds on demand rather than depending on run order. `clean: true` in
// tsdown.config.ts makes this idempotent with the later CI build step.
const built =
  (existsSync(entryFile("anthropic")) && existsSync(chatFactoryEntry())) ||
  (await $`bun run build`.quiet().then(() => true));

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

  /**
   * `unmodel/google-vertex` reaches `unmodel/google`'s **barrel** — its
   * `check.ts` imports `checkChat` from `../google`, and its `index.ts` imports
   * a dozen wire types from the same place. That is a re-export away from being
   * the most expensive import in the library, and until this wave nothing said
   * so: the barrel now names five endpoint validators, and a single value that
   * failed to shake would put a whole second provider inside this entry.
   *
   * So what is pinned is what survives tree-shaking, measured rather than
   * assumed:
   *
   * - **absent**, and each for real money: `google/chat.ts` (the validator the
   *   barrel's `checkChat` sits beside), `google/stt.ts`, `google/image.ts`,
   *   `google/video.ts`, and every unified adapter;
   * - **present, and named because it is not free**: `google/tts.ts` rides in
   *   at ~12 KiB. Nothing imports it — `tts-check.ts` needs only
   *   `./tts-models` — but rolldown emits those two modules as one chunk, so
   *   the validator arrives with the three rows its cost estimate reads. A
   *   chunking artifact rather than a graph edge, and pinned here so that if it
   *   ever *stops* being one the diff says which.
   */
  test("google-vertex reaches google's check helpers and none of its endpoints", () => {
    const modules = sourceModulesOf(entryFile("google-vertex"));
    // A vacuous scan would be worse than no scan.
    expect(modules).toContain("src/providers/google-vertex/chat.ts");
    expect(modules).toContain("src/providers/google/check.ts");

    for (const endpoint of ["chat", "stt", "image", "video"]) {
      expect(
        modules,
        `google-vertex pulls google/${endpoint}.ts through the barrel`,
      ).not.toContain(`src/providers/google/${endpoint}.ts`);
    }
    expect(modules.filter((m) => /^src\/providers\/google\/unified/.test(m))).toEqual([]);
    expect(modules).not.toContain("src/providers/google/constraints.ts");

    // The measured exception; see the note above.
    expect(modules).toContain("src/providers/google/tts.ts");
  });
});

describe("unmodel/catalog", () => {
  test(`its declaration file stays under ${CATALOG_DECLARATION_BUDGET_KIB} KiB`, () => {
    const file = join(DIST, "catalog", "index.d.ts");
    expect(existsSync(file), "dist declaration for catalog").toBe(true);
    const kib = statSync(file).size / 1024;
    expect(kib, `catalog/index.d.ts is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      CATALOG_DECLARATION_BUDGET_KIB,
    );
  });

  test("its declaration names no generated namespace — that is what the annotation buys", () => {
    const file = join(DIST, "catalog", "index.d.ts");
    const text = readFileSync(file, "utf8");
    // One import, and it is the shared core types chunk. A `.gen` SPECIFIER
    // here means the widening was dropped and the 3.6 MB came with it. (The
    // prose in the doc comment mentions `.gen`, hence the specifier-shaped
    // pattern rather than a bare substring.)
    expect(text).not.toMatch(/from "[^"]*\.gen/);
    expect(text.match(/^import /gm) ?? []).toHaveLength(1);
  });

  test(`the opt-in typed entry stays under ${TYPED_CATALOG_DECLARATION_BUDGET_KIB} KiB`, () => {
    const file = join(DIST, "catalog", "typed.gen.d.ts");
    expect(existsSync(file), "dist declaration for catalog/typed").toBe(true);
    const kib = statSync(file).size / 1024;
    expect(kib, `catalog/typed.gen.d.ts is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      TYPED_CATALOG_DECLARATION_BUDGET_KIB,
    );
    // …and that it IS the heavy one, so a future regression cannot pass by
    // quietly widening both halves back to the same cheap shape.
    expect(kib).toBeGreaterThan(CATALOG_DECLARATION_BUDGET_KIB * 100);
  });

  test("both entries share one runtime object — the split is declarations only", () => {
    const cheap = readFileSync(join(DIST, "catalog", "index.js"), "utf8");
    const typed = readFileSync(join(DIST, "catalog", "typed.gen.js"), "utf8");
    // `index.js` imports the registry rather than declaring a second copy of
    // it; a caller who reaches for both entries pays for one.
    expect(cheap).toMatch(/from "\.\.\/typed\.gen-/);
    expect(typed).toMatch(/from "\.\.\/typed\.gen-/);
  });
});

describe("unmodel/chat", () => {
  test(`stays under ${CHAT_BUDGET_KIB} KiB`, () => {
    expect(existsSync(chatEntry()), "dist entry for chat").toBe(true);
    const kib = transitiveBytes(chatEntry()) / 1024;
    expect(kib, `chat is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(CHAT_BUDGET_KIB);
  });

  test(`its declaration file stays under ${CHAT_DECLARATION_BUDGET_KIB} KiB`, () => {
    const file = join(DIST, "chat", "index.d.ts");
    expect(existsSync(file), "dist declaration for chat").toBe(true);
    const kib = statSync(file).size / 1024;
    expect(kib, `chat/index.d.ts is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      CHAT_DECLARATION_BUDGET_KIB,
    );
  });

  test("its graph contains the compiler's own modules", () => {
    const modules = new Set(sourceModulesOf(chatEntry()));
    // Every module under src/chat that emits runtime code has to actually be
    // reached — a compiler step that quietly stopped being part of the entry
    // would show up here and nowhere else.
    //
    // `providers.ts` is the one exception and is pinned separately: it exports
    // a single const used exactly once, so rolldown folds it into the entry's
    // `createChat({ … })` call and emits no region marker for it.
    for (const module of [
      "src/chat/compile.ts",
      "src/chat/encode.ts",
      "src/chat/factory.ts",
      "src/chat/index.ts",
      "src/chat/media-paths.ts",
      "src/chat/refs.ts",
      "src/chat/schema.ts",
      "src/chat/validate.ts",
      "src/chat/wire-paths.ts",
    ]) {
      expect([...modules], `${module} is not in the chat graph`).toContain(module);
    }

    // The registry, inlined: one key per statically addressable provider.
    const entry = readFileSync(chatEntry(), "utf8");
    const registry = entry.slice(entry.indexOf("createChat({"), entry.indexOf("createChat({") + 2000);
    for (const provider of ["alibaba", "anthropic", "google", "openai", "zhipuai"]) {
      expect(registry, `${provider} is missing from the inlined registry`).toContain(provider);
    }
    expect(entry.includes('"fireworks-ai":')).toBe(true);
  });

  /**
   * The 51 provider modules the registry drags in, enumerated.
   *
   * Counting *directories* — which is all the import-graph rule can do — says
   * 32 and stays 32 no matter what a barrel grows. 29 of the 32 providers ship
   * only an `index.ts`, so the registry has to import a barrel for them, and a
   * barrel re-exports whatever its provider adds next: `../providers/mistral`
   * already pulls a transcription endpoint and its audio catalog (~22 KiB) into
   * a chat entry. That is a fact worth a name in a diff, not headroom to be
   * absorbed silently.
   *
   * Two entries look surprising and are legitimate: `google/chat-tts-overlay.ts`
   * is imported by `google/chat.ts` for `chatModels`, and `google/veo-models.ts`
   * by `google/constraints.ts` for its media rules — both leaf-driven, not
   * barrel leakage.
   *
   * **51 → 54 with the google speech surfaces**, and all three are google's,
   * all three are leaf-driven, and none of them is a catalog:
   *
   * - `google/tts-constraints.ts` and `google/audio-constraints.ts` are the two
   *   import-free leaves the TTS/STT constants moved into (`google.tts` may not
   *   reach `google/constraints.ts`, which reads the generated catalog). They
   *   were always in this graph — as bytes inside `constraints.ts` — and are
   *   now named.
   * - `google/tts-checks.ts` is the shared speech check battery `chat.ts` now
   *   CALLS instead of owning. Same reason: those checks were already here, in
   *   `chat.ts`'s body, and the module boundary is what lets `google.tts` run
   *   the identical rules.
   *
   * `google/tts-models.ts` in the old list is `google/chat-tts-overlay.ts` in
   * the new one — a rename, not a departure; `google/tts-models.ts` now names
   * the dedicated surface's three hand rows and is deliberately NOT here.
   */
  test("its provider graph is exactly the enumerated 54 modules", () => {
    const modules = sourceModulesOf(chatEntry()).filter((m) => m.startsWith("src/providers/"));
    expect(modules).toEqual([
      "src/providers/alibaba/index.ts",
      "src/providers/anthropic/chat.ts",
      "src/providers/anthropic/constraints.ts",
      "src/providers/anthropic/interop.ts",
      "src/providers/anthropic/wire.ts",
      "src/providers/baseten/index.ts",
      "src/providers/cerebras/index.ts",
      "src/providers/deepinfra/index.ts",
      "src/providers/deepseek/index.ts",
      "src/providers/fireworks-ai/index.ts",
      "src/providers/friendli/index.ts",
      "src/providers/google/audio-constraints.ts",
      "src/providers/google/chat-tts-overlay.ts",
      "src/providers/google/chat.ts",
      "src/providers/google/constraints.ts",
      "src/providers/google/interop.ts",
      "src/providers/google/model-path.ts",
      "src/providers/google/tts-checks.ts",
      "src/providers/google/tts-constraints.ts",
      "src/providers/google/veo-models.ts",
      "src/providers/google/wire.ts",
      "src/providers/groq/constraints.ts",
      "src/providers/groq/index.ts",
      "src/providers/huggingface/index.ts",
      "src/providers/inception/index.ts",
      "src/providers/longcat/index.ts",
      "src/providers/meta/index.ts",
      "src/providers/minimax/index.ts",
      // Barrel leakage, measured: mistral's index re-exports its transcribe
      // endpoint. Deleting these three lines requires giving mistral a
      // `chat.ts` leaf, not loosening the assertion.
      "src/providers/mistral/audio-models.ts",
      "src/providers/mistral/index.ts",
      "src/providers/mistral/stt.ts",
      "src/providers/mistral/transcription-check.ts",
      "src/providers/moonshotai/index.ts",
      "src/providers/nebius/index.ts",
      "src/providers/novita-ai/index.ts",
      "src/providers/nvidia/index.ts",
      "src/providers/openai-compatible/chat-completions.ts",
      "src/providers/openai-compatible/check.ts",
      "src/providers/openai-compatible/index.ts",
      "src/providers/openai-compatible/interop.ts",
      "src/providers/openai-compatible/wire.ts",
      "src/providers/openai/chat.ts",
      "src/providers/openai/constraints.ts",
      "src/providers/openrouter/index.ts",
      "src/providers/perplexity/index.ts",
      "src/providers/sarvam/index.ts",
      "src/providers/scaleway/index.ts",
      "src/providers/siliconflow/index.ts",
      "src/providers/stepfun/index.ts",
      "src/providers/togetherai/index.ts",
      "src/providers/upstage/index.ts",
      "src/providers/vercel/index.ts",
      "src/providers/xai/index.ts",
      "src/providers/zhipuai/index.ts",
    ]);
  });

  test("its graph contains the ready registry's exact catalogs and availability", () => {
    const modules = sourceModulesOf(chatEntry());
    // A vacuous scan would be worse than no scan.
    expect(modules).toContain("src/chat/index.ts");
    expect(modules).toContain("src/catalog/chat-profiles.gen.ts");

    expect(modules.filter((m) => m.startsWith("src/catalog/availability/"))).toEqual([
      "src/catalog/availability/anthropic.gen.ts",
      "src/catalog/availability/baseten.gen.ts",
      "src/catalog/availability/friendli.gen.ts",
      "src/catalog/availability/google.gen.ts",
      "src/catalog/availability/mistral.gen.ts",
      "src/catalog/availability/nebius.gen.ts",
      "src/catalog/availability/nvidia.gen.ts",
      "src/catalog/availability/openai.gen.ts",
      "src/catalog/availability/scaleway.gen.ts",
      "src/catalog/availability/siliconflow.gen.ts",
      "src/catalog/availability/xai.gen.ts",
    ]);

    const CHAT_TABLES = new Set([
      "src/catalog/chat-profiles.gen.ts",
      "src/catalog/chat-refs.gen.ts",
    ]);
    const catalogs = modules.filter(
      (m) =>
        /^src\/catalog\/.*\.gen\.ts$/.test(m) &&
        !m.startsWith("src/catalog/availability/") &&
        !CHAT_TABLES.has(m),
    );
    expect(catalogs).toEqual([
      "src/catalog/alibaba.gen.ts",
      "src/catalog/anthropic.gen.ts",
      "src/catalog/baseten.gen.ts",
      "src/catalog/cerebras.gen.ts",
      "src/catalog/deepinfra.gen.ts",
      "src/catalog/deepseek.gen.ts",
      "src/catalog/fireworks-ai.gen.ts",
      "src/catalog/friendli.gen.ts",
      "src/catalog/google.gen.ts",
      "src/catalog/groq.gen.ts",
      "src/catalog/huggingface.gen.ts",
      "src/catalog/inception.gen.ts",
      "src/catalog/longcat.gen.ts",
      "src/catalog/meta.gen.ts",
      "src/catalog/minimax.gen.ts",
      "src/catalog/mistral.gen.ts",
      "src/catalog/moonshotai.gen.ts",
      "src/catalog/nebius.gen.ts",
      "src/catalog/novita-ai.gen.ts",
      "src/catalog/nvidia.gen.ts",
      "src/catalog/openai.gen.ts",
      "src/catalog/openrouter.gen.ts",
      "src/catalog/perplexity.gen.ts",
      "src/catalog/sarvam.gen.ts",
      "src/catalog/scaleway.gen.ts",
      "src/catalog/siliconflow.gen.ts",
      "src/catalog/stepfun.gen.ts",
      "src/catalog/togetherai.gen.ts",
      "src/catalog/upstage.gen.ts",
      "src/catalog/vercel.gen.ts",
      "src/catalog/xai.gen.ts",
      "src/catalog/zhipuai.gen.ts",
    ]);
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

describe("unmodel/chat/factory", () => {
  test(`stays under ${CHAT_FACTORY_BUDGET_KIB} KiB before providers are supplied`, () => {
    expect(existsSync(chatFactoryEntry()), "dist entry for chat/factory").toBe(true);
    const kib = transitiveBytes(chatFactoryEntry()) / 1024;
    expect(kib, `chat/factory is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      CHAT_FACTORY_BUDGET_KIB,
    );
  });

  test("contains the compiler and codecs, but no ready registry or provider data", () => {
    const modules = sourceModulesOf(chatFactoryEntry());
    expect(modules).toContain("src/chat/factory.ts");
    expect(modules).not.toContain("src/chat/index.ts");
    expect(modules).not.toContain("src/chat/providers.ts");
    expect(modules).not.toContain("src/catalog/chat-profiles.gen.ts");
    expect(modules.filter((m) => /^src\/catalog\/.*\.gen\.ts$/.test(m))).toEqual([]);

    // Not "no endpoint validator" — *no provider module at all* beyond the
    // three codecs the compiler is made of. A catalog, a constraint table or a
    // wire schema arriving here would mean the narrow entry had quietly
    // acquired a provider, which is the one thing it exists not to do.
    expect(modules.filter((m) => m.startsWith("src/providers/"))).toEqual([
      "src/providers/anthropic/interop.ts",
      "src/providers/google/interop.ts",
      "src/providers/openai-compatible/interop.ts",
    ]);
  });

  test("its declaration graph does not reference the ready registry", () => {
    const declarations = transitiveDeclarations(join(DIST, "chat", "factory.d.ts"));
    const text = declarations.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(text).not.toContain("CHAT_PROVIDER_VALIDATORS");
    expect(text).not.toContain("src/chat/providers.d.ts");
    expect(text).not.toContain("src/chat/index.d.ts");
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

describe("unmodel/tts (the first ready-made pack)", () => {
  /**
   * The composition assertion, in the shape the kernel-only one had before a
   * pack existed: the *list* is what does the work, not the byte count.
   *
   * A pack that reaches a sixteenth provider, or that drags in a generated
   * catalog because someone imported `providers/<p>/index.ts` instead of the
   * adapter leaf, fails here in the diff that causes it — which is the whole
   * reason the adapters import `./tts` and not `.`.
   */
  test("it reaches exactly the fifteen tts providers, through their adapters", () => {
    const modules = sourceModulesOf(unifiedEntry("tts"));
    expect(modules).toContain("src/unified/tts.ts");
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual(TTS_PACK_PROVIDERS);

    // One adapter leaf per provider, and it is what pulled the provider in.
    // Seven of the fifteen serve more than one category, so their adapters are
    // split per category and this pack imports only the speech half — see the
    // independence test below. Google is the newest and the one with the most
    // to lose by a barrel: `google/unified.ts` also exports the Imagen, Veo and
    // stt adapters, and reaching it here would put three more
    // validators and the generated catalog in a tts bundle.
    const SPLIT = new Set([
      "cartesia",
      "deepgram",
      "elevenlabs",
      "google",
      "inworld",
      "minimax",
      "openai",
    ]);
    for (const provider of TTS_PACK_PROVIDERS) {
      const leaf = SPLIT.has(provider) ? "unified-tts" : "unified";
      expect(modules).toContain(`src/providers/${provider}/${leaf}.ts`);
      expect(modules).toContain(`src/providers/${provider}/tts.ts`);
      // The barrel is never in a pack's graph: importing it would pull the
      // other categories' adapters — and their catalogs — in with it.
      if (SPLIT.has(provider)) {
        expect(modules).not.toContain(`src/providers/${provider}/unified.ts`);
      }
    }
  });

  test("its graph carries no generated catalog, availability data or retarget layer", () => {
    const modules = sourceModulesOf(unifiedEntry("tts"));
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

  /**
   * Google is the one provider whose TTS surface shares a *route* with a chat
   * validator, so the zero-catalog assertion above is only half the story: what
   * keeps it true is that `google.tts` reaches the two **import-free**
   * constraint leaves rather than `google/constraints.ts`, which reads
   * `src/catalog/google.gen.ts` and `./veo-models.ts`. One edge from
   * `unified-tts.ts` or `tts.ts` to that module would put ~90 KiB of generated
   * rows and the whole Veo table into a tts bundle — and it would fail above
   * as a bare list mismatch, which says nothing about the cause. These name it.
   */
  test("google reaches the import-free leaves, never the constraint tables", () => {
    const modules = sourceModulesOf(unifiedEntry("tts"));
    expect(modules).toContain("src/providers/google/unified-tts.ts");
    expect(modules).toContain("src/providers/google/tts-constraints.ts");
    expect(modules).toContain("src/providers/google/tts-models.ts");

    expect(modules).not.toContain("src/providers/google/constraints.ts");
    expect(modules).not.toContain("src/providers/google/veo-models.ts");
    expect(modules).not.toContain("src/providers/google/chat.ts");
    expect(modules).not.toContain("src/providers/google/chat-tts-overlay.ts");
    expect(modules).not.toContain("src/providers/google/stt.ts");
    expect(modules).not.toContain("src/providers/google/audio-constraints.ts");
    expect(modules).not.toContain("src/providers/google/index.ts");
    expect(modules).not.toContain("src/providers/google/interop.ts");
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
    const tts = sourceModulesOf(unifiedEntry("tts"));
    expect(image).not.toContain("src/unified/tts.ts");
    expect(tts).not.toContain("src/unified/image.ts");
    // openai is in both packs and must contribute only the endpoint each pack
    // needs. This is what the per-category adapter split buys, and it is worth
    // 39 KiB: one module exporting both adapters is one *entry* chunk holding
    // both, so `unmodel/tts` carried OpenAI's image catalog — and the
    // generated `src/catalog/openai.gen.ts` behind it — for nothing.
    expect(image).not.toContain("src/providers/openai/tts.ts");
    expect(tts).not.toContain("src/providers/openai/image.ts");
    expect(tts.filter((m) => m.startsWith("src/catalog/"))).toEqual([]);
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
    const tts = sourceModulesOf(unifiedEntry("tts"));
    for (const other of ["image", "tts"]) {
      expect(video).not.toContain(`src/unified/${other}.ts`);
    }
    expect(image).not.toContain("src/unified/video.ts");
    expect(tts).not.toContain("src/unified/video.ts");
    // The seven shared providers contribute one category each, per pack.
    for (const shared of ["openai", "google", "luma", "kling", "runway", "vidu", "bytedance"]) {
      expect(video).not.toContain(`src/providers/${shared}/image.ts`);
      expect(image).not.toContain(`src/providers/${shared}/video.ts`);
    }
    expect(video).not.toContain("src/providers/openai/tts.ts");
    expect(video).not.toContain("src/providers/minimax/tts.ts");
    expect(tts).not.toContain("src/providers/minimax/video.ts");
  });
});

describe("unmodel/stt (the fourth ready-made pack)", () => {
  /**
   * The composition assertion. Six of the twelve also serve a speech surface
   * and two also serve image and video, so an adapter that imported its
   * provider's barrel instead of the transcribe leaf would drag a second
   * category's validators and catalogs in without changing a single import in
   * `src/unified/stt.ts`.
   */
  test("it reaches exactly the twelve stt providers, through their adapters", () => {
    const modules = sourceModulesOf(unifiedEntry("stt"));
    expect(modules).toContain("src/unified/stt.ts");
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual(STT_PACK_PROVIDERS);

    // Six of the twelve serve transcription only, so their adapter is the
    // unsuffixed leaf; the other six split per category.
    const SPLIT = new Set(["cartesia", "deepgram", "elevenlabs", "google", "inworld", "openai"]);
    for (const provider of STT_PACK_PROVIDERS) {
      const leaf = SPLIT.has(provider) ? "unified-stt" : "unified";
      expect(modules).toContain(`src/providers/${provider}/${leaf}.ts`);
      if (SPLIT.has(provider)) {
        expect(modules).not.toContain(`src/providers/${provider}/unified.ts`);
      }
      // Every provider's endpoint module is addressed as `transcribe.ts`, which
      // is the rename made structural: the pack cannot reach a provider except
      // through a file with the uniform name. Eight wire spellings —
      // `transcription`, `transcriptions`, `transcript`, `speech-to-text`,
      // `listen`, `pre-recorded`, `jobs`, `stt` — collapse onto one.
      expect(modules).toContain(`src/providers/${provider}/stt.ts`);
    }
  });

  test("its graph carries exactly two catalogs, and no availability or retarget layer", () => {
    const modules = sourceModulesOf(unifiedEntry("stt"));
    expect(modules.filter((m) => m.startsWith("src/catalog/")).sort()).toEqual(
      STT_PACK_CATALOGS,
    );
    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);
    expect(modules.filter((m) => m.endsWith("/interop.ts"))).toEqual([]);
    // The chat half of a provider that serves both is the loudest possible
    // leak: `mistral/index.ts` would bring the openai-compatible dialect in,
    // and `google/index.ts` the gemini codec and four more endpoints.
    expect(modules).not.toContain("src/providers/mistral/chat.ts");
    expect(modules).not.toContain("src/providers/google/chat.ts");
    expect(modules).not.toContain("src/providers/google/constraints.ts");
    expect(modules).not.toContain("src/providers/google/veo-models.ts");
    expect(modules).not.toContain("src/providers/google/index.ts");
    // …but the four-layer engine IS here: the pack ends in the providers' own
    // validators.
    expect(modules).toContain("src/core/pipeline.ts");
  });

  test("the speech and transcribe packs share six providers and no endpoints", () => {
    const stt = sourceModulesOf(unifiedEntry("stt"));
    const tts = sourceModulesOf(unifiedEntry("tts"));
    expect(stt).not.toContain("src/unified/tts.ts");
    expect(tts).not.toContain("src/unified/stt.ts");
    const SHARED = ["cartesia", "deepgram", "elevenlabs", "google", "inworld", "openai"];
    // The six shared providers contribute one endpoint each, per pack — this
    // is what the per-category adapter split buys, and it is the reason
    // `unmodel/tts` does not carry twelve STT validators.
    //
    // cartesia is the one exception, and it is the provider's own doing rather
    // than the adapter's: `cartesia/stt.ts` imports `CARTESIA_VERSION` from
    // `./tts`, so the TTS module rides along in this pack for one constant.
    // Pinned as an exception so that a *second* one has to be typed out here.
    for (const shared of SHARED) {
      expect(tts).toContain(`src/providers/${shared}/tts.ts`);
      if (shared !== "cartesia") {
        expect(stt).not.toContain(`src/providers/${shared}/tts.ts`);
      }
    }
    for (const shared of SHARED) {
      expect(stt).toContain(`src/providers/${shared}/stt.ts`);
      expect(tts).not.toContain(`src/providers/${shared}/stt.ts`);
    }
    // Google is *nearly* a second cartesia and deliberately is not: its two
    // surfaces share a check battery, so `google/tts-checks.ts` and
    // `google/tts-constraints.ts` are in BOTH packs — but the validator they
    // were extracted from is in neither's other half, which is exactly what the
    // extraction bought. A `google/tts.ts` in the STT graph would mean the
    // shared battery had been re-absorbed into an endpoint module.
    for (const shared of ["src/providers/google/tts-checks.ts", "src/providers/google/tts-constraints.ts"]) {
      expect(tts).toContain(shared);
      expect(stt).toContain(shared);
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
    expect(modules).not.toContain("src/providers/elevenlabs/tts.ts");
    expect(modules).not.toContain("src/providers/elevenlabs/stt.ts");
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
    expect(modules).not.toContain("src/providers/openai/tts.ts");
    expect(modules).not.toContain("src/providers/openai/stt.ts");
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

/**
 * The type-only entries — `unmodel/types` and `unmodel/<provider>/types`.
 *
 * These have the inverse budget problem to every entry above: their JavaScript
 * is empty by construction (`test/types-entries.test.ts` pins that against the
 * same build), so the only thing that can grow is the **declaration** graph —
 * and a declaration graph is exactly what a careless re-export grows without
 * changing a single byte of shipped code.
 *
 * Two numbers are pinned:
 *
 * - **per provider entry**, against the fattest of the 70. The catalog-heavy
 *   overlays lead (openrouter's model-id union alone is ~230 KiB), which is
 *   also why this budget is the one a models.dev refresh moves first — the
 *   same drift the note at the top of this file describes for `BUDGET_KIB`.
 * - **the hub**, which must stay in the neighbourhood of the root entry. It is
 *   the canonical vocabulary plus the six media vocabularies and nothing else;
 *   an aggregate of provider wire types would put it an order of magnitude
 *   higher, which is the mistake the per-provider layout exists to avoid.
 */
describe("type-only entries", () => {
  /** Fattest today: openrouter at ~298 KiB, openai at ~297 KiB. */
  const TYPES_ENTRY_DECLARATION_BUDGET_KIB = 340;
  /** ~307 KiB today, against 233 KiB for the root entry it extends. */
  const TYPES_HUB_DECLARATION_BUDGET_KIB = 340;

  const typesEntry = (provider: string): string =>
    join(DIST, "providers", provider, "types.d.ts");

  const PROVIDERS: string[] = readdirSync(join(ROOT, "src", "providers"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const declarationKiB = (entry: string): number =>
    transitiveDeclarations(entry).reduce((total, file) => total + statSync(file).size, 0) / 1024;

  test("the build is present, so the budgets below assert something", () => {
    expect(built).toBe(true);
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(70);
    for (const provider of PROVIDERS) {
      expect(existsSync(typesEntry(provider)), `dist types entry for ${provider}`).toBe(true);
    }
    expect(existsSync(join(DIST, "types", "index.d.ts"))).toBe(true);
  });

  test(`every provider types entry declares under ${TYPES_ENTRY_DECLARATION_BUDGET_KIB} KiB`, () => {
    const over: string[] = [];
    for (const provider of PROVIDERS) {
      const kib = declarationKiB(typesEntry(provider));
      if (kib > TYPES_ENTRY_DECLARATION_BUDGET_KIB) {
        over.push(`${provider}: ${kib.toFixed(1)} KiB`);
      }
    }
    expect(over).toEqual([]);
  });

  test(`the hub declares under ${TYPES_HUB_DECLARATION_BUDGET_KIB} KiB`, () => {
    const kib = declarationKiB(join(DIST, "types", "index.d.ts"));
    expect(kib, `unmodel/types is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(
      TYPES_HUB_DECLARATION_BUDGET_KIB,
    );
  });

  test("a provider types entry costs no more than that provider's main entry", () => {
    // The proposition of the split is that the types are the *cheap* half. If a
    // types entry ever outgrew its own `index`, it would be carrying something
    // the runtime entry does not — a second provider's declarations, most
    // likely, which amendment A8 in test/import-graph.test.ts forbids at the
    // source and this catches in bytes.
    const over: string[] = [];
    for (const provider of PROVIDERS) {
      const types = declarationKiB(typesEntry(provider));
      const index = declarationKiB(join(DIST, "providers", provider, "index.d.ts"));
      // A small margin: the types entry adds the alias declarations and, for
      // the fleet overlays, the shared dialect wire leaf its index does not
      // re-export.
      if (types > index * 1.15 + 16) over.push(`${provider}: types ${types.toFixed(1)} KiB vs index ${index.toFixed(1)} KiB`);
    }
    expect(over).toEqual([]);
  });

  test("the hub's declaration graph names no provider wire module", () => {
    const graph = transitiveDeclarations(join(DIST, "types", "index.d.ts"));
    // The dialect bodies `ChatBody<Ref>` resolves to are the ONE provider-shaped
    // thing the hub legitimately reaches, and they arrive as chunked wire leaves
    // rather than as a provider entry. What must never appear is a provider's
    // own `dist/providers/<p>/…` declaration: that would mean the hub had
    // acquired an entry, not a leaf.
    expect(graph.filter((file) => file.includes(`${join(DIST, "providers")}/`))).toEqual([]);
  });
});
