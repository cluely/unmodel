## Project overview

**unmodel** is a published npm library (`unmodel`): catalog-aware, zod-powered validation and translation for AI API requests — chat plus the media surfaces (TTS, STT, image, image edit, video, lipsync, avatar, upscale, 3D, music, voice clone, voice design, realtime configs). It checks a request against what the provider actually accepts before it is sent, compiles optional cross-provider params to real wire bodies, and sanity-checks raw responses (truncation, refusals, usage, catalog-priced cost). **It never sends anything and never sees a credential** — users keep their own `fetch`, SDK, and keys. ESM-only, Node 20+/Bun/Workers; runtime deps are `zod` and `citty`, nothing else (provider SDKs are devDeps for interop tests only).

Two layers, and they are not peers (docs/decisions.md §1):

- **The substrate** — `unmodel/<provider>`: wire-exact validators whose params ARE the provider's raw REST body, byte for byte. Nothing renamed, defaulted, or normalised — including the parts we find ugly.
- **The unified layer** — `unmodel/chat` + the media packs (`unmodel/image`, `unmodel/tts`, …): one camelCase vocabulary that **compiles down** to one provider's wire params and finishes in that provider's own validator. There is no second definition of valid; a gap in the unified layer is a **typed refusal**, never a workaround.

## Core principles

- Write code that is **type-safe, exact, and maintainable**. Exactness is the product: what the caller builds is what gets sent, and a validator refusing a request the API fulfils is the one failure this library must never have.
- **Near-zero dependencies is a design constraint**, not thrift. Before adding a runtime dep, assume the answer is no. Bundle and declaration weight are budgeted per entry in bytes (`test/bundle-budget.test.ts`) — cheap imports are what the per-entry architecture exists to protect.
- **Breaking changes are fine; drift is not.** This is a semver'd published package: renames and removals happen deliberately, recorded in a changeset, with retired names fully removed (no aliases, no compat shims — the changeset is the only place a retired spelling survives).
- Prefer **functional programming and the factory pattern** (`createChat`, `createAzure({ endpoint })`, `withApiTarget`).
- **Make architectural decisions for the long term.** Do not accept a stopgap that only works for now and is meant to be replaced later.
- **The package already knows it → say it at the API surface.** Anything the library knows but the caller must find elsewhere (a JSDoc-only fact, a delivery shape, an auth header, an exclusion reason) is a defect. The fix is data or types on a public entry, or docs when data would be a lie.
- **Unverifiable → caveat, never catalog.** Where no defensible number or fact exists (credit-based pricing, contradicting pages), `cost` is omitted and estimates return `undefined` with the refusal documented — one guessed number breaks trust in every real one.

## Working method

### 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity first

**Minimum code that fully meets the current requirements. Nothing speculative.**

- No features beyond what was asked.
- No abstractions, configuration, or indirection for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-driven execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Commands

Bun is the runtime for everything local (`bun install`, `bun test`, `bun <file>`).

```bash
bun test                 # all tests (colocated *.test.ts + test/)
bun run check            # tsc --noEmit
bun run build            # tsdown → dist/
bun run bench:types      # @ark/attest type-instantiation budgets (runs via tsx)
bun run lint:pkg         # publint + attw --pack (esm-only profile)

bun run codegen          # regen src/catalog/*.gen.ts from data/models-dev.json (offline)
bun run codegen:fal      # regen src/providers/fal/gen/** from data/fal/ snapshots (offline)
bun run codegen:refresh  # re-fetch the models.dev snapshot, then regen
bun run codegen:fal:refresh|:check|:audit   # the network-touching fal variants

bun run changeset        # record a user-visible change
bun run audit:leaderboard | audit:atlascloud | gen:tts-matrix
```

- **Definition of done for any change** is the CI ladder, in order: `codegen` + `codegen:fal` leave the tree clean (drift check — includes untracked files), `check`, `bench:types`, `bun test`, `build`, `lint:pkg` all green. Run at least the ones your change can affect.
- `bench:types` fails at >20% over the committed baselines; counts are deterministic for the pinned TypeScript version.
- Bundle/declaration pins in `test/bundle-budget.test.ts` are **platform-sensitive — pin the Linux (CI) figure**, not the local macOS one.
- Codegen is offline by design (a fal outage can never fail an unrelated PR); only the `:refresh`/`:check`/`:audit` variants touch the network. Snapshot drift is caught by the weekly workflows (`codegen-refresh.yml`, `codegen-fal-refresh.yml`, `leaderboard-audit.yml`, `atlascloud-audit.yml`).

## Repository map

- `src/providers/<id>/` — one directory per provider: wire types (`wire.ts`/`types.ts`), one module per endpoint address (`chat.ts`, `tts.ts`, …), `unified-<category>.ts` adapter leaves, hand catalog `models.ts` where needed, `values.ts`, and `index.ts` (the only module that wires `.toApi` for media — decisions.md §6).
- `src/core/` — pipeline, issues, cost, catalog lookup, request/result shapes, the Standard Schema seam, `translate/`.
- `src/unified/` — the media-category schemas + compile functions. `src/chat/` — the ready chat pack + `factory.ts` (two entries on purpose — decisions.md §3).
- `src/catalog/*.gen.ts` — generated from models.dev. `src/providers/fal/gen/**` — generated from fal OpenAPI snapshots. **Never hand-edit a `.gen.ts`**: fix `data/` or the generator and rerun.
- `data/` — the committed snapshots and hand-maintained truth: `models-dev.json`, `fal/` (`curation.json`, `pricing.json`, `overlays.json` — every entry carries a reason, source URL, and date), `availability-overrides.json`, `leaderboard-aliases.json`.
- `test/` — cross-cutting suites: `bundle-budget`, `import-graph`, `type-bench`, `types/` (compile-time assertions), `interop/` (SDK golden tests), `docs/`, `fixtures/` (recorded real responses). Behavioural tests are colocated `*.test.ts` beside their source.
- `docs/` — user-facing docs plus `decisions.md`, `providers.md` (the roster + tier status), `research/` (evaluation write-ups).

## Standing decisions

**Read `docs/decisions.md` before "fixing" anything that looks inconsistent** — every entry there is a deliberate non-uniformity, and each states what would have to be true for it to change. The headlines:

- §1 Validation lives only in `src/providers/`; `src/unified/` and `src/chat/` compile and delegate. Every endpoint stays reachable wire-exactly by name.
- §2 **The address-vs-wire naming law**: endpoint addresses are uniform verbs (`chat`, `tts`, `videoFromImage`, …); wire-shaped names keep the provider's own spelling (`MessagesBody` beside `anthropic.chat` is correct). `src/cli-registry.test.ts` is the executable rename map.
- §3 `createChat` lives at `unmodel/chat/factory` and is deliberately NOT re-exported from `unmodel/chat` (bundle weight tree-shaking can't reach).
- §4 A wide surface never gets narrower because a modality view exists (`google.chat` still accepts TTS ids); shared check batteries, not private copies.
- §5 zod 4 behind the `StandardSchemaV1` seam: no `z.infer` in public types, no `z.ZodType` in public signatures; `~standard.validate` can go async on hostile values.
- §7 `/v1/responses` is a future substrate address (`openai.chatResponses`), never a fifth chat dialect.
- §8 **The two-witness rule**: a param joins the canonical vocabulary only when a second provider independently has the same concept; one-provider params live typed under `providerOptions.<id>`. Union over intersection — a level one dialect lacks becomes an `approximated_param`, not an unsayable request.

## Provider work

- **Research before typing.** Never type a provider endpoint from memory or from an SDK's `.d.ts` alone: read the provider's docs AND API reference AND SDK types; the SDK/OpenAPI resolves doc ambiguities. Findings worth keeping go in `docs/research/`. Wire leaves carry `mirror … exactly` comments — they are load-bearing, not boilerplate.
- Coverage = providers with a **public developer API**, addressed natively (`unmodel/<provider>`); fal is additionally served as a generated aggregator provider. No public API → not in the library (noted as excluded in `docs/providers.md`).
- Implementation tiers (native / oai-base / generated / catalog-only) and per-provider status live in `docs/providers.md` — update it when a provider lands or moves tier.
- Hand-maintained catalogs follow `src/providers/HAND_CATALOGS.md`: `as const satisfies Record<string, ModelInfo>`, a header comment with refresh URLs, `limit.context: 0` for non-token models, synthetic ids for wires with no model field. Every hand row is a human reading a pricing page — **provenance comments (URL, date, exact quote) are mandatory**, and a number without them does not exist.
- New endpoints ship with: the wire-exact validator, colocated tests, a CLI registry entry, catalog rows, and — only where the canonical vocabulary reaches them — a `unified-<category>.ts` adapter plus the pack registration.

## Adopter feedback

External complaints and feature requests (a user's list, an issue batch) run through this process. Assume every claim is **partly** right — accurate about the friction, wrong about the cause or the fix — so the verification is the product:

1. **Verify before ranking.** Check every claim adversarially against three sources: the repo, a scratch install of the *published* version, and the provider's live docs/API. Reproduce with probes; before-states come from `git archive <old-sha>`, never from memory.
2. **Look beside the claim.** The highest-value finds are bugs a complaint walks past — adjacent to what was reported, not named by it. A verification isn't done until it answers "what does this evidence expose that the user didn't say?"
3. **Per item, produce four things**: a facts verdict (yes/partly/no, with evidence), a philosophy fit (which principle acts or refuses), a recommendation (act / act-modified / decline), and a scope estimate.
4. **Rank in tiers**: verified bugs → cheap data/curation acts → documentation for things that already exist ("it already exists but nobody can find it" is a docs bug, fixed as one) → new scope (a new vendor must clear the research bar recorded in `docs/providers.md`) → declines.
5. **Record every decline where tooling reads it** — `data/*/curation.json` excluded maps, `docs/decisions.md`, module headers — with reason + source + date. A reason the audit script cannot parse is not recorded: the excluded thing gets re-suggested on every audit run, forever.
6. **Genuine roster/product forks go to the owner** with pros and cons, not a unilateral pick. Owner precedents: demand-driven curation beats roster tidiness (an adopter's production call sites are a curation signal), and multi-generation families are fine (kling serves v2.5/v2.6/v3 side by side).
7. **The reply to the adopter carries the corrections too** — where they were wrong (and what to do instead) is as valuable as what got fixed.

## Parallel sessions

Multiple Claude sessions work this repo concurrently. Before any multi-file wave: `git status` + ListAgents; if a writer is active, split territory via SendMessage first. Merge around concurrent edits — re-read shared pin files immediately before editing and increment from the *current* tree state; another session's uncommitted edit is theirs (leave it unstaged, and restore it if an agent clobbers it). Stage only your own paths.

## Docs & README

Every ❌/✅ claim in the README and docs is pasted from a real `tsc` run or backed by a test (`test/docs/`, recorded fixtures) — including the hero image. When editing examples, keep them provable: change the test or fixture with the prose, never invent output.

## Releasing

Changesets + npm **trusted publishing** (OIDC, no token) via `release.yml`; `prepublishOnly` runs build + `lint:pkg`. Any user-visible change needs a changeset (`bun run changeset`). Retired names are listed in their changeset and nowhere else.

## Code standards

No linter is configured — `tsc --noEmit` (strict) is the mechanical gate, plus the repo's own executable conventions (bundle budgets, import-graph, cli-registry, type benches). Judgment calls on top:

- Explicit parameter/return types on public surfaces; `unknown` over `any`; `as const satisfies` for literal tables; type narrowing over assertions; named constants over magic numbers.
- **Function declarations, not arrow consts.** Helpers below their callers; top-down reading order.
- Comments here carry **intent, constraints, and provenance** — module headers state scope and why (see `src/cli.ts`), data rows cite sources with dates, cross-cutting invariants are documented where a future agent will look. Never narrate history ("previously", "renamed from") in code — history lives in changesets and `docs/decisions.md`.
- Throw the library's own error types with messages that name what the provider DOES offer; expected outcomes are typed results (`.safe()` issues, `warnings`), not throws.
- Types-only entries (`unmodel/types`, `unmodel/<provider>/types`) must emit **no JavaScript**, and values entries stay ~1 KiB — `test/types-entries.test.ts` and the bundle budget enforce it; keep imports `type`-only accordingly.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay, not list price. Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model    | cost | intelligence | taste |
| -------- | ---- | ------------ | ----- |
| sonnet-5 | 5    | 5            | 7     |
| opus-5   | 4    | 7            | 8     |
| fable-5  | 2    | 9            | 9     |

How to apply:

- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence > taste > cost.
- Bulk/mechanical work (clear-spec implementation, data analysis, migrations): sonnet-5
- Anything user-facing (docs, API design, error copy) needs taste ≥ 7.
- Reviews of plans/implementations: fable-5 or opus-5, optionally sonnet-5 as an extra independent perspective.
- Never use Haiku.
- Claude models (sonnet-5, opus-5, fable-5) run via the Agent/Workflow model parameter.
- On complex problems (architecture, gnarly debugging, ambiguous trade-offs, adjudicating conflicting findings), if fable-5 is NOT the current model, you can and should use fable-5 as an advisor. Prefer the native advisor tool when enabled (`/advisor`, `advisorModel` setting, or `--advisor` — Claude Code 2.1.98+); otherwise spawn a `model: 'fable'` agent with a self-contained brief of the problem and the options considered, get its recommendation, then act on it in the main loop. Don't grind through a hard problem on a weaker model when a Fable consult is one agent call away.
