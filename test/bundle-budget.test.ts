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
 * Providers whose adapters are SPLIT one file per category, derived from disk.
 *
 * Derived rather than enumerated, and that is the whole point of the change:
 * a hand-written list has one failure mode nothing else here catches. Add a
 * second category to a provider that already had one, forget to add it to the
 * list, and every assertion below quietly checks the WRONG file — it looks for
 * `unified.ts`, finds it (the barrel is still there), and passes while the
 * pack silently ships the other category's validators. Green build, and the
 * exact regression these budgets exist to prevent.
 *
 * A provider with more than one `unified-<category>.ts` on disk is split, by
 * definition. There is nothing to keep in step, so nothing can fall out of it.
 */
function splitProviders(): ReadonlySet<string> {
  const split = new Set<string>();
  const providers = join(ROOT, "src", "providers");
  for (const provider of readdirSync(providers)) {
    const dir = join(providers, provider);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const leaves = readdirSync(dir).filter((file) => /^unified-.+\.ts$/.test(file) && !file.endsWith(".test.ts"));
    if (leaves.length > 1) split.add(provider);
  }
  return split;
}


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
  /**
   * **Bumped 150 → 165** by the canonical `detail` promotion (150.6 measured,
   * up 2.2 from 148.4). The same +2.2 to +5.0 KiB lands on every entry that
   * carries a chat codec, so it is described once here and referenced from
   * `deepinfra` and `openrouter` below rather than repeated.
   *
   * `ChatFilePart.detail` became vocabulary rather than a one-dialect concept,
   * which turned three warnings into three mappings — and a mapping is code
   * where a warning was a string. Measured module by module (unminified ESM,
   * so the prose ships too):
   *
   * | module | what it gained |
   * |---|---|
   * | `openai-compatible/interop.ts` | `imageDetailFor` (the `medium` → `high` narrowing) + `warnNonImageDetail`, and `detail` threaded through both media branches |
   * | `google/interop.ts` | the two level ⇄ detail tables and `detailFromLevel`, plus `mediaResolution` on three decode branches |
   * | `anthropic/interop.ts` | the one `dropped_param` this dialect genuinely owes |
   * | `chat/encode.ts` + `chat/schema.ts` | carrying the field, and one `z.enum` |
   * | `openai-compatible/chat-completions.ts` | `estimateChatTokens`' per-part image-token resolver |
   *
   * anthropic is the smallest of the three bumps (+2.2) because it pays only
   * for its own decoder plus the openai-chat codec it already carried; the
   * openai-dialect fleet pays ~+2.9, and the two-codec entries ~+4.5.
   */
  anthropic: 165,
  /**
   * Bumped 125 → 138 (125.9 measured) when `core/standard-schema.ts` joined
   * the four-layer engine: the pipeline's layer 1 now consumes any Standard
   * Schema validator instead of naming zod, and the vendored interface plus
   * the one adapter ride in every pipeline-bearing graph (~1 KiB). groq was
   * already within a kilobyte of its pin, so the seam is what tipped it, not
   * what filled it.
   */
  groq: 138,
  google: 345, // 313.8 measured after the Lyria music surface (2026-08-24); same ~10% headroom.
  /** Bumped 190 → 210: 191.8 measured, +4.4 for the `detail` mappings (see `anthropic`). */
  deepinfra: 210,
  /** Bumped 400 → 440: 401.9 measured, +4.8 for the `detail` mappings (see `anthropic`). */
  openrouter: 440,
  /**
   * Bumped 355 → 390: 354.8 measured, +4.8 for the same `detail` mappings.
   * This one did not fail — it landed 0.2 KiB under its pin — and is moved
   * anyway, because a budget with 0.06% headroom is a tripwire rather than a
   * budget and the next entry to touch a codec would trip it for a reason that
   * has nothing to do with that entry.
   */
  vercel: 390,
  /**
   * fal at 474.9 KiB measured, pinned at 525.
   *
   * The only entry here whose weight is GENERATED rather than transcribed, and
   * the shape of it is worth stating because it will grow in a way the others
   * do not: fal serves 140 endpoints across nine categories, and each one ships
   * four rows — a wire interface (type-only, free at run time), an IR row the
   * check battery reads, a unified row a picker renders, and a catalog row.
   * Only the last three are bytes.
   *
   * **Bumped 370 → 525 by wave 1d** (336.2 → 474.9 KiB): +45 endpoints and the
   * last four categories, which also completed `./models.ts` — it merges all
   * nine verbs' catalog slices now rather than the two it had. That merge cost
   * 0.8 KiB, measured, because the slices were already reachable through the
   * validators this entry re-exports; the other ~138 are the roster.
   *
   * This entry is the ONE place in the library that legitimately carries all of
   * fal at once — `unmodel/fal` is the hand surface — so it is also the entry
   * where the per-category split cannot help. That is why the packs are
   * measured separately below: a caller who wants upscale pays 265 KiB, not
   * this.
   *
   * So this number tracks the ROSTER, not the code: `src/providers/fal/*.ts` is
   * ~1,500 hand-written lines and will stay about there, while `gen/` scales
   * with `data/fal/curation.json`. A jump here after a wave is expected; a jump
   * here WITHOUT a roster change is a barrel leak, and `models.ts` — the merged
   * catalog every category's slice would flow through — is the first place to
   * look (see A12 in test/import-graph.test.ts).
   *
   * **Bumped 525 → 620 by wave 3** (474.9 → 561.8 KiB): +19 endpoints and the
   * `threeD` category, the tenth verb this entry carries. The roster grew 12%
   * and this number grew 18%, and the gap is accounted for: `fal-ai/trellis-2`
   * alone publishes thirty sampler and UV-unwrap parameters and `meshy/v7/*`
   * twenty, so the 3D IR rows are the longest per endpoint in the provider.
   */
  fal: 620,
  /**
   * The native Tripo provider: two validators, one shared module of enums and
   * cross-field checks, a four-row hand catalog and a credit table. 46.4 KiB
   * measured — comparable to pixverse and vidu, and for the same reason: a
   * hand-written provider's weight is its prose and its checks, not a roster.
   */
  tripo3d: 55,
  /**
   * The native sync. provider: two validators on ONE url, a shared module of
   * enums, cross-field checks and two long hand catalogs (62 error codes, 93
   * dubbing languages), and a five-row model table. 62.0 KiB measured — the
   * heaviest hand provider in the tree, and the two catalogs are most of the
   * difference from tripo3d's 46.4.
   */
  sync: 70,
  /**
   * The native Topaz provider: two validators across two routes, a fifteen-row
   * per-model SETTINGS table that Topaz's own OpenAPI document does not
   * contain, a fifteen-row hand catalog and the credit arithmetic. 61.3 KiB
   * measured.
   */
  topaz: 70,
  /**
   * Atlas Cloud: ONE validator on ONE url, and the heaviest hand provider in
   * the tree at 72.2 KiB measured — heavier than sync.'s two validators and two
   * long catalogs, from a single endpoint.
   *
   * The reason is the thing that makes this provider interesting rather than a
   * regression: Atlas publishes one OpenAPI 3.0.0 document PER MODEL, so its 23
   * curated ids are 23 independent param surfaces rather than one narrowed 23
   * ways. Every table here is therefore per-id — the deny rows, the enum rows,
   * the shape rules, the unified rows and the adapter's field-name table are
   * five tables of twenty-three, and four dialect families inside them disagree
   * about field names, casing and which route owns which field. `bytedance`
   * (4,646 LoC across two categories) is pinned at no entry here because it has
   * no barrel budget; the comparable figure is its 23-model equivalent, which
   * does not exist.
   *
   * NO pricing weight, and that is deliberate: Atlas ships no usable price unit,
   * so `./pricing.ts` is a caveat plus a transcription table and no row carries
   * a `cost` — which also keeps `pricing.ts` out of the video PACK entirely
   * (asserted below), since the validator declares no `estimate` to reach it.
   *
   * 80 is 72.2 × 1.1, the same multiple as every row above.
   */
  atlascloud: 80,

  /**
   * The six entries that carry the **media retarget seam** — `.toApi("fal")`.
   *
   * These are pinned as a group because they are the only entries whose weight
   * now includes something a *pack* deliberately does not: the engine
   * (`core/translate/media-retarget.ts`), the target table
   * (`core/translate/media-endpoints.ts`) and the family's own
   * `fal-target.ts`. The seam lives in `src/providers/<p>/index.ts` for exactly
   * that reason — every media pack reaches these providers through their
   * `unified-<category>.ts` adapter leaves, which import `./video` / `./tts` /
   * `./image` directly and never the barrel, so the pack graphs are unchanged
   * (asserted below in "the media retarget seam").
   *
   * Measured after the seam landed, pinned at ~×1.1:
   *
   * | entry | measured | pinned | what the seam cost it |
   * |---|---|---|---|
   * | pixverse | 57.3 | 64 | one endpoint, one model, three refusals |
   * | lightricks | 60.5 | 68 | one endpoint, one model, the WxH → tier+ratio split |
   * | black-forest-labs | 89.5 | 100 | five models across two endpoints |
   * | kling | 122.1 | 135 | six fal endpoints across two source routes |
   * | elevenlabs | 183.0 | 202 | three models, the widest refusal battery, plus DUBBING |
   * | minimax | 209.1 | 227 | three models, plus chat/video/clone/design |
   *
   * The engine and the target table are ~9 KiB of the total, shared as one
   * chunk between all six; the rest is each family's own mapping prose. A
   * seventh family joining moves only its own row.
   *
   * **elevenlabs 162 → 202 (measured 146.9 → 183.0), and the seam did not do
   * it.** `elevenlabs.dub` + `elevenlabs.dubLanguage` landed — two wire
   * validators with their zod schemas, two response checkers, and
   * `dubbing-languages.ts`, which is ~194 BCP-47 string literals across two
   * hand-transcribed tables (94 Dubbing v2 base tags + 14 dialects, 86 Dubbing
   * v1 tags). The language tables are the bulk of the +36 KiB and they are data
   * that cannot be generated: ElevenLabs types `target_language` as a bare
   * `string` and publishes the enumeration only as prose. Pinned at ~×1.10,
   * the same multiple as every other row in this group.
   *
   * **minimax's measured figure moved 205.9 → 209.1 and its pin did not**, which
   * is the point of the `./models`-not-`./tts` import rule recorded below at
   * the voice-clone pack: `minimax/tts-check.ts` costs ~3 KiB because it reads
   * the catalog rates and never the validator's zod schema. Importing `./tts`
   * there would have dragged that schema into every graph reaching this barrel.
   */
  pixverse: 64,
  lightricks: 68,
  "black-forest-labs": 100,
  kling: 135,
  elevenlabs: 202,
  minimax: 227,
};

/**
 * The provider entries that carry `.toApi("fal")`, and the source modules that
 * prove it. Read by the seam tests below in both directions.
 */
const MEDIA_RETARGET_ENTRIES: Array<{ provider: string; falTarget: string }> = [
  { provider: "kling", falTarget: "src/providers/kling/fal-target.ts" },
  { provider: "pixverse", falTarget: "src/providers/pixverse/fal-target.ts" },
  { provider: "lightricks", falTarget: "src/providers/lightricks/fal-target.ts" },
  { provider: "elevenlabs", falTarget: "src/providers/elevenlabs/fal-target.ts" },
  { provider: "minimax", falTarget: "src/providers/minimax/fal-target.ts" },
  {
    provider: "black-forest-labs",
    falTarget: "src/providers/black-forest-labs/fal-target.ts",
  },
];

/** The modules a media pack must never reach, because `.toApi` is not on its results. */
const MEDIA_RETARGET_MODULES = [
  "src/core/translate/media-retarget.ts",
  "src/core/translate/media-endpoints.ts",
];

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

/**
 * Provider-free compiler/factory entry; 150.2 KiB measured, pinned at 158.
 * Bumped 150 → 158 when `core/standard-schema.ts` joined the engine (the
 * Standard Schema seam — see the groq note in BUDGET_KIB above); the entry
 * was at ~144 with ~4% headroom before the wave-1c growth plus the seam.
 */
const CHAT_FACTORY_BUDGET_KIB = 158;

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
  "lipsync",
  "avatar",
  "upscale",
  "3d",
  "tts",
  "stt",
  "music",
  "voice-clone",
  "voice-design",
];

/**
 * `unmodel/voice-clone`'s budget: the kernel plus six clone providers'
 * wire validators, adapters and hand catalogs. Measured 208.7 KiB at landing;
 * the headroom is one small provider. Two accounting notes from the landing
 * measurement, both cuts rather than additions:
 *
 * - `inworld/audio-bytes.ts` exists because this pack's 4MB sample check
 *   needs `decodedBase64Bytes`, which lived inside `inworld/stt.ts` — a
 *   ~30 KiB transcription validator this pack has no other reason to carry.
 *   The helper moved to an import-free leaf; measured, the move took the pack
 *   240.9 → 208.7.
 * - `minimax/tts.ts` was in this graph for one array (`T2A_LANGUAGE_BOOSTS`,
 *   the clone preview's language hint). The array moved to `minimax/models.ts`
 *   — the cartesia-languages precedent: the hand catalog already rides in the
 *   pack for the synthetic rows and the preview pricing.
 *
 * What legitimately stays: each provider's `models.ts` (the synthetic
 * voice-clone rows live there, and MiniMax's speech rows price the preview
 * synthesis), and the six `voice-clone.ts` wire validators with their zod
 * schemas.
 */
const VOICE_CLONE_PACK_BUDGET_KIB = 220;

/**
 * `unmodel/voice-design`'s budget: the kernel plus four design providers.
 * Measured 179.1 KiB at landing. `inworld/audio-bytes.ts` rides in through
 * `inworld/voice-clone.ts` (the design adapter shares its language checks
 * and lang-code enum) — a leaf, not the STT validator it replaced; see the
 * voice-clone accounting above.
 */
const VOICE_DESIGN_PACK_BUDGET_KIB = 190;

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
 *
 * **Bumped 500 → 515 by the values entries**, and the investigation this
 * file's header demands was run rather than skipped: **no module joined this
 * graph that was not already in it as bytes**. 467.4 → 481.3 KiB, +13.9 across 15 adapter leaves.
 * `unmodel/<provider>/values` publishes the per-model tables, so those tables
 * moved out of the adapters into import-free `<category>-params.ts` leaves —
 * without that split, importing one voice list cost 30–82 KiB of validator
 * (measured; see `test/values-entries.test.ts`). Splitting a module is not free
 * in an unminified ESM build: each leaf costs its own doc header and the
 * export/import plumbing rolldown emits for a const that now crosses a module
 * boundary instead of being inlined. Measured at **~0.65 KiB per leaf**, in the
 * one pack small enough to account for line by line: music's
 * `elevenlabs/unified-music.ts` went 4.2 → 2.6 KiB with a 2.3 KiB
 * `music-params.ts` beside it (+0.7), stability's 3.4 → 2.4 with 1.6 (+0.6),
 * and `core/unified/canonical-keys.ts` — the params vocabulary, moved out of
 * `kernel.ts` so `unmodel/values` could publish it without the kernel's chunk —
 * is +0.1 net against the kernel's own shrink.
 */
const TTS_PACK_BUDGET_KIB = 850;

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
 *
 * **Bumped 790 → 820 by the values entries**, and the investigation this
 * file's header demands was run rather than skipped: **no module joined this
 * graph that was not already in it as bytes**. 765.4 → 780.5 KiB, +15.1 across 21 adapter leaves.
 * `unmodel/<provider>/values` publishes the per-model tables, so those tables
 * moved out of the adapters into import-free `<category>-params.ts` leaves —
 * without that split, importing one voice list cost 30–82 KiB of validator
 * (measured; see `test/values-entries.test.ts`). Splitting a module is not free
 * in an unminified ESM build: each leaf costs its own doc header and the
 * export/import plumbing rolldown emits for a const that now crosses a module
 * boundary instead of being inlined. Measured at **~0.65 KiB per leaf**, in the
 * one pack small enough to account for line by line: music's
 * `elevenlabs/unified-music.ts` went 4.2 → 2.6 KiB with a 2.3 KiB
 * `music-params.ts` beside it (+0.7), stability's 3.4 → 2.4 with 1.6 (+0.6),
 * and `core/unified/canonical-keys.ts` — the params vocabulary, moved out of
 * `kernel.ts` so `unmodel/values` could publish it without the kernel's chunk —
 * is +0.1 net against the kernel's own shrink.
 *
 * **Bumped 820 → 1050 by fal**, and this one IS a real, large addition to the
 * graph rather than drift — exactly the case this file's header says to
 * investigate rather than wave through. 780.5 → 952.5 KiB, +172 from one
 * provider, and the investigation is short because the bytes are all one kind
 * of thing: fal serves 28 text-to-image endpoints behind a single address, and
 * every one of them ships a generated narrowing row. `image-narrow.gen.ts`
 * (the per-endpoint IR the check battery reads) and `image-params.gen.ts` (the
 * per-endpoint unified row a picker renders) are ~600 and ~550 lines of pure
 * data between them, and `models-image.gen.ts` is 28 catalog rows with their
 * pricing provenance.
 *
 * That is the cost of the thing being bought, not overhead around it: fal
 * roughly doubles this pack's model count on its own. It is also why
 * `createImage([…])` matters more than it did — a caller who wants two
 * providers should not pay for a queue in front of a thousand models. Pinned
 * at 1050, the usual ~10% over the measurement.
 */
const IMAGE_PACK_BUDGET_KIB = 1160;

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
 * `unmodel/video`'s budget: the kernel plus eleven video providers —
 * twenty-two endpoint modules between them, because six of them serve more than
 * one route and Kling alone contributes five.
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
 *
 * **Bumped 670 → 930 by fal**, which is the largest single-provider jump this
 * table has recorded: 646.9 → 844.4 KiB, +198 from ONE adapter. The shape of
 * the spend is the opposite of the other ten providers': fal contributes one
 * adapter, one validator and one union schema, and then thirty endpoints' worth
 * of GENERATED data — the IR the check battery narrows with, the unified rows
 * (each carrying its own duration list, tier map, ratio enum and role→wire
 * map), thirty catalog rows, thirty wire interfaces, and the shared 95-row rate
 * table. This pack roughly doubles its model count to get them.
 *
 * It is also the pack where `createVideo([…])` earns its keep hardest: a caller
 * who wants Sora and Veo now skips 198 KiB of fal by naming two adapters.
 *
 * **Bumped 1040 → 1170 by atlascloud**, measured 1061.7 KiB, of which the new
 * provider is 65.8 — read off the `//#region src/providers/atlascloud/*` blocks
 * in this pack's own chunks rather than estimated. Six modules arrive, and the
 * split is worth recording because it is the opposite shape from fal's:
 *
 * | module | what it is |
 * |---|---|
 * | `constraints.ts` | 23 per-MODEL deny tables and enum rows — Atlas publishes one OpenAPI document per model, so there is no shared body to narrow and no row is shared |
 * | `video.ts` | one validator, one union zod schema over 22 fields, six checks |
 * | `video-params.ts` | 23 unified rows (tiers, shapes, extras) |
 * | `unified-video.ts` | the adapter, plus its 23-row field-name table |
 * | `models.ts` | 23 catalog rows, reached through the validator's `catalog:` |
 * | `urls.ts` | four strings and three functions |
 *
 * fal's +198 was thirty endpoints of GENERATED data behind one adapter and one
 * schema. This +66 is 23 HAND rows across four dialect families that disagree
 * about field names (`ratio` vs `aspect_ratio`, `audio` vs `generate_audio`),
 * about casing (`1080P` at Wan 3.0-prime, `1080p` at Wan 3.0, `-SR` at Seedance
 * 2.0, `-sr` at 2.5) and about which of the three routes a family's fields live
 * on. That disagreement IS the weight: it is what the deny tables spell out, and
 * spelling it out is what makes a param from a sibling route an error naming the
 * id to pick instead of a 400 from Atlas.
 *
 * 1170 restores ~10% headroom, the same multiple every row in this file uses.
 */
const VIDEO_PACK_BUDGET_KIB = 1170;

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

/** The fourteen providers `unmodel/video`'s ready-made pack is allowed to reach. */
const VIDEO_PACK_PROVIDERS: string[] = [
  "alibaba",
  "atlascloud",
  "bytedance",
  "fal",
  "google",
  "kling",
  "lightricks",
  "luma",
  "minimax",
  "openai",
  "pixverse",
  "runway",
  "vidu",
  "xai",
];

/**
 * The sixteen providers `unmodel/image`'s ready-made pack is allowed to reach.
 *
 * google is on this list for its Imagen adapter only: `google/unified.ts`
 * imports `./image` and `./constraints`, never `.`, so the gemini chat codec
 * and the translate layer stay out — which the composition test below is what
 * actually holds down.
 *
 * fal is the sixteenth and the one that moved the budget: it is a queue in
 * front of many vendors rather than a vendor, so it brings 28 endpoints and
 * their generated narrowing rows on its own.
 */
const IMAGE_PACK_PROVIDERS: string[] = [
  "black-forest-labs",
  "bria",
  "bytedance",
  "fal",
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
  "xai",
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
const STT_PACK_BUDGET_KIB = 715;

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

/** The thirteen providers `unmodel/stt`'s ready-made pack is allowed to reach. */
const STT_PACK_PROVIDERS: string[] = [
  "assemblyai",
  "cartesia",
  "deepgram",
  "elevenlabs",
  "fal",
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
 *
 * **Bumped 160 → 168 by the values entries**, and the investigation this
 * file's header demands was run rather than skipped: **no module joined this
 * graph that was not already in it as bytes**. 155.1 → 156.8 KiB, +1.7 across 2 adapter leaves.
 * `unmodel/<provider>/values` publishes the per-model tables, so those tables
 * moved out of the adapters into import-free `<category>-params.ts` leaves —
 * without that split, importing one voice list cost 30–82 KiB of validator
 * (measured; see `test/values-entries.test.ts`). Splitting a module is not free
 * in an unminified ESM build: each leaf costs its own doc header and the
 * export/import plumbing rolldown emits for a const that now crosses a module
 * boundary instead of being inlined. Measured at **~0.65 KiB per leaf**, in the
 * one pack small enough to account for line by line: music's
 * `elevenlabs/unified-music.ts` went 4.2 → 2.6 KiB with a 2.3 KiB
 * `music-params.ts` beside it (+0.7), stability's 3.4 → 2.4 with 1.6 (+0.6),
 * and `core/unified/canonical-keys.ts` — the params vocabulary, moved out of
 * `kernel.ts` so `unmodel/values` could publish it without the kernel's chunk —
 * is +0.1 net against the kernel's own shrink.
 *
 * **Bumped 400 → 440 by the v0.3.x fal wave**, and the investigation this
 * file's header demands was run rather than skipped — in isolation, against a
 * scratch build of HEAD with ONLY the fal changes applied, so the number is
 * this workstream's and nobody else's: **376.9 → 401.8 KiB, +24.9**. No module
 * joined the graph. Two causes, both prose rather than logic:
 *
 * - **~16 KiB of it is `FAL_EXCLUDED`**, the `excluded.endpoints` block of
 *   `data/fal/curation.json` emitted into `gen/endpoints.gen.ts` and read by
 *   `checks.ts`, which every fal verb already imports. It grew from 9 recorded
 *   ids to 66 in this wave (the background-removal, `image-editing/*` and
 *   ffmpeg/workflow families, plus the delisted Topaz pair), and the reasons
 *   ARE the feature: an adopter who names a deliberately-unserved id used to
 *   get a bare `unknown_model` that reads as catalog lag. Comments and prose
 *   ship as real bytes in an unminified ESM build, which is the same accounting
 *   the type-tightening bump above did.
 * - **the rest is the six curated endpoints** landing in the shared fal chunks
 *   this pack pays for whole — `endpoints.gen.ts`'s id lists and doc URLs,
 *   `pricing.gen.ts`'s six new rate tables, `shared.gen.ts`'s new $ref
 *   components. `unmodel/music` reaches none of those endpoints; it pays for
 *   them because they are in modules its own fal half imports.
 *
 * It failed here and nowhere else for the reason the 150 → 160 bump records:
 * this pack had 5.8% headroom where the other five fal packs had ten or more,
 * so a shared-chunk increment landed on all of them and only this one noticed.
 * Restoring the ~10% (401.8 × 1.1 ≈ 442, pinned at 440) is what the convention
 * asks; the alternative was deleting recorded reasons to buy bytes, which is
 * the thing this wave exists to stop doing.
 */
const MUSIC_PACK_BUDGET_KIB = 440;

/** The five providers `unmodel/music`'s ready-made pack is allowed to reach. */
const MUSIC_PACK_PROVIDERS: string[] = ["elevenlabs", "fal", "google", "mureka", "stability"];

/** The nineteen providers `unmodel/tts`'s ready-made pack is allowed to reach. */
const TTS_PACK_PROVIDERS: string[] = [
  "alibaba",
  "breezeblue",
  "cartesia",
  "deepgram",
  "elevenlabs",
  "fal",
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
  "stepfun",
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
 *
 * **Bumped 295 → 310 by the values entries**, and the investigation this
 * file's header demands was run rather than skipped: **no module joined this
 * graph that was not already in it as bytes**. 281.4 → 287.2 KiB, +5.8 across 8 adapter leaves.
 * `unmodel/<provider>/values` publishes the per-model tables, so those tables
 * moved out of the adapters into import-free `<category>-params.ts` leaves —
 * without that split, importing one voice list cost 30–82 KiB of validator
 * (measured; see `test/values-entries.test.ts`). Splitting a module is not free
 * in an unminified ESM build: each leaf costs its own doc header and the
 * export/import plumbing rolldown emits for a const that now crosses a module
 * boundary instead of being inlined. Measured at **~0.65 KiB per leaf**, in the
 * one pack small enough to account for line by line: music's
 * `elevenlabs/unified-music.ts` went 4.2 → 2.6 KiB with a 2.3 KiB
 * `music-params.ts` beside it (+0.7), stability's 3.4 → 2.4 with 1.6 (+0.6),
 * and `core/unified/canonical-keys.ts` — the params vocabulary, moved out of
 * `kernel.ts` so `unmodel/values` could publish it without the kernel's chunk —
 * is +0.1 net against the kernel's own shrink.
 *
 * **Bumped 310 → 470 by fal**, for the same reason and in the same shape as
 * the image pack: 287.2 → 425.9 KiB, +139 from one provider serving 17 editing
 * endpoints behind a single address. The bytes are the generated per-endpoint
 * rows — the IR the check battery narrows with, the unified rows a picker
 * renders, and 17 catalog rows — and this pack more than triples its model
 * count to get them. Pinned at 470, the usual ~10% over the measurement.
 */
const IMAGE_EDIT_PACK_BUDGET_KIB = 530;

/**
 * The one generated catalog this pack legitimately reaches.
 *
 * Load-bearing rather than leaked, and for the same reason as in the image
 * pack: `openai/images-models.ts` builds the image catalog by supplementing
 * `src/catalog/openai.gen.ts`. A *second* entry here means a provider barrel
 * leaked in.
 */
const IMAGE_EDIT_PACK_CATALOGS: string[] = ["src/catalog/openai.gen.ts"];

/** The five providers `unmodel/image-edit`'s ready-made pack is allowed to reach. */
const IMAGE_EDIT_PACK_PROVIDERS: string[] = [
  "black-forest-labs",
  "fal",
  "ideogram",
  "openai",
  "recraft",
];

/**
 * `unmodel/lipsync`'s budget: the kernel plus ONE provider serving eight
 * endpoints. Measured 222.9 KiB at landing, pinned at 245 with the usual ~10%.
 *
 * The number is the interesting part, because it is nothing like the ~120 the
 * plan guessed, and the gap is not fal's fault. **Two hundred of those
 * kilobytes are the shared floor every media pack pays** — `core/pipeline.ts`
 * with its four-layer engine, `core/request.ts`, `core/tokens.ts`,
 * `core/issue-sink.ts`, the kernel and `core/unified/derive.ts` — and they are
 * there whether a pack has one provider or fifteen. What the fal half actually
 * costs is small and countable: the union schema, the eight-row IR, the eight
 * unified rows, eight catalog rows, the queue URL helpers, and
 * `gen/pricing.gen.ts`.
 *
 * `gen/pricing.gen.ts` is the one line item worth naming, because it is
 * shared across all TEN fal verbs rather than scoped to this one: every
 * curated endpoint's rate lives in a single generated table, so this pack
 * carries the whole roster's rows to use 8. Splitting it per verb was
 * considered and refused for the reason its own header gives — a price is a
 * fact about an ENDPOINT, and ten copies of the same lookup is a worse trade
 * than a few kilobytes. Revisit if the roster passes ~200 endpoints.
 *
 * **Bumped 245 → 275 by wave 1d**, and the investigation this file's header
 * demands was run rather than skipped: measured 246.3 KiB, +23.4 on the wave,
 * and this pack gained NOT ONE module of its own. Every byte is the two tables
 * fal shares across its ten verbs growing with the roster —
 * `gen/pricing.gen.ts` from 95 rates to 140, and `gen/endpoints.gen.ts`, whose
 * `FAL_DOC_URLS` every adapter reads to cite a source in its refusals, from 95
 * ids to 140. That is the cost of the shared-table trade stated as a number
 * rather than a hope, and it is the figure to weigh when the roster next grows:
 * ~0.5 KiB per curated endpoint, paid by all ten packs.
 *
 * **Bumped 275 → 350 by the sync. wave**, measured 318.0 KiB, +71.7 — and this
 * time the pack DID gain modules of its own, which is what a second provider
 * is. The sync. half is five files (`unified-lipsync.ts`, `lipsync-params.ts`,
 * `lipsync.ts`, `shared.ts`, `models.ts`) and the largest single item in it is
 * `shared.ts`, which carries a 62-code error catalog and a 93-language dubbing
 * enum as `as const` arrays. Both are DATA a client needs — branching on an
 * error code is the documented way to handle a failure at sync. — and both are
 * published through `unmodel/sync/values` for exactly that. The alternative
 * (typing them and shipping no runtime list) was rejected for the reason
 * `values-entries.test.ts` exists.
 */
// **Bumped 350 → 445 by the natives wave**, measured 395.2 KiB, +77. The two
// halves added are a native provider apiece: VEED brings one validator, one
// zod schema and a row with NOTHING on it; HeyGen brings two validators, a
// schema with five nested objects (background, caption, watermark,
// voice_settings, engine) and two rows of a dozen extras each. HeyGen is most
// of the delta and the schema is most of HeyGen — which is the shape of the
// thing this pack is for.
const LIPSYNC_PACK_BUDGET_KIB = 445;

/** The four providers `unmodel/lipsync`'s ready-made pack is allowed to reach. */
const LIPSYNC_PACK_PROVIDERS: string[] = ["fal", "heygen", "sync", "veed"];

/**
 * `unmodel/avatar`'s budget: the same shape as its lipsync twin, 4.7 KiB
 * heavier. Measured 227.6 KiB at landing, pinned at 250.
 *
 * The difference between the two packs is exactly what the categories differ
 * by: avatar's eight endpoints publish more parameters (OmniHuman's mask and
 * turbo switches, LongCat's ten knobs, and the two 28-value performer enums at
 * VEED and Argil), so its generated wire types and IR rows are longer. Nothing
 * structural: both reach one provider, neither reaches a catalog, and both pay
 * the same ~200 KiB kernel floor. That the two numbers are within 2% of each
 * other is the assertion worth reading — a pack that drifted away from its
 * twin would have acquired something, and this is where it would show.
 *
 * **Bumped 280 → 345 by the sync. wave**, measured 312.5 KiB. It stays within
 * 2% of its lipsync twin, which is the assertion above and is now a stronger
 * one: the two packs reach the SAME two providers, and at sync. they reach the
 * same `shared.ts` and the same `models.ts` — so the 5.5 KiB between them is
 * one adapter leaf and one params leaf apiece, exactly as it should be. If the
 * avatar pack ever picked up sync.'s lipsync rows, this is the number that
 * would move.
 */
// **Bumped 345 → 445 by the natives wave**, measured 396.4 KiB. It stays
// within 2% of its lipsync twin, which is the assertion above and is now the
// strongest version of it there has been: the two packs reach the SAME FOUR
// providers, and at three of them they reach the same `shared.ts` and the same
// `models.ts`. The 1.2 KiB between them is one adapter leaf and one params
// leaf apiece. If the avatar pack ever picked up HeyGen's lipsync rows, this
// is the number that would move.
const AVATAR_PACK_BUDGET_KIB = 445;

/** The four providers `unmodel/avatar`'s ready-made pack is allowed to reach. */
const AVATAR_PACK_PROVIDERS: string[] = ["fal", "heygen", "sync", "veed"];

/**
 * `unmodel/upscale`'s budget: the third one-provider pack, and the heaviest of
 * the three. Measured 265.0 KiB at landing, pinned at 295 with the usual ~10%.
 *
 * ~19 KiB above its lipsync twin, and the difference is exactly what the
 * category is: ten endpoints rather than eight, across two media, and the
 * Topaz rows alone publish thirteen and seventeen parameters each (face
 * enhancement, subject detection, denoise, sharpen, texture, detail, and a
 * twenty-one-member network enum at the video arm). Nothing structural — one
 * provider, one adapter leaf, no catalog, and the same ~200 KiB kernel floor
 * every media pack pays.
 *
 * **Bumped 295 → 375 by the Topaz wave**, measured 337.0 KiB, +72.0. The Topaz
 * half is fifteen unified rows across two routes, and the rows are the cost:
 * every one of them carries the whole per-model settings table that Topaz's own
 * OpenAPI document does NOT contain (`additionalProperties: { type: string }`
 * is all the spec says), hand-transcribed from fifteen model pages. That
 * transcription is the entire reason to have a native Topaz provider rather
 * than only fal's resale of three of its endpoints, so the kilobytes are the
 * feature.
 */
const UPSCALE_PACK_BUDGET_KIB = 375;

/** The two providers `unmodel/upscale`'s ready-made pack is allowed to reach. */
const UPSCALE_PACK_PROVIDERS: string[] = ["fal", "topaz"];

/**
 * `unmodel/3d`'s budget: the first of the 2026 categories with TWO providers in
 * its ready-made pack, and the reason its number is not comparable to the three
 * fal-only ones above. Measured 349.4 KiB at landing, pinned at 385 with the
 * usual ~10%.
 *
 * ~54 KiB above `upscale`, and the split is worth reading because it is not
 * "more endpoints". fal's nineteen 3D rows account for most of it — Trellis 2
 * publishes thirty parameters and Meshy twenty, the longest per-endpoint IR in
 * the provider — and the native `tripo3d` half is ~25 KiB of it: two wire
 * validators, the version-gate and polycount checks, a four-row hand catalog
 * and the credit table. Nothing structural: two adapter leaves, no merged
 * catalog, no retarget layer, and the same ~200 KiB kernel floor every media
 * pack pays.
 */
const THREE_D_PACK_BUDGET_KIB = 385;

/** The two providers `unmodel/3d`'s ready-made pack is allowed to reach. */
const THREE_D_PACK_PROVIDERS: string[] = ["fal", "tripo3d"];

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
  lipsync: LIPSYNC_PACK_BUDGET_KIB,
  avatar: AVATAR_PACK_BUDGET_KIB,
  upscale: UPSCALE_PACK_BUDGET_KIB,
  "3d": THREE_D_PACK_BUDGET_KIB,
  tts: TTS_PACK_BUDGET_KIB,
  stt: STT_PACK_BUDGET_KIB,
  music: MUSIC_PACK_BUDGET_KIB,
  "voice-clone": VOICE_CLONE_PACK_BUDGET_KIB,
  "voice-design": VOICE_DESIGN_PACK_BUDGET_KIB,
};

/**
 * What each pack costs an EDITOR, as opposed to a bundler.
 *
 * The budgets above measure JavaScript, which is what a browser downloads.
 * These measure declarations, which is what `tsc` reads on every keystroke —
 * and the two move independently. A per-model narrowing table is a handful of
 * bytes of JavaScript (an object of `undefined`s) and a full union of literal
 * types in the declaration; adding one adapter with 28 models can leave the JS
 * budget almost still and put megabytes in front of the language server.
 *
 * That failure mode has a precedent in this repo — the chat-entry declaration
 * regressed 48% before anyone noticed, because nothing measured it — and it is
 * the reason `test/unified/completions.test.ts` carries a 30-second timeout as
 * a canary. A canary tells you something died; these numbers tell you what.
 *
 * ## Why the graph and not the file
 *
 * `dist/unified/image.d.ts` is a few hundred BYTES: rolldown emits the packs'
 * declarations as re-export stubs over shared chunks, so `statSync` on the
 * entry measures the stub and nothing it points at. `tsc` follows the whole
 * graph, so this does too — which is also why the numbers overlap heavily
 * between packs (they share `core/unified/**` and every provider they have in
 * common) and why a single pack's number moving is more interesting than the
 * total.
 *
 * ## The numbers
 *
 * Measured, then pinned ~10% over — the same convention as every other budget
 * in this file, and the same instruction applies: find out which declaration
 * joined the graph before raising one.
 *
 * | pack | measured | pinned | what dominates |
 * |---|---|---|---|
 * | `image` | 1138.8 | 1260 | 16 providers' per-model tables; fal's 28 endpoint rows are the newest and largest single block |
 * | `image-edit` | 1502.4 | 1660 | 5 providers, but `ImageEditInputFor` distributes over each adapter's `imageInputs` |
 * | `video` | 1701.7 | 1880 | duration x resolution x ratio matrices at ten providers |
 * | `tts` | 2101.6 | 2320 | voice unions — thousands of literal ids across fifteen providers |
 * | `stt` | 2222.6 | 2450 | language unions, which are longer than the voice ones |
 * | `music` | 1234.5 | 1360 | three providers; this is close to the floor a pack can have |
 * | `voice-clone` | 1525.7 | 1690 | the shared vocabulary plus per-provider sample constraints |
 * | `voice-design` | 1332.7 | 1470 | likewise |
 * | `lipsync` | 541.8 | 615 | fal's ten wire interfaces + sync.'s two `as const` catalogs |
 * | `avatar` | 545.1 | 600 | its twin, within 2% |
 * | `upscale` | 508.8 | 560 | fifteen Topaz rows of hand-transcribed per-model settings |
 *
 * `music` at 1234 KiB for three providers is the number to read first: most of
 * every pack here is the shared kernel and vocabulary, not the adapters. A
 * pack that jumps well above its neighbours has acquired something structural,
 * not another model.
 */
const PACK_DECLARATION_BUDGET_KIB: Readonly<Record<string, number>> = {
  image: 1260,
  "image-edit": 1660,
  video: 1880,
  // The three fal-only packs, and the cheapest declarations in the table.
  // Each category is five canonical words with one or two narrowed fields, so
  // there is very little for `tsc` to instantiate: no `SizingArms` XOR, no
  // duration enums, no codec matrix. What they do carry is fal's per-endpoint
  // wire interfaces, which is why they are not smaller still.
  //
  // **lipsync bumped 395 → 615 by wave 1d**, measured 556.8 KiB, and the
  // investigation was run rather than skipped: the pack acquired no module of
  // its own, and its own `unified/lipsync.d.ts` is still 1.5 KiB. What changed
  // is CHUNKING — rolldown-plugin-dts now co-locates the shared vocabulary
  // with declarations it names after `image-edit`, and this walker counts a
  // whole chunk when an entry touches any of it. `avatar` and `upscale`, whose
  // graphs are 13 files, did not move; `lipsync`'s is 26. The number to watch
  // is therefore the SPREAD between the three, and the twin-size test below is
  // the assertion that actually has teeth.
  // …and the sync. wave measured 472.7, comfortably under the 615 that
  // chunking artefact had forced. It is left where it is rather than tightened,
  // because the artefact is still there and the SPREAD test below is the one
  // with teeth.
  // 2026-08-26: the artefact turned out to be PLATFORM-SENSITIVE too — the
  // same commit measures ~556 KiB on macOS and 698.0 KiB on the Linux release
  // runner, because rolldown-plugin-dts assigns one shared-vocabulary chunk to
  // a different side of the lipsync/avatar boundary per platform. 770 is the
  // Linux figure ×1.1; the number that matters is still the SPREAD test.
  lipsync: 770,
  // Bumped 425 → 475 by wave 3: 428.7 measured, and the pack acquired no module
  // of its own. What grew is `fal/gen/shared.gen.ts`, the deduplicated $ref
  // components — the 3D roster added `ModelUrls`, `BasicAnimations` and their
  // `File` children to it — and every fal-touching pack counts the whole chunk.
  // Bumped 475 → 545 by the sync. wave: 466.3 measured. The sync. half is one
  // adapter leaf, one params leaf and a shared module — and the shared module
  // is what the declaration counts, because its `as const` catalogs (62 error
  // codes, 93 languages) are literal unions rather than `string[]`.
  //
  // **Bumped 545 → 600 by the atlascloud wave, and NOT because this pack grew.**
  // It measured 545.1 — 0.03% over its pin — and `unmodel/avatar` cannot reach
  // atlascloud: the new provider serves video only and the composition test
  // above pins avatar's roster unchanged. This is the same CHUNKING artefact
  // the lipsync note above describes, and it is now on record twice:
  // rolldown-plugin-dts co-locates the shared vocabulary into chunks whose
  // membership shifts when the entry list changes, and this walker counts a
  // whole chunk when an entry touches any of it. Adding four `providers/
  // atlascloud/*` entries to tsdown.config.ts moved a boundary by ~79 KiB of
  // shared declarations into avatar's reach and out of nobody's.
  //
  // A budget with 0.03% headroom is a tripwire rather than a budget — the next
  // entry to touch the shared vocabulary would trip it for a reason that has
  // nothing to do with avatar — so it goes to ~10%, the convention everywhere
  // else in this file. The assertion with teeth here remains the SPREAD test
  // below, which holds lipsync (541.8) and avatar (545.1) to 2% of each other
  // and is unaffected: they moved together, which is what "the chunk moved"
  // looks like and what "avatar acquired a module" would not.
  //
  // Re-checked on the finished wave, which is when the chunk boundary settles:
  // **543.0** measured, against lipsync's 539.6 — still within 0.7% of each
  // other, and 600 is measured x 1.1. The artefact reading holds; the pin stays.
  avatar: 600,
  // Bumped 450 → 560 by the Topaz wave: 508.8 measured, the largest jump of the
  // three and the one with a real cause rather than a chunking artefact. Topaz
  // brings FIFTEEN rows whose `extras` are hand-transcribed per-model settings
  // tables — between eight and twenty-four typed dials each — so `tsc` has
  // fifteen distinct object types to instantiate where fal's ten share three
  // shapes. That is the declaration cost of the thing this provider exists for.
  upscale: 560,
  // `unmodel/3d`: 534.1 measured. The most expensive of the four small packs
  // and the only one with two providers, which is most of the difference — the
  // `tripo3d` half brings four literal model ids, two quality ladders and its
  // own wire interfaces. The other part is fal's nineteen endpoint interfaces,
  // where Trellis 2's thirty parameters are one declaration.
  "3d": 590,
  tts: 2320,
  stt: 2450,
  music: 1360,
  "voice-clone": 1690,
  "voice-design": 1470,
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
   *
   * **54 → 55 with the values entries**, and the one that joined is a *move*
   * rather than an addition: `google/image-constraints.ts` is the import-free
   * leaf the Imagen and Gemini-image value spaces went to so that
   * `unmodel/google/values` could publish them without `src/catalog/google.gen.ts`
   * riding along (26.1 → 3.6 KiB on a shaken one-import measurement).
   * `google/constraints.ts` re-exports every name, so those bytes were already
   * in this graph — inside `constraints.ts` — and this line is where they went.
   */
  test("its provider graph is exactly the enumerated 55 modules", () => {
    const modules = sourceModulesOf(chatEntry()).filter((m) => m.startsWith("src/providers/"));
    expect(modules).toEqual([
      "src/providers/alibaba/chat.ts",
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
      "src/providers/google/image-constraints.ts",
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
      // A chat.ts LEAF (the anthropic/google/openai pattern), cut when the
      // voice-creation wave landed: importing the minimax barrel here dragged
      // the new voiceClone/voiceDesign validators (plus the media catalog and
      // tts.ts they import) into every chat bundle, and unlike mistral's
      // enumerated leakage above, that graph would keep growing with each
      // minimax media endpoint. The leaf pins chat's minimax cost to the chat
      // dialect + its two generated catalogs, permanently.
      "src/providers/minimax/chat.ts",
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
      "src/providers/stepfun/chat.ts",
      "src/providers/togetherai/index.ts",
      "src/providers/upstage/index.ts",
      "src/providers/vercel/index.ts",
      "src/providers/xai/chat.ts",
      "src/providers/zhipuai/index.ts",
    ]);
  });

  test("its graph contains the ready registry's exact catalogs and availability", () => {
    const modules = sourceModulesOf(chatEntry());
    // A vacuous scan would be worse than no scan.
    expect(modules).toContain("src/chat/index.ts");
    expect(modules).toContain("src/catalog/chat-profiles.gen.ts");

    expect(modules.filter((m) => m.startsWith("src/catalog/availability/"))).toEqual([
      "src/catalog/availability/alibaba.gen.ts",
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
      "src/catalog/availability/stepfun.gen.ts",
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
  test("all twelve are built, so the assertions below assert something", () => {
    expect(new Set(ALL_UNIFIED_ENTRIES).size).toBe(12);
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

  test.each(Object.entries(PACK_DECLARATION_BUDGET_KIB))(
    "unmodel/%s declares under %i KiB",
    (name, budget) => {
      const entry = join(DIST, "unified", `${name}.d.ts`);
      expect(existsSync(entry), `dist declaration for ${name}`).toBe(true);
      const kib =
        transitiveDeclarations(entry).reduce((total, file) => total + statSync(file).size, 0) / 1024;
      expect(kib, `unified/${name}.d.ts graph is ${kib.toFixed(1)} KiB`).toBeLessThanOrEqual(budget);
    },
  );

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

  /**
   * The MEDIA half of the same property, added when `.toApi("fal")` landed.
   *
   * The rule above catches the chat retarget layer by directory
   * (`src/retarget/**`) and by basename (`interop.ts`); neither pattern would
   * catch `core/translate/media-retarget.ts`, which lives in core, or a
   * `fal-target.ts` leaf, which lives in a provider directory a pack already
   * reaches. So they are named.
   *
   * This is the assertion the whole seam placement exists to satisfy. A
   * `Validated` from a unified call has no `.toApi` on its declared type, so
   * every byte of the engine and every overlap table would be dead weight
   * here — and both are one careless import away, because the obvious place to
   * wire `api:` is the endpoint module's own `finalize`, which is precisely
   * the module twelve packs reach.
   */
  test.each(ALL_UNIFIED_ENTRIES)("unmodel/%s carries no media retarget seam", (name) => {
    const modules = sourceModulesOf(unifiedEntry(name));
    expect(modules).toContain(`src/unified/${name}.ts`);

    expect(modules.filter((m) => MEDIA_RETARGET_MODULES.includes(m))).toEqual([]);
    expect(modules.filter((m) => /\/fal-target\.ts$/.test(m))).toEqual([]);
  });
});

/**
 * The media retarget seam, from the other side.
 *
 * The pack tests above are negative, and a negative assertion is only worth
 * something when the positive one holds somewhere: if `withApiTarget` were
 * deleted tomorrow, every "no media retarget seam" test would still pass. So
 * this names the six entries that DO carry it and checks the modules are
 * really there.
 */
describe("the media retarget seam", () => {
  test.each(MEDIA_RETARGET_ENTRIES)(
    "unmodel/$provider carries the engine, the target table and its own overlap table",
    ({ provider, falTarget }) => {
      const modules = sourceModulesOf(entryFile(provider));
      for (const required of [...MEDIA_RETARGET_MODULES, falTarget]) {
        expect(modules, `unmodel/${provider} must reach ${required}`).toContain(required);
      }
    },
  );

  /**
   * And that it is reached from the BARREL, not from an endpoint module —
   * which is the fact that keeps the packs clean. `unified-<category>.ts`
   * leaves import `./video` / `./tts` / `./image`; if a `fal-target` import
   * appeared in one of those, this fails and the pack tests fail with it.
   */
  test("no adapter leaf or endpoint module imports a fal-target", () => {
    const providers = join(ROOT, "src", "providers");
    const offenders: string[] = [];
    for (const provider of readdirSync(providers)) {
      const dir = join(providers, provider);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".ts") || file === "index.ts" || file === "fal-target.ts") continue;
        if (file.endsWith(".test.ts") || file.endsWith(".test-d.ts")) continue;
        const text = readFileSync(join(dir, file), "utf8");
        if (/from\s+["']\.\/fal-target["']/.test(text)) {
          offenders.push(`src/providers/${provider}/${file}`);
        }
      }
    }
    expect(
      offenders,
      "only src/providers/<p>/index.ts may import ./fal-target — every other module in the " +
        "directory is reachable from a category pack, which must not pay for the retarget seam",
    ).toEqual([]);
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
    // The providers that serve more than one category split their adapter per
    // category, and this pack imports only the speech half — see the
    // independence test below. Which providers those are is read off disk by
    // {@link splitProviders} rather than listed here, so a provider that grows
    // a second category cannot quietly go on being checked against its barrel.
    // Google has the most to lose by a barrel: `google/unified.ts` also exports
    // the Imagen, Veo and stt adapters, and reaching it here would put three
    // more validators and the generated catalog in a tts bundle.
    const SPLIT = splitProviders();
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
    // The providers that serve more than one category split their adapter per
    // category, and each pack imports only its own half — which is what the
    // independence test below is measuring in bytes. fal is the newest and the
    // starkest: one `unified.ts` holding both its adapters would put 17
    // editing endpoints' narrowing tables and their schema into a pack that
    // can never call them.
    const SPLIT = splitProviders();
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
   * providers" is doing the most work: seven of the fourteen also serve an image
   * or speech surface, so an adapter that imported its provider's barrel instead
   * of the video leaf would drag a second category's validators and catalogs in
   * without changing a single import in `src/unified/video.ts`.
   */
  test("it reaches exactly the fourteen video providers, through their adapters", () => {
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
    // unsuffixed leaf; the other twelve split per category. fal is the sharpest
    // case for the split in this pack: it serves FIVE categories, so a barrel
    // import here would drag its image, image-edit, lipsync and avatar
    // surfaces — validators, union schemas and generated rows — into a video
    // bundle that can never call them.
    //
    // atlascloud serves ONE category and still splits, which is the interesting
    // row: `unified.ts` there is a one-line barrel over `unified-video.ts`, so
    // this loop demands the leaf and forbids the barrel at a provider that has
    // nothing behind the barrel to leak. That is deliberate — the shape is what
    // lets a second Atlas category (image, tts) join without moving a single
    // import in `src/unified/video.ts`, and a pack that had come to depend on
    // the barrel would break on the day it did.
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

  /**
   * The R1 barrel trap, at the one provider added this wave — and stated as a
   * SOURCE fact rather than a graph one, because a graph assertion could not
   * say it: `models.ts` is legitimately in this pack's graph (every video
   * validator names its catalog through `createValidator`'s `catalog:`), so
   * "the pack does not reach it" would be false everywhere and prove nothing.
   *
   * What must hold is narrower and is the thing that actually breaks: the
   * ADAPTER LEAF must not import the catalog. `unmodel/atlascloud/values`
   * re-exports `video-params.ts` for client-side pickers, and one `./models`
   * edge in `unified-video.ts` would put twenty-three catalog rows behind every
   * dropdown — the same failure `test/values-entries.test.ts` budgets against
   * from the other side. The import-free halves (`constraints.ts`,
   * `video-params.ts`) are what it may reach, and the validator is where a
   * model id is looked up.
   */
  test("atlascloud's adapter leaf never imports its catalog (R1)", () => {
    const leaf = readFileSync(
      join(ROOT, "src", "providers", "atlascloud", "unified-video.ts"),
      "utf8",
    );
    const specifiers = [...leaf.matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1] as string);
    expect(specifiers).not.toContain("./models");
    expect(specifiers).not.toContain("./pricing");
    // …and the positive half, so the assertion cannot pass by the file having
    // no imports at all.
    expect(specifiers).toContain("./video-params");
    expect(specifiers).toContain("./constraints");
    expect(specifiers).toContain("./video");
  });

  test("its graph carries exactly two catalogs, and no availability or retarget layer", () => {
    const modules = sourceModulesOf(unifiedEntry("video"));
    expect(modules.filter((m) => m.startsWith("src/catalog/")).sort()).toEqual(VIDEO_PACK_CATALOGS);
    // Atlas ships no usable price unit, so its validator declares no `estimate`
    // and `pricing.ts` — the caveat plus the transcription table — is reachable
    // only from `unmodel/atlascloud` and `unmodel/atlascloud/values`, never
    // from a pack. A row that acquired a `cost` would land here first.
    expect(modules).not.toContain("src/providers/atlascloud/pricing.ts");
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
    const SPLIT = splitProviders();
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

    // Providers that serve more than one category split their adapter per
    // category and this pack imports only the music half; mureka is
    // single-modality, so its adapter honestly lives at `unified.ts` (the
    // smallest-ai arrangement). Every endpoint module is addressed as
    // `music.ts` either way — the rename made structural, exactly as in the
    // other packs.
    const SPLIT = splitProviders();
    for (const provider of MUSIC_PACK_PROVIDERS) {
      const leaf = SPLIT.has(provider) ? "unified-music" : "unified";
      expect(modules).toContain(`src/providers/${provider}/${leaf}.ts`);
      expect(modules).toContain(`src/providers/${provider}/music.ts`);
      if (SPLIT.has(provider)) {
        expect(modules).not.toContain(`src/providers/${provider}/unified.ts`);
      }
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

  test("the eleven packs are independent — none pulls another's entry in", () => {
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

/**
 * The three media packs with a native half, checked together because the
 * assertion that matters most is a COMPARISON.
 *
 * `fal-ai/sync-lipsync/v3` and `fal-ai/sync-lipsync/v3/image-to-video` are one
 * vendor's one model on two routes, and they are in different categories. If
 * the per-category adapter split ever slipped, the symptom would not be a
 * budget overrun — it would be these two packs quietly becoming the same
 * bundle. So each is pinned to its exact provider set, each provider reached
 * through exactly one leaf, and then pinned NOT to contain the other's leaf,
 * its schema, or its generated rows.
 *
 * The native waves sharpened that considerably, and there are now THREE native
 * providers serving both audio-driven categories. At fal the two categories are
 * two ENDPOINT IDS behind one union schema, so a leak shows up as an extra
 * generated file. At sync., VEED and HeyGen they are two adapter leaves over a
 * shared module — `unified-lipsync.ts` and `unified-avatar.ts`, both importing
 * that provider's `shared.ts` — so a lipsync bundle containing
 * `heygen/unified-avatar.ts` would be a leak with no filename tell at all
 * except this assertion. (At sync. the two leaves even reach the same URL.)
 *
 * fal serves ten categories, which makes it the strongest test of the split in
 * the library: `src/providers/fal/unified.ts` re-exports all ten adapters, and
 * either pack importing that barrel instead of its own leaf would pull ~30
 * video wire types and 45 image endpoints into a ten-endpoint bundle without
 * changing a line in `src/unified/lipsync.ts`.
 */
describe("unmodel/lipsync, unmodel/avatar and unmodel/upscale (the packs with native halves)", () => {
  const CASES: Array<{
    name: string;
    providers: string[];
    other: string;
    /** Every native provider that serves BOTH audio-driven categories. */
    natives?: Array<{ provider: string; twin: string }>;
  }> = [
    {
      name: "lipsync",
      providers: LIPSYNC_PACK_PROVIDERS,
      other: "avatar",
      // Three native providers, each serving both categories through two leaves
      // — and at sync. through ONE url, at VEED through two urls with disjoint
      // schemas, at HeyGen through two urls with different response shapes. All
      // three would leak with no filename tell but this.
      natives: [
        { provider: "sync", twin: "avatar" },
        { provider: "veed", twin: "avatar" },
        { provider: "heygen", twin: "avatar" },
      ],
    },
    {
      name: "avatar",
      providers: AVATAR_PACK_PROVIDERS,
      other: "lipsync",
      natives: [
        { provider: "sync", twin: "lipsync" },
        { provider: "veed", twin: "lipsync" },
        { provider: "heygen", twin: "lipsync" },
      ],
    },
    // The third, and the one that makes the sweep below mean something at a
    // provider serving ten categories: `upscale`'s twin is not one of the
    // other two, so its "…and nothing of the twin" assertion is checked against
    // `lipsync` and the six-category loop underneath catches the rest. Its
    // native half is a single-leaf provider (`topaz/unified.ts` IS the adapter),
    // so there is no twin leaf to exclude.
    { name: "upscale", providers: UPSCALE_PACK_PROVIDERS, other: "lipsync" },
  ];

  test.each(CASES)("unmodel/$name reaches exactly $providers, through its own leaf", (kase) => {
    const modules = sourceModulesOf(unifiedEntry(kase.name));
    expect(modules).toContain(`src/unified/${kase.name}.ts`);
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual([...kase.providers]);

    // The leaf, not the barrel — the whole point of the split at a provider
    // that serves five categories.
    expect(modules).toContain(`src/providers/fal/unified-${kase.name}.ts`);
    expect(modules).not.toContain("src/providers/fal/unified.ts");
    // The rename made structural: the pack reaches fal only through a file
    // named after the category's own verb.
    expect(modules).toContain(`src/providers/fal/${kase.name}.ts`);

    // …and nothing of the twin, which is the assertion this describe exists
    // for. One product, two routes, two bundles.
    expect(modules).not.toContain(`src/providers/fal/unified-${kase.other}.ts`);
    expect(modules).not.toContain(`src/providers/fal/${kase.other}.ts`);
    expect(modules).not.toContain(`src/providers/fal/gen/${kase.other}-schema.gen.ts`);
    expect(modules).not.toContain(`src/providers/fal/gen/${kase.other}-params.gen.ts`);

    // Nor of fal's other categories. This is the loop that carries the weight
    // now that fal serves ten: `unified.ts` re-exports all ten
    // adapters, and either pack importing that barrel instead of its own leaf
    // would pull ~30 video wire types, 45 image endpoints and 23 speech
    // rosters into a ten-endpoint bundle without changing a line in
    // `src/unified/<category>.ts`.
    const others = ["image", "image-edit", "video", "lipsync", "avatar", "upscale", "three-d", "tts", "stt", "music"]
      .filter((category) => category !== kase.name);
    for (const category of others) {
      // `three-d` is the one entry here whose leaf name is not its category id:
      // the leaf is `unified-3d.ts` and the generated slice is `three-d-*`,
      // because the id is `3d` and a generated file stem has to be an
      // identifier. Both spellings are checked so neither can leak.
      const leaf = category === "three-d" ? "3d" : category;
      expect(modules).not.toContain(`src/providers/fal/unified-${leaf}.ts`);
      expect(modules).not.toContain(`src/providers/fal/gen/${category}-schema.gen.ts`);
    }
    // A12: the merged catalog is for `unmodel/fal` alone. A validator reaching
    // it would put all ten verbs' rows in every pack.
    expect(modules).not.toContain("src/providers/fal/models.ts");

    // The native half, and the sharper version of the same rule: sync. serves
    // both audio-driven categories from ONE url through two adapter leaves, so
    // this is the only thing standing between them.
    for (const native of kase.natives ?? []) {
      expect(modules).toContain(`src/providers/${native.provider}/unified-${kase.name}.ts`);
      expect(modules).toContain(`src/providers/${native.provider}/${kase.name}.ts`);
      expect(modules).toContain(`src/providers/${native.provider}/${kase.name}-params.ts`);
      expect(modules).not.toContain(`src/providers/${native.provider}/unified.ts`);
      expect(modules).not.toContain(`src/providers/${native.provider}/unified-${native.twin}.ts`);
      expect(modules).not.toContain(`src/providers/${native.provider}/${native.twin}.ts`);
      expect(modules).not.toContain(`src/providers/${native.provider}/${native.twin}-params.ts`);
    }
    if (kase.name === "upscale") {
      // Topaz serves one category, so `unified.ts` IS its adapter leaf — the
      // pixverse/tripo3d shape, and the reason `splitProviders()` is derived
      // from disk rather than enumerated.
      expect(modules).toContain("src/providers/topaz/unified.ts");
      expect(modules).toContain("src/providers/topaz/upscale.ts");
      expect(modules).toContain("src/providers/topaz/upscale-generative.ts");
    }
  });

  test.each(CASES)("unmodel/$name carries no catalog, availability or retarget layer", (kase) => {
    const modules = sourceModulesOf(unifiedEntry(kase.name));
    expect(modules.filter((m) => m.startsWith("src/catalog/"))).toEqual([]);
    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);
    expect(modules.filter((m) => m.endsWith("/interop.ts"))).toEqual([]);
    // The pipeline IS here, and deliberately: a unified call ends in the
    // provider's own validator, all four layers of it.
    expect(modules).toContain("src/core/pipeline.ts");
  });

  /**
   * The three stay within 20% of each other.
   *
   * A relative assertion rather than three more absolute ones, because it
   * survives the shared kernel growing and catches the thing an absolute number
   * cannot: one of the three acquiring a module the others have not.
   *
   * **Widened from 10% to 20% by the natives wave**, measured 15.0%. The two
   * audio-driven packs went from two providers to FOUR and `upscale` stayed at
   * two, so the spread is now a difference in ROSTER rather than in structure —
   * which is exactly the thing the assertion was written to tolerate and the
   * absolute budgets above are written to catch. The pair that has to stay tight
   * is `lipsync` against `avatar`, and the twin test below holds them to 2%.
   */
  test("the three media packs stay within a fifth of each other", () => {
    const sizes = CASES.map((kase) => [kase.name, transitiveBytes(unifiedEntry(kase.name))] as const);
    const largest = Math.max(...sizes.map(([, bytes]) => bytes));
    const smallest = Math.min(...sizes.map(([, bytes]) => bytes));
    const drift = (largest - smallest) / largest;
    expect(drift, sizes.map(([name, bytes]) => `${name} ${bytes}`).join(" vs ")).toBeLessThan(0.2);
  });
});

/**
 * `unmodel/3d` — the first of the 2026 categories whose ready-made pack has TWO
 * providers, and the reason the category exists at all.
 *
 * The three packs above are each one provider, and each of their composition
 * tests is really asking "did the per-category split hold". This one asks
 * something the others cannot: that an aggregator's resale of a model and that
 * vendor's own API can sit in one bundle without either dragging the other's
 * neighbours in. `tripo3d/h3.1/image-to-3d` at fal and `tripo3d/v3.1-20260211`
 * here are the SAME MODEL reached two ways — that is the comparison the category
 * was built to make cheap, and this is where the bytes of it are pinned.
 *
 * Note the two leaf shapes. fal serves ten categories, so its 3D adapter is
 * `unified-3d.ts` and the pack must reach it rather than the ten-adapter
 * `unified.ts` barrel. Tripo serves one, so its adapter IS `unified.ts` — which
 * is the pixverse/lightricks shape and costs nothing, because there is no
 * second category behind it to leak.
 */
describe("unmodel/3d (the two-provider pack)", () => {
  test("reaches exactly fal and tripo3d, each through one adapter leaf", () => {
    const modules = sourceModulesOf(unifiedEntry("3d"));
    expect(modules).toContain("src/unified/3d.ts");
    expect(modules).toContain("src/core/unified/kernel.ts");

    const providers = [
      ...new Set(
        modules
          .filter((m) => m.startsWith("src/providers/"))
          .map((m) => m.split("/")[2] as string),
      ),
    ].sort();
    expect(providers).toEqual([...THREE_D_PACK_PROVIDERS]);

    // fal: the leaf named after the CATEGORY (`unified-3d.ts`), the validator
    // named after the VERB (`three-d.ts`), and never the ten-adapter barrel.
    expect(modules).toContain("src/providers/fal/unified-3d.ts");
    expect(modules).toContain("src/providers/fal/three-d.ts");
    expect(modules).not.toContain("src/providers/fal/unified.ts");
    expect(modules).not.toContain("src/providers/fal/models.ts");

    // tripo3d: one category, so `unified.ts` IS the leaf, and both wire routes
    // ride because the adapter picks between them at compile time.
    expect(modules).toContain("src/providers/tripo3d/unified.ts");
    expect(modules).toContain("src/providers/tripo3d/three-d.ts");
    expect(modules).toContain("src/providers/tripo3d/three-d-from-image.ts");

    // None of fal's other nine categories, which is what the split buys.
    const others = [
      "image",
      "image-edit",
      "video",
      "lipsync",
      "avatar",
      "upscale",
      "tts",
      "stt",
      "music",
    ];
    for (const category of others) {
      expect(modules).not.toContain(`src/providers/fal/unified-${category}.ts`);
      expect(modules).not.toContain(`src/providers/fal/gen/${category}-schema.gen.ts`);
    }
  });

  test("carries no catalog, availability or retarget layer", () => {
    const modules = sourceModulesOf(unifiedEntry("3d"));
    expect(modules.filter((m) => m.startsWith("src/catalog/"))).toEqual([]);
    expect(modules.filter((m) => m.startsWith("src/retarget/"))).toEqual([]);
    expect(modules.filter((m) => m.endsWith("/interop.ts"))).toEqual([]);
    // The pipeline IS here, and deliberately: a unified call ends in the
    // provider's own validator, all four layers of it.
    expect(modules).toContain("src/core/pipeline.ts");
  });

  test("the native half is a small fraction of the pack", () => {
    // A relative assertion, so it survives roster growth on either side. The
    // point is that adding a native provider beside an aggregator is cheap:
    // `unmodel/tripo3d` is 46 KiB against fal's 562, and a caller who wants
    // only Tripo builds `createThreeD([tripo3d])` and pays for that alone.
    const native = transitiveBytes(entryFile("tripo3d"));
    const aggregator = transitiveBytes(entryFile("fal"));
    expect(native).toBeLessThan(aggregator / 4);
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
  /**
   * Fattest today: fal at 698.8 KiB, then google at 404.3, openai at 319.3 and
   * openrouter at 298.9.
   *
   * **Bumped 460 → 615 by fal's wave 1d, 615 → 730 by wave 3, and 730 → 770 by
   * the adopter-feedback wave** (698.8 measured, up 35.4 from 663.4). The
   * number is a fact about what this entry IS rather than a regression:
   * `unmodel/fal/types` publishes one interface per curated endpoint across TEN
   * categories — 172 of them now — plus, since this wave, the ten
   * `Fal<Verb>ResultById` maps and the `FalQueueResult` / `FalQueueError` pair
   * they need. Every one carries that endpoint's own enums, bounds and doc
   * comment. It is the only provider in the library whose types entry is a
   * whole aggregator's catalogue rather than one vendor's API.
   *
   * The 35.4 splits roughly in three and every part was accounted for before
   * the pin moved: the six newly curated video/upscale endpoints and their
   * `$ref` children in `gen/shared.gen.ts`; the carrier re-exports
   * (`src/core/carriers.ts`, +0.2–0.5 on every provider entry, which is why
   * google/openai/openrouter moved too); and the result-type surfacing, which
   * names declarations that were already in the graph rather than adding any.
   * At the old 730 this entry had 4.5% headroom, below this file's ~10%
   * convention — a tripwire rather than a budget.
   *
   * Zero runtime either way: the emitted JavaScript is an empty module, which
   * the test above pins.
   */
  const TYPES_ENTRY_DECLARATION_BUDGET_KIB = 770;
  /**
   * **Bumped 385 → 425**: 387.7 KiB measured, up 11.9 from 375.8.
   *
   * Two causes, and separating them was the point of measuring rather than
   * bumping. The smaller half is the hub's own growth: `ChatMediaDetail`
   * joined the canonical vocabulary and `ChatProviderOptions` grew the
   * OpenAI-only bucket half. The larger half is one shared chunk —
   * `src/retarget/dialects.ts` now names OpenAI's endpoint body, so
   * `providers/openai/wire.d.ts` (~5.7 KiB) rides in a chunk this hub already
   * reached, and `constraint-types` gained `imageTokensByDetail` (+0.8).
   *
   * The version of this change that measured **+43 KiB on fifty-seven types
   * entries** is worth recording, because the fix is not obvious and the
   * regression was invisible to `tsc`: the wire leaf originally closed `model`
   * to `OpenaiChatModelId`, which put `catalog/openai.gen` (80 KiB of literal
   * ids) into the dialect hub's chunk and therefore into every provider's
   * declaration graph. Making the body generic in its model id
   * (`ChatCompletionsBodyOf<M>`, closed to the catalog only in `openai/chat.ts`)
   * took it back to +6.4 each. A hub module must not name a catalog.
   *
   * Re-measured on the finished wave, after atlascloud joined: **389.2 KiB**,
   * up 1.5 from the 387.7 above. The pin STAYS at 425 — 9.2% headroom, which
   * is this file's ~10% convention already — because a 0.4% drift is not a
   * reason to loosen a budget. The 1.5 is atlascloud's four ids reaching the
   * video vocabulary; the hub gained no module.
   */
  const TYPES_HUB_DECLARATION_BUDGET_KIB = 425;

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
