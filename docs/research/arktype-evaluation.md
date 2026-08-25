# ArkType evaluation (2026-08)

Question: should unmodel migrate from zod to [ArkType](https://arktype.io), and if not, which of its
implementation techniques are worth porting? Evaluated against `arktype@2.2.3` (latest stable,
published 2026-07-07) and `zod@4.4.3` (what this repo ships).

**Verdict: do not migrate. Borrow three techniques.** First-party measurements (below) confirm
ArkType's runtime validators are genuinely fast under unmodel's passthrough semantics — but the
win lands on a cold path, while the costs land on the hot ones: schema construction is 6.3×
slower at import time (the per-entry budget architecture exists to keep imports cheap),
type-checking costs 4.7× the instantiations (paid by every consumer), and a global-registry
retention bug makes dynamically constructed types unreclaimable. unmodel's zod usage profile —
a pure runtime gate with no type-level entanglement — means a migration would rewrite ~292
schemas across 134 files to buy nanoseconds where the pipeline spends microseconds. The techniques worth taking regardless are `@ark/attest` instantiation benchmarking,
the Standard Schema seam, and the bidirectional type-width-check concept. All three are adopted; see
[What we borrowed](#what-we-borrowed).

## How unmodel actually uses zod

The migration cost/benefit is dominated by facts about this repo, not about either library:

- **Three runtime call-sites.** `spec.schema.safeParse` in `src/core/pipeline.ts` (layer 1 of the
  validator), `src/core/translate/retarget.ts`, and `src/chat/validate.ts`. Each maps
  `issue.path`/`issue.message` into unmodel's own `Issue` shape; no zod error object or formatter
  escapes.
- **Zero `z.infer`.** Every public type is hand-written or generated; schemas are runtime gates only.
  zod contributes ~nothing to the `.d.ts` weight this repo fights (that weight is generated literal
  unions — voice ids, per-model narrowing tables).
- **~292 module-scope schemas** built eagerly on import, dominated by `z.looseObject` (443 uses —
  unknown keys pass through and are reported as unmodel warnings via `reportUnknownTopLevelKeys`,
  which introspects `ZodObject.shape`).
- **zod is excluded from every bundle budget** (`test/bundle-budget.test.ts` treats bare specifiers
  as externals). Swapping validators would not move a single committed number — the budgets are blind
  to this choice, which cuts both ways.
- The fal `gen/` layer already solved "eager schema construction is expensive" in-house: one loose
  category-wide zod gate + a plain-data per-endpoint IR (`FAL_*_SHAPES`) checked by a hand-written
  battery (`src/providers/fal/checks.ts`). That design is strictly better for this package's goals
  than anything a validator swap provides.

## Claims vs. measured reality

### Runtime speed: real, but for a different operation

The arktype.io homepage chart ("ArkType 14ns / Zod 281ns") sources
[moltar's benchmark suite](https://moltar.github.io/typescript-runtime-type-benchmarks/), where the
ArkType case registers only `assertLoose` implemented as `t.allows(data)` — a boolean predicate that
constructs nothing — while the zod case parses and materializes an output object. From the suite's
raw `node-24.json` (Node 24, arktype 2.2.3, zod 4):

| library / operation | ns/op |
| --- | --- |
| arktype `.allows()` (predicate only) | 18.8 |
| zod4 `parseSafe` | 141.4 |
| zod4 `parseStrict` | 278.8 |
| arktype "delete" mode (zod-equivalent strip, ArkType's own committed bench, `ark/type/__tests__/runtime.bench.ts`) | 3,540 |
| arktype "reject" mode (strict) | 5,970 |

Under zod-equivalent *strip* semantics ArkType's advantage disappears and reverses by roughly an
order of magnitude on its own reference payload (partly deep-clone cost; ArkType deep-clones input
before morphs/deletes). That caveat turned out **not** to apply to unmodel's own profile — the
gates here are passthrough, which maps to ArkType's fast default mode; see the first-party
prototype numbers below, where arktype won the runtime comparison decisively. The claim to
distrust is the *headline*, which compares a predicate against a parse — not the idea that the
compiled validators are fast.

### Editor / compile-time: the claim points the wrong way

ArkType publishes **no** instantiation counts or tsc timings vs zod — the claim is prose
("editor performance that will remind you how autocomplete is supposed to feel"). Its precise
inference works by re-running a shift-reduce parser *in the type system* character-by-character
(`ark/type/parser/reduce/static.ts` mirrors `dynamic.ts` line for line), which is intrinsically
instantiation-heavy. The only quantitative comparison found
([astahmer/typescript-runtime-typechecking-benchmarks](https://github.com/astahmer/typescript-runtime-typechecking-benchmarks),
low-trust — 1 star, self-labeled WIP, but built on ArkType's own `@ark/attest` measurement tool)
puts ArkType at 10–30x more instantiations than zod 4 across scenarios, worst on exactly the
generated-code shapes unmodel emits (Petstore-style API: 136k instantiations vs zod's 6.7k).
Corroborating: [microsoft/TypeScript#58805](https://github.com/microsoft/TypeScript/issues/58805)
records ArkType's own suite at ~2.6–2.8M instantiations. zod 4 meanwhile cut instantiations ~100x
vs zod 3 ([zod.dev/v4](https://zod.dev/v4)).

unmodel's compile-time problem is `.d.ts` size from generated literal unions (see the incidents
documented in `test/bundle-budget.test.ts` around the declaration budgets); ArkType would add to the
instantiation bill, not reduce it.

### Bundle: larger, and it barely tree-shakes

Measured via bundlephobia (2026-08-24): `arktype@2.2.3` **45.8 kB min+gzip**, no `sideEffects` field
in its package.json (bundlers must assume side effects); the set-theoretic engine + JIT compiler in
its hard dependency `@ark/schema` is effectively monolithic (~277 kB raw). zod 4 full barrel is
61.8 kB but core tree-shakes to **5.36 kB gzip** and `zod/mini` to **1.88 kB**; zod declares
`sideEffects: false` with granular subpath exports. If consumer bundle weight ever becomes the
priority, `zod/mini` is the cheap move, not ArkType.

### Costs specific to unmodel's architecture

- **Schema construction is 12–56x slower than zod's builder calls** (~90–175 µs each, measured by
  [miyaji255/arktype-macro-bench](https://github.com/miyaji255/arktype-macro-bench); no AOT story —
  [#810](https://github.com/arktypeio/arktype/issues/810) open since 2023). ~292 eager schemas ≈
  30–50 ms of import-time penalty, attacking exactly what the per-entry budget architecture protects.
- **Open memory leak from the global schema registry**
  ([#1584](https://github.com/arktypeio/arktype/issues/1584), confirmed by the maintainer as a bug).
- **JIT via `new Function`** with a silent interpreted fallback under CSP (Cloudflare Workers, strict
  browser CSP) — the environments lose exactly the performance that motivated the swap.
- Solo maintainer (640 commits vs next contributor's 39), bursty cadence with multi-month gaps,
  ESM-only, TS ≥ 5.1, `strictNullChecks` required, editor DX requires per-developer VS Code config
  (`editor.quickSuggestions.strings`). No async validation. No zod→arktype codemod exists.
- npm weekly downloads: arktype ~1.7M vs zod ~265.7M.

### What ArkType is genuinely better at

Honest reasons to reach for it that zod cannot match at any version: cyclic/recursive schemas without
`z.lazy()` gymnastics (`type.module` alias references), runtime set-theoretic introspection
(`.extends` / `.equals` / `.overlaps`), automatic multi-path union discrimination, `match` pattern
matching, bidirectional JSON Schema (`@ark/json-schema`), and Standard-Schema-as-definition
(embed a zod schema inside an arktype type). unmodel needs none of these today.

## What we borrowed

1. **`@ark/attest` type-instantiation benches** (`test/type-bench/`, `bun run bench:types`).
   The repo previously measured tsc cost only by proxy — declaration-KiB budgets and long test
   timeouts as canaries. Attest measures instantiations directly with committed inline snapshots
   that fail on regression; the benches cover the historically-regressed hot surfaces (chat entry,
   typed catalog, fal pack params, media path types). The declaration budgets stay: they measure a
   different consumer cost (bytes in front of tsserver) and the two move independently.
2. **Standard Schema seam** (`src/core/standard-schema.ts`). `PipelineSpec.schema` and the three
   call-sites now consume the vendored [`StandardSchemaV1`](https://standardschema.dev) interface
   instead of `z.ZodType`, with one shared issue adapter replacing the tripled ten-line mapping.
   Non-breaking — zod 4 implements the spec — and it removes zod from public type positions while
   keeping per-schema experimentation open (the prototype below plugged arktype schemas into the
   unchanged pipeline through this seam). `reportUnknownTopLevelKeys` remains the one deliberate
   zod-specific behavior (it introspects `ZodObject.shape`; non-zod schemas skip the check).
3. **Bidirectional width-check concept** (from ArkType's `type.declare<T>()`, which errors when an
   inferred type drifts too wide *or* too narrow). Ported to the fal codegen as generated type-only
   assertions: every generated wire input interface must be assignable to the category zod gate's
   input, so a field emitted as `z.string()` while the wire type says `number` fails `tsc` instead
   of shipping. Zero runtime bytes.

Not borrowed, considered: the CSP-aware `new Function` JIT (unmodel's fal checks interpret a
plain-data IR; JIT would add complexity for µs-scale wins on a cold path) and the dual
static/dynamic string parser (spectacular engineering, but string-embedded definitions are the
instantiation cost center — the opposite trade of this repo's `.d.ts` discipline).

## Revisit if

- Attest benches show zod becoming a measurable share of instantiation cost (today it is ~nil).
- ArkType fixes the registry leak (#1584) **and** ships precompilation/AOT (#810) — the two
  blockers for a package whose imports must stay cheap.
- unmodel grows a real need for cyclic schemas, set-theoretic introspection, or JSON Schema
  emission from validators.
- The hot path changes shape to pure predicate checks (`.allows()`-like), e.g. request routing by
  shape, where ArkType's compiled matchers genuinely excel.

## First-party prototype numbers

Measured 2026-08-24 in an isolated worktree: `src/providers/cartesia/tts.ts` (discriminated
union) and `src/providers/runway/shared.ts` (9 schemas + a `superRefine` cross-field rule)
ported to arktype 2.2.3 side by side with the zod 4.4.3 originals. Both ports passed the full
`tsc --noEmit` and runtime smoke tests; no port blockers hit (bounded ranges, integer keywords,
auto-discrimination and `.narrow` all worked first try). Bun 1.3.14, TS 5.9.3, macOS arm64;
every number is the second of two matching runs.

| Measurement | zod 4.4.3 | arktype 2.2.3 | ratio |
| --- | --- | --- | --- |
| Consumer bundle, validator **bundled** (min / gzip) | 285.2 kB / 65.3 kB | 158.6 kB / 49.2 kB | arktype **−44% / −25%** |
| Cold import + schema construction (median of 10 fresh processes) | 15.3 ms | 96.7 ms | arktype **6.3× slower** |
| Type instantiations, defining the cartesia schema (attest) | 4,734 | 22,381 | arktype **4.7× more** |
| Validate valid body (ns/op, 100k iters) | 600 | 53 (`Type()`) / 34 (`.allows()`) | arktype **11–18× faster** |
| Validate invalid body (ns/op) | 2,222 | 1,340 | arktype ~1.7× faster |
| Heap retained after 200k dynamic constructions (forced GC) | +1.1 MB, flat | **+19.3 MB, never reclaimed** | confirms #1584 |

Two results **contradict** the third-party framing above and are worth stating plainly:

- **Runtime validation favors arktype under unmodel's semantics.** The "delete-mode is µs-slow"
  caveat applies to zod's *strip* semantics; unmodel's gates are `looseObject` passthrough, which
  maps to arktype's default `ignore` mode — no clone, no strip — and there arktype's compiled
  validators genuinely deliver ~11× on the happy path.
- **Bundle favors arktype against unmodel's actual zod usage.** The repo imports the full zod
  classic barrel (not `zod/mini`), which bundles at ~285 kB minified; the `zod/mini`-vs-arktype
  comparison in §Bundle is the fair *potential* comparison, but the *current* one flips.

Neither changes the verdict, because the three costs that bind for this package all confirmed:
cold-start construction (6.3× on two surfaces extrapolates to the ~30–50 ms import-time penalty
across ~292 schemas that the per-entry budget architecture exists to prevent), type-checker cost
(4.7× instantiations, landing on every consumer), and the registry retention (module-scope-only
construction would be a hard usage constraint the current architecture doesn't need). The
runtime win is real but bought at the wrong margin: the three `safeParse` call-sites run once
per request build, where 600 ns → 53 ns is noise.

DX friction recorded during the port: `configure({exactOptionalPropertyTypes: false})` (needed
to match zod's acceptance of `{key: undefined}`) must live in its own module imported before any
`arktype` import — ESM hoisting silently no-ops an inline call; `instanceof type.errors` fails
silently across duplicated arktype copies (a hazard zod's `.success` API doesn't have); `.narrow`
messages must be phrased as "must be …" fragments; union error messages list members in internal
order, not source order.

## Sources

Primary: [arktype.io docs](https://arktype.io/docs/intro/setup)
([configuration](https://arktype.io/docs/configuration) covers `jitless`/CSP and error chains;
[FAQ](https://arktype.io/docs/faq) covers no-async and `skipLibCheck`), ArkType source
(`ark/type/parser/`, `ark/schema/shared/compile.ts`, `ark/util/functions.ts`,
`ark/type/__tests__/runtime.bench.ts`), issues
[#1584](https://github.com/arktypeio/arktype/issues/1584) /
[#1415](https://github.com/arktypeio/arktype/issues/1415) /
[#810](https://github.com/arktypeio/arktype/issues/810) /
[#611](https://github.com/arktypeio/arktype/issues/611), [zod.dev/v4](https://zod.dev/v4),
[standardschema.dev](https://standardschema.dev). Third-party:
[moltar/typescript-runtime-type-benchmarks](https://moltar.github.io/typescript-runtime-type-benchmarks/)
(read the `cases/*.ts` files before trusting any cross-library row),
astahmer/typescript-runtime-typechecking-benchmarks (directional only),
miyaji255/arktype-macro-bench, bundlephobia + npm registry data (2026-08-24).
