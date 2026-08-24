# unmodel

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
  *and* `.toApi(target)` are the provider's own, typed off its generated
  availability table. `chat({ model: "anthropic/claude-opus-5", … })
  .toApi("openrouter")` retargets a request you authored canonically, and
  `.toApi("groq")` on the same request is a compile error because the catalog
  says Groq does not serve that model. (This corrects the "no `.toApi()` on a
  unified result" note in the `unified-surfaces` changeset, which is now a
  statement about the six media packs only.)
  
  Issue paths still come back in the vocabulary you wrote: a finding the provider
  reports at `["max_completion_tokens"]` is returned at `["maxOutputTokens"]` —
  and the *message* now says which wire param it was compiled from, so a
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
      id: "openai", baseUrl: "…", catalog: myCatalog,
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
    OpenAI *and* all 30 OpenAI-compatible providers refuse a request their APIs
    400. It surfaces as `["reasoning"]` through `unmodel/chat`.
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
  address-vs-wire naming law applied to the category verb itself: the *addresses*
  move, the *wire* names do not.
  
  **The two subpaths:**
  
  | old | new |
  | --- | --- |
  | `unmodel/speech` | `unmodel/tts` |
  | `unmodel/transcribe` | `unmodel/stt` |
  
  `speech` / `createSpeech` are now `tts` / `createTts`; `transcribe` /
  `createTranscribe` are now `stt` / `createStt`. The CLI ids moved with them:
  `unified.speech` → `unified.tts`, `unified.transcribe` → `unified.stt`.
  
  **The 29 endpoint ids** (every one of these is also the export name, the module
  filename, and the CLI id):
  
  | old | new |
  | --- | --- |
  | `openai.speech` | `openai.tts` |
  | `cartesia.speech` | `cartesia.tts` |
  | `deepgram.speech` | `deepgram.tts` |
  | `elevenlabs.speech` | `elevenlabs.tts` |
  | `fish-audio.speech` | `fish-audio.tts` |
  | `hume.speech` | `hume.tts` |
  | `inworld.speech` | `inworld.tts` |
  | `lmnt.speech` | `lmnt.tts` |
  | `lmnt.speechDetailed` | `lmnt.ttsDetailed` |
  | `minimax.speech` | `minimax.tts` |
  | `murf.speech` | `murf.tts` |
  | `murf.speechStream` | `murf.ttsStream` |
  | `resemble.speech` | `resemble.tts` |
  | `resemble.speechStream` | `resemble.ttsStream` |
  | `rime.speech` | `rime.tts` |
  | `smallest-ai.speech` | `smallest-ai.tts` |
  | `speechify.speech` | `speechify.tts` |
  | `speechify.speechStream` | `speechify.ttsStream` |
  | `openai.transcribe` | `openai.stt` |
  | `assemblyai.transcribe` | `assemblyai.stt` |
  | `cartesia.transcribe` | `cartesia.stt` |
  | `deepgram.transcribe` | `deepgram.stt` |
  | `elevenlabs.transcribe` | `elevenlabs.stt` |
  | `gladia.transcribe` | `gladia.stt` |
  | `inworld.transcribe` | `inworld.stt` |
  | `mistral.transcribe` | `mistral.stt` |
  | `revai.transcribe` | `revai.stt` |
  | `soniox.transcribe` | `soniox.stt` |
  | `speechmatics.transcribe` | `speechmatics.stt` |
  
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
  typed as *chat*. It now has two dedicated surfaces — and the chat route keeps
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
    with a `(string & {})` tail and a *warning* — not an error — off-list;
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
  stt.safe(params, { media: [{ path: ["contents", 0, "parts", 0], durationSeconds: 600 }] });
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
  
  | entry | old | new | why |
  | --- | --- | --- | --- |
  | `unmodel/google` | 235 KiB | 310 KiB | two new endpoints and their leaves — `tts.ts`, `stt.ts`, `tts-checks.ts`, `tts-check.ts`, `tts-models.ts`, `tts-constraints.ts`, `audio-constraints.ts`. All google's own; nothing foreign leaked in |
  | `unmodel/tts` | 430 KiB | 500 KiB | Gemini's hand TTS catalog and the 78-language table. The zero-catalog pin **stays** — the pack still reaches no generated catalog, which is why `tts-constraints.ts` is an import-free leaf rather than part of `constraints.ts` |
  | `unmodel/stt` | 420 KiB | 520 KiB | `google.stt` reads the generated `google.gen` catalog (there is no doc correction to make, so hand rows would be a second opinion on generated data — the `mistral.gen` precedent) |
- 9c32ad2: **Every type unmodel knows is now importable without importing unmodel.**
  `unmodel/<provider>/types` (70 new subpaths) and `unmodel/types` (one hub) are
  type-only entries: they emit an **empty JavaScript module**, so the whole
  surface is free at runtime.
  
  They exist for the developer who wants the doc-corrected request shapes and is
  sending the request themselves — with `fetch`, with the vendor SDK, or through
  a client they already have. Nothing here is new *knowledge*; the types were
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
  `ImageEditBody` and `RealtimeSessionBody`. There, the wire name wins and *is*
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
  *exactly*: `unmodel/anthropic`'s `chat()` takes `max_tokens` and `cache_control`
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
  
  req.request.url;      // https://api.anthropic.com/v1/messages
  JSON.stringify(req);  // {"model":"claude-opus-5","max_tokens":4096,…,
                        //  "thinking":{"type":"enabled","budget_tokens":2048}}
  ```
  
  Change the ref to `"openai/gpt-5.2"` and the same object compiles to
  `max_completion_tokens` + `reasoning_effort: "low"` at
  `api.openai.com/v1/chat/completions`, with an `approximated_param` warning
  naming both the requested budget and the bucket it landed in. That is the entire
  proposition.
  
  **New package exports**
  
  | Entry | Function(s) | Providers |
  | --- | --- | --- |
  | `unmodel/chat` | `chat` | 32 |
  | `unmodel/chat/factory` | `createChat` | whichever you register |
  | `unmodel/image` | `image`, `createImage` | 15 |
  | `unmodel/tts` | `tts`, `createTts` | 14 |
  | `unmodel/stt` | `stt`, `createStt` | 11 |
  | `unmodel/video` | `video`, `createVideo` | 10 |
  | `unmodel/image-edit` | `imageEdit`, `createImageEdit` | 4 |
  | `unmodel/music` | `music`, `createMusic` | 2 |
  
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
  *means* the request mapped exactly — asserted per category by a golden matrix
  that compiles one canonical request at every provider that can express it.
  
  ```ts
  image({ model: "black-forest-labs/flux-pro-1.1", prompt: "…", aspectRatio: "16:9", resolution: "1k" }).warnings;
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
    error naming what they *do* report.
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
  
  **No `.toApi()` on a unified *media* result, deliberately.** A provider result
  offers `.toApi(target)` because it starts in one dialect and may want another.
  A unified media result has no dialect to leave: retargeting it means changing
  `model` and calling again, which is a string edit rather than an API — and
  adding `.toApi` would bundle the availability tables the six media packs exist
  without. `unmodel/chat` is the exception and pays for it on purpose: it returns
  the provider's own `Validated`, so `.toApi` and `.toSdk` are there because they
  were never removed. See the `chat-composition` changeset.
  
  ## `unmodel/image` knows what *one model* takes
  
  The two image surfaces narrow per **model**, not per provider — because that is
  where the disagreement actually is. `gpt-image-2` takes a free-form `size` up to
  3840 px and a `background` of `"opaque" | "auto"`; `gpt-image-1` — same
  provider, same endpoint — takes a three-value `size` enum and a `background`
  that also accepts `"transparent"`. One adapter, two request surfaces, and the
  difference is the model id.
  
  ```ts
  image({ model: "openai/gpt-image-2", prompt, size: "3840x2160" });
  //                                          ^ that model's own presets
  
  image({ model: "openai/gpt-image-1", prompt, background: "transparent" });  // ok
  image({ model: "openai/gpt-image-2", prompt, background: "transparent" });  // compile error
  ```
  
  That second line is the whole argument for this library in one call. The OpenAI
  SDK's own type offers `transparent` on every GPT image model; gpt-image-2
  answers a 400 — *"Requests with `background` set to `transparent` will return an
  error for these models; use `opaque` or `auto` instead"* — which unmodel keeps
  as a recorded fixture.
  
  **What narrows.** `size` (a new canonical field, joining `aspectRatio` and
  `dimensions` in the XOR — three spellings of one decision, at most one given),
  `aspectRatio`, `resolution`, and the per-model params the canonical vocabulary
  has no word for. `size` is a string on purpose: `"3840x2160"` is what the docs,
  the dashboards and the models themselves call it, and one token autocompletes
  where a `{ width, height }` pair cannot.
  
  **The presets are provable.** A closed enum gets no template tail — the list
  *is* the limit, so `size: "1920x1080"` does not compile on `dall-e-3`. A
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
  
  **The law.** An endpoint's *address* is uniform across providers even where the
  wire spelling is not. Fifty-plus providers had spelled the same six operations
  about thirty different ways — a wire path (`imageToImage`, `text2video`), a
  product family (`fluxKontext`, `krea2`), a bare verb (`edit`, `listen`,
  `speak`), a plural noun (`images`, `videos`, `jobs`, `generations`) and a noun
  phrase (`replaceBackground`, `contentGenerationTasks`). All of them now address
  their category as `chat`, `image`, `imageEdit`, `tts`, `stt`, `video`
  or `music`, with each *extra* route at a provider qualified by what makes it
  different — never the primary one, so the word a caller reaches for first is the
  same word everywhere.
  
  **Wire-shaped names deliberately did not move.** `MESSAGES_URL`,
  `GenerateContentBody`, `ConverseParams`, `IMAGES_GENERATIONS_URL`, `Flux2Body`,
  `TEXT2VIDEO_URL`, `STABLE_AUDIO_TEXT_TO_AUDIO_URL`, `AUDIO_TRANSCRIPTIONS_URL`,
  `IDEOGRAM_V3_REMIX_URL`, `StableImageEraseParams`, `JobConfig`, the dialect ids
  — all unchanged. The rule is *address-shaped names go uniform, wire-shaped names
  keep the wire spelling*, and the reason is that those two kinds of name answer
  different questions: an address is "which endpoint do I call", and it should
  read the same at every provider; a wire name describes the bytes on the wire,
  and respelling it would make the type lie about the request. `docs/decisions.md`
  records this as a standing decision so it does not get "corrected" later.
  
  ## Chat
  
  | old | new |
  | --- | --- |
  | `anthropic.messages` | `anthropic.chat` |
  | `google.generateContent` | `google.chat` |
  | `google-vertex.generateContent` | `google-vertex.chat` |
  | `amazon-bedrock.converse` | `amazon-bedrock.chat` |
  
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
  
  | old label | new label | what it means |
  | --- | --- | --- |
  | `google-vertex.generateContent` | `google-vertex.chat` | Gemini on Vertex — the surface `createGoogleVertex(…).chat` validates |
  | `google-vertex.chat` | `google-vertex.chatMaas` | the OpenAI-compatible MaaS surface Vertex serves `*-maas` models on |
  | — | `google-vertex.chatRawPredict` | new, and dormant: the Anthropic-shaped `rawPredict` route Claude-on-Vertex uses. unmodel has no module for it, so those rows stay denied in `data/availability-overrides.json`; the label exists so the rule is already correct when one lands |
  
  ## TTS (text to speech)
  
  | old | new |
  | --- | --- |
  | `elevenlabs.textToSpeech` | `elevenlabs.tts` |
  | `cartesia.tts` | `cartesia.tts` |
  | `deepgram.speak` | `deepgram.tts` |
  | `hume.tts` | `hume.tts` |
  | `minimax.t2a` | `minimax.tts` |
  | `rime.tts` | `rime.tts` |
  | `fish-audio.tts` | `fish-audio.tts` |
  | `smallest-ai.tts` | `smallest-ai.tts` |
  | `inworld.tts` | `inworld.tts` |
  | `murf.speechGenerate` | `murf.tts` |
  | `resemble.synthesize` / `resemble.synthesizeStream` | `resemble.tts` / `resemble.ttsStream` |
  | `speechify.stream` | `speechify.ttsStream` |
  
  `openai.tts`, `lmnt.tts`, `lmnt.ttsDetailed`, `murf.ttsStream` and
  `speechify.tts` were already spelled with the category's verb and moved with
  it. The rows where old and new read alike are the providers whose own wire word
  was already `tts`. Constraint tables and checkers follow:
  `elevenlabs.textToSpeechConstraints` → `ttsConstraints` (likewise cartesia,
  rime, smallest-ai, inworld), and `resemble.checkSynthesis` → `checkTts`,
  matching `murf.checkTts`.
  
  ## STT (speech to text)
  
  | old | new |
  | --- | --- |
  | `openai.transcription` | `openai.stt` |
  | `mistral.transcription` | `mistral.stt` |
  | `elevenlabs.speechToText` | `elevenlabs.stt` |
  | `soniox.transcriptions` | `soniox.stt` |
  | `deepgram.listen` | `deepgram.stt` |
  | `assemblyai.transcript` | `assemblyai.stt` |
  | `gladia.preRecorded` | `gladia.stt` |
  | `revai.jobs` | `revai.stt` |
  | `speechmatics.jobs` | `speechmatics.stt` |
  | `cartesia.stt` | `cartesia.stt` |
  
  `inworld.stt` moved with the rest of the category; `cartesia.stt` reads alike in
  both columns because `stt` was already Cartesia's own wire word.
  `openai.transcriptionToFormData` moves with its endpoint to
  `openai.sttToFormData`.
  
  ## Image generation
  
  | old | new |
  | --- | --- |
  | `openai.images` | `openai.image` |
  | `google.generateImages` | `google.image` |
  | `black-forest-labs.flux2` / `black-forest-labs.flux1` | `black-forest-labs.image` / `black-forest-labs.imageFlux1` |
  | `ideogram.generate` / `ideogram.generateV4` | `ideogram.image` / `ideogram.imageV4` |
  | `recraft.generations` | `recraft.image` |
  | `stability.stableImageUltra` / `stableImageCore` / `stableImageSd3` | `stability.image` / `imageCore` / `imageSd3` |
  | `luma.imageGenerations` | `luma.image` |
  | `bytedance.imageGenerations` | `bytedance.image` |
  | `runway.textToImage` | `runway.image` |
  | `kling.imageGenerations` / `kling.omniImage` | `kling.image` / `kling.imageOmni` |
  | `vidu.reference2image` | `vidu.imageFromReference` |
  | `bria.imageGenerate` / `bria.imageGenerateLite` | `bria.image` / `bria.imageLite` |
  | `leonardo.generations` | `leonardo.image` |
  | `krea.krea2` | `krea.image` |
  | `reve.create` / `reve.createV2` | `reve.image` / `reve.imageV2` |
  
  Constraint tables move with them (`openai.imagesConstraints` →
  `imageConstraints`, likewise google, black-forest-labs, bytedance, runway and
  recraft's family rules).
  
  ## Image editing
  
  Twenty-six routes across eight providers, each extra one qualified by *what it
  does to the picture* rather than by the wire path or the vendor's product name.
  
  | old | new |
  | --- | --- |
  | `black-forest-labs.fluxKontext` | `black-forest-labs.imageEdit` |
  | `black-forest-labs.fluxFill` | `black-forest-labs.imageEditFill` |
  | `black-forest-labs.fluxExpand` | `black-forest-labs.imageEditExpand` |
  | `black-forest-labs.fluxErase` | `black-forest-labs.imageEditErase` |
  | `black-forest-labs.fluxDeblur` | `black-forest-labs.imageEditDeblur` |
  | `black-forest-labs.fluxOutpainting` | `black-forest-labs.imageEditOutpainting` |
  | `black-forest-labs.fluxVto` | `black-forest-labs.imageEditVto` |
  | `ideogram.edit` | `ideogram.imageEdit` |
  | `ideogram.remix` | `ideogram.imageEditRemix` |
  | `ideogram.reframe` | `ideogram.imageEditReframe` |
  | `ideogram.replaceBackground` | `ideogram.imageEditReplaceBackground` |
  | `recraft.imageToImage` | `recraft.imageEdit` |
  | `recraft.inpaint` | `recraft.imageEditInpaint` |
  | `recraft.outpaint` | `recraft.imageEditOutpaint` |
  | `recraft.generateBackground` | `recraft.imageEditGenerateBackground` |
  | `recraft.replaceBackground` | `recraft.imageEditReplaceBackground` |
  | `stability.stableImageErase` | `stability.imageEditErase` |
  | `stability.stableImageInpaint` | `stability.imageEditInpaint` |
  | `stability.stableImageOutpaint` | `stability.imageEditOutpaint` |
  | `stability.stableImageSearchAndReplace` | `stability.imageEditSearchAndReplace` |
  | `stability.stableImageSearchAndRecolor` | `stability.imageEditSearchAndRecolor` |
  | `stability.stableImageRemoveBackground` | `stability.imageEditRemoveBackground` |
  | `luma.reframeImage` | `luma.imageEditReframe` |
  | `reve.edit` | `reve.imageEdit` |
  | `reve.remix` | `reve.imageEditRemix` |
  
  `openai.imageEdit` and `bria.imageEdit` already had the uniform name, and
  `openai.imageEditToFormData` is unchanged.
  
  ## Video
  
  | old | new |
  | --- | --- |
  | `openai.videos` | `openai.video` |
  | `google.generateVideos` | `google.video` |
  | `bytedance.contentGenerationTasks` | `bytedance.video` |
  | `runway.textToVideo` / `imageToVideo` / `videoToVideo` | `runway.video` / `videoFromImage` / `videoFromVideo` |
  | `kling.textToVideo` / `imageToVideo` | `kling.video` / `videoFromImage` |
  | `kling.textToVideoV3` / `imageToVideoV3` / `omniVideo` | `kling.videoV3` / `videoV3FromImage` / `videoOmni` |
  | `luma.generations` | `luma.video` |
  | `luma.modifyVideo` / `reframeVideo` / `upscale` / `addAudio` | `luma.videoModify` / `videoReframe` / `videoUpscale` / `videoAddAudio` |
  | `minimax.videoGeneration` / `videoGenerationV2` | `minimax.video` / `videoV2` |
  | `vidu.text2video` / `img2video` / `reference2video` | `vidu.video` / `videoFromImage` / `videoFromReference` |
  | `pixverse.textToVideo` / `imageToVideo` | `pixverse.video` / `videoFromImage` |
  | `lightricks.textToVideo` / `imageToVideo` / `audioToVideo` | `lightricks.video` / `videoFromImage` / `videoFromAudio` |
  
  Constraint tables move with them (`openai.videosConstraints` →
  `videoConstraints`, google's `generateVideosConstraints` / `FamilyRules` /
  `Models`, runway's three `*Constraints` / `*Required` / `*ShapeRules` triples,
  bytedance's `contentGenerationTasksConstraints`, luma's
  `modifyVideoConstraints`, vidu's three).
  
  ## Music
  
  | old | new |
  | --- | --- |
  | `stability.stableAudioTextToAudio` | `stability.music` |
  | `stability.stableAudioAudioToAudio` | `stability.musicFromAudio` |
  | `stability.stableAudioInpaint` | `stability.musicInpaint` |
  
  `elevenlabs.music` already had the uniform name.
  
  ## What did *not* get renamed
  
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
  it the *values*: which voices `openai/gpt-4o-mini-tts` has, which sizes
  `gpt-image-2` takes, which durations `kling-v2-5-turbo-pro` allows. A type
  cannot be mapped over, so every app that wanted a picker retyped the list by
  hand — and that copy is wrong the day a provider adds a voice.
  
  Those lists now ship as arrays. 36 providers — exactly the ones with a unified
  adapter — publish `unmodel/<provider>/values`, and every entry names the same
  uniform exports for each category it serves:
  
  ```tsx
  import { TTS_MODELS, TTS_MODEL_PARAMS } from "unmodel/openai/values";
  
  <select name="voice">
    {TTS_MODEL_PARAMS["gpt-4o-mini-tts"].voices.map((v) => <option key={v}>{v}</option>)}
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
  
  | Import | Cost |
  | --- | --- |
  | any array from `unmodel/values` | 0.2–1.5 KiB |
  | the median provider export | ~1 KiB |
  | the worst (`unmodel/runway/values`) | 19.4 KiB |
  | `CHAT_MODEL_REFS` | 49 KiB |
  
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
    handles share no vocabulary, and voice *management* is out of scope.
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
