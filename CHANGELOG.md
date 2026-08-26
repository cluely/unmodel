# unmodel

## 0.5.0

### Minor Changes

- eb9ac2e: **v0.4.0 triage: the `finishReason` unlock, and branching between two requests.** Two adopter
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
    distinction the caller actually needs: MiniMax's codes split _three_ ways, not two, and
    `outcome: "failed"` tells a caller to give up on a `1002` rate limit that clears in a second.
  - **No error-severity issues in `warnings`** (§9). `ResponseReport` has exactly one array and it
    is named `warnings`; an `Issue` with `severity: "error"` inside it is self-contradictory, and
    `warnings.some(w => w.severity === "error")` is not an improvement on the `warnings.length > 0`
    it would replace. The request side can partition because `partition()` runs there and `.safe()`
    returns a discriminated `ok`; the response side has no such partition.
  - **No variance change to `ValidateResult` / `Validated`, and no `ValidateResultLike`.** The
    reported cause was wrong: `Validated` is _already_ covariant (`ValidateResult<VA>` is assignable
    to `ValidateResult<VA | VB>`), and `toSdk` is already method shorthand. What actually fails is a
    stock TypeScript rule — it never unions multiple covariant inference candidates for a naked type
    parameter — and it reproduces on `type Box<T> = { readonly value: T }`, which has no members to
    make variant. A structural `ValidateResultLike` was tested and does not fix it either, and every
    `*Like` in this repo is an input-position reader for untrusted provider responses, never a
    loosened unmodel output. The fix is on the consumer's side of the call, and it is now
    documented: type the parameter `ValidateResult<{ request: RequestMeta }>`, which accepts the raw
    ternary _and_ single-arm results and still feeds `toRequestInit`, or hoist the ternary into the
    params so there is one call. The hoist costs no exactness — a typo'd key or a wrong-route field
    in either arm still fails to compile.

  ## Still filed

  A `ResponseIssueKind` union for the sixteen ad-hoc `meta.kind` values across the checkers.
  `docs/tts.md` tells callers to branch on `meta.kind: "provider_error"`, but `Issue.meta` is
  `Record<string, unknown>`, so the documented discriminator is not reachable in strict TypeScript
  without a cast. It is a larger, separate change and is not in this release.

## 0.4.1

### Patch Changes

- Release automation: the package now publishes from GitHub Actions via npm
  trusted publishing (OIDC) — a version change in package.json pushed to main
  releases hands-free, with provenance. No tokens stored anywhere.

## 0.4.0

### Minor Changes

- 0a925e7: **v0.3.0 adopter feedback, all four tiers.** A production adopter filed twenty complaints and
  requests against 0.3.0. Every one was verified against the repo, the published package and the
  live provider APIs before anything was written; the ones that turned out to be real are below,
  and so are the ones that turned out not to be, with the reason.

  Five of these were bugs the complaints walked _past_ rather than reported.

  ## Fixed
  - **Nine OpenAI refs that could only ever come back 400 are gone from `unmodel/chat`.**
    `gpt-5.3-codex`, `gpt-5.3-codex-spark`, three `text-embedding-*`, three image rows and
    `gpt-realtime-2.1` are catalog models OpenAI does not serve on `/v1/chat/completions`, and they
    were `ChatModelRef` arms all the same — offered by autocomplete, compiling clean, addressing the
    chat endpoint. `CHAT_MODEL_REFS` goes 1,339 → 1,330, the generated chat tables lose them, and
    `openai.chat` now warns by name on a catalog row it recognises but cannot route, saying which
    surface serves it instead (`/v1/responses` for the codex pair, `/v1/embeddings`, `/v1/images`,
    `/v1/realtime`). The exclusion is data (`chatScopeExclude` in
    `data/availability-overrides.json`), the reasoning is `docs/decisions.md` §7, and
    `test/chat/refs.test.ts` now asserts every surviving `openai/…` ref is an `OpenaiChatModelId`.
  - **fal's aspect-ratio classifier refused decimal ratios.** The regex behind the generated
    `ratios` rows required integers on both sides, so `2.35:1`, `19.5:9` and `9:19.5` were dropped
    from every endpoint that declares them and could not be reached through
    `video({ aspectRatio })`. Widened to mirror `RATIO_SPELLING` in `core/unified/derive.ts`, and
    the fix carries an invariant rather than a patch: codegen now throws, naming the endpoint and
    the member, if any closed `aspect_ratio` enum value is missing from the row's `ratios` and is
    not the one recorded non-shape (`"auto"`, which is a schema default on 17 of 20 rows and is
    reached through `providerOptions.fal.aspect_ratio`).
  - **`.toSdk("openai")` no longer needs a cast, and its JSDoc no longer lies.** The comment
    claimed the SDK hand-off carried `stream: false`; it did not, and typing the wire that way
    would have lied to streaming callers instead. The caller's `stream` is now threaded through the
    unified surface — `ChatPackResult` carries the caller's `T`, so the result has no `stream` key
    when it was never set and the literal `true`/`false` when it was, and
    `client.chat.completions.create(chat({…}).toSdk("openai"))` typechecks either way. The
    confirmation is that `SdkComparable` in `test/types/chat.test-d.ts` LOST its stream
    special-case: the test got simpler.
  - **TS2883/TS2742 for downstream libraries that emit declarations.** A library wrapping unmodel
    and shipping its own `.d.ts` could not compile: the inferred type of its own function named
    `Validated`, `RequestMeta`, `ExactKeys`, `ValidateOptions`, `ValidateResult` and `Retargeted`
    through a hashed internal chunk path. Half of those were already exported — the error persists
    anyway, because TypeScript can only name a symbol through a module already in the consumer's
    program. So the carrier set now ships from `src/core/carriers.ts` and is re-exported from every
    entry a consumer might import alone: the root, `unmodel/chat`, `unmodel/chat/factory`, every
    provider `index.ts` and every `src/unified/*` pack. A new `test/types/declaration-portability.test.ts`
    builds `dist/`, emits declarations against it from both a flat and a pnpm-style nested
    `node_modules`, and fails on either error code.
  - **MiniMax TTS prose that was false in three places.** `index.ts`, `tts.ts` and the
    `tts-params.ts` JSDoc all said MiniMax has no response checker because its errors arrive as
    HTTP status codes. They do not — see `checkTts` below — and the three sentences moved in
    lockstep with the checker that replaces them.

  ## Added
  - **`atlascloud` — a new provider.** `atlascloud.video` compiles
    `POST https://api.atlascloud.ai/api/v1/model/generateVideo` for **23 curated models** across
    four families (Seedance 2.5 / 2.0 / 2.0-mini / 2.0-fast / v1.5-pro, Wan 3.0 + 3.0-prime,
    Veo 3.1), with per-model wire arms, a unified adapter at `unmodel/atlascloud/unified`, and the
    usual four entries (`unmodel/atlascloud`, `/unified`, `/types`, `/values`). It joins
    `unmodel/video` as the fourteenth provider.

    Atlas is a **third transport for weights unmodel already reaches**: `bytedance/seedance-*` is
    also `bytedance.video` (ByteDance's own ModelArk) and `fal.video`; `google/veo3.1/*` is also
    `google.video` and `fal.video`. The three compile to visibly different bodies and no
    normalisation runs between them — feeding one provider's body to another's validator fails,
    which is the point.

    Two facts worth calling out for callers. `model` is a **real, required body field** that names
    the route as well as the model: there is no `endpoint` pseudo-param, because
    `bytedance/seedance-2.5/text-to-video` and `.../image-to-video` are two refs with two OpenAPI
    documents, and a caller who adds `image` to the text ref is told to pick the image ref rather
    than silently rerouted to a model with a different price. And **no `atlascloud` model ships a
    `cost`**: Atlas publishes no unit for its rates — 335 of its 337 media catalog rows carry a
    bare `base_price` with no `unit`, 152 of 473 rows carry a 40–90% promotional discount, and the
    model page renders the same figure as a per-run price, a per-second rate and a per-1000-token
    rate from three templates in one bundle. The caveat ships instead, as
    `ATLASCLOUD_PRICING_CAVEAT`, and the validator declares no `estimate` at all.

    Auth is `Authorization: Bearer <ATLASCLOUD_API_KEY>`; the POST creates a prediction, so poll
    `predictionUrl(id)` (`resultUrl(id)` is the second spelling five of the schemas use).
    Snapshots, curation and the pricing caveat live in `data/atlascloud/`; `bun run audit:atlascloud`
    diffs the live catalog and re-hashes every snapshot, weekly in CI, and never writes.

  - **`elevenlabs.dub` and `elevenlabs.dubLanguage` — dubbing, wire-only.**
    `POST /v1/dubbing/project` (multipart, file XOR `source_url`, transcript ⇒ `source_language`,
    ≤500 reference clips, ≤3 webhook ids, the full keyterms battery, per-model BCP-47
    `target_language` with v1's no-dialects refusal) plus `POST /v1/dubbing/{id}/language` for
    adding a target to an existing project. Two models join the catalog: `dubbing_v1` ($0.50/min —
    the no-watermark rate, since this route has no `watermark` field for the discounted one to
    apply to) and `dubbing_v2` ($2.20/min). `checkDubbingProject` prices
    duration × languages × rate and warns on `failed`; `checkDubbingLanguage` warns on a stale
    revision. The reference page most people find (`/docs/api-reference/dubbing/create`)
    308-redirects to the LEGACY route, which has no `model_id` at all and so cannot reach Dubbing
    v2 — unmodel serves the project surface and deliberately not that one.
  - **`minimax.checkTts` — MiniMax answers HTTP 200 for every outcome.** The T2A reference declares
    exactly one response code and documents no non-200: failure rides in band on
    `base_resp.status_code`, so `if (res.ok) use(body.data.audio)` hands the empty string on as
    audio after an authentication failure. `checkTts` reads the envelope, warns quoting
    `status_msg` with `meta.kind: "provider_error"`, reports empty audio separately, and prices the
    call from `usage_characters`. MiniMax moves to `docs/tts.md`'s ships-a-checker table.
  - **`sync.generationUrl(id, query)` takes the three documented query params.** `wait`, `timeout`
    and `include`, as an XOR union — `include: "progress"` cannot be combined with `wait`/`timeout`,
    which the spec forbids and which is now a compile error rather than a 400. The JSDoc carries
    all three verbatim, the 1–10 `timeout` range, the `X-Sync-Wait-Mode` /
    `X-Sync-Wait-Timeout-Seconds` response headers, and the caveat that `progress_percent` is
    described only on the param and is not a declared property of the `Generation` model. Not
    validated; exported for convenience.
  - **`detail` is canonical chat vocabulary.** `ChatFilePart.detail?: "auto" | "low" | "medium" | "high"`
    compiles to OpenAI's `image_url.detail` (with `medium` → `high` as an `approximated_param`), to
    Gemini's per-part `mediaResolution.level`, and to an explicit `dropped_param` on Anthropic.
    Both interop encoders used to warn that the _other_ dialect's field had no equivalent — a
    matched pair of warnings is the signature of a missing vocabulary word. `estimateChatTokens`
    now reads it for the image-token term, from catalog data rather than a hardcoded constant.
    `docs/decisions.md` §8.
  - **`providerOptions.openai` is typed.** All twelve OpenAI-only chat params (including
    `verbosity`) complete and are enumerated there — plus OpenAI's exact `reasoning_effort` and
    `service_tier` unions where the shared dialect leaves the string open — read from a new
    type-only `src/providers/openai/wire.ts`
    through `retarget/dialects.ts` — so `verbosity: "extreme"` is a compile error and
    `providerOptions.openai.messages` no longer typechecks at all. The hand-mirrored
    `OpenAiChatServiceTier` is deleted and its drift-guard replaced by an identity assertion
    against the real union. The wire leaf names **no catalog**: the body is generic in its model id
    and `openai/chat.ts` closes it, because the version that closed it in the leaf put 80 KiB of
    literal ids into fifty-seven declaration graphs.
  - **Six fal video endpoints, and `FAL_EXCLUDED` at the API surface.** The roster goes 165 → 171:
    `fal-ai/veo3.1/reference-to-video`, `fal-ai/kling-video/v3/pro/motion-control` (its image is a
    _reference_, not a first frame — recorded on the row), `fal-ai/kling-video/o1/video-to-video/edit`,
    `fal-ai/minimax/hailuo-2.3/pro/text-to-video`, `fal-ai/lightx/relight` and
    `topaz/upscale/video/generative`. Alongside them, the exclusion records go 9 → 66 and now
    _reach the caller_: an id unmodel deliberately declined arrives as ``unmodel deliberately does
not serve `X`: <reason>`` instead of the generic "catalog data may lag behind", from
    `FAL_EXCLUDED` / `FAL_EXCLUDED_CATEGORIES` on `unmodel/fal`.
  - **`FalQueueError` and `FalQueueResult<T>`, and the ten `Fal<Verb>ResultById` maps are now
    findable.** The response types have shipped since the fal wave; nothing pointed at them, so an
    adopter hand-rolled `{ video: { url: string } }` per endpoint. `unmodel/fal/types` now names
    all ten, and `FalQueueResult<T>` gives the failure arm a type — necessary because fal's queue
    declares no `FAILED` status and a failed request reports `COMPLETED` with its error in the
    RESULT document. `"error" in body` is the discriminant; `test/types/fal.test-d.ts` pins the
    narrowing and pins each result map against its request map, key for key.
  - **`src/core/carriers.ts`** — see TS2883 above; the type re-exports are a public, documented
    surface now, not an accident of chunking.

  ## Declined, with reasons
  - **A zod schema per fal result document.** 171 schemas restating the generated types, refreshed
    on fal's clock, to validate a document unmodel never fetches. The types ship; the validation
    does not.
  - **A `retryable` field on `UnmodelValidationError`.** It would read `false` on 100% of
    instances. Validation is a pure function of the params, so the documented answer is "never
    retry, classify at the catch" — with the patterns, the durable-runtime one-liners and the
    `structuredClone` caveat now in `docs/validation.md`.
  - **Auto-suppressing `unknown_param` on fal's widened arm** (and a `widened_endpoint` code, and
    aggregating the warnings). The widened arm is the one path where the type system has also stood
    down, so it is the last remaining signal on the call with the least help — and it is quieter
    than it sounds: 15.6% of keys on average, zero keys for 58% of endpoints. `{ severity: {
unknown_param: "off" } }` is the per-call answer, and `docs/providers.md` now documents it.
  - **`verbosity` promoted to canonical chat vocabulary.** One witness. `detail` had two, and got
    promoted in the same wave — which is what makes it a rule rather than a preference.
  - **`openai.chatResponses`.** Queued as its own wave, not built here: `/v1/responses` is a
    substrate address, not a fifth dialect. The four clauses are in `docs/decisions.md` §7.
  - **Typing the wire `stream?: false`.** It would lie to every streaming caller.
  - **Widening `TtsDelivery`'s `errorPath`** for MiniMax's in-band envelope; a provider-level const
    is the future data form if the second witness arrives.
  - **An `unmodel/dubbing` category.** Two witnesses that do not share a request shape: ElevenLabs
    is a two-request project/target model with an editable transcript and a revision counter,
    HeyGen `/v3/video-translations` is a one-shot job.
  - **Atlas codegen, and Atlas chat / TTS / image / 3D.** The codegen bar is recorded in
    `data/atlascloud/curation.json`: ~1,500 LoC worth writing past roughly 40 curated ids, and it
    would need two lowering rules fal's does not have. The chat surface is the cheap next wave (an
    `openai-compatible` overlay at `api.atlascloud.ai/v1`); TTS is blocked on hand-curating an
    ElevenLabs voice enum of 21 opaque ids.
  - **`duration: -1` as canonical vocabulary.** Atlas's Seedance and Wan schemas use `-1` for "the
    model picks the length"; the canonical `duration` is a positive number of seconds at every
    provider, and a sentinel is not a duration. It is reached through
    `providerOptions.atlascloud.duration`, pinned by a golden, and still gated per model.

## 0.3.0

### Minor Changes

- 61ca88e: **New provider: fal.ai**, and three new unified categories that arrived with it.

  `unmodel/fal` covers **146 curated endpoints across nine verbs** — `image` (32),
  `imageEdit` (17), `video` (30), `lipsync` (10), `upscale` (10), `avatar` (8), `tts` (23),
  `stt` (6), `music` (10) — all bare ids, plus a unified adapter per category at
  `unmodel/fal/unified`, wire types at `unmodel/fal/types` and runtime tables at
  `unmodel/fal/values`.

  Three things about fal are unlike every other provider in this package:
  - **The model IS the route.** `POST https://queue.fal.run/{endpoint_id}` takes a flat JSON
    body with no model field in it, so the route selector is a pseudo-param named `endpoint`
    that is stripped in `finalize` and interpolated into the URL. It could not be `model`,
    because `model` is a genuine wire field on several fal endpoints (sync-lipsync v2, the
    Topaz and ESRGAN upscalers, Gemini TTS); codegen hard-errors on a top-level `model`
    property unless `data/fal/curation.json` allow-lists it. Unified refs are unaffected:
    `"fal/fal-ai/flux/dev"` splits on the FIRST slash, so unified callers still write `model:`.
  - **`.request.url` is the queue submit.** The response is an envelope (`request_id`, `status`,
    and the `response_url` / `status_url` / `cancel_url` to follow), not a file. `unmodel/fal`
    exports `falQueueUrl` / `falSyncUrl` / `falStatusUrl` / `falResultUrl` / `falCancelUrl` and
    documents the contract, including the two traps: fal's queue declares no failure state,
    and `metadata.model_url` is the sync host rather than the submit URL. Polling stays with
    your transport code.
  - **Auth is stated, never derived.** `Authorization: Key ${FAL_KEY}`. The `Key ` prefix is
    real and fal's own OpenAPI security scheme omits it, so no unmodel export builds this
    header for you.

  **Types generated from the provider's own published OpenAPI.** fal serves an OpenAPI 3.0.4
  document per endpoint through its documented Platform API, which makes it the first provider
  where "types from docs, never SDKs" has a machine-readable source. `scripts/codegen-fal.ts`
  emits `src/providers/fal/gen/` (wire interfaces, one `looseObject` union schema per category,
  the per-endpoint constraint IR, unified rows and catalog rows) from per-endpoint snapshots
  committed under `data/fal/openapi/`. The generator emits DATA and TYPES only: every check,
  message, estimate and doc comment is hand-written beside it, and no generated file is ever
  hand-edited. New commands: `codegen:fal`, `codegen:fal:refresh`, `codegen:fal:check`,
  `codegen:fal:audit`, plus a weekly refresh workflow. Curation, pricing and overlays stay
  hand-maintained in `data/fal/`, each row carrying a source URL, a date and a quote.

  **Three new unified categories**, each a full buildout rather than an arm bolted onto an
  existing one:
  - **`unmodel/lipsync`** (`lipsync`, `createLipsync`) — a clip in, an audio track in, a clip
    whose mouth matches the audio out. Five canonical words (`model`, `source`, `audio`,
    `seed`, `providerOptions`) and no geometry, because the output's shape is the input's.
  - **`unmodel/avatar`** (`avatar`, `createAvatar`) — the still-driven twin. The split from
    lipsync is by INPUT rather than by vendor, which is why `fal-ai/sync-lipsync/v3` and
    `fal-ai/sync-lipsync/v3/image-to-video` land in different categories. `image` is narrowed
    per model and types as `never` at the two routes whose performer is a catalogued id.
  - **`unmodel/upscale`** (`upscale`, `createUpscale`) — `factor` is the one cross-vendor
    word, and it has three answers per model: a range, a closed set, or absent. The only
    category with no fixed modality: seven of the ten routes take a still and three take a
    clip, so `source` is narrowed per model and the output modality is read off each
    endpoint's own response schema.

  Each ships the full set: vocabulary, kernel id and canonical keys, pack entry and package
  subpath, CLI id, `unmodel/values` entries, `unmodel/types` entries and test scaffolding.
  Existing packs gain fal too: `image()` now spans 17 providers, `tts()` 19, `video()` 13,
  `stt()` 13, `image-edit()` 5 and `music()` 5.

  **Repo rules that landed with the generated data**, and are enforced by
  `test/import-graph.test.ts`:
  - `src/providers/*/gen/**` is DATA: wire modules are type-only, only the schema module may
    import zod, and no generated module may reach the pipeline, request layer, validators or
    catalog.
  - A `<category>-params.ts` leaf may import `./gen/<category>-params.gen.ts` and nothing else
    under `gen/`, which is what keeps zod from ending up behind a values entry.
  - `src/providers/fal/gen/**` is importable only from `src/providers/fal/**`, and the merged
    `models.ts` catalog only from `index.ts` — asserted explicitly, because the same-directory
    rule cannot catch a sibling import.
  - The SPLIT provider set (providers whose adapters are one file per category) is now
    **derived from disk** rather than listed, so a newly split provider cannot silently skip
    its per-category budgets.
  - Every pack now carries a `.d.ts` declaration budget alongside its bundle budget.

  **Not yet:** `.toApi("fal")`. Retargeting a first-party media request onto fal's queue needs
  a media retarget layer that does not exist today (chat only), and `EndpointAuth.scheme` has
  no `"Key"` arm.

- c9e02dd: **Media retargeting: `.toApi("fal")` on validated native image, video and speech requests.**

  `.toApi(provider)` has been chat-only since it shipped, and the reason given was that media has
  no shared wire dialect to translate through and no availability data to derive a target union
  from. Both halves are still true. What changed is the conclusion: the overlap is a hand table
  per family and the crossing is a hand mapping per family, checked at compile time against fal's
  own generated wire types.

  ```ts
  import { video } from "unmodel/kling";

  const request = video({
    model_name: "kling-v2-5-turbo",
    prompt: "A slow push-in through a rainy neon alley",
    mode: "pro",
    duration: "10",
  });

  const onFal = request.toApi("fal");
  onFal.request.url; // https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/text-to-video
  onFal.warnings; // []  ← empty means the mapping was exact
  onFal.toSdk("fal"); // { input: { … } }, the shape @fal-ai/client takes
  ```

  Six provider families across three categories, transcribed from fal's endpoint pages on
  2026-08-25 and drift-guarded against fal's curated roster:

  | source                                    | models                                                                       |
  | ----------------------------------------- | ---------------------------------------------------------------------------- |
  | `kling.video` / `kling.videoFromImage`    | `kling-v3`, `kling-v2-6`, `kling-v2-5-turbo`                                 |
  | `pixverse.video`                          | `v6`                                                                         |
  | `lightricks.video`                        | `ltx-2-5-pro`                                                                |
  | `elevenlabs.tts`                          | `eleven_v3`, `eleven_multilingual_v2`, `eleven_turbo_v2_5`                   |
  | `minimax.tts`                             | `speech-2.8-hd`, `speech-2.8-turbo`, `speech-02-hd`                          |
  | `black-forest-labs.image` / `.imageFlux1` | `flux-2-pro`, `flux-2-max`, `flux-pro-1.1`, `flux-pro-1.1-ultra`, `flux-dev` |

  **The loss policy, stated normatively.** A parameter fal cannot express is an **error** naming
  the parameter, the fal endpoint and the reason — never a silent drop, because a dropped
  `camera_control` produces a different video rather than a lossier one. A value fal expresses
  approximately is exactly one `approximated_param` warning carrying `requested` and `achieved`.
  So `warnings.length === 0` _means_ the mapping was exact, and the goldens assert it.

  **`.toApi` exists only where a mapping does.** Where chat degrades an unrecognised model to the
  full target union — its catalog is a models.dev snapshot that lags a release by days — the
  media tables are hand-written, so "unmapped" and "unknown" are the same thing:
  `kling.video({ model_name: "kling-v1", … }).toApi` is a compile error naming a member that is
  not on the type. Every model outside the tables carries a recorded reason rather than a bare
  "unknown model", including the ones refused on purpose: Recraft as a whole family (fal's rows
  drop `num_images`, `seed` and `negative_prompt` and speak a style vocabulary Recraft retired),
  `mode: "std"` on Kling 2.5-turbo and 2.6 (fal serves the pro tier only, and promoting a tier
  changes the resolution and the price), `safety_tolerance: 0` at Black Forest Labs (fal's enum
  starts at `"1"`, and 0 is the _strictest_ native setting — promoting it would loosen
  moderation), and zero-retention, webhooks and account-scoped ids everywhere.

  **`EndpointAuth.scheme` gains `"Key"`**, because retargeting invalidates the auth header the
  caller already wrote: Kling takes `authorization: Bearer <key>`, fal takes
  `authorization: Key <FAL_KEY>` — the literal word `Key`, which fal's own OpenAPI security
  scheme omits. Stated, never derived.

  **The media packs are byte-identical.** `unmodel/video`, `unmodel/tts`, `unmodel/image` and the
  other nine reach these providers through their `unified-<category>.ts` adapter leaves, whose
  results carry no `.toApi` at all — so the seam is applied in `src/providers/<p>/index.ts`, the
  one module only `unmodel/<p>` imports, rather than in the endpoint module's `finalize` where
  chat wires its own. `test/bundle-budget.test.ts` asserts both directions.

  New type exports from the root entry: `MediaApiMember`, `MediaApiTargetId`, `MediaOverlapTable`,
  `MediaRetargeted`, `MediaMapContext`, `MediaOverlapRow`, `MediaRetargetSpec`,
  `MediaTargetEndpoint` and `EndpointAuth`. Each family's overlap and refusal tables are exported
  from its own provider entry (`KLING_VIDEO_FAL_OVERLAP`, `ELEVENLABS_TTS_FAL_REFUSALS`, …) so a
  caller can ask what is mappable before calling.

- 61ca88e: **Native provider wave: leaderboard-gap coverage across TTS, image, video and music.**

  An audit of the current TTS / image / video / music leaderboards against the native catalogs,
  then coverage for every gap a public developer API can reach.

  Two new providers:
  - **`unmodel/breezeblue`** — Breeze TTS 2 (`breezeblue.tts`), with a unified adapter, wire
    types and values entry.
  - **`unmodel/mureka`** — song and instrumental generation (`mureka.music`,
    `mureka.instrumental`) on the async create-then-poll shape, mureka-7.6 through 9.5, with a
    unified `music` adapter.

  New endpoints on providers that were already here:
  - **stepfun** — StepAudio 2.5 TTS (`stepfun.tts`, `/v1/audio/speech`), a hand catalog
    mirroring the generated chat rows.
  - **alibaba** — Qwen3-TTS on DashScope (`alibaba.tts`, unary HTTP; the realtime-WebSocket-only
    ids ship as catalog rows the unary validator rejects by name) and DashScope video synthesis
    (`alibaba.video`: Wan 3.0/2.7/2.6/2.5/2.2/2.1 plus HappyHorse 1.0/1.1, async
    create-then-poll). Chat moves to a dedicated leaf so `unmodel/chat` stops paying for the
    provider barrel.
  - **xai** — Grok Imagine image (`xai.image`, `/v1/images/generations`) and video
    (`xai.video`, `xai.videoEdit`, `xai.videoExtend`), with the same chat-leaf split.
  - **google** — Lyria 3 Pro / Clip music over the Gemini Interactions API (`google.music`),
    with a hand-mirrored catalog so `unmodel/music` stays free of the generated catalog.
  - **azure** — the Microsoft Foundry MAI-Image-2.5 family (`/mai/v1/images/generations` plus
    multipart edits) under the deployment-name doctrine: wire validators only, no unified refs,
    the same rule azure chat already follows.

  Catalog refreshes: cartesia (`sonic-preview` identified as the Sonic 3.6 beta, dated legacy
  snapshots and sunset dates), elevenlabs (`eleven_v3_conversational` plus legacy v1 rows),
  speechify (the simba retirement schedule).

  Also recorded, so the gaps stay explained rather than looking like oversights: Suno, VUI Labs,
  MAGI-2 and MiniMax Music are not addable (no public developer API, or closed to new users).

- f7f9bcd: **Two native providers — `unmodel/sync` and `unmodel/topaz` — and with them, second witnesses
  for `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale`.**

  Those three categories shipped on fal alone, which was always the thing to fix rather than a
  property of them. A vocabulary read off one provider is that provider's request schema with the
  field names changed, and here the risk was sharper than usual: four of fal's ten lipsync
  endpoints ARE sync.'s models resold, so the words were being checked against the same vendor
  twice. Now they are checked against the vendor's own API, and against a second vendor in
  `upscale`, and the disagreements are exactly where a second witness earns its keep.

  ```ts
  import { lipsync } from "unmodel/lipsync";

  JSON.stringify(
    lipsync({
      model: "sync/lipsync-2",
      source: { url: clip },
      audio: { url: vo },
    }),
  );
  // → {"model":"lipsync-2","input":[{"type":"video","url":"…"},{"type":"audio","url":"…"}]}
  //   POST https://api.sync.so/v2/generate

  JSON.stringify(
    lipsync({
      model: "fal/fal-ai/sync-lipsync/v2",
      source: { url: clip },
      audio: { url: vo },
    }),
  );
  // → {"video_url":"…","audio_url":"…"}
  //   POST https://queue.fal.run/fal-ai/sync-lipsync/v2
  ```

  Same weights, two bodies. The array is what carries `refId`s, `segments` and dubbing, none of
  which fal's flattening can express; the flat pair is what accepts inline bytes, which sync.'s
  fetch-only fields do not. **Neither is a superset**, and that comparison is pinned in the golden
  tree rather than described.

  ## `unmodel/sync` — sync.'s own lipsync API

  `https://api.sync.so/v2`, JSON bodies, `x-api-key: <SYNC_API_KEY>`. Two addresses on ONE url
  (`POST /v2/generate`): `sync.lipsync` takes a source CLIP, `sync.avatar` takes a STILL. They are
  separate addresses because the required fields differ — a still narrows `model` to `sync-3` and
  can carry neither `segments` (no timeline to slice) nor `dubParams` (no track to extract).

  Five models: `sync-3` (the default; 4K native; the only one that reads an image), `lipsync-2`,
  `lipsync-2-pro`, the legacy `lipsync-1.9.0-beta`, and `react-1`, whose `options.prompt` is a
  six-word emotion enum rather than a sentence. Per-second output rates are on every catalog row.

  The provider id is `sync` rather than `sync-so` because unmodel's provider ids are vendor names
  and not domains — `kling`, not `klingai.com` — and sync.'s own SDKs import as `sync` and read
  `SYNC_API_KEY`.

  Six documented rules are checked here rather than at the API, each of them a 4xx or a silent
  no-op otherwise: `input` is an ARRAY with an arity rule (exactly one visual, one voice), each
  media item needs a `url` OR an `assetId` (the spec encodes that as an `anyOf`, so both fields
  are individually optional and `{ type: "video" }` type-checks), an image input narrows the model
  to `sync-3`, four of the six `options` are model-gated, `dubParams` forbids the voice input the
  request would otherwise need, and `segments` links its tracks by `refId`.

  The model gate is a **warning** and not an error, deliberately: sync. ignores an option a model
  does not take rather than refusing it, so `temperature: 0.9` at `sync-3` is a successful,
  identically-billed generation in which the dial did nothing. Refusing it would reject a request
  the API fulfils; staying silent would let a caller believe the dial worked.

  Deliberately not served: `POST /v2/tts` and the `/v2/voices` clone surface (an ElevenLabs
  passthrough — unmodel carries ElevenLabs natively, with the real voice roster rather than a
  two-field projection of it), and `/v2/assets`, `/v2/projects`, `/v2/batch` (storage,
  organisation and an envelope around the body this provider already validates).

  Subpaths: `unmodel/sync`, `/unified`, `/types`, `/values`. `SYNC_ERROR_CODES` publishes all 62
  codes sync.'s unauthenticated `GET /v2/errors` catalogue serves, because branching on the code
  rather than the message is what its docs ask for.

  ## `unmodel/topaz` — Topaz Labs' image API

  `https://api.topazlabs.com/image/v1`, **multipart form** bodies, `X-API-Key: <TOPAZ_API_KEY>`.
  Two addresses, because Topaz publishes two real URLs with disjoint model enums and different
  dials: `topaz.upscale` (`POST /enhance/async`, the six classic Gigapixel models) and
  `topaz.upscaleGenerative` (`POST /enhance-gen/async`, the nine generative Wonder and Bloom
  ones). `unmodel/upscale` hides the fork — its adapter picks the URL from the ref.

  Neither path declares a JSON arm, so even a request whose only input is `source_url` is
  form-encoded: results carry `request.body === "form"` and **empty headers** (`fetch` derives the
  multipart boundary), and the body goes out through `topaz.toFormData(params)`.

  The model ids are Topaz's own product names, spaces and all — `"topaz/Standard V2"`,
  `"topaz/Upscale High Fidelity V3"`, `"topaz/Bloom Realism"`. Slugging them would invent a
  vocabulary and then need a table to undo it.

  **The reason this provider is hand-written**: every request schema in Topaz's published OpenAPI
  document ends `additionalProperties: { type: string }`, so the machine-readable half knows the
  envelope and nothing at all about `creativity`, `texture`, `faceEnhancement`, `denoise`,
  `strength` or `prompt` — the dials that decide what the output looks like. Those are documented
  only in prose, per model, and Topaz **ignores** a dial a model does not read. A wrong setting is
  therefore a silent no-op at the API, billed identically. `TOPAZ_SETTINGS_BY_MODEL` is that prose
  transcribed, and it turns the no-op into a warning that names the models which do read it.

  Topaz brings the category two things fal's resale of three of its endpoints cannot. The first is
  `prompt`: nine of its fifteen models steer on one, which turns a word with one real witness into
  a word with two. The second is a `factor` that is `never`:

  ```ts
  upscale({ model: "fal/fal-ai/recraft/upscale/crisp", source, factor: 2 }); // no multiplier: it chooses
  upscale({ model: "topaz/Standard V2", source, factor: 2 }); // no multiplier: you state a size
  ```

  Two ways to have no multiplier, two different messages, and it took a second provider for the
  empty `factors` list to stop looking like a special case.

  Cost is exact here, which is rare for a media provider: Topaz bills per output megapixel
  (`credits = ceil(outputMP / mpPerCredit)`, at 24 MP/credit for Gigapixel, 4 for Wonder, 2 for
  Bloom, $0.12 a credit), and the request states the output size. A request that lets Topaz choose
  the size estimates `undefined` rather than guessing.

  Deliberately not served: the rest of the Image API — `/denoise`, `/sharpen`, `/sharpen-gen`,
  `/restore-gen`, `/lighting`, `/matting` — which are separate routes that clean, sharpen, relight
  or cut out a picture at the size it arrived rather than upscaling it. And the **Video API**,
  which is not a request but a five-step protocol (quote → accept → S3 multipart upload →
  complete-upload → poll) in which only the first step has a body, whose body needs facts about
  the file unmodel has no words for (`container`, `duration`, `frameCount`, `frameRate`,
  `resolution`), and whose model ids are opaque codes (`prob-4`, `iris-3`, `thd-3`) with no
  published mapping to the product names. `unmodel/upscale` reaches Topaz video through fal, which
  is the sort of gap an aggregator is for.

  Subpaths: `unmodel/topaz`, `/unified`, `/types`, `/values`.

  ## What else moved
  - `unmodel validate` gains `sync.lipsync`, `sync.avatar`, `topaz.upscale` and
    `topaz.upscaleGenerative`.
  - `.toSdk("sync")` and `.toSdk("topaz")` return the same body; sync.'s is exactly what
    `@sync.so/sdk`'s `generations.create` takes, and Topaz ships no JavaScript SDK.
  - `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale` each reach two providers now. Their
    ready-made packs grew accordingly (measured 318.0, 312.5 and 337.0 KiB), and the composition
    tests gained the assertion a native provider makes possible: sync. serves both audio-driven
    categories from one url through two adapter leaves, so a lipsync bundle containing
    `sync/unified-avatar.ts` would be a leak with no filename tell.
  - No canonical word was promoted. `sync_mode` remains a per-model extra at both providers,
    because sync. agreeing with itself through a reseller is one witness rather than two — and
    the two spell it at different depths (`sync_mode` at fal's body root, `options.sync_mode`
    natively), which is a difference the extras mechanism can carry and a vocabulary could not.

- 62417e9: **Two more native providers — `unmodel/veed` and `unmodel/heygen` — which take `unmodel/lipsync`
  and `unmodel/avatar` from two providers to four, and finally make the category's oldest open
  vocabulary question answerable.**

  Four of fal's ten lipsync endpoints are sync.'s models resold; two more are VEED's and two more
  are HeyGen's. Those three vendors are now here at their own APIs, which means the words in
  `LipsyncParams` and `AvatarParams` are checked against four independent request schemas rather
  than against one aggregator's flattening of them.

  ```ts
  import { lipsync } from "unmodel/lipsync";

  JSON.stringify(
    lipsync({
      model: "veed/lipsync-2.0",
      source: { url: clip },
      audio: { url: vo },
    }),
  );
  // → {"video_url":"…","audio_url":"…"}
  //   POST https://api.veed.io/v1/lipsync-2.0

  JSON.stringify(
    lipsync({
      model: "heygen/lipsync-precision",
      source: { url: clip },
      audio: { url: vo },
    }),
  );
  // → {"video":{"type":"url","url":"…"},"audio":{"type":"url","url":"…"},"mode":"precision"}
  //   POST https://api.heygen.com/v3/lipsyncs
  ```

  ## The promotion rule ran, and the answer was no

  `unmodel/lipsync` has never had a canonical word for "what happens when the track and the clip
  are different lengths", and the rule for adding one is two INDEPENDENT vendors spelling it
  compatibly. With four providers that is finally testable:

  | vendor                               | field                             | value space                 |
  | ------------------------------------ | --------------------------------- | --------------------------- |
  | sync. (natively, and resold at fal)  | `sync_mode` / `options.sync_mode` | 5-arm enum                  |
  | LatentSync (at fal)                  | `loop_mode`                       | 2-arm enum                  |
  | HeyGen (natively, and resold at fal) | `enable_dynamic_duration`         | boolean, default `true`     |
  | VEED                                 | —                                 | the route has no such field |

  Five rows, three vendors — a vendor agreeing with itself through a reseller is one witness.
  Three shapes and one outright absence is not a vocabulary: a canonical `durationMismatch` would
  have to pick a value space, and a boolean and a five-strategy enum have none in common. So it
  stays a per-model extra everywhere, and `test/unified/lipsync-capabilities.test.ts` now holds
  that as an assertion which FAILS the day two of them agree.

  ## `unmodel/veed` — the smallest request surface in the library

  `https://api.veed.io/v1`, JSON, `Authorization: Bearer vp_…` (`VEED_API_KEY`). Two URLs with
  disjoint schemas: `veed.lipsync` posts `{ video_url, audio_url }` to `/v1/lipsync-2.0`, and
  `veed.avatar` posts `{ image_url, audio_url, resolution }` to `/v1/fabric-1.0`. Everything is
  typed from one publicly fetchable OpenAPI 3.1.0 document; VEED ships no SDK, so there was no
  tiebreak to run.

  Three facts from that document decide the provider. Every request schema is
  `additionalProperties: false`, so an undeclared key is a **422 with no job created** rather than
  a field VEED ignores — the opposite of sync. and Topaz, and the reason the unknown-param check
  here reports an error where theirs report warnings. Every media field carries the pattern
  `^[Hh][Tt][Tt][Pp][Ss]?://` and an 8192-character ceiling, and VEED publishes **no upload arm of
  any kind** — no multipart, no base64, no asset ids — so a `data:` URI, an `s3://` reference and
  a bare path are three 422s that look like URLs. And `resolution` on `fabric-1.0` is `required`
  with **no default**, which makes `{ image_url, audio_url }` a 422 and makes this the one route
  in either category that needs a word the vocabulary has not got. It rides as a per-model extra,
  and the refusal quotes both rates rather than choosing: 480p is $0.08 per second of output and
  720p is $0.15, so a default unmodel invented would be a line item.

  Pricing is in the spec — each submit operation carries an `x-veed-pricing` extension with
  currency, unit, rounding and rates that may be conditioned on a request field — so the rates
  change in the same diff as a schema change. Where the published numbers disagree, veed.io/api
  says Fabric is $0.08–$0.20/sec and the model page, the tools page and the machine-readable
  extension all say $0.08–$0.15; the outlier is not followed.

  VEED's lipsync row declares **no extras at all**, and that emptiness is the evidence behind the
  promotion decision above. Its avatar row is the OPPOSITE of the same vendor's row at fal:
  `fal/veed/avatars/audio-to-video` is a presenter library with `sources: []`, and VEED's own API
  has no presenter roster (`POST /v1/avatars` answers a real JSON 404), so `veed/fabric-1.0` is
  `sources: ["image"]`. Same vendor, two products, opposite rows.

  Not served: the `video-background-removal` family — three variants and six of VEED's ten
  operations. A real, priced, documented product that matches no category unmodel has, and a
  one-provider `matting` category read off a single witness is what this library declines to
  build.

  ⚠️ VEED's docs, schemas and playground are fully public, but keys are not self-serve: every page
  links to contact-sales. The types are as exact as any in the library and were never exercised
  against a live key.

  ## `unmodel/heygen` — the one with two specs and a moved doc host

  `https://api.heygen.com/v3`, JSON, `x-api-key: <HEYGEN_API_KEY>`. `heygen.avatar` is
  `POST /v3/videos` and `heygen.lipsync` is `POST /v3/lipsyncs` — two URLs with two response
  shapes and **two different status enums** (`processing` on the video route, `running` on the
  lipsync one; a shared polling `switch` over them falls through).

  Two traps this provider exists to have already walked into. HeyGen serves **two** OpenAPI
  documents and both answer 200: `developers.heygen.com/openapi.yaml` is a v4.0.8 document with 52
  v1/v2 paths and no `/v3/videos` at all, and `openapi/external-api.json` is the current one (98
  paths, 300 schemas). And `docs.heygen.com` is gone — it 301s to `developers.heygen.com`, where
  the old canonical slugs 404. Every URL cited here was re-resolved by fetching it.

  **Neither route has a `model` field, and both defaults are prices.** The video route has an
  `engine` discriminated union — `avatar_iii`, `avatar_iv` (applied when `engine` is omitted),
  `avatar_v` — and those three are the catalog rows, because they are three products with three
  pages and a four-fold price spread. The lipsync route has `mode: "speed" | "precision"` (default
  `"speed"`), catalogued as `lipsync-speed` and `lipsync-precision` after HeyGen's own doc slugs.
  Both adapters write the wire value out on every call: a ref that names a price should not depend
  on a server-side default to get it.

  Seven cross-field rules are checked, every one of them prose in the spec on fields that are all
  individually optional: `type` decides which visual source is required and which is refused (both
  arms are `additionalProperties: false`, and HeyGen's own documented example error is that
  mistake); Avatar III does not render raw image input; `expressiveness` is Avatar IV only and
  `motion_prompt` is not Avatar III, both REJECTED rather than ignored; `script` and the audio
  fields are mutually exclusive; `voice_id` is required with a script unless `avatar_id` supplies
  a default voice; `voice_settings` is silently ignored beside uploaded audio (a warning, because
  it is a no-op); and `output_format: "webm"` rejects any `background`.

  HeyGen brings the category a third answer to inline bytes. fal builds a `data:` URI for a field
  that fetches URLs; sync. and VEED refuse bytes because their fields only fetch; HeyGen has a
  real `{ type: "base64", media_type, data }` arm on its own `oneOf`, so the bytes go in
  structurally — and its `audio_url` does not have that arm, so one request accepts bytes for the
  still and refuses them for the track.

  Pricing is public USD. Two of the five rows carry a band, because HeyGen's table is keyed by
  engine × avatar type and the avatar type lives on the look rather than in the request: Avatar
  III $0.0167–$0.0433/sec, Avatar IV $0.05–$0.0667, Avatar V $0.0667 exactly, lipsync speed
  $0.0333 and precision $0.0667 exactly. Rows carry the top of each band. Nothing estimates: every
  rate is per second of output and the output's length follows the audio's.

  **`heygen.tts` is a deliberate exclusion.** `POST /v3/voices/speech` publishes no model id at all
  (the engine is fixed to Starfish and stated only in prose), `voice_id` is an account-scoped
  handle with no published roster, `input_type` is a bare `string`, and there is no format, sample
  rate, codec or bitrate control — which is most of what `unmodel/tts`'s vocabulary is. A row that
  narrows nothing would widen the tts matrix while telling a caller less than every other row in
  it. Also excluded with reasons: `type: "cinematic_avatar"` (a prompt-to-video model wearing an
  avatar route's URL — no audio input, a `prompt` and an array of look ids), `type: "studio"` (a
  fifty-scene timeline document), video translation, background removal, HyperFrames, AI clipping,
  filler-word removal, and the whole platform surface.

  **Argil and Tencent's native Hunyuan3D** were researched in the same rounds and are recorded as
  declined in `docs/providers.md`: Argil publishes no aggregated OpenAPI document (the advertised
  one 404s; the schemas exist only as fences in 23 `.md` pages) and no USD pricing at all, and
  Hunyuan3D's native API is a Tencent Cloud product whose auth is TC3-HMAC-SHA256 request signing
  rather than a header key. Both vendors' models remain reachable through fal.

  ## New subpaths

  `unmodel/veed`, `unmodel/veed/unified`, `unmodel/veed/types`, `unmodel/veed/values`,
  `unmodel/heygen`, `unmodel/heygen/unified`, `unmodel/heygen/types`, `unmodel/heygen/values`.
  `unmodel/lipsync` and `unmodel/avatar` gain two providers each with no API change; pack budgets
  move 350 → 445 KiB (measured 395.2) and 345 → 445 KiB (measured 396.4), and the two stay within
  2% of each other, which is the assertion that has teeth.

- c22997c: **New unified category `unmodel/3d`, and the native `unmodel/tripo3d` provider that made it
  possible.**

  The first category in the library that did **not** ship on one provider, and that was the
  point. `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale` all arrived with fal alone
  (they gain their second witnesses in the same release — see the sync./Topaz entry below);
  3D waited for a second, independent witness, because a vocabulary read off a single vendor is
  that vendor's request schema with the field names changed — and 3D is where that shows fastest.
  Two schemas in, `texture` already had five spellings (`texture`, `textured_mesh`,
  `enable_texture`, `should_texture`, `texture_mode`) and the output container had four more plus
  a boolean that changes it as a side effect. None of them is in the vocabulary.

  ```ts
  import { threeD } from "unmodel/3d";

  JSON.stringify(
    threeD({
      model: "tripo3d/v3.1-20260211",
      prompt: "a brass astrolabe",
      seed: 7,
    }),
  );
  // → {"model":"v3.1-20260211","prompt":"a brass astrolabe","model_seed":7}
  //   POST https://openapi.tripo3d.ai/v3/generation/text-to-model
  ```

  **Five canonical words**, and the first category whose two content words are ALTERNATIVES
  rather than companions: `model`, `prompt` XOR `image`, `seed`, `providerOptions`. One row field
  (`inputs`) moves both in opposite directions, with three populated arms — text-only routes type
  `image` as `never`, image-only routes do the reverse, and a route that publishes both (fal's
  Hyper3D Rodin, and every Tripo model) leaves both optional. No `size`, no `aspectRatio`, no
  `resolution`, no `n`: a mesh has no frame, and these routes return one object per request.

  **`unmodel/tripo3d`** — Tripo's own v3 API, `https://openapi.tripo3d.ai/v3`, flat JSON,
  `Authorization: Bearer <TRIPO_API_KEY>`. Two endpoints (`tripo3d.threeD` for
  `POST /v3/generation/text-to-model`, `tripo3d.threeDFromImage` for `…/image-to-model`) across
  four models — `v3.1-20260211`, `v3.0-20250812`, `v2.5-20250123` and the low-poly
  `P1-20260311`. Subpaths: `unmodel/tripo3d`, `/unified`, `/types`, `/values`.

  Three cross-field rules Tripo documents, each of them a 4xx otherwise, are compile-time or
  validation errors here: seven parameters are gated on the model version and `v2.5-20250123`
  takes none of them; `generate_parts: true` requires `texture`, `pbr` and `quad` all false, and
  the first two DEFAULT to true; and the polycount ceiling moves with the model, with Ultra mode
  and with `quad`. Its `input` is one polymorphic string — a `file_…` token, a public URL or a
  prior `task_…` id, never inline bytes — so a `{ data }` ref is refused naming `POST /v3/files`
  rather than compiled into a `data:` URI Tripo would reject.

  Tripo is also the rare media provider whose estimate is **exact**: the price is a pure function
  of the request body (a per-task credit base plus the add-ons the body switched on, at $0.01 a
  credit), with no duration to guess and no output pixel count to infer from a URL. P1 declines,
  because its credit table is rendered client-side only on Tripo's pricing page.

  **`fal.threeD`** — 19 curated endpoints from seven vendors, taking `unmodel/fal` to **165
  endpoints across ten verbs**. Tripo H3.1 and P1 (text and image), Tripo v2.5 image and
  multiview, Hunyuan3D 2.0 and turbo, Hunyuan 3D 3.1 Pro and Rapid, TRELLIS and TRELLIS 2,
  TripoSR, Hyper3D Rodin v2.5 and its text-only sibling, Meshy 7, Hi3D v3.0. The verb is `threeD`
  rather than `3d` for a mechanical reason: an endpoint id's second segment is a module export
  name and `3d` is not a JavaScript identifier. The category id, the package subpath
  (`unmodel/3d`) and the CLI's `unified.3d` all keep the digit.

  The two providers overlap on purpose. `tripo3d/h3.1/image-to-3d` at fal and
  `tripo3d/v3.1-20260211` natively are the same model reached two ways, and they compile to
  visibly different bodies — which is the comparison the category exists to make cheap:

  ```ts
  threeD({ model: "fal/tripo3d/h3.1/image-to-3d", image: { url } });
  // → {"image_url":"…"}                          POST https://queue.fal.run/tripo3d/h3.1/image-to-3d

  threeD({ model: "tripo3d/v3.1-20260211", image: { url } });
  // → {"model":"v3.1-20260211","input":"…"}      POST https://openapi.tripo3d.ai/v3/generation/image-to-model
  ```

  Also in this release:
  - `Modality` gains a `"3d"` member. A mesh is not a picture of one, and every route here also
    returns a preview render — filing the whole category under `"image"` would have made
    `modalities.output` lie about what the request bought.
  - `unmodel/fal` now exports a `provider` `ProviderInfo` (`{ id: "fal", name: "fal.ai",
env: ["FAL_KEY"] }`), which every other hand-catalogued provider already had.
  - `unmodel validate` gains `fal.threeD`, `tripo3d.threeD`, `tripo3d.threeDFromImage` and
    `unified.3d`.

## 0.2.0

### Minor Changes

- 62f3e01: **The speech response surface, said out loud — a false `empty_audio` fixed, a
  delivery descriptor on all fifteen TTS adapters, the auth header named where
  retargeting moves it, and `toRequestInit` so nobody retypes a fetch init
  again.**

  Every item here is the same shape of fix: the package already knew the thing
  and made you find it somewhere else. Six of them.

  ## `google.checkTts` no longer reports `empty_audio` on a `fileData` response

  A real bug, and the package's own validator is what proved it. `hasAudioPart`
  scanned `candidates[0].content.parts[].inlineData.mimeType` only — so a
  response to a request that set `responseFormat.audio.delivery: "URI"`, which
  `google.tts` validates and `GEMINI_AUDIO_DELIVERY_MODES` enumerates, came back
  as a `fileData` part carrying a `fileUri` and was reported as
  `invalid_shape` / `empty_audio` with the message telling you to retry. The
  checker now counts both deliveries, and the message names both
  (`"neither inlineData nor a fileData URI"`) so the remaining case still reads
  as the real one it is.

  ## `toRequestInit(result)` — the four fetch arguments, minus the key

  ```ts
  const { url, ...init } = toRequestInit(request);
  await fetch(url, { ...init, headers: { ...init.headers, authorization } });
  ```

  url, method, static headers and the JSON framing are all things the package
  knows and the caller currently retypes — and spreading a result to retype them
  silently drops `.request`, which is non-enumerable by design. Returns
  `FetchArgs` (`{ url, method, headers, body }`), with `headers` a copy so
  adding auth to it cannot reach the validator's own object. It never calls
  `fetch` and takes no credential.

  Two whole classes of endpoint cannot reach it, both at compile time: socket
  configs (`SocketMeta.method` is `"GET"`) and the multipart endpoints, whose
  `ValidatedForm` result type makes the call a type error naming the
  `toFormData` helper to use instead. `recraft.imageEdit`, the one endpoint
  whose framing is decided per call, is caught at runtime with the same message.

  Lives at `src/core/request-init.ts` — an import-free leaf reached only from
  the root entry — so `unmodel/groq`, which never builds a fetch call, pays zero
  bytes for it.

  ## `TargetEndpoint.auth` and `CHAT_AUTH` — the header retargeting invalidates

  `.toApi("openai")` moves a validated Anthropic request to a new host, and the
  `x-api-key` header the caller already wrote goes with it, unchanged and now
  wrong. The retarget endpoint table is the only place that knows both halves of
  that swap, so it now carries the second half:

  ```ts
  import { CHAT_AUTH } from "unmodel/chat";

  const { header, scheme } = CHAT_AUTH[provider];
  headers[header] = scheme === undefined ? key : `${scheme} ${key}`;
  ```

  Names only, never values — unmodel still never touches a key, the same way
  `ProviderInfo.env` already names the env var without reading it. `CHAT_AUTH`
  is a deliberate _mirror_ of the endpoint table's new `auth` column rather than
  a re-export of it: retaining any binding from `endpoints.ts` retains all 30
  chat/completions URLs, which would put 6.1 KiB behind a 3 KiB per-export
  budget on `unmodel/values`. Restating three frozen descriptors costs 0.3, and
  `test/chat/providers.test.ts` compares every row against the endpoint that
  provider actually resolves to, so the copy cannot drift. The four targets with
  a second way in (google's `?key=`, azure's Entra token, google-vertex's
  OAuth-only access token, bedrock's SigV4) are argued in the `EndpointAuth`
  docblock, which names the one form that always works and why.

  ## `TtsDelivery` — where the audio is, on all fifteen adapters

  A TTS response puts the audio in one of five places and a boolean would lie
  about four of them, so `delivery` is a descriptor: `bytes`, `base64` (with the
  path), `hex` (MiniMax), `url` (there are no bytes in hand — naming that is the
  point) and `sse`. Three shapes, because the providers genuinely disagree about
  what decides it: flat, `byRequestField` (OpenAI's `stream_format`, Deepgram's
  `callback`, MiniMax's `output_format`, Gemini's `responseFormat.audio.delivery`,
  Murf's `encodeAsBase64`), and `byModel` (Murf again, where `gen2` and
  `falcon-2` are served by two different routes). A `byRequestField` variant
  whose value is a _string_ is a declared gap in the `unsupported` idiom: it
  says why that request carries no audio at all, which is how Deepgram's
  `callback` ack is spelled.

  Declared as a const on each provider's import-free `tts-params` leaf and
  re-exported as `TTS_DELIVERY` from `unmodel/<provider>/values`, so a picker
  can read it without pulling that provider's validator. unmodel validates
  requests, so this is a description and never a parser: no module in this
  library reads a response body off one.

  ## `GEMINI_TTS_VOICE_INFO` — the 30 voice descriptors

  Google publishes a one-word character note beside each preset voice ("Zephyr:
  Bright", "Kore: Firm"), and a picker that wants to label the option had to
  invent the word. Now it does not. Display data, never enforced: no check reads
  this table, `voiceName` is still typed from `GEMINI_TTS_VOICES`, and the value
  is an object rather than a bare string so a second published column can join
  without breaking callers. `as const satisfies` makes a 31st voice a build
  error until its descriptor is transcribed too.

  ## `docs/tts.md` — the integrator's matrix, split by provenance

  Fifteen providers' auth header, response delivery, response checker and wire
  quirks in one place, with the drift liability engineered out rather than
  accepted. URL, method and static headers are already properties of a compiled
  `.request`, so a hand-written table of them is a copy: those columns are
  generated by `scripts/gen-tts-matrix.ts` (`bun run gen:tts-matrix`) from real
  `tts()` calls, and `test/docs/tts-matrix.test.ts` re-runs those calls against
  the committed rows, asserts the row set equals the adapters `unmodel/tts`
  registers, and asserts the doc is byte-identical to a fresh regeneration. Auth
  has no API surface on purpose and stays prose; the delivery and checker
  columns cite the const and the export by name rather than restating them, and
  the test pins those citations by reference.

  Four module headers were wrong or silent about their own response side and are
  fixed: `openai/tts.ts` was the one TTS module that never named its auth
  scheme; `hume/tts.ts` and `speechify/tts.ts` both answer JSON and never said
  why they have no checker; and `murf/tts.ts` read as if Murf had none, when
  `/v1/speech/generate` has one and only `/v1/speech/stream` does not.

  ## README

  Executed, not asserted, as always. The two hand-rolled JSON fetch inits are
  now the `toRequestInit` idiom; the Values section states that `voices` exists
  only where a provider publishes a closed list (OpenAI and Google, of fifteen)
  and that `SPEECH_VOICES` / `GEMINI_TTS_VOICES` are `===` the row's array
  rather than a rival API; a new "Estimating cost" block documents
  `estimate.costUSD`, the `maxCostUSD` gate and the four public cost helpers
  (`resolveModelInfo`, `computeCharacterCostUSD`, `computeAudioMinutesCostUSD`,
  `computeCostUSD`) which had zero mentions; and the `getModel` example now says
  it reads the models.dev snapshot only, pointing media users at
  `import { models } from "unmodel/<provider>"` instead of an `undefined` they
  would reasonably read as missing data.

## 0.1.1

### Patch Changes

- Correct the repository, homepage and bugs URLs — the project lives under the
  `cluely` organization on GitHub, not a personal account.

## 0.1.0

### Minor Changes

- 82884c9: **`unmodel/chat` now composes the real provider validators, and there is a
  narrow entry for applications that only call two of them.**

  A unified chat call used to be checked against a slim per-model profile table
  that lived beside the provider validators and could disagree with them. It no
  longer is. `chat()` validates the canonical shape, compiles it to the target
  dialect once, and hands the body to **that provider's own `chat()`** — the same
  function `unmodel/anthropic` exports, with its schema, its catalog, its
  hand-written constraint tables, its capability and media checks and its cost
  estimate. There is one definition of a valid request per provider, and unified
  chat is not a second one.

  **What you get back is that provider's result.** Enumerable properties are its
  exact wire body and `.request` is its URL, as before — but now `.toSdk(target)`
  _and_ `.toApi(target)` are the provider's own, typed off its generated
  availability table. `chat({ model: "anthropic/claude-opus-5", … })
.toApi("openrouter")` retargets a request you authored canonically, and
  `.toApi("groq")` on the same request is a compile error because the catalog
  says Groq does not serve that model. (This corrects the "no `.toApi()` on a
  unified result" note in the `unified-surfaces` changeset, which is now a
  statement about the six media packs only.)

  Issue paths still come back in the vocabulary you wrote: a finding the provider
  reports at `["max_completion_tokens"]` is returned at `["maxOutputTokens"]` —
  and the _message_ now says which wire param it was compiled from, so a
  canonical path never arrives attached to a sentence about a param that does not
  exist in the API you are using. A wire param with no canonical name keeps its
  wire spelling and gains ``(supplied via `providerOptions`)``.

  **New export: `unmodel/chat/factory`.**

  ```ts
  import { createChat } from "unmodel/chat/factory";
  import { chat as anthropic } from "unmodel/anthropic";
  import { chat as openai } from "unmodel/openai";

  const chat = createChat({ anthropic, openai });
  ```

  Same compiler, same vocabulary, byte-identical requests — from only the
  validators you register. The registry key and the validator under it are one
  claim: every chat validator is structurally identical and providers share model
  ids, so `createChat({ groq: togetherai })` would otherwise compile and quietly
  post to the wrong host. It is a compile error, and a `TypeError` at
  construction for a hand-written validator that carries no provider claim.
  A ref naming a provider you did not register has no usable result type either —
  the call can only throw, so the type says so instead of offering `.request`.

  `createChat` is **not** re-exported from `unmodel/chat`. It would be the same
  function at eleven times the weight: `chat` is a top-level call that anchors the
  whole registry, and no bundler removes it. The type re-exports are free and stay.

  **Removed: `ChatOptions.catalog`.** A catalog layered beside a concrete provider
  validator is a second authority that can disagree with the first — exactly the
  thing this change removes everywhere else. Configure the validator instead and
  register it:

  ```ts
  const chat = createChat({
    openai: createOpenAICompatible<string, never, "openai">({
      id: "openai",
      baseUrl: "…",
      catalog: myCatalog,
    }).chat,
  });
  ```

  **Also removed:** `chatConstraintsFor` and `CHAT_CONSTRAINT_ENDPOINTS` from
  `unmodel/chat`. They exposed the chat-side copy of the deny/enum tables, which
  no longer exists; each provider's validator applies its own.

  **New issue code: `media_declaration_dropped`** (warning). Only a compiling
  surface can produce it: a `ValidateOptions.media` declaration whose part did not
  survive compilation is reported and dropped, rather than forwarded at a path
  that now addresses a different attachment.

  **Deeper checks, everywhere — not just here.** Pushing validation down to the
  substrate made several of them wider than they were, on the provider subpaths
  as well as on `unmodel/chat`:
  - `reasoning_effort` on a model the catalog marks `reasoning: false` is now an
    `unsupported_capability` error in the shared chat-completions battery, so
    OpenAI _and_ all 30 OpenAI-compatible providers refuse a request their APIs 400. It surfaces as `["reasoning"]` through `unmodel/chat`.
  - `structuredOutput` is tri-state everywhere now: absent means "the catalog has
    no answer" and never fails a request. `google.chat` and `google-vertex.chat`
    used to read absent as `false`.
  - Estimate findings carry a path: `over_context` / `near_context` point at the
    prompt-bearing param, `over_budget` at `["model"]`.
  - A `tools` refusal names the tools that were supplied again.

  **Bundle.** `unmodel/chat` measures **1718.7 KiB** (budget 1800) — 32 validators,
  their catalogs and 11 availability tables. About 379 KiB of that is the
  `chatProfiles` discovery snapshot, which is public API and no longer read by any
  validation path; it is kept for discovery and priced honestly here rather than
  quietly. `unmodel/chat/factory` measures **144.0 KiB** (budget 150) and contains
  no provider module beyond the three dialect codecs, asserted rather than
  described. `dist/chat/index.d.ts` is 455 KiB, down from 892, and now has a
  budget of its own — a declaration regression is invisible to every other gate.

- 196d9be: Media endpoint wave: image editing, TTS/STT, and video post-production validators.

  New request validators (all on existing subpaths — no new package exports):
  - `unmodel/openai`: `imageEdit` (+ `imageEditToFormData`), `tts` (TTS),
    `stt` (+ `sttToFormData`).
  - `unmodel/google`: `image` (Imagen 4 fast/standard/ultra).
  - `unmodel/black-forest-labs`: `imageFlux1`, `imageEditFill`, `imageEditExpand`, and the
    FLUX Tools routes `imageEditOutpainting`, `imageEditErase`, `imageEditDeblur`,
    `imageEditVto`.
  - `unmodel/ideogram`: `imageV4`, `imageEdit`, `imageEditRemix`, `imageEditReframe`,
    `imageEditReplaceBackground`.
  - `unmodel/recraft`: `imageEdit`, `imageEditInpaint`, `imageEditOutpaint`,
    `imageEditGenerateBackground`, `imageEditReplaceBackground`.
  - `unmodel/stability`: `imageEditErase`, `imageEditInpaint`, `imageEditOutpaint`,
    `imageEditSearchAndReplace`, `imageEditSearchAndRecolor`,
    `imageEditRemoveBackground`.
  - `unmodel/luma`: `videoModify`, `videoReframe`, `imageEditReframe`, `videoUpscale`,
    `videoAddAudio`.
  - `unmodel/runway`: `videoFromVideo`.

  Types across every audited endpoint were re-derived from the providers' current
  documentation rather than their SDKs — narrowed where the SDK permits what the API
  rejects, widened where the SDK enum is a subset of the documented range (e.g.
  `gpt-image-2` now accepts free-form `WIDTHxHEIGHT` sizes and rejects only
  `background: "transparent"`). Every deviation carries its doc URL.

  The `unmodel validate` CLI registry now covers all 77 JSON-bodied endpoints and
  reports multipart-upload endpoints as library-only instead of failing on a type error.

- 196d9be: Realtime session configs for the TTS/STT providers — the documented JSON config object
  of each socket surface, never the socket lifecycle.

  New request validators (all on existing subpaths — no new package exports):
  - `unmodel/cartesia`: `ttsWebsocket` (+ `ttsWebsocketUrl`), `sttWebsocket`
    (+ `sttWebsocketUrl`, `sttWebsocketConstraints`).
  - `unmodel/deepgram`: `listenLive`, `listenFlux` + its mid-stream `fluxConfigure`
    message, `speakLive` (+ `listenLiveUrl`, `listenFluxUrl`, `speakLiveUrl`).
  - `unmodel/elevenlabs`: `textToSpeechStreamInput` (+ `textToSpeechStreamInputUrl`,
    `toInitializeConnectionMessage`), `speechToTextRealtime`
    (+ `speechToTextRealtimeUrl`).
  - `unmodel/inworld`: `stt` (sync STT — base64 audio inline in the JSON body),
    `realtimeTranscribeConfig` and `realtimeVoiceContext` (the first frame of each
    bidirectional socket).
  - `unmodel/soniox`: `realtimeTranscription` (the configuration message sent right
    after connecting).

  These follow the `openai.realtimeSession` pattern: unmodel validates the config
  object — a connection-URL query set, a first configuration frame, or a per-chunk
  generation message — with the same catalog awareness, documented bounds and
  per-model gates as any REST endpoint. Opening the connection, framing audio,
  keepalives and every server event stay out of scope, as each module's header states
  next to the doc URL it was verified against.

  Where the socket address follows from the config, `.request` describes the socket
  (`wss://` url, method `"GET"` — a handshake is an HTTP GET upgrade); the surfaces
  whose address must be assembled from the params export a URL builder instead.

  `unmodel validate` now covers these too and labels them `transport: websocket`
  rather than mistaking a header-less socket config for a multipart body.

- 196d9be: **Breaking:** `.toSdk()` now takes a target, and chat validators gain `.toApi(provider)`.

  `.toSdk()` no longer exists in its zero-argument form. Every endpoint declares the
  SDK shapes it can honestly produce and you name one:

  ```diff
  - const completion = await openai.chat.completions.create(validated.toSdk());
  + const completion = await openai.chat.completions.create(validated.toSdk("openai"));
  ```

  Targets are catalog provider ids (`"openai"`, `"anthropic"`, `"google"`,
  `"amazon-bedrock"`, `"cohere"`, …) plus one reserved non-catalog id, `"ai-sdk"`, for the
  Vercel AI SDK. An unknown target is a compile error, not a wrongly-shaped object.

  New in this release:
  - **`.toApi(provider)` on chat validators** — retargets a validated request to another
    provider that serves the same model, translating the wire format across dialects and
    respelling the model id. The target union is typed per model from generated per-provider
    availability tables (`src/catalog/availability/<id>.gen.ts`), so
    `chat({ model: "claude-opus-5", … }).toApi("openai")` is a compile error rather than
    a 404. `.toApiSafe(provider)` is the non-throwing form. The endpoint factories
    (`amazon-bedrock`, `google-vertex`, `azure`) are excluded from the union for now — they
    need per-instance config a one-argument call cannot supply — and a two-argument overload
    is reserved as a non-breaking follow-up. Media endpoints have `.toSdk` but no `.toApi`.
  - **Translation warnings.** `.toApi` never throws on lossiness and never silently drops:
    every removal or approximation lands in the non-enumerable `.warnings` array.
    `id_respelled` is always present, so a translation whose only warning is `id_respelled`
    is lossless.
  - **`toSdk("ai-sdk")` on chat endpoints**, emitting the AI SDK's stable `generateText` /
    `streamText` option shape.
  - **New subpath `unmodel/ai-sdk`**, exporting `withJsonSchemaTools(options, jsonSchema)`.
    It takes `ai`'s `jsonSchema` helper as an argument, so unmodel gains no dependency and no
    peer dependency on `ai` and the adapter keeps working across `ai` versions.

  Also breaking for anyone calling it directly: `toValidated`'s argument order is now
  `(body, request, init)`.

- b681286: TTS and STT become first-class categories, and Gemini joins both.

  Two things happened, and the first is a **breaking rename** of every audio
  address in the library.

  ## 1. `speech` → `tts`, `transcribe` → `stt`

  The two audio modalities now carry the names the rest of the world uses for
  them, matching `chat` and `image` as first-class category objects. This is the
  address-vs-wire naming law applied to the category verb itself: the _addresses_
  move, the _wire_ names do not.

  **The two subpaths:**

  | old                  | new           |
  | -------------------- | ------------- |
  | `unmodel/speech`     | `unmodel/tts` |
  | `unmodel/transcribe` | `unmodel/stt` |

  `speech` / `createSpeech` are now `tts` / `createTts`; `transcribe` /
  `createTranscribe` are now `stt` / `createStt`. The CLI ids moved with them:
  `unified.speech` → `unified.tts`, `unified.transcribe` → `unified.stt`.

  **The 29 endpoint ids** (every one of these is also the export name, the module
  filename, and the CLI id):

  | old                       | new                   |
  | ------------------------- | --------------------- |
  | `openai.speech`           | `openai.tts`          |
  | `cartesia.speech`         | `cartesia.tts`        |
  | `deepgram.speech`         | `deepgram.tts`        |
  | `elevenlabs.speech`       | `elevenlabs.tts`      |
  | `fish-audio.speech`       | `fish-audio.tts`      |
  | `hume.speech`             | `hume.tts`            |
  | `inworld.speech`          | `inworld.tts`         |
  | `lmnt.speech`             | `lmnt.tts`            |
  | `lmnt.speechDetailed`     | `lmnt.ttsDetailed`    |
  | `minimax.speech`          | `minimax.tts`         |
  | `murf.speech`             | `murf.tts`            |
  | `murf.speechStream`       | `murf.ttsStream`      |
  | `resemble.speech`         | `resemble.tts`        |
  | `resemble.speechStream`   | `resemble.ttsStream`  |
  | `rime.speech`             | `rime.tts`            |
  | `smallest-ai.speech`      | `smallest-ai.tts`     |
  | `speechify.speech`        | `speechify.tts`       |
  | `speechify.speechStream`  | `speechify.ttsStream` |
  | `openai.transcribe`       | `openai.stt`          |
  | `assemblyai.transcribe`   | `assemblyai.stt`      |
  | `cartesia.transcribe`     | `cartesia.stt`        |
  | `deepgram.transcribe`     | `deepgram.stt`        |
  | `elevenlabs.transcribe`   | `elevenlabs.stt`      |
  | `gladia.transcribe`       | `gladia.stt`          |
  | `inworld.transcribe`      | `inworld.stt`         |
  | `mistral.transcribe`      | `mistral.stt`         |
  | `revai.transcribe`        | `revai.stt`           |
  | `soniox.transcribe`       | `soniox.stt`          |
  | `speechmatics.transcribe` | `speechmatics.stt`    |

  `openai.transcribeToFormData` is `openai.sttToFormData`; every `*Constraints`,
  `check*`, `*SdkTargets` and `unified-*` sibling followed its endpoint
  (`cartesia.speechConstraints` → `ttsConstraints`, `unified-speech.ts` →
  `unified-tts.ts`, and so on).

  **The category-named types**, in one line: `SpeechParams` → `TtsParams`,
  `TranscribeParams` → `SttParams`, and every sibling with them —
  `*ParamsBase`, `*ParamsFor`, `*ModelParams`, `*ModelParamTable`,
  `*ModelNarrowing`, `*AdapterFor`, `*Validator`, `Any*Adapter`. The kernel's
  category ids are `"tts"` and `"stt"`.

  **Wire-shaped names are untouched**, deliberately, because they describe bytes
  rather than addresses: `elevenlabs.TEXT_TO_SPEECH_BASE_URL`, `minimax.T2A_URL`,
  `deepgram.SpeakParams`, `elevenlabs.speechToTextRealtime`, MiniMax's
  `speech-*` model ids, and every realtime socket surface read exactly as they
  did. So does `AudioFormatSpec`, `Voice`, `Diarization` and the rest of the
  shared audio vocabulary — those are not category addresses.

  ## 2. Gemini joins both packs

  Google has no speech endpoint: TTS is `:generateContent` with
  `responseModalities: ["AUDIO"]` + a `speechConfig`, and STT is
  `:generateContent` with audio parts. Until now that meant Gemini speech was
  typed as _chat_. It now has two dedicated surfaces — and the chat route keeps
  serving the same ids, because a validator that refused a request the API
  fulfils is the one failure this library must never have. See
  `docs/decisions.md` §4 for why one wire route carries three addresses.

  **New: `tts` at `unmodel/google`** (plus `checkTts`, `generateTtsUrl`,
  `ttsStreamUrl`, `ttsSupportsStreaming`, `ttsModels`). A Tier-A view of the same
  bytes `google.chat` sends:
  - `generationConfig` is **required** and its `responseModalities` is pinned to
    `["AUDIO"]`;
  - every chat-only knob is `?: never` — tools, structured output, `imageConfig`,
    media resolution, sampling penalties, including the ones nested under
    `generationConfig`;
  - `speechConfig` is a compile-time **XOR** of its single- and multi-speaker
    arms, and `speakerVoiceConfigs` is a bounded `[one] | [one, two]` tuple
    (the guide says up to 2);
  - `voiceName` is the closed 30-voice preset list, from the same `as const`
    array the runtime check reads;
  - `languageCode` completes the **78** primary language subtags the
    speech-generation guide tabulates (hand-transcribed 2026-08-21, count pinned),
    with a `(string & {})` tail and a _warning_ — not an error — off-list;
  - `responseFormat.audio` is a discriminated union, so `bitRate` exists only on
    the compressed arms and asking for one on raw PCM is refused;
  - the estimate is bounded by the real 32,768-token TTS session limit.

  Five new checks (`responseFormat.audio` enums, the `bitRate` rule, sample-rate
  sanity and band, off-table `languageCode`) live in **one shared battery** both
  surfaces call, so `google.chat` gained them too and the two cannot drift.
  `google.chat` on a TTS id without `["AUDIO"]` now names `google.tts` and
  `unmodel/tts` in the error.

  **New: `stt` at `unmodel/google`** (plus `checkStt`, `generateSttUrl`). 13
  curated Gemini ids; the 6 audio-capable ids it deliberately does not serve are
  listed **by name and reason** (`gemini-3.1-flash-live-preview` and
  `gemini-3.5-live-translate-preview` are Live API/WebSocket, `gemini-embedding-2`
  is `:embedContent`, `gemini-robotics-er-1.6-preview` has no documented
  transcription behaviour, the two Deep Research previews are an agentic surface),
  and a drift test asserts every audio-input catalog id is curated **or**
  excluded — a codegen refresh has to classify a new model, not absorb it.
  `contents` narrows to text and audio parts only, `inlineData.mimeType` is the
  closed seven-value audio set, and `audioTranscriptionConfig` is fully typed:
  its acceptance on the **unary** route was verified against the live API (200
  for `{ wordTimestamp, diarization }`, and Google 400s unknown fields, so
  acceptance is proof) rather than inferred from the Live API's docs.

  **Both unified packs grew**: `unmodel/tts` 14 → **15** providers,
  `unmodel/stt` 11 → **12**. `tts({ model: "google/…" })` maps `voice`,
  `outputFormat`, `language` (via the primary subtag, warning on a dropped
  regional one) and nests the extras; `stt({ model: "google/…" })` maps
  `language`/`languages`/`timestamps: "word"`/`diarization.enabled` onto
  `audioTranscriptionConfig`.

  ## 3. The `data` audio-input kind

  `AudioInputKind` gains a fourth member, `"data"` — `{ data, mimeType? }`,
  `DataRef` verbatim, the same shape `image`, `image-edit` and `video` already
  carry. `mimeType` is optional in the vocabulary and required by whichever
  adapter cannot sniff the format; Gemini's refusal names all seven MIME
  spellings it takes.

  This retires a real wart: **inworld's `audioInputs` was `[]`** — a provider
  registered in the STT pack that no canonical request could reach, because its
  route takes base64 in the JSON body and the vocabulary had no word for that.
  It is now `["data"]` and `stt({ model: "inworld/inworld/inworld-stt-1", audio:
{ data } })` compiles and validates. `google.stt` declares
  `["data", "fileId"]`; `{ url }` is refused with the Files-API upload path
  spelled out, because `fileData.fileUri` is a Files API name and Gemini fetches
  no third-party host.

  ## 4. `computeCostUSD` prices audio input

  `TokenBreakdown` gains an **`audioInputTokens`** slot, re-rated the way
  `cachedInputTokens` already is: subtracted from fresh input and billed at the
  catalog's `inputAudio` rate, falling back to `input` where a model publishes
  none. It is the first consumer of the `inputAudio` rates the hand catalogs have
  been carrying.

  `google.stt` fills it: audio tokens are `ceil(durationSeconds × 32)` — 32
  tokens per second, documented — read from `options.media`. Declaring a duration
  turns the estimate into a real number:

  ```ts
  stt.safe(params, {
    media: [{ path: ["contents", 0, "parts", 0], durationSeconds: 600 }],
  });
  // estimate: { inputTokens: 19204, costUSD: 0.18304120000000002 }
  ```

  Duration is the caller's to declare, so an undeclared clip is normally silent —
  except with `maxCostUSD` set, where the same call now warns
  (`media_duration_undeclared`) rather than passing a budget check made on a known
  undercount. `checkChat` / `checkStt` also read the real per-modality counts
  Gemini returns in `usageMetadata.promptTokensDetails`.

  ## Budgets

  Three committed bundle budgets moved, each set to measured × 1.07 with the
  module-naming rationale the file demands:

  | entry            | old     | new     | why                                                                                                                                                                                                                              |
  | ---------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `unmodel/google` | 235 KiB | 310 KiB | two new endpoints and their leaves — `tts.ts`, `stt.ts`, `tts-checks.ts`, `tts-check.ts`, `tts-models.ts`, `tts-constraints.ts`, `audio-constraints.ts`. All google's own; nothing foreign leaked in                             |
  | `unmodel/tts`    | 430 KiB | 500 KiB | Gemini's hand TTS catalog and the 78-language table. The zero-catalog pin **stays** — the pack still reaches no generated catalog, which is why `tts-constraints.ts` is an import-free leaf rather than part of `constraints.ts` |
  | `unmodel/stt`    | 420 KiB | 520 KiB | `google.stt` reads the generated `google.gen` catalog (there is no doc correction to make, so hand rows would be a second opinion on generated data — the `mistral.gen` precedent)                                               |

- 9c32ad2: **Every type unmodel knows is now importable without importing unmodel.**
  `unmodel/<provider>/types` (70 new subpaths) and `unmodel/types` (one hub) are
  type-only entries: they emit an **empty JavaScript module**, so the whole
  surface is free at runtime.

  They exist for the developer who wants the doc-corrected request shapes and is
  sending the request themselves — with `fetch`, with the vendor SDK, or through
  a client they already have. Nothing here is new _knowledge_; the types were
  already on the provider subpaths. What is new is that reaching them no longer
  means resolving a module that also carries a zod schema, a generated catalog
  and a validation pipeline, and that they are now uniformly discoverable.

  ```ts
  import type { ImageBody } from "unmodel/openai/types";

  const body = {
    model: "gpt-image-2",
    prompt: "a lighthouse at dusk",
    size: "3840x1280",
    background: "transparent",
  } satisfies ImageBody;
  // Type '"transparent"' is not assignable to type '"auto" | "opaque" | null | undefined'.
  ```

  That error is the product: `gpt-image-2` returns a 400 for a transparent
  background, so the type does not have the value — while `size` stays open to
  the whole documented `WIDTHxHEIGHT` rule space. `satisfies` rather than an
  annotation, so the literal types survive.

  **Two families of name, and the difference is deliberate.** Each provider entry
  re-exports that provider's **wire names verbatim** (`MessagesBody`,
  `ListenParams`, `Flux2Body`, `GenerateTtsBody`) — they are how you find the
  endpoint in the vendor's own documentation, and `docs/decisions.md` §2 is why
  they are not respelled. Alongside them, one uniform **`<Endpoint>Body` alias per
  endpoint address** the provider serves, named after the word you already type at
  `unmodel/<provider>` and `unmodel validate`: `ChatBody`, `TtsBody`, `SttBody`,
  `ImageBody`, `ImageEditBody`, `VideoBody`, `MusicBody`, plus the qualified
  extras (`ImageFlux1Body`, `TtsStreamBody`, `VideoV3FromImageBody`,
  `ImageEditSearchAndReplaceBody`, `RealtimeSessionBody`, …). 155 endpoint
  addresses across 65 providers; 149 new alias declarations, 6 names that already
  were the wire spelling, and 5 more `ChatBody` aliases for the factory-configured
  providers that have no CLI endpoint id (amazon-bedrock, azure,
  cloudflare-workers-ai, google-vertex, openai-compatible) — 154 alias
  declarations in all. Every one is a pure `export type X = Y`: an addition,
  never a rename.

  Six of those names were **already** the provider's wire spelling — cohere's
  `ChatBody`, fish-audio's and hume's and smallest-ai's `TtsBody`, openai's
  `ImageEditBody` and `RealtimeSessionBody`. There, the wire name wins and _is_
  the alias; declaring a second one would be the rename the law forbids.

  Generic wire types stay generic through the alias, so the escape hatches
  survive: `ImageBody<"gpt-image-9">` opts into the future-model arm exactly as
  `ImagesBody<"gpt-image-9">` does, and the 31 OpenAI-compatible overlays get
  `ChatBody<ModelId>` defaulted to **their own** catalog union — `unmodel/xai/types`
  completes Grok ids, `unmodel/groq/types` completes Groq's, from the same shared
  dialect leaf their validators check against. Those overlays also surface the
  chat dialect's message, content-part and tool types for the first time on their
  own subpath; previously they were reachable only via
  `unmodel/openai-compatible`.

  **`unmodel/types` is the hub, and it is small on purpose.** It carries the
  canonical camelCase vocabulary the unified surfaces speak — `ChatParams`,
  `TtsParams`, `SttParams`, `ImageParams`, `ImageEditParams`, `VideoParams`,
  `MusicParams`, and the words they are built from (`AspectRatio`, `AudioFormat`,
  `Voice`, `Diarization`, `Dimensions`, the media input refs) — the
  `"provider/model"` ref unions (`ChatModelRef`, `ChatProviderId`), the result
  vocabulary (`Issue`, `ValidateResult`, `ResponseReport`, `UsageReport`,
  `TranslationWarning`, `Retargeted`, `SdkTargetId`, `ApiTargetId`) and the
  catalog/constraint shapes.

  It does **not** aggregate provider wire types, and that is the whole design.
  The 70 provider entries carry ~2,140 type exports between them; one module
  naming all of them is a ~900 KB declaration file that every consumer would
  have to parse to reach one interface. Per-provider entries mean
  you pay for the provider you call: the hub declares ~307 KiB (against 233 KiB
  for the root `unmodel` entry it extends), and the fattest provider types entry
  is ~298 KiB, dominated by that provider's own generated model-id union.

  **The guarantees are tested, not asserted.** `test/types-entries.test.ts` pins,
  against a real build:
  - **zero runtime** — every one of the 71 built entries is an empty JavaScript
    module, and every source file contains `import type` / `export type`
    statements and nothing else (under `verbatimModuleSyntax` a value import here
    would be a value import in the output);
  - **completeness drift** — the endpoint list comes from `src/cli-registry.ts`,
    so a new endpoint that lands without its `<Endpoint>Body` fails the build
    rather than shipping a release behind;
  - **packaging** — every entry has its `exports` subpath and its tsdown entry.

  `test/import-graph.test.ts` adds amendment A8: a provider types entry may name
  only its own directory, its own generated catalog and the two structural
  dialect bases (`openai-compatible`, and `google` for `google-vertex`); the hub
  may name no provider at all. `test/bundle-budget.test.ts` pins the declaration
  budgets, including the rule that a types entry can never cost more than that
  provider's main entry. `test/types/types-entries.test-d.ts` checks the aliases
  resolve to the wire types they claim to be — the one thing a regex over the
  source cannot see.

  Runtime values are unchanged and stay where they were: URL constants, `check*`
  helpers, `toFormData`, the models tables and the validators remain on
  `unmodel/<provider>`, which tree-shakes to the few bytes a URL string costs.
  Nothing was renamed, moved or removed.

- b7837fd: **New: seven standardized surfaces that compile to any provider's exact wire
  body** — `unmodel/chat`, plus one pack per media category.

  unmodel's per-provider validators exist because they mirror a wire format
  _exactly_: `unmodel/anthropic`'s `chat()` takes `max_tokens` and `cache_control`
  because that is what `POST /v1/messages` takes, and a validator that renamed
  things would be lying about the request it validates. That stays the default and
  it is not going away. These entries are the other half of the trade — **one**
  camelCase vocabulary, and the compiler emits whichever wire body the model ref
  names:

  ```ts
  import { chat } from "unmodel/chat";

  const req = chat({
    model: "anthropic/claude-opus-5",
    messages: [{ role: "user", content: "Explain retargeting." }],
    reasoning: { budgetTokens: 2048 },
    maxOutputTokens: 4096,
  });

  req.request.url; // https://api.anthropic.com/v1/messages
  JSON.stringify(req); // {"model":"claude-opus-5","max_tokens":4096,…,
  //  "thinking":{"type":"enabled","budget_tokens":2048}}
  ```

  Change the ref to `"openai/gpt-5.2"` and the same object compiles to
  `max_completion_tokens` + `reasoning_effort: "low"` at
  `api.openai.com/v1/chat/completions`, with an `approximated_param` warning
  naming both the requested budget and the bucket it landed in. That is the entire
  proposition.

  **New package exports**

  | Entry                  | Function(s)                    | Providers              |
  | ---------------------- | ------------------------------ | ---------------------- |
  | `unmodel/chat`         | `chat`                         | 32                     |
  | `unmodel/chat/factory` | `createChat`                   | whichever you register |
  | `unmodel/image`        | `image`, `createImage`         | 15                     |
  | `unmodel/tts`          | `tts`, `createTts`             | 14                     |
  | `unmodel/stt`          | `stt`, `createStt`             | 11                     |
  | `unmodel/video`        | `video`, `createVideo`         | 10                     |
  | `unmodel/image-edit`   | `imageEdit`, `createImageEdit` | 4                      |
  | `unmodel/music`        | `music`, `createMusic`         | 2                      |

  …plus `unmodel/<provider>/unified` for each of the 36 providers that ship an
  adapter, and `unified.image` / `unified.imageEdit` / `unified.music` /
  `unified.tts` / `unified.stt` / `unified.video` on `unmodel validate`.

  **The result is a provider result.** A unified call does not validate the
  request itself. It compiles the canonical params to the provider's wire params
  and then runs **that provider's own validator** — the same `image()` from
  `unmodel/openai` you would have called by hand, with its catalog, its constraint
  tables, its media limits and its cost estimate. So there is no second definition
  of what a valid request is and the two cannot disagree, and what comes back is
  an ordinary `Validated`: enumerable properties are the provider's exact wire
  body, `.request` is its URL/method/static headers, `.toSdk(target)` is its SDK
  shape. Dropping to the wire layer is deleting one import, not a migration.

  **The ref convention.** `model` is `"provider/model"`, split on the **first**
  slash. OpenRouter's own ids contain slashes, so
  `"openrouter/anthropic/claude-opus-5"` is provider `openrouter`, model
  `anthropic/claude-opus-5`; splitting on the last slash — the obvious
  implementation — would route it to a provider called `openrouter/anthropic`. The
  generated ref unions drive autocomplete but never gate the API, so a model
  released after the catalog snapshot is still callable. `unmodel/chat`'s return
  type is keyed off the provider half at the type level: `"anthropic/…"` is typed
  as a `/v1/messages` body, `"google/…"` as a Gemini body with no `model` key (it
  lives in the URL), everything else as chat-completions, and an unrecognised
  provider degrades to the union of the three rather than to `any`.

  **The loss policy, in three rules.** A param the provider cannot express at all
  is an **error** naming what it does offer. A value it can only express
  approximately is an `approximated_param` **warning** naming both the requested
  and the achieved value. Everything else is silent. So `warnings.length === 0`
  _means_ the request mapped exactly — asserted per category by a golden matrix
  that compiles one canonical request at every provider that can express it.

  ```ts
  image({
    model: "black-forest-labs/flux-pro-1.1",
    prompt: "…",
    aspectRatio: "16:9",
    resolution: "1k",
  }).warnings;
  // [approximated_param] `aspectRatio` 16:9 at 1k does not land on this model's
  // 32px grid: 1344×768 (1.750:1, requested 1.778:1).

  image({ model: "openai/gpt-image-1", prompt: "…", seed: 7 });
  // throws: `seed` is not supported by "openai/gpt-image-1" — POST
  // /v1/images/generations has no seed field, so a seed could only be dropped.
  ```

  **`providerOptions` is the escape hatch, and it is still validated.** Anything
  genuinely one-off — OpenAI's `store`, OpenRouter's `provider` routing block,
  Vidu's reference `images` — rides in a bucket keyed by provider id, deep-merged
  over the compiled body **before** validation, so it goes through the provider's
  own checks rather than around them. Buckets that do not match the ref are inert,
  so one request object can carry tuned settings for several providers and stay
  portable.

  **Narrowings that happen at compile time.** `audio` narrows to the STT
  route (AssemblyAI fetches a URL, Cartesia takes multipart bytes, Soniox takes a
  URL or its own file id, Mistral takes all three); `image` narrows the same way
  in `unmodel/image-edit`; `aspectRatio` and `dimensions` are an XOR; the presence
  of `image` / `video` chooses the video endpoint, and a model with no arm for the
  derived route says so by name; `operation` is `"edit"` and only `"edit"` in v1.
  One declaration drives both halves in each case — the same array types the
  caller's field and backs it at run time with a message naming the shapes the
  route does take, for JavaScript callers and refs built at run time.

  **What each vocabulary actually buys**, in one line per category — these are the
  translations that would otherwise be hand-written per provider:
  - **chat** — `maxOutputTokens` is `max_completion_tokens` / `max_tokens` /
    `generationConfig.maxOutputTokens`; `temperature` is canonical 0–2 and clamps
    (never rescales) to Anthropic's ceiling of 1 with a warning; `reasoning`
    buckets a token budget into `reasoning_effort` where no budget field exists;
    `tools` is a `Record` so duplicate names are unrepresentable rather than
    detectable; `cache` breakpoints reach `cache_control`, `cachePoint` and
    `prompt_cache_breakpoint`.
  - **image / image-edit** — `aspectRatio` XOR `dimensions` plus a `resolution`
    tier compiles to all six shapes a provider might offer: a closed ratio enum, a
    grid-snapped pixel pair, a documented size enum, a free-form `WxH`, an open
    ratio string with numeric bounds, and a bare tier name.
  - **image-edit** — `strength` means one thing in one direction: `0` keeps the
    source, `1` ignores it. Ideogram's `image_weight` runs **backwards**, so
    `strength: 0` compiles to `image_weight: 100`. Every adapter declares its
    scale as the wire values at canonical 0 and 1, so the inversion is one number
    swapped rather than a minus sign hidden in a branch, and the capability sweep
    asserts the direction by compiling two requests and checking which way the
    wire value moves.
  - **video** — `duration` is a plain number of seconds and compiles to five wire
    shapes: `8`, `"8"`, `"8s"`, a nested `settings.duration`, and the documented
    `null` "automatic duration". A duration a model does not offer is an
    `invalid_enum_value` listing the ones it does — never the nearest, because a
    9-second clip is not approximately a 5-second one at any price.
  - **stt** — `diarization: { enabled: true }` reaches a flag
    (`speaker_labels`, `diarize`, `enable_speaker_diarization`), an enum
    (`diarization: "speaker"`), an **inverted** flag (`skip_diarization: false`)
    and a flag-plus-config-object; `timestamps: "word"` is an array at OpenAI, a
    scalar enum at ElevenLabs, a boolean at Deepgram, and free at the four routes
    that report word timings unconditionally — where `timestamps: "segment"` is an
    error naming what they _do_ report.
  - **music** — the unit is in the name: `durationSeconds: 90` is
    `music_length_ms: 90000` at ElevenLabs and `duration: 90` at Stability. The
    conversion is exact and therefore silent; a length that lands between two
    milliseconds is refused rather than rounded.
  - **tts** — `outputFormat` reconciles container, sample rate and bitrate
    across fourteen providers that each publish a different subset; a provider
    with no speaking-rate field says so instead of dropping `speed`.

  **Bundle cost is opt-in and pinned.** Per-provider entries carry none of this;
  the adapters live in their own `unified-<category>.ts` modules behind the
  separate `unmodel/<provider>/unified` export, and `test/bundle-budget.test.ts`
  holds every entry — provider and pack alike — to a committed byte budget
  measured over the real `dist/` import graph. Measured today, unminified ESM with
  `zod` excluded: chat 1718.7 KiB (`chat/factory` 144.0), image 755.7, video
  614.4, tts 409.8, stt 401.7, image-edit 276.1, music 149.8. A pack is
  the whole category;
  `createTts([openai, rime])` and its siblings pay only for the providers you
  register.

  **Declared gaps, each a typed refusal rather than a surprise.**
  `inworld.stt` carries base64 audio inside its JSON body, which a
  synchronous compile step cannot produce from a `Blob`; Black Forest Labs'
  Kontext `input_image` is a JSON string, so its `imageInputs` is
  `["data", "url"]` and `{ file }` does not type-check; Recraft's `strength` is
  required with no documented default, so a request without one is an error rather
  than a number unmodel picked; Stability's `musicFromAudio` / `musicInpaint` and
  the sixteen masked editing routes take controls no other provider has, so they
  stay reachable by name at `unmodel/<provider>` where they work perfectly well.

  **No `.toApi()` on a unified _media_ result, deliberately.** A provider result
  offers `.toApi(target)` because it starts in one dialect and may want another.
  A unified media result has no dialect to leave: retargeting it means changing
  `model` and calling again, which is a string edit rather than an API — and
  adding `.toApi` would bundle the availability tables the six media packs exist
  without. `unmodel/chat` is the exception and pays for it on purpose: it returns
  the provider's own `Validated`, so `.toApi` and `.toSdk` are there because they
  were never removed. See the `chat-composition` changeset.

  ## `unmodel/image` knows what _one model_ takes

  The two image surfaces narrow per **model**, not per provider — because that is
  where the disagreement actually is. `gpt-image-2` takes a free-form `size` up to
  3840 px and a `background` of `"opaque" | "auto"`; `gpt-image-1` — same
  provider, same endpoint — takes a three-value `size` enum and a `background`
  that also accepts `"transparent"`. One adapter, two request surfaces, and the
  difference is the model id.

  ```ts
  image({ model: "openai/gpt-image-2", prompt, size: "3840x2160" });
  //                                          ^ that model's own presets

  image({ model: "openai/gpt-image-1", prompt, background: "transparent" }); // ok
  image({ model: "openai/gpt-image-2", prompt, background: "transparent" }); // compile error
  ```

  That second line is the whole argument for this library in one call. The OpenAI
  SDK's own type offers `transparent` on every GPT image model; gpt-image-2
  answers a 400 — _"Requests with `background` set to `transparent` will return an
  error for these models; use `opaque` or `auto` instead"_ — which unmodel keeps
  as a recorded fixture.

  **What narrows.** `size` (a new canonical field, joining `aspectRatio` and
  `dimensions` in the XOR — three spellings of one decision, at most one given),
  `aspectRatio`, `resolution`, and the per-model params the canonical vocabulary
  has no word for. `size` is a string on purpose: `"3840x2160"` is what the docs,
  the dashboards and the models themselves call it, and one token autocompletes
  where a `{ width, height }` pair cannot.

  **The presets are provable.** A closed enum gets no template tail — the list
  _is_ the limit, so `size: "1920x1080"` does not compile on `dall-e-3`. A
  free-form field gets `` `${number}x${number}` `` beside the presets, because it
  genuinely accepts more than the list; there `"1920x1080"` compiles and fails at
  run time on gpt-image-2's own 16-px rule, which is why it is absent from the
  presets and `"2560x1440"` is in them. Every preset in every table — across all
  19 adapters — is compiled through the adapter and run past the provider's own
  validator, with zero errors and zero warnings, in
  `test/unified/image-presets.test.ts`.

  **The extras are identity, and still checked.** A per-model param is already
  spelled the way the provider spells it, so it goes on the wire unchanged, before
  `providerOptions` is merged (which therefore still wins). The provider's own
  schema and deny tables then re-check it: a JavaScript caller who passes
  `background: "transparent"` to gpt-image-2 gets the same refusal a TypeScript
  caller got at compile time. An extra sent to a model that does not take it is an
  `unsupported_param` naming the models that do.

  Unknown and run-time-built refs degrade to the wide vocabulary, exactly as an
  unrecognised model already does: the union drives autocomplete, it does not gate
  the API.

- b7837fd: **Breaking: every endpoint is now addressed by its category's verb.**

  An endpoint id is public API twice over — it is what `unmodel validate <id>`
  takes on the command line, and it is the route label the availability data and
  `.toApi` warnings name — so this is the migration guide, and it is complete.
  `src/cli-registry.test.ts` is the same list made executable: it pins every
  current id and asserts every retired one is gone.

  **The law.** An endpoint's _address_ is uniform across providers even where the
  wire spelling is not. Fifty-plus providers had spelled the same six operations
  about thirty different ways — a wire path (`imageToImage`, `text2video`), a
  product family (`fluxKontext`, `krea2`), a bare verb (`edit`, `listen`,
  `speak`), a plural noun (`images`, `videos`, `jobs`, `generations`) and a noun
  phrase (`replaceBackground`, `contentGenerationTasks`). All of them now address
  their category as `chat`, `image`, `imageEdit`, `tts`, `stt`, `video`
  or `music`, with each _extra_ route at a provider qualified by what makes it
  different — never the primary one, so the word a caller reaches for first is the
  same word everywhere.

  **Wire-shaped names deliberately did not move.** `MESSAGES_URL`,
  `GenerateContentBody`, `ConverseParams`, `IMAGES_GENERATIONS_URL`, `Flux2Body`,
  `TEXT2VIDEO_URL`, `STABLE_AUDIO_TEXT_TO_AUDIO_URL`, `AUDIO_TRANSCRIPTIONS_URL`,
  `IDEOGRAM_V3_REMIX_URL`, `StableImageEraseParams`, `JobConfig`, the dialect ids
  — all unchanged. The rule is _address-shaped names go uniform, wire-shaped names
  keep the wire spelling_, and the reason is that those two kinds of name answer
  different questions: an address is "which endpoint do I call", and it should
  read the same at every provider; a wire name describes the bytes on the wire,
  and respelling it would make the type lie about the request. `docs/decisions.md`
  records this as a standing decision so it does not get "corrected" later.

  ## Chat

  | old                             | new                   |
  | ------------------------------- | --------------------- |
  | `anthropic.messages`            | `anthropic.chat`      |
  | `google.generateContent`        | `google.chat`         |
  | `google-vertex.generateContent` | `google-vertex.chat`  |
  | `amazon-bedrock.converse`       | `amazon-bedrock.chat` |

  `openai.chat`, `cohere.chat`, `azure.chat`, `cloudflare-workers-ai.chat` and
  every one of the 29 OpenAI-compatible overlays already had the uniform name.
  The checkers and constraint tables move with the endpoints:
  `anthropic.checkMessages`, `google.checkGenerateContent` and
  `amazon-bedrock.checkConverse` are all `checkChat` now (matching
  `openai.checkChat`), `messagesConstraints` / `generateContentConstraints` are
  `chatConstraints`, `messagesFamilyRules` is `chatFamilyRules`, the
  `MessagesSdkTargets` type is `ChatSdkTargets`, and the Bedrock factory's
  `AmazonBedrockConverse` type is `AmazonBedrockChat`.

  Two **retarget route labels** in the generated availability data changed with
  them, because Vertex serves three different wire surfaces and the label has to
  say which:

  | old label                       | new label                      | what it means                                                                                                                                                                                                                                  |
  | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `google-vertex.generateContent` | `google-vertex.chat`           | Gemini on Vertex — the surface `createGoogleVertex(…).chat` validates                                                                                                                                                                          |
  | `google-vertex.chat`            | `google-vertex.chatMaas`       | the OpenAI-compatible MaaS surface Vertex serves `*-maas` models on                                                                                                                                                                            |
  | —                               | `google-vertex.chatRawPredict` | new, and dormant: the Anthropic-shaped `rawPredict` route Claude-on-Vertex uses. unmodel has no module for it, so those rows stay denied in `data/availability-overrides.json`; the label exists so the rule is already correct when one lands |

  ## TTS (text to speech)

  | old                                                 | new                                   |
  | --------------------------------------------------- | ------------------------------------- |
  | `elevenlabs.textToSpeech`                           | `elevenlabs.tts`                      |
  | `cartesia.tts`                                      | `cartesia.tts`                        |
  | `deepgram.speak`                                    | `deepgram.tts`                        |
  | `hume.tts`                                          | `hume.tts`                            |
  | `minimax.t2a`                                       | `minimax.tts`                         |
  | `rime.tts`                                          | `rime.tts`                            |
  | `fish-audio.tts`                                    | `fish-audio.tts`                      |
  | `smallest-ai.tts`                                   | `smallest-ai.tts`                     |
  | `inworld.tts`                                       | `inworld.tts`                         |
  | `murf.speechGenerate`                               | `murf.tts`                            |
  | `resemble.synthesize` / `resemble.synthesizeStream` | `resemble.tts` / `resemble.ttsStream` |
  | `speechify.stream`                                  | `speechify.ttsStream`                 |

  `openai.tts`, `lmnt.tts`, `lmnt.ttsDetailed`, `murf.ttsStream` and
  `speechify.tts` were already spelled with the category's verb and moved with
  it. The rows where old and new read alike are the providers whose own wire word
  was already `tts`. Constraint tables and checkers follow:
  `elevenlabs.textToSpeechConstraints` → `ttsConstraints` (likewise cartesia,
  rime, smallest-ai, inworld), and `resemble.checkSynthesis` → `checkTts`,
  matching `murf.checkTts`.

  ## STT (speech to text)

  | old                       | new                |
  | ------------------------- | ------------------ |
  | `openai.transcription`    | `openai.stt`       |
  | `mistral.transcription`   | `mistral.stt`      |
  | `elevenlabs.speechToText` | `elevenlabs.stt`   |
  | `soniox.transcriptions`   | `soniox.stt`       |
  | `deepgram.listen`         | `deepgram.stt`     |
  | `assemblyai.transcript`   | `assemblyai.stt`   |
  | `gladia.preRecorded`      | `gladia.stt`       |
  | `revai.jobs`              | `revai.stt`        |
  | `speechmatics.jobs`       | `speechmatics.stt` |
  | `cartesia.stt`            | `cartesia.stt`     |

  `inworld.stt` moved with the rest of the category; `cartesia.stt` reads alike in
  both columns because `stt` was already Cartesia's own wire word.
  `openai.transcriptionToFormData` moves with its endpoint to
  `openai.sttToFormData`.

  ## Image generation

  | old                                                                 | new                                                        |
  | ------------------------------------------------------------------- | ---------------------------------------------------------- |
  | `openai.images`                                                     | `openai.image`                                             |
  | `google.generateImages`                                             | `google.image`                                             |
  | `black-forest-labs.flux2` / `black-forest-labs.flux1`               | `black-forest-labs.image` / `black-forest-labs.imageFlux1` |
  | `ideogram.generate` / `ideogram.generateV4`                         | `ideogram.image` / `ideogram.imageV4`                      |
  | `recraft.generations`                                               | `recraft.image`                                            |
  | `stability.stableImageUltra` / `stableImageCore` / `stableImageSd3` | `stability.image` / `imageCore` / `imageSd3`               |
  | `luma.imageGenerations`                                             | `luma.image`                                               |
  | `bytedance.imageGenerations`                                        | `bytedance.image`                                          |
  | `runway.textToImage`                                                | `runway.image`                                             |
  | `kling.imageGenerations` / `kling.omniImage`                        | `kling.image` / `kling.imageOmni`                          |
  | `vidu.reference2image`                                              | `vidu.imageFromReference`                                  |
  | `bria.imageGenerate` / `bria.imageGenerateLite`                     | `bria.image` / `bria.imageLite`                            |
  | `leonardo.generations`                                              | `leonardo.image`                                           |
  | `krea.krea2`                                                        | `krea.image`                                               |
  | `reve.create` / `reve.createV2`                                     | `reve.image` / `reve.imageV2`                              |

  Constraint tables move with them (`openai.imagesConstraints` →
  `imageConstraints`, likewise google, black-forest-labs, bytedance, runway and
  recraft's family rules).

  ## Image editing

  Twenty-six routes across eight providers, each extra one qualified by _what it
  does to the picture_ rather than by the wire path or the vendor's product name.

  | old                                     | new                                      |
  | --------------------------------------- | ---------------------------------------- |
  | `black-forest-labs.fluxKontext`         | `black-forest-labs.imageEdit`            |
  | `black-forest-labs.fluxFill`            | `black-forest-labs.imageEditFill`        |
  | `black-forest-labs.fluxExpand`          | `black-forest-labs.imageEditExpand`      |
  | `black-forest-labs.fluxErase`           | `black-forest-labs.imageEditErase`       |
  | `black-forest-labs.fluxDeblur`          | `black-forest-labs.imageEditDeblur`      |
  | `black-forest-labs.fluxOutpainting`     | `black-forest-labs.imageEditOutpainting` |
  | `black-forest-labs.fluxVto`             | `black-forest-labs.imageEditVto`         |
  | `ideogram.edit`                         | `ideogram.imageEdit`                     |
  | `ideogram.remix`                        | `ideogram.imageEditRemix`                |
  | `ideogram.reframe`                      | `ideogram.imageEditReframe`              |
  | `ideogram.replaceBackground`            | `ideogram.imageEditReplaceBackground`    |
  | `recraft.imageToImage`                  | `recraft.imageEdit`                      |
  | `recraft.inpaint`                       | `recraft.imageEditInpaint`               |
  | `recraft.outpaint`                      | `recraft.imageEditOutpaint`              |
  | `recraft.generateBackground`            | `recraft.imageEditGenerateBackground`    |
  | `recraft.replaceBackground`             | `recraft.imageEditReplaceBackground`     |
  | `stability.stableImageErase`            | `stability.imageEditErase`               |
  | `stability.stableImageInpaint`          | `stability.imageEditInpaint`             |
  | `stability.stableImageOutpaint`         | `stability.imageEditOutpaint`            |
  | `stability.stableImageSearchAndReplace` | `stability.imageEditSearchAndReplace`    |
  | `stability.stableImageSearchAndRecolor` | `stability.imageEditSearchAndRecolor`    |
  | `stability.stableImageRemoveBackground` | `stability.imageEditRemoveBackground`    |
  | `luma.reframeImage`                     | `luma.imageEditReframe`                  |
  | `reve.edit`                             | `reve.imageEdit`                         |
  | `reve.remix`                            | `reve.imageEditRemix`                    |

  `openai.imageEdit` and `bria.imageEdit` already had the uniform name, and
  `openai.imageEditToFormData` is unchanged.

  ## Video

  | old                                                          | new                                                                    |
  | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
  | `openai.videos`                                              | `openai.video`                                                         |
  | `google.generateVideos`                                      | `google.video`                                                         |
  | `bytedance.contentGenerationTasks`                           | `bytedance.video`                                                      |
  | `runway.textToVideo` / `imageToVideo` / `videoToVideo`       | `runway.video` / `videoFromImage` / `videoFromVideo`                   |
  | `kling.textToVideo` / `imageToVideo`                         | `kling.video` / `videoFromImage`                                       |
  | `kling.textToVideoV3` / `imageToVideoV3` / `omniVideo`       | `kling.videoV3` / `videoV3FromImage` / `videoOmni`                     |
  | `luma.generations`                                           | `luma.video`                                                           |
  | `luma.modifyVideo` / `reframeVideo` / `upscale` / `addAudio` | `luma.videoModify` / `videoReframe` / `videoUpscale` / `videoAddAudio` |
  | `minimax.videoGeneration` / `videoGenerationV2`              | `minimax.video` / `videoV2`                                            |
  | `vidu.text2video` / `img2video` / `reference2video`          | `vidu.video` / `videoFromImage` / `videoFromReference`                 |
  | `pixverse.textToVideo` / `imageToVideo`                      | `pixverse.video` / `videoFromImage`                                    |
  | `lightricks.textToVideo` / `imageToVideo` / `audioToVideo`   | `lightricks.video` / `videoFromImage` / `videoFromAudio`               |

  Constraint tables move with them (`openai.videosConstraints` →
  `videoConstraints`, google's `generateVideosConstraints` / `FamilyRules` /
  `Models`, runway's three `*Constraints` / `*Required` / `*ShapeRules` triples,
  bytedance's `contentGenerationTasksConstraints`, luma's
  `modifyVideoConstraints`, vidu's three).

  ## Music

  | old                                 | new                        |
  | ----------------------------------- | -------------------------- |
  | `stability.stableAudioTextToAudio`  | `stability.music`          |
  | `stability.stableAudioAudioToAudio` | `stability.musicFromAudio` |
  | `stability.stableAudioInpaint`      | `stability.musicInpaint`   |

  `elevenlabs.music` already had the uniform name.

  ## What did _not_ get renamed

  **The realtime surfaces**, on purpose: a socket config is a different endpoint
  from a batch POST, and folding them in would make `tts` and `stt` each
  mean two transports. `openai.realtimeSession`, `elevenlabs.textToSpeechStreamInput`,
  `elevenlabs.speechToTextRealtime`, `soniox.realtimeTranscription`,
  `deepgram.listenLive` / `listenFlux` / `fluxConfigure` / `speakLive`,
  `cartesia.ttsWebsocket` / `sttWebsocket`, `inworld.realtimeTranscribeConfig` and
  `inworld.realtimeVoiceContext` are all unchanged.

  **Module filenames moved with the addresses** — `messages.ts`, `converse.ts`,
  `generate-content.ts`, `images-edit.ts`, `kontext.ts`, `transform.ts`,
  `listen.ts`, `pre-recorded.ts`, `jobs.ts`, `stt.ts`, `audio.ts` and the rest are
  now named for the endpoint they serve. That is not cosmetic:
  `test/bundle-budget.test.ts` asserts a unified pack can only reach a provider
  through a file with the uniform name, so the rename is structural.

  ## Migrating

  Mechanically: rename the import, rename the CLI id, rename the checker. The
  params, the URL, the response and the `.toSdk` targets are all exactly what they
  were — this wave changed no wire format and no validation rule.

  ```diff
  - import { messages, checkMessages } from "unmodel/anthropic";
  + import { chat, checkChat } from "unmodel/anthropic";

  - import { generateImages } from "unmodel/google";
  + import { image } from "unmodel/google";

  - echo "$params" | unmodel validate openai.transcription
  + echo "$params" | unmodel validate openai.stt
  ```

- 90f2c5b: **The runtime lists behind the types: `unmodel/<provider>/values` and a
  `unmodel/values` hub.**

  `unmodel/<provider>/types` gave a client-side app the shapes. It could not give
  it the _values_: which voices `openai/gpt-4o-mini-tts` has, which sizes
  `gpt-image-2` takes, which durations `kling-v2-5-turbo-pro` allows. A type
  cannot be mapped over, so every app that wanted a picker retyped the list by
  hand — and that copy is wrong the day a provider adds a voice.

  Those lists now ship as arrays. 36 providers — exactly the ones with a unified
  adapter — publish `unmodel/<provider>/values`, and every entry names the same
  uniform exports for each category it serves:

  ```tsx
  import { TTS_MODELS, TTS_MODEL_PARAMS } from "unmodel/openai/values";

  <select name="voice">
    {TTS_MODEL_PARAMS["gpt-4o-mini-tts"].voices.map((v) => (
      <option key={v}>{v}</option>
    ))}
  </select>;
  ```

  `<CATEGORY>_MODEL_PARAMS` is the per-model narrowing table (voices, sizes,
  aspect ratios, durations, resolutions, codecs, languages, timestamp
  granularities and the per-model `extras`), `<CATEGORY>_MODELS` is the model-id
  list, and `<CATEGORY>_FORMAT_SPEC` is the audio format spec where the category
  has one — with `IMAGE_`, `IMAGE_EDIT_`, `VIDEO_`, `TTS_`, `STT_` and `MUSIC_`
  prefixes. Beside them, each entry re-exports that provider's own published enums
  under their own names (`GEMINI_TTS_VOICES`, `GPT_IMAGE_2_SIZES`,
  `BFL_ASPECT_RATIOS`, `RECRAFT_V3_STYLES`, `KLING_ASPECT_RATIOS`, …), including
  nine lists that existed but had never been reachable from any subpath.

  **They are the adapter's own objects, not copies.** `TTS_MODEL_PARAMS` is
  `===` the table `unmodel/tts` compiles with, so a picker built from it and the
  request built from the same params cannot disagree. That is asserted by
  reference in `test/values-entries.test.ts`, not by deep equality.

  **`unmodel/values`** is the canonical hub: the closed unions as arrays —
  `ASPECT_RATIO_PRESETS`, `RESOLUTION_TIERS`, `VIDEO_RESOLUTIONS`,
  `IMAGE_OUTPUT_FORMATS`, `OUTPUT_DELIVERIES`, `AUDIO_FORMAT_CODECS`,
  `AUDIO_CONTAINERS`, `TIMESTAMP_GRANULARITIES`, `AUDIO_INPUT_KINDS` — plus
  `CANONICAL_KEY_LISTS` (the exact params each category accepts, which is the list
  the kernel's envelope check is built from) and `CHAT_PROVIDERS`. Each array is
  proved equal to its union in **both** directions by a type test, so a word added
  to the vocabulary and forgotten in the array is a compile error rather than a
  picker that quietly offers eight options out of nine.

  **`unmodel/values/chat-refs`** carries `CHAT_MODEL_REFS`, the runtime twin of
  `ChatModelRef` — all 1,339 `"provider/model"` pairs `chat()` accepts, generated
  beside the union and asserted equal to it. It is a separate subpath because it is
  45 KiB: measured both ways, exporting it from the hub instead put all 1,339
  strings into `values/index.js` and took that entry from 2.4 KiB to 49.

  **Light bundles are the point, and they are measured.** A values entry that
  re-exported its lists from the modules that declare them would have dragged that
  provider's validator, zod schema and sometimes its generated catalog — 30–82 KiB
  for one array, measured. So the per-model tables moved out of the adapters onto
  import-free `<category>-params.ts` leaves that the adapters themselves import,
  and nine providers' value spaces moved out of validator modules onto import-free
  constraint leaves. The result, per single export, against a real build:

  | Import                              | Cost        |
  | ----------------------------------- | ----------- |
  | any array from `unmodel/values`     | 0.2–1.5 KiB |
  | the median provider export          | ~1 KiB      |
  | the worst (`unmodel/runway/values`) | 19.4 KiB    |
  | `CHAT_MODEL_REFS`                   | 49 KiB      |

  `test/values-entries.test.ts` runs that measurement for all 267 provider exports
  on every test run and holds each to a budget; `test/import-graph.test.ts`
  (amendment A9) holds the source-level rule that makes it possible — a values
  entry names only its own provider directory, and never an adapter.

  Nothing was renamed or removed. The six media packs and the provider entries
  carry the same modules they did; splitting the data onto its own leaves cost
  ~0.65 KiB per leaf in unminified ESM, which moved four pack budgets and is
  accounted for module by module where those budgets are declared.

- 53f3065: **Voice creation is now a first-class, validated capability — two new
  categories, thirteen new wire-exact endpoints, and the packs on top.**

  Creating a voice used to be the hole the library talked around: ElevenLabs'
  text-to-voice models sat in the catalog with a "which unmodel does not
  validate" note, Fish Audio's inline cloning payload was deliberately excluded
  from unified TTS, and Speechify's clone routes carried a `NOT VALIDATED HERE`.
  This wave closes it, in the order `docs/providers.md` has always prescribed:
  wire-exact subpaths first, adapters second.

  ## The wire wave — 13 endpoints across 7 providers

  Every shape was verified against the provider's API reference AND its official
  SDK types / OpenAPI (the resolver where the prose docs disagreed with
  themselves — Fish's `reference_text` cap is 150, not the feature page's 300;
  Cartesia's pre-2026 `mode`/`enhance`/`transcript` fields are gone; MiniMax's
  spelling is `need_volume_normalization`, whatever third-party samples say):
  - `elevenlabs.voiceClone` (POST /v1/voices/add — IVC, multipart),
    `elevenlabs.voiceDesign` (POST /v1/text-to-voice/design, with the
    ttv_v3-only field gate) and `elevenlabs.voiceDesignSave` (POST
    /v1/text-to-voice — the phase-2 save, deliberately wire-only).
  - `fish-audio.voiceClone` (POST /model — voices 1–20, the
    visibility-defaults-to-PUBLIC footgun warned on omission, cover_image
    required-if-public) and `fish-audio.voiceDesign` (POST /v1/voice-design,
    required `model: voice-design-1` header, $0.01/request estimated flat).
  - `inworld.voiceClone` (voices:clone — base64 samples, 4MB cap checked from
    the payload), `inworld.voiceDesign` (designPrompt 30–250) and
    `inworld.voiceDesignPublish` (the draft-voice save, wire-only).
  - `minimax.voiceClone` (POST /v1/voice_clone — the caller-chosen `voice_id`
    grammar enforced; preview text priced at the chosen speech model's rate;
    `toVoiceUploadFormData` builds the upload prerequisite) and
    `minimax.voiceDesign` (single-phase; preview text priced at $30/1M chars).
  - `cartesia.voiceClone` (POST /voices/clone, Cartesia-Version 2026-08-14,
    language REQUIRED from a closed 44-code list).
  - `lmnt.voiceClone` (POST /v1/ai/voice, lmnt-version 1.2 — the flat one-file
    form; the old files[]+metadata shape is not typed).
  - `speechify.voiceClone` + `speechify.voiceConsentChallenge` — the consent
    challenge/response ceremony, wire-exact, with the deprecated declarative
    `consent` JSON typed as such.

  Multipart endpoints ship `voiceCloneToFormData` helpers and sit in
  `MULTIPART_ONLY`; every endpoint has its `<Endpoint>Body` alias on
  `unmodel/<provider>/types`.

  ## The categories — `unmodel/voice-clone` and `unmodel/voice-design`

  Two categories, not one `voice()` with a mode flag, by the image-vs-imageEdit
  test: disjoint required fields (audio samples + name vs a text prompt),
  different wire routes at every provider serving both, different model lists —
  and one word, `description`, that means **metadata** on the clone side and
  **the generative prompt** on the design side. Both carry a required
  `operation` literal (`"clone"` / `"design"`) so future arms (remix, re-train)
  land without a break.
  - **`samples` narrows per model at compile time** — stt's `audioInputs`
    mechanism, one field over: `{ file }` at the multipart four, `{ data }` at
    Inworld, `{ fileId }` at MiniMax, with per-route counts (Fish 1–20,
    Cartesia/LMNT/MiniMax exactly one) enforced by the new
    `resolveVoiceSamples` with the bounds in the message.
  - **The wires' asymmetries are vocabulary, not trivia**: `visibility`
    (private/unlisted/public — Fish defaults public, Cartesia private),
    `voiceId` (required by MiniMax, the one wire where the caller mints the
    handle; refused by name everywhere else), per-sample `transcript` (Fish's
    parallel `texts[]`, Inworld's `transcription`, MiniMax's
    `text_validation`), and `previewText` (required at Inworld/MiniMax,
    `auto_generate_text: true` when omitted at ElevenLabs, refused at Fish).
  - **Phase 1 only, by charter.** The packs validate the generative request;
    the provider-minted handle that comes back is yours to use on `unmodel/tts`
    as `voice`. The two-phase saves are wire-only because their correlating
    handles share no vocabulary, and voice _management_ is out of scope.
  - Model refs where the wire has none use **synthetic route-shaped ids**
    (`elevenlabs/ivc`, `fish-audio/fast`, `cartesia/voice-clone`, …), now a
    documented convention in `src/providers/HAND_CATALOGS.md`.

  Both packs are budgeted (`voice-clone` ≤220 KiB, `voice-design` ≤190 KiB,
  measured with the accounting written down), golden-matrixed (one canonical
  request per case compiled at every provider that can express it, exact bodies
  committed), capability-probed (every `unsupported` declaration rejected at the
  canonical path by a real call), and type-tested (the sample-shape table in
  both directions, the ttv_v3 extras gate, the `prompt`/`description` word
  split).

  ## Knock-on structure, all of it measured
  - **minimax grew a `chat.ts` leaf** (the anthropic/google/openai pattern):
    the chat registry imported the minimax barrel, and the new voice validators
    would have ridden into every chat bundle. The import-graph and chat-graph
    tests now pin the leaf.
  - **fish-audio and lmnt split `unified-tts.ts` out of their barrels** for the
    same reason on the tts pack (494 KiB, back under its budget).
  - `inworld/audio-bytes.ts` and `minimax/models.ts` picked up one shared
    helper and one shared enum each, so the voice packs stopped paying ~50 KiB
    for an STT validator and a TTS validator they never call.
