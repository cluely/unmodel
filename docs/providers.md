# Provider roster

Sourced from artificialanalysis.ai leaderboards (fetched 2026-08-12) cross-checked against our
models.dev catalog snapshot (`data/models-dev.json`). Tiers describe how unmodel supports each
provider — not their quality ranking.

## Implementation tiers

- **native** — hand-written wire schemas, deep per-model constraints, own subpath (`unmodel/<id>`).
- **oai-base** — thin named overlay on the shared OpenAI-compatible chat validator: base URL,
  catalog, and quirk constraints only. Own subpath, ~30 lines each.
- **catalog-only** — model metadata available via `unmodel/catalog`; no request validator yet.
- **excluded** — no public developer API today (noted; revisit when one ships).

`models.dev`: ✅ = in the generated catalog already; ✋ = needs a hand-maintained catalog file
(mostly speech/image/video providers — models.dev is LLM-centric).

## Wave 1 — user-named priorities

| Provider | Categories | API style | Tier | models.dev | Notes |
|---|---|---|---|---|---|
| openai | llm, image, tts, stt, video (Sora) | native (the reference) | **native** (chat + images + imageEdit + speech + transcription + video + realtime session done) | ✅ | complete for the documented REST surface |
| anthropic | llm | native (the reference) | **native** (done) | ✅ | |
| google | llm, image, video, tts, stt | native | **native** (generateContent + Imagen image + Veo video done) | ✅ | Gemini TTS is validated inside `generateContent` (`responseModalities: ["AUDIO"]` + `speechConfig`); STT likewise via inline/file audio parts |
| xai (grok) | llm, image, video, stt | openai-compatible (+anthropic-compat) | **oai-base** (live) | ✅ (`xai`) | grok-imagine image/video are native-style, later |
| groq | inference (chat + Whisper STT) | openai-compatible | **oai-base** (live) | ✅ | Whisper STT covered by speech wave via oai audio shape |
| cerebras | inference | openai-compatible | **oai-base** (live) | ✅ | |
| openrouter | aggregator (400+ models) | openai-compatible | **oai-base** (live) | ✅ (349 models) | |
| huggingface | aggregator (router.huggingface.co) | openai-compatible | **oai-base** (live) | ✅ | |
| elevenlabs | tts (r11), stt (Scribe, r1), music | native | **native** (TTS+STT+music live; realtime configs live) | ✋ | per-character pricing; `textToSpeechStreamInput` + `speechToTextRealtime` validate the socket configs |
| cartesia | tts (Sonic, r6), stt (Ink) | native | **native** (TTS+STT live; realtime configs live) | ✋ | `ttsWebsocket` (generation message) + `sttWebsocket` (connection query set) |
| inworld | tts (Realtime TTS, r7), stt | native | **native** (TTS+STT live; realtime configs live) | ✋ | STT is inline base64 (no multipart); `realtimeTranscribeConfig` + `realtimeVoiceContext` validate the first frames |
| soniox | stt (v5, r11) | native | **native** (STT live; realtime config live) | ✋ | async `transcriptions` + `realtimeTranscription` config message |
| stepfun | llm (r83), tts (r5), image-edit | openai-compatible | **oai-base** (chat live) | ✅ | TTS via speech wave |

## Wave 2 — inference hosts & aggregators (all openai-compatible, all in models.dev → oai-base)

**Live:** togetherai, fireworks-ai, deepinfra, nebius, novita-ai, baseten, friendli,
scaleway, siliconflow, vercel (gateway), cloudflare (workers-ai — `createCloudflare(accountId)`
factory; the base URL embeds the account id).
Remaining: sambanova, hyperbolic, parasail, crusoe, gmi, coreweave, lambda, modal,
databricks, digitalocean, lightning-ai.
Special cases — now **live as endpoint factories** (no provider-wide static URL):
**azure** (`createAzure({ endpoint })`, OpenAI v1 dialect, deployment-name model ids),
**google-vertex** (`createGoogleVertex({ project, location })`, Gemini generateContent),
**amazon-bedrock** (`createAmazonBedrock({ region })`, native Converse wire format).
Still catalog-only: **replicate** (native API — until a native validator lands).

## Wave 2 — model creators with first-party OpenAI-compatible APIs (oai-base)

**Live:** mistral, deepseek, moonshotai, alibaba, zhipuai, minimax, nvidia, perplexity,
meta (Model API), upstage (Solar), inception (Mercury), sarvam, longcat.
Remaining: tencent (Hunyuan), baidu (ERNIE/Qianfan), bytedance-seed (Doubao), ai21, reka,
microsoft (Phi), liquid-ai, nous-research, arcee-ai, prime-intellect, kwaikat/streamlake.
Native-API exceptions: **cohere** — now **native** (v2 Chat live, `unmodel/cohere`);
**amazon** (Nova — reachable via the Bedrock Converse factory); catalog-only:
**ibm** (Granite/watsonx), **naver**, **snowflake**.
Mixed-tier: **minimax** and **mistral** are oai-base for chat *and* native for their media
routes on the same subpath (`minimax.speech` / `video` / `videoV2`,
`mistral.transcription`). **bytedance** is a separate native subpath for the BytePlus
ModelArk image/video routes — the Doubao chat overlay above is still to do.

## Speech wave — TTS / STT (native APIs, hand-maintained catalogs ✋)

**Live — TTS:** every provider addresses its synthesis route as `speech` (the address-vs-wire
law — the wire spellings `/v1/text-to-speech/{voice_id}`, `/tts/bytes`, `/v1/speak`,
`/v1/t2a_v2`, `/synthesize` survive only on the URL constants and wire types):
openai (tts-1/tts-1-hd/gpt-4o-mini-tts/gpt-4o-mini-tts-2025-12-15), cartesia,
deepgram (Aura 1/2), elevenlabs, fish-audio, hume (Octave), inworld,
lmnt (`speech` + `speechDetailed`), minimax (T2A v2), murf (`speech` + `speechStream`),
resemble (`speech` + `speechStream`), rime, smallest-ai,
speechify (`speech` + `speechStream`).
All fourteen also ship a `unified.ts` adapter, so `speech()` from `unmodel/speech` reaches
them through one canonical vocabulary.
**Live — STT:** openai (`transcription` — gpt-transcribe/gpt-4o-transcribe/gpt-4o-mini-transcribe/
gpt-4o-mini-transcribe-2025-12-15/gpt-4o-transcribe-diarize/whisper-1), assemblyai, cartesia,
deepgram (`listen`), elevenlabs (Scribe), gladia (`preRecorded`), inworld (`transcribe` —
base64 audio inline in the JSON body, no multipart route), mistral (`transcription`,
Voxtral), revai (`jobs`), soniox, speechmatics (`jobs`).
Google TTS/STT ride on `generateContent` (no separate endpoint upstream).
**Live — realtime session configs:** the documented JSON config object of each socket surface
(connection query set, first configuration frame, or per-chunk generation message) — never the
socket lifecycle, which stays out of unmodel's scope and is stated in every module header.
openai (`realtimeSession`), cartesia (`ttsWebsocket`, `sttWebsocket`), deepgram (`listenLive`,
`listenFlux` + `fluxConfigure`, `speakLive`), elevenlabs (`textToSpeechStreamInput`,
`speechToTextRealtime`), inworld (`realtimeTranscribeConfig`, `realtimeVoiceContext`), soniox
(`realtimeTranscription`).
**Realtime still to do:** the streaming/live socket configs of assemblyai, gladia and
speechmatics, plus Cartesia's sibling turn-detection socket (`/stt/turns/websocket`).
**TTS still to do (leaderboard order):** typecast, alibaba (Qwen-TTS), google, stepfun,
gradium, async, microsoft/azure, mistral (Voxtral TTS), boson-ai, neuphonic, amazon (Polly),
nvidia (Magpie), zyphra.
**STT still to do:** azure, smallest-ai, google, alibaba, deepinfra, xai, amazon,
nvidia, gradium, reson8, modulate, cohere (transcribe).

## Image wave (native APIs unless noted)

**Live — generation:** every text-to-image route is addressed as `<provider>.image`,
whatever the wire calls it; a provider with more than one generation route qualifies the
extras (`imageCore`, `imageV4`, `imageFlux1`) and never the primary one. openai gpt-image +
DALL·E (`image`, at /v1/images), google (Imagen 4 via `image` → `:predict`; Nano Banana /
gemini-*-image via `chat`), black-forest-labs (FLUX.2 `image`, FLUX 1.x `imageFlux1`,
Kontext — api.bfl.ai, `unmodel/black-forest-labs`), bria (`image` + `imageLite`, FIBO),
bytedance (`image`, Seedream on BytePlus ModelArk), kling (`image` + `imageOmni`), krea
(`image`), leonardo (`image`, Lucid / Phoenix), recraft (`image`), ideogram (v3 `image` + v4
`imageV4`), reve (`image` + `imageV2`), stability (Stable Image `image` / `imageCore` /
`imageSd3`), luma (Photon `image`), runway (`image`), vidu (`imageFromReference`).
All fifteen also ship a unified adapter at `unmodel/<provider>/unified`, and
`unmodel/image` carries the ready-made pack over all of them.
**Live — editing:** openai (`imageEdit`), black-forest-labs (`fluxFill`, `fluxExpand`,
FLUX Tools `fluxOutpainting`/`fluxErase`/`fluxDeblur`/`fluxVto`), bria (`imageEdit`), recraft
(`imageToImage`, `inpaint`, `outpaint`, `generateBackground`, `replaceBackground`), ideogram
(`edit`, `remix`, `reframe`, `replaceBackground`), reve (`edit`, `remix`), stability
(`stableImageErase`, `stableImageInpaint`, `stableImageOutpaint`,
`stableImageSearchAndReplace`, `stableImageSearchAndRecolor`,
`stableImageRemoveBackground`), luma (`reframeImage`).
Remaining: microsoft-ai, xai (grok-imagine), alibaba (Qwen-Image/Wan), fal (aggregator),
baidu, tencent (HunyuanImage), minimax, z-ai, nvidia, amazon (Titan/Nova).
**Excluded (no public API):** midjourney, hidream, pruna, playground, sapiens-ai, eigen-ai,
deepseek (Janus — weights only).

## Video / music wave

**Video — live:** openai (Sora 2, `video` at /v1/videos), google (Veo, `video`),
bytedance (`video`, Seedance / Dreamina Seedance), kling (`video` /
`videoFromImage` on `POST /v1/videos/*`, plus the EXPERIMENTAL path-addressed
`videoV3` / `videoV3FromImage` / `videoOmni`), lightricks (LTX-2: `video` /
`videoFromImage` / `videoFromAudio`), minimax (`video` Hailuo + `videoV2`
MiniMax-H3), pixverse (`video` + `videoFromImage`), runway (`video` +
`videoFromImage` + `videoFromVideo`), luma (Ray, `video`, plus post-production
`videoModify` / `videoReframe` / `videoUpscale` / `videoAddAudio`), vidu
(`video` / `videoFromImage` / `videoFromReference`). All ten are reachable
through one canonical `video()` at `unmodel/video`.
Remaining (first-party APIs): alibaba (Wan), xai (grok-imagine), tencent (HunyuanVideo).
Several of these are already reachable as hosted routes on `unmodel/runway`
(`hailuo3`, `seedance2*`, `gemini_omni_flash`, `grok_imagine_1_5`).
**Excluded:** pika, genmo/haiper, sand-ai, skywork, sapiens-ai (no public API).
**Music / audio — live:** elevenlabs (Eleven Music, `music`), stability (Stable Audio 2.x:
`stableAudioTextToAudio` / `stableAudioAudioToAudio` / `stableAudioInpaint`).
Remaining: mureka, sonauto. **Excluded:** suno, udio, producer-ai (no public API).

## LLM creators without a public API today (catalog-only or excluded)

motif-technologies, xiaomi (MiMo), thinking-machines (Inkling), nex-agi, china-mobile,
sapiens-ai, inclusionai (Ant Ling/Ring), sk-telecom, ai9stars, lg-ai-research (EXAONE),
servicenow, multiverse-computing, mbzuai-ifm, korea-telecom, celeris, trillion-labs,
openbmb, nanbeige, tii-falcon, allenai (Olmo — weights only).

## Output targets — `.toSdk(target)` and `.toApi(provider)`

Two different vocabularies, both closed unions, both catalog-id-based.

**`.toSdk(target)` — every endpoint, 153 of them.** (The count is not maintained by hand:
`src/cli.test.ts`'s drift guard asserts `REGISTRY` + `MULTIPART_ONLY` are exactly the set of
module-level validators, so that test is the source of truth if this number ever rots.)
The target set is a property of
the *endpoint*: each `finalize` declares a literal map of zero-arg formatters and the
union is `keyof` that map. There is no zero-argument form and no global registry — a
registry would be order-dependent under bundled `.d.ts` emit and would offer
`unmodel/openai`'s speech endpoint Anthropic's targets. Targets are catalog provider
ids, plus exactly one reserved non-catalog id, `"ai-sdk"` (the `ai` npm package).

`"ai-sdk"` is declared only where the AI SDK's own API is stable (checked 2026-08-13):
`generateText`/`streamText` — so every chat endpoint. `experimental_generateVideo`,
`experimental_streamTranscribe` and `experimental_streamTranslate` keep video and the
streaming speech routes out for now. Offering a target the SDK cannot actually serve is
worse than offering none.

**`.toApi(provider)` — chat only.** Availability is derived from the models.dev snapshot
by `scripts/availability.ts` (id-tail normalization **and** display-name normalization,
conjoined) and emitted per provider into `src/catalog/availability/<id>.gen.ts` — no
`index.ts` aggregator, since one would defeat the tree-shaking the layout exists for.
Scope is the 36 chat-validating providers listed explicitly in
`data/availability-overrides.json`, and that file is also the manual valve:
`deny`/`force` pairs applied after the heuristic so every deviation is a reviewable diff
rather than a silent 404, plus a `targetOnly` list for providers that are reachable as
*destinations* but get no source table of their own.

34 files are emitted — one per in-scope provider except `amazon-bedrock` and `azure`,
which are `targetOnly` (they are endpoint factories — see below — so their modules wire
no `api:`, and a source table for them would be generated code with no importer). The
one-importer rule is asserted by `test/import-graph.test.ts`.

**Every row carries its own provider as a target.** A provider serves its own models by
definition, so `.toApi("openai")` on an OpenAI model is a valid — and lossless, no-op —
retarget, which is what makes a provider-generic call site writable. It also means every
in-scope chat row gets an entry, not only the rows in multi-provider groups: a model
nobody else serves resolves to a union of exactly its home provider rather than falling
through to the permissive `StaticApiTargetId` arm (28 targets that all fail at runtime).
That is why `sarvam`, whose models no other in-scope provider serves, has a table at all,
and why the tables grew from ~288 KiB to ~350 KiB. Identity entries never carry `narrows`
(a model does not narrow against itself) and are suppressed by a `deny` pair that matches
the row on both halves — which is how google-vertex's Claude rows, whose `rawPredict`
surface unmodel has no module for, stay out of the data entirely.

Two normalizations are worth naming because they are where merges are won or lost. The
id half collapses **digit-dot-digit version separators** (`anthropic/claude-haiku-4.5` ≡
`claude-haiku-4-5`), without which every Claude row on OpenRouter and Vercel goes
missing and `.toApi("openrouter")` becomes a compile error on models OpenRouter serves.
The scope half keeps chat models only: `modalities.output` including `text` is necessary
but not sufficient, since models.dev records embeddings, transcription and music
generation as text-out too, so a row that charges for input and nothing for output (it
generates no tokens) or that emits audio/video without tool calling (music, speech,
realtime voice) is dropped. Image-out rows are deliberately kept — `gemini-3-pro-image`
really is a `generateContent` request.

Currently denied there, both for unverified wire surfaces:

- `*  → azure:*claude*` — models.dev lists 11 Claude rows on Azure but records `api: null`,
  and unmodel's Azure module is OpenAI-compatible only. The surface is unconfirmed.
- `*  → google-vertex:*claude*` — Vertex serves Claude through an Anthropic-shaped
  `rawPredict` route that unmodel has no module for.

Not denied but worth knowing: `claude → openrouter` ships through the chat-completions
dialect. Whether OpenRouter also exposes an Anthropic-compatible `/v1/messages` surface
is unverified; if it does, that default is needlessly lossy (thinking blocks,
`cache_control` and server tools are dropped) and should be revisited.

**Excluded from the `.toApi` union in v1: the endpoint factories** — `amazon-bedrock`,
`google-vertex`, `azure`. `.toApi` is synchronous and total, and there is no defensible
default for a `region`, a `project` + `location`, or a resource `endpoint`; Azure is worse
still, since its `model` is a user-chosen deployment name rather than a catalog id. Their
edges **are** emitted into the availability data, so the reserved two-argument overload
(`toApi("amazon-bedrock", { region })`) is a types + runtime change with no codegen work.

**No media `.toApi`, and that is a scope decision.** Across the providers unmodel
implements there are exactly 5 multi-provider media groups in the snapshot (2 image, 1
video, 2 transcription), and the providers one would expect to join —
black-forest-labs, elevenlabs, deepgram, runway, luma, ideogram, recraft, stability,
kling, pixverse — are absent from models.dev entirely (they are the ✋ hand catalogs
above). There is nothing to generate, and their wire formats share no dialect to
translate through. The README says so explicitly, because chat-has-it/media-doesn't
otherwise reads as an oversight. If hand catalogs ever grow an `equivalentTo` field, the
same `buildAvailability` machinery consumes it unchanged.

## Architecture implications

1. **OpenAI-compatible base validator** (`src/providers/openai-compatible/`) parameterized by
   base URL + catalog + constraints; named overlays re-export a configured instance per
   provider. Covers ~35 providers at ~30 lines each.
2. **Supplemental hand-maintained catalogs** for providers absent from models.dev (speech,
   image, video): same `ModelInfo` contract, hand-written `models.ts` next to the validator,
   refreshed manually. `ModelCost` carries the non-token rates these modalities need:
   `perMillionCharacters` (TTS), `perAudioMinute` (STT), `perImage`, `perVideoSecond`.
   `ModelLimit.characters` bounds character-priced inputs.
3. **New endpoint shapes**: TTS (`speech`/`tts`), STT (`transcription`/`stt`/`listen`), image
   generation and editing, and video generation + post-production, each mirroring its native
   wire format on the same pipeline/constraints machinery. Realtime *transports* stay out of
   scope; the session-config object is validated (`openai.realtimeSession`).
4. **Multipart endpoints** ship a `toFormData(validated)` builder next to the validator.
   Multipart transport alone does *not* exclude an endpoint from the CLI: the params are
   still a JSON document, so `unmodel validate` registers them and prints a
   `transport: multipart/form-data` note naming the subpath's `toFormData` (it detects them
   by their intentionally empty `.request.headers` — the boundary belongs to the `FormData`).
   Only the endpoints whose schema *requires* a `Blob` field are library-only, since no JSON
   document can express one; those live in the CLI's `MULTIPART_ONLY` map, which points the
   caller at the library API instead of failing with "expected Blob".
   Two builders, two jobs — keep the names apart: `toFormData(validated)` re-encodes the
   *same* endpoint's validated body as multipart; `toUploadFormData(params)` builds the body
   for a *distinct* upload endpoint whose response id then feeds the validator
   (`gladia.toUploadFormData` → `UPLOAD_URL`, `soniox.toUploadFormData` → `FILES_URL`).
   A provider needing both disambiguates per endpoint instead (openai's
   `imageEditToFormData` / `transcriptionToFormData`).
5. **Translation is hub-and-spoke, and the spokes are per *dialect*, not per provider.**
   The hub lives in `src/core/translate/` (`ir.ts`, `warnings.ts`, `endpoints.ts`,
   `retarget.ts`, `ai-sdk.ts`, `availability-types.ts`) and imports nothing from
   `src/providers/`, not even type-only. Each dialect's codec is an `interop.ts` beside its
   own wire types — three of them in v1 (`openai-compatible`, `anthropic`, `google`), with
   `openai-compatible/interop.ts` alone serving all ~30 fleet overlays. `bedrock-converse`
   is deliberately deferred: its only targets are the factory providers, which are out of
   the `.toApi` union anyway. An endpoint module may import *other* providers' `interop.ts`
   and nothing else of theirs, which is what keeps `unmodel/anthropic` from pulling
   OpenRouter's schema, constraints or catalog. `test/import-graph.test.ts` enforces these
   rules over every import specifier in `src/`, because a single stray barrel import would
   quietly multiply a provider's bundle. Measured, this costs little: 90.4% of retarget
   edges are OpenAI-compatible → OpenAI-compatible and skip the IR entirely (id respell +
   URL swap), so only the cross-dialect endpoints pay for a codec at all.
