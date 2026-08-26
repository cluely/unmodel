---
"unmodel": minor
---

**v0.4.0 triage: the `finishReason` unlock, and branching between two requests.** Two adopter
complaints against 0.4.0, both verified adversarially against the repo, the published package
and the live provider docs before anything was written. Both turned out to be right about the
friction and wrong about the cause, so what shipped is not what was asked for — and the
corrections are recorded here too.

## Fixed

- **MiniMax's in-band failure is now the report's outcome, not a warning count.**
  `minimax.checkTts` returns `ResponseReport<MinimaxBaseRespStatus>` and puts
  `base_resp.status_code` on `finishReason` — the same field the five job checkers
  (`revai.checkJob` → `"failed"`, `speechmatics.checkJob` → `"rejected"`, …) have always used
  for a terminal status. `/v1/t2a_v2` answers `200` for every outcome, so before this a `1004`
  auth failure and a cosmetic finding were distinguishable only by reading warning text.
  **`0` is the only success and `0` is falsy**: branch on `finishReason !== 0`, never on
  truthiness.

- **`resemble.checkTts` too.** `success: false` was the same defect at the provider MiniMax's
  module header cites as its precedent, so the precedent was teaching the wrong thing. It now
  returns `ResponseReport<ResembleSynthesisOutcome>` with `finishReason: "success" | "failure"`,
  absent when the response omits `success` entirely.

## Added

- **`MINIMAX_BASE_RESP_INFO`** from `unmodel/minimax` — the eight documented
  `base_resp.status_code` values as data rather than a JSDoc table, each mapping to MiniMax's own
  `statusMsg` and, where that message answers it, `retryable`. `1002` (rate limit) is `true`,
  `1004` (auth failed) is `false`, and `1000` ("unknown error") carries no `retryable` at all,
  because the docs do not classify it and a guess there would make the other seven untrustworthy.
  The same value lands on the issue's `meta.retryable`. Type: `MinimaxBaseRespInfo`.

- **`ResponseReport`'s `Reason` parameter accepts `string | number`** (default still `string`).
  A vocabulary is whatever the provider publishes, and MiniMax publishes numbers — the old
  `string` constraint locked the one provider whose route reports every outcome in band out of
  the field that exists to carry it. Fully additive: every existing annotation, including
  `const x: string | undefined = r.finishReason`, still compiles.

- **`docs/validation.md` § "Branching between two requests"** — the recipe for
  `cond ? safe(a) : safe(b)`, with every ✅/❌ pasted from a real `tsc` run and pinned by
  `test/types/atlascloud.test-d.ts` and `test/types/unified-video.test-d.ts`.

- **`docs/surfaces.md` § "Response checks"** — the response-check surface had no section at
  all; it was documented only in per-provider tables and module JSDoc.

## Declined, with the reason

- **No `outcome` union on `ResponseReport`** (`docs/decisions.md` §9). It would restate
  `finishReason` for the twelve checkers that already answer, and it would collapse the
  distinction the caller actually needs: MiniMax's codes split *three* ways, not two, and
  `outcome: "failed"` tells a caller to give up on a `1002` rate limit that clears in a second.

- **No error-severity issues in `warnings`** (§9). `ResponseReport` has exactly one array and it
  is named `warnings`; an `Issue` with `severity: "error"` inside it is self-contradictory, and
  `warnings.some(w => w.severity === "error")` is not an improvement on the `warnings.length > 0`
  it would replace. The request side can partition because `partition()` runs there and `.safe()`
  returns a discriminated `ok`; the response side has no such partition.

- **No variance change to `ValidateResult` / `Validated`, and no `ValidateResultLike`.** The
  reported cause was wrong: `Validated` is *already* covariant (`ValidateResult<VA>` is assignable
  to `ValidateResult<VA | VB>`), and `toSdk` is already method shorthand. What actually fails is a
  stock TypeScript rule — it never unions multiple covariant inference candidates for a naked type
  parameter — and it reproduces on `type Box<T> = { readonly value: T }`, which has no members to
  make variant. A structural `ValidateResultLike` was tested and does not fix it either, and every
  `*Like` in this repo is an input-position reader for untrusted provider responses, never a
  loosened unmodel output. The fix is on the consumer's side of the call, and it is now
  documented: type the parameter `ValidateResult<{ request: RequestMeta }>`, which accepts the raw
  ternary *and* single-arm results and still feeds `toRequestInit`, or hoist the ternary into the
  params so there is one call. The hoist costs no exactness — a typo'd key or a wrong-route field
  in either arm still fails to compile.

## Still filed

A `ResponseIssueKind` union for the sixteen ad-hoc `meta.kind` values across the checkers.
`docs/tts.md` tells callers to branch on `meta.kind: "provider_error"`, but `Issue.meta` is
`Record<string, unknown>`, so the documented discriminator is not reachable in strict TypeScript
without a cast. It is a larger, separate change and is not in this release.
