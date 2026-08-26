---
"unmodel": minor
---

**v0.3.0 adopter feedback, all four tiers.** A production adopter filed twenty complaints and
requests against 0.3.0. Every one was verified against the repo, the published package and the
live provider APIs before anything was written; the ones that turned out to be real are below,
and so are the ones that turned out not to be, with the reason.

Five of these were bugs the complaints walked *past* rather than reported.

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
  Both interop encoders used to warn that the *other* dialect's field had no equivalent — a
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
  *reference*, not a first frame — recorded on the row), `fal-ai/kling-video/o1/video-to-video/edit`,
  `fal-ai/minimax/hailuo-2.3/pro/text-to-video`, `fal-ai/lightx/relight` and
  `topaz/upscale/video/generative`. Alongside them, the exclusion records go 9 → 66 and now
  *reach the caller*: an id unmodel deliberately declined arrives as ``unmodel deliberately does
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
