# Provider roster

Sourced from artificialanalysis.ai leaderboards (fetched 2026-08-12) cross-checked against our
models.dev catalog snapshot (`data/models-dev.json`). Tiers describe how unmodel supports each
provider — not their quality ranking.

## Implementation tiers

- **native** — hand-written wire schemas, deep per-model constraints, own subpath (`unmodel/<id>`).
- **oai-base** — thin named overlay on the shared OpenAI-compatible chat validator: base URL,
  catalog, and quirk constraints only. Own subpath, ~30 lines each.
- **generated** — wire types, schemas, per-endpoint constraint data and catalog rows emitted by a
  codegen from the provider's own published OpenAPI, over a committed snapshot. Behaviour (checks,
  messages, estimates, docs) is still hand-written beside it. One provider so far: **fal** — see
  [the fal.ai wave](#falai-wave--one-aggregator-ten-verbs).
- **catalog-only** — model metadata available via `unmodel/catalog`; no request validator yet.
- **excluded** — no public developer API today (noted; revisit when one ships).

`models.dev`: ✅ = in the generated catalog already; ✋ = needs a hand-maintained catalog file
(mostly speech/image/video providers — models.dev is LLM-centric).

## Wave 1 — user-named priorities

| Provider | Categories | API style | Tier | models.dev | Notes |
|---|---|---|---|---|---|
| openai | llm, image, tts, stt, video (Sora) | native (the reference) | **native** (chat + image + imageEdit + tts + stt + video + realtime session done) | ✅ | complete for the documented REST surface |
| anthropic | llm | native (the reference) | **native** (`chat`, the `/v1/messages` wire format — done) | ✅ | |
| google | llm, image, video, tts, stt | native | **native** (`chat` + `tts` + `stt` + Imagen `image` + Veo `video` done) | ✅ | `tts` and `stt` are dedicated Tier-A surfaces — required AUDIO modality, XOR'd `speechConfig`, bounded speaker tuple, 78-language table, closed audio MIME set, typed `audioTranscriptionConfig`. Both post to `:generateContent`, which is also what `chat` serves, so the same ids stay valid there too — one shared check battery backs both surfaces |
| xai (grok) | llm, image, video, stt | openai-compatible (+anthropic-compat) | **oai-base** (chat) + native `image`/`video`/`videoEdit`/`videoExtend` (Grok Imagine, live) | ✅ (`xai`) | |
| groq | inference (chat + Whisper STT) | openai-compatible | **oai-base** (live) | ✅ | Whisper STT covered by speech wave via oai audio shape |
| cerebras | inference | openai-compatible | **oai-base** (live) | ✅ | |
| openrouter | aggregator (400+ models) | openai-compatible | **oai-base** (live) | ✅ (349 models) | |
| huggingface | aggregator (router.huggingface.co) | openai-compatible | **oai-base** (live) | ✅ | |
| elevenlabs | tts (r11), stt (Scribe, r1), music | native | **native** (TTS+STT+music live; realtime configs live) | ✋ | per-character pricing; `textToSpeechStreamInput` + `speechToTextRealtime` validate the socket configs |
| cartesia | tts (Sonic, r6), stt (Ink) | native | **native** (TTS+STT live; realtime configs live) | ✋ | `ttsWebsocket` (generation message) + `sttWebsocket` (connection query set) |
| inworld | tts (Realtime TTS, r7), stt | native | **native** (TTS+STT live; realtime configs live) | ✋ | STT is inline base64 (no multipart); `realtimeTranscribeConfig` + `realtimeVoiceContext` validate the first frames |
| soniox | stt (v5, r11) | native | **native** (STT live; realtime config live) | ✋ | async `stt` + `realtimeTranscription` config message |
| stepfun | llm (r83), tts (r5), image-edit | openai-compatible | **oai-base** (chat live) + native `tts` (stepaudio-2.5-tts, live) | ✅ | speech is a hand catalog mirroring the generated rows |

## Wave 2 — inference hosts & aggregators (all openai-compatible, all in models.dev → oai-base)

**Live:** togetherai, fireworks-ai, deepinfra, nebius, novita-ai, baseten, friendli,
scaleway, siliconflow, vercel (gateway), cloudflare (workers-ai — `createCloudflare(accountId)`
factory; the base URL embeds the account id).
Remaining: sambanova, hyperbolic, parasail, crusoe, gmi, coreweave, lambda, modal,
databricks, digitalocean, lightning-ai.
Special cases — now **live as endpoint factories** (no provider-wide static URL):
**azure** (`createAzure({ endpoint })`, OpenAI v1 dialect, deployment-name model ids),
**google-vertex** (`createGoogleVertex({ project, location })`, Gemini `chat` on the
`:generateContent` route),
**amazon-bedrock** (`createAmazonBedrock({ region })`, `chat` on the native Converse wire
format).
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
routes on the same subpath (`minimax.tts` / `video` / `videoV2`,
`mistral.stt`). **bytedance** is a separate native subpath for the BytePlus
ModelArk image/video routes — the Doubao chat overlay above is still to do.

## Speech wave — TTS / STT (native APIs, hand-maintained catalogs ✋)

**Live — TTS:** every provider addresses its synthesis route as `tts` (the address-vs-wire
law — the wire spellings `/v1/text-to-speech/{voice_id}`, `/tts/bytes`, `/v1/speak`,
`/v1/t2a_v2`, `/synthesize`, `:generateContent` survive only on the URL constants and wire
types): openai (tts-1/tts-1-hd/gpt-4o-mini-tts/gpt-4o-mini-tts-2025-12-15), cartesia,
deepgram (Aura 1/2), elevenlabs, fish-audio, google (Gemini TTS), hume (Octave), inworld,
lmnt (`tts` + `ttsDetailed`), minimax (T2A v2), murf (`tts` + `ttsStream`),
resemble (`tts` + `ttsStream`), rime, smallest-ai,
speechify (`tts` + `ttsStream`), stepfun (StepAudio 2.5), breezeblue (Breeze TTS 2),
alibaba (Qwen3-TTS on DashScope; the realtime-WebSocket-only ids incl.
qwen-audio-3.0-tts-plus are catalog rows the unary validator rejects by name),
fal (23 hosted endpoints — ElevenLabs, MiniMax, Gemini TTS, Chatterbox, Inworld,
xAI, Seed-Speech, Qwen-3 and nine Kokoro languages — behind one `fal.tts`).
All nineteen also ship an adapter at `unmodel/<provider>/unified`, so `tts()` from
`unmodel/tts` reaches them through one canonical vocabulary. Two leaderboard names that
LOOK like gaps are not: Cartesia "Sonic 3.6" has no model id of its own (it is the beta
behind `sonic-preview`), and ElevenLabs "v3 Conversational" is the realtime
`eleven_v3_conversational` (catalog row; Text-to-Dialogue WebSocket only).
**Live — STT:** every provider addresses the route as `stt` — openai
(gpt-transcribe/gpt-4o-transcribe/gpt-4o-mini-transcribe/
gpt-4o-mini-transcribe-2025-12-15/gpt-4o-transcribe-diarize/whisper-1), assemblyai, cartesia,
deepgram, elevenlabs (Scribe), gladia, google (13 curated Gemini ids, 6 excluded by name and
reason), inworld (base64 audio inline in the JSON body, no multipart route), mistral
(Voxtral), revai, soniox, speechmatics, fal (6 hosted endpoints — Wizper, fal's own
speech-to-text + turbo, ElevenLabs Scribe v1/v2, Cohere Transcribe; the `/stream` variants are
excluded by name as a socket surface). All thirteen also ship an adapter at
`unmodel/<provider>/unified`, so `stt()` from `unmodel/stt`
reaches them through one canonical vocabulary — where the `audio` shapes each route accepts
are enforced at compile time.
Google is the one provider whose TTS and STT are the *same wire route* as its chat
(`:generateContent` — there is no separate endpoint upstream). `google.tts` and `google.stt`
are narrower, modality-specific *views* of those bytes, not different endpoints; the ids
therefore remain valid on `google.chat`, and both surfaces run one shared check battery so
they cannot drift about what a valid request is.
**Live — realtime session configs:** the documented JSON config object of each socket surface
(connection query set, first configuration frame, or per-chunk generation message) — never the
socket lifecycle, which stays out of unmodel's scope and is stated in every module header.
openai (`realtimeSession`), cartesia (`ttsWebsocket`, `sttWebsocket`), deepgram (`listenLive`,
`listenFlux` + `fluxConfigure`, `speakLive`), elevenlabs (`textToSpeechStreamInput`,
`speechToTextRealtime`), inworld (`realtimeTranscribeConfig`, `realtimeVoiceContext`), soniox
(`realtimeTranscription`).
**Realtime still to do:** the streaming/live socket configs of assemblyai, gladia and
speechmatics, plus Cartesia's sibling turn-detection socket (`/stt/turns/websocket`).
**TTS still to do (leaderboard order):** typecast,
gradium, async, microsoft/azure, mistral (Voxtral TTS), boson-ai, neuphonic, amazon (Polly),
nvidia (Magpie), zyphra. **Excluded (no public developer API):** VUI Labs (Luna TTS —
contact-gated, no published docs).
**STT still to do:** azure, smallest-ai, alibaba, deepinfra, xai, amazon,
nvidia, gradium, reson8, modulate, cohere (stt).

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
`imageSd3`), luma (Photon `image`), runway (`image`), vidu (`imageFromReference`),
xai (Grok Imagine `image` at /v1/images/generations), azure (Microsoft Foundry MAI-Image-2.5
family via the `createAzure(endpoint)` factory — deployment-name model field, so wire
validators only, no unified refs, same doctrine as azure chat),
fal (`image`, 32 hosted endpoints — the FLUX.2 family, Nano Banana 1/2/Pro, GPT Image 1.5/2,
Seedream 4.5/5 Pro, Ideogram v3/v4, Recraft v3/v4, Krea 2, Kling Image v3, Reve 2.1, Qwen-Image,
Z-Image, Grok Imagine, Hunyuan Image 3, SD 3.5 Large, FLUX general, MAI-Image-2.5).
The pack providers also ship a unified adapter at `unmodel/<provider>/unified`, and
`unmodel/image` carries the ready-made pack over all seventeen of them. "Reve 2.1" needs no
new ids: Reve's API has no 2.1 version strings — `latest` serves it. Several fal rows are the
same model unmodel already serves first-party (FLUX at black-forest-labs, Seedream at
bytedance, Krea, Ideogram, Recraft, Reve): the same weights behind a different queue, which is
what `.toApi("fal")` is reserved for and why it is not implemented yet.
**Live — editing:** every image-to-image route is addressed as
`<provider>.imageEdit`, with each extra route qualified by what it does to the
picture. openai (`imageEdit`), black-forest-labs (Kontext `imageEdit`, FLUX.1
`imageEditFill` / `imageEditExpand`, FLUX Tools
`imageEditOutpainting`/`imageEditErase`/`imageEditDeblur`/`imageEditVto`), bria
(`imageEdit`), recraft (`imageEdit`, `imageEditInpaint`, `imageEditOutpaint`,
`imageEditGenerateBackground`, `imageEditReplaceBackground`), ideogram
(`imageEdit`, `imageEditRemix`, `imageEditReframe`,
`imageEditReplaceBackground`), reve (`imageEdit`, `imageEditRemix`), stability
(`imageEditErase`, `imageEditInpaint`, `imageEditOutpaint`,
`imageEditSearchAndReplace`, `imageEditSearchAndRecolor`,
`imageEditRemoveBackground`), luma (`imageEditReframe`), fal (`imageEdit`, 17 hosted
endpoints — Nano Banana 1/2/Pro edit, GPT Image 1.5/2 edit, FLUX Kontext / Kontext Max /
Kontext Multi, FLUX.2 pro/dev edit, FLUX fill and i2i, Seedream 4.5 / 5 Pro edit,
Qwen-Image-Edit 2511, Qwen Image 3 edit).
Five of the nine — openai, black-forest-labs, ideogram, recraft, fal — ship a
unified adapter, and `unmodel/image-edit` carries the ready-made pack over
them. No background-removal route is curated at fal in wave 1: it is an
operation with no prompt, and this vocabulary has no word for it yet.
Remaining: alibaba (Qwen-Image), baidu, tencent (HunyuanImage), minimax, z-ai, nvidia,
amazon (Titan/Nova); azure MAI `imageEdit` is live (multipart /mai/v1/images/edits).
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
(`video` / `videoFromImage` / `videoFromReference`), alibaba (Wan 3.0/2.x + HappyHorse 1.x
on DashScope video-synthesis, async create-then-poll), xai (Grok Imagine `video` +
`videoEdit` + `videoExtend` at /v1/videos/*), fal (`video`, 30 hosted endpoints — Seedance
2.0/2.5, Kling v2.5-turbo/v2.6/v3 and o3 video edit, MiniMax H3 + Hailuo-02, Veo 3.1 and its
fast / i2v / first-last / extend arms, Wan v2.2/v2.7, LTX-2.5, PixVerse v6, Grok Imagine,
Gemini Omni Flash). All thirteen are reachable
through one canonical `video()` at `unmodel/video`.
fal is the one provider here with **no** `videoFromImage`: at fal the model IS the route, so
text-to-video, image-to-video, reference and first-last are separate endpoint ids reached
through the same `fal.video`, and `videoFromImage` exists to qualify a wire-route fork rather
than a model choice (the argument is recorded in `src/cli-registry.test.ts`).
Remaining (first-party APIs): tencent (HunyuanVideo).
Several are also reachable as hosted routes on `unmodel/runway`
(`hailuo3`, `seedance2*`, `gemini_omni_flash`, `grok_imagine_1_5`, `happyhorse_1_0`).
**Excluded:** pika, genmo/haiper, sand-ai (MAGI-2 Preview is open weights on HF, no hosted
API), skywork, sapiens-ai (no public API).
**Music / audio — live:** elevenlabs (Eleven Music, `music`), stability (Stable Audio 2.x:
`music` / `musicFromAudio` / `musicInpaint`), google (Lyria 3 Pro / Clip via the Gemini
Interactions API, `music`), mureka (`music` at /v1/song/generate + `instrumental`,
async create-then-poll, mureka-7.6…9.5), fal (`music`, 10 hosted endpoints — MiniMax Music
3 / v2.6 / v2, ElevenLabs Music, Lyria 3 Pro + Lyria 2, Stable Audio 2.5 and 3 Medium,
ACE-Step, DiffRhythm). All five text-to-music routes ship an adapter at
`unmodel/<provider>/unified` behind `music()` from `unmodel/music`; the audio-conditioned
Stability routes and mureka's lyrics/extend/stem routes stay wire-only or doc-noted
(see `src/unified/music.ts`). No sound-effect route is curated at fal: an SFX prompt is not a
song, and an `sfx` category with one witness would be a guess.
Remaining: sonauto. **Excluded:** suno, udio, producer-ai (no public API).
MiniMax music is reachable **only** through fal here: the native
/v1/music_generation API closed to NEW users on 2026-08-20 (current ids
music-3.0/music-cover; existing subscribers only, so it fails the public-accessibility
bar), while `minimax/music-3` on fal's queue is open to anyone with a `FAL_KEY`.

## Lipsync / avatar / upscale wave (fal only, for now)

Three categories that arrived with fal because fal is where their models are hosted. Each is a
full unmodel category — own vocabulary, own kernel id, own pack, own `unmodel/<category>`
subpath — rather than an arm bolted onto an existing one, which is what keeps a second
provider a one-file addition. Examples and the narrowing rules live in
[surfaces.md](surfaces.md#lipsync).

**Lipsync — `lipsync`, 10 endpoints.** A clip in, an audio track in, a clip whose mouth matches
the audio out. sync. lipsync v3, v2 and v2/pro; VEED lipsync v1 and v2; LatentSync; Kling
LipSync (audio-to-video); PixVerse lipsync; HeyGen v3 lipsync precision and speed. Five
canonical words and no geometry — the output's shape **is** the input's. `fal-ai/sync-lipsync/v2`
is the roster's reminder that fal's route selector cannot be `model`: it has a real `model` body
field (`"lipsync-2" | "lipsync-2-pro"`) that stays on the wire while `endpoint` routes.
Excluded by name: `fal-ai/sync-lipsync/v1.9.0-beta` (superseded) and
`fal-ai/kling-video/lipsync/text-to-video` (a script + a voice id is TTS composed with lipsync,
and composing it here would hide which half failed).

**Avatar — `avatar`, 8 endpoints.** A still in, the same audio in, a clip out. sync-lipsync
v3/image-to-video, ByteDance OmniHuman 1.5, Kling AI Avatar v2 standard and pro, EchoMimic v3,
LongCat single-avatar, VEED Avatars, Argil Avatars. The split from lipsync is by INPUT rather
than by vendor, which is why `fal-ai/sync-lipsync/v3` and
`fal-ai/sync-lipsync/v3/image-to-video` — one product on two routes — land in different
categories. Two rows take neither a still nor a clip: their performer is a catalogued id, so
`image` is narrowed per model and types as `never` there.

**Upscale — `upscale`, 10 endpoints.** Clarity Upscaler, Topaz image precision and generative,
Topaz video precision, ESRGAN, AuraSR, SeedVR upscale image and video, Recraft crisp upscale,
FLUX video upscale. The only verb in the roster with no fixed modality: seven routes take a
still and three take a clip, so `source` is narrowed per model and the output modality is read
off each endpoint's own response schema. `factor` is the one cross-vendor word, and it has
three answers per model: a range, a closed set (AuraSR upscales by 4 or not at all), or absent.

**Wire notes, shared by all three:** the request is a queue submit to
`https://queue.fal.run/{endpoint}`, the media arguments are https URLs or `data:` URIs, and the
result is a queue envelope rather than a file. Polling is out of scope — follow the
`response_url` fal hands back, never a URL you construct.

## 3D wave — the first category with two witnesses

`unmodel/3d` is the fourth category added in 2026 and the only one that did **not** ship on one
provider. The three above were deferred to fal alone because fal is where their models are
hosted; this one waited for a second, independent witness, because a 3D vocabulary read off a
single vendor would have been that vendor's request schema with the field names changed. Two
schemas in, `texture` already had five spellings and the output container four more.

**Tripo — `tripo3d.threeD` and `tripo3d.threeDFromImage`, 4 models.** Tier: **native**.
`https://openapi.tripo3d.ai/v3`, flat JSON, `Authorization: Bearer <TRIPO_API_KEY>`, one endpoint
per operation. Models `v3.1-20260211`, `v3.0-20250812`, `v2.5-20250123` and the low-poly
`P1-20260311` — the DATED ids every endpoint reference page and every `curl` example publishes.
(Tripo's `models-and-versions` page names the same four `tripo-v3.1`, `tripo-v3.0`, `tripo-v2.5`
and `tripo-p1`; the endpoint page is the per-route spec and is what the parameter's own enum is
written on, so it wins. The aliases are plausibly accepted and that is not verified.) Two
routes, both qualified the way `vidu.videoFromImage` is, because they are two URLs with
different required fields. Not served: the mesh-processing surface (texture, convert, segment,
decimate, rig, retarget) — mesh in, mesh out is a question no unmodel verb asks — and the
text-to-image routes, which resell seedream, gemini and gpt-image that unmodel already carries
from the vendors themselves.

Three cross-field rules Tripo documents and unmodel checks, each of them a 4xx otherwise:
seven parameters are gated on the model version and `v2.5-20250123` takes none of them;
`generate_parts: true` requires `texture`, `pbr` and `quad` all false, and the first two DEFAULT
to true; and the polycount ceiling moves with the model, with Ultra mode and with `quad`. A
fourth is a heuristic: `input` is one polymorphic string that accepts a `file_…` token, a public
URL or a prior `task_…` id, disambiguated by prefix and never inline bytes.

Pricing is per task in credits at $0.01 each, and this is the rare media provider whose estimate
is EXACT: the price is a pure function of the request body (base task type plus the add-ons the
body switched on), with no duration to guess and no output pixel count to infer. The one
exception is P1, whose credit table Tripo's pricing page renders client-side only — `undefined`
rather than borrowing the H-series numbers, which are demonstrably different.

**fal — `fal.threeD`, 19 endpoints.** Tripo H3.1 text/image, Tripo P1 text/image, Tripo v2.5
image and multiview, Hunyuan3D 2.0 and turbo, Hunyuan 3D 3.1 Pro text/image and Rapid image,
TRELLIS and TRELLIS 2, TripoSR, Hyper3D Rodin v2.5 and its text-only sibling, Meshy 7
text/image, Hi3D v3.0. Seven vendors, one address. `hitem3d/hi3d/v3.0/image-to-3d` is this
category's `model`-collision case: a `const "hi3dv3.0"` body field that stays on the wire while
`endpoint` routes.

Excluded by name: `tripo3d/h3.1/multiview-to-3d` (requires two views; `image` is one reference,
and half-serving it would be worse than not serving it), `fal-ai/hunyuan3d-v21` (fal marked it
`deprecated`), `tripo3d/triposplat` (gaussian splats are a point cloud, not a mesh),
`fal-ai/hunyuan_world/image-to-world` (a navigable scene, not an object). Excluded wholesale:
fal's twelve `3d-to-3d` endpoints — retopology, segmentation, retexture, rigging, part
splitting — which take a mesh and return one. `unmodel/3d` asks for an object to be MADE.

The overlap between the two providers is deliberate: `tripo3d/h3.1/image-to-3d` at fal and
`tripo3d/v3.1-20260211` natively are the same model reached two ways, which is the comparison
the category exists to make cheap. Where they disagree on a word — fal renames Tripo's `input`
to `image_url` and drops `smart_low_poly`, `generate_parts` and `compress` — the disagreement
lands in each row's extras rather than in the vocabulary.

## fal.ai wave — one aggregator, ten verbs

fal.ai is a generative-media inference cloud. unmodel serves **165 curated endpoints across
ten verbs** — `fal.image` (32), `fal.imageEdit` (17), `fal.video` (30), `fal.lipsync` (10),
`fal.upscale` (10), `fal.avatar` (8), `fal.threeD` (19), `fal.tts` (23), `fal.stt` (6),
`fal.music` (10) — all bare ids, all on `unmodel/fal`, with a unified adapter per category behind
`unmodel/fal/unified`. Tier: **generated**.

`fal.threeD` is the one verb here that is not its category's id, and the reason is mechanical:
an endpoint id's second segment is a module export name, and `3d` is not a JavaScript
identifier. The category id, the subpath (`unmodel/3d`) and the CLI's `unified.3d` all keep the
digit.

**The model IS the route.** `POST https://queue.fal.run/{endpoint_id}` with a flat JSON body and
no model field in it — the endpoint id is the URL path, at arbitrary depth. So the selector is a
pseudo-param named `endpoint`, stripped in `finalize` and interpolated into the URL; `model`
could not be it, because `model` is a **real wire field** on several endpoints
(`fal-ai/sync-lipsync/v2`, the Topaz and ESRGAN upscalers) and codegen hard-errors on a
top-level `model` property that curation has not allow-listed. Unified refs are unaffected:
`"fal/fal-ai/flux/dev"` splits on the FIRST slash, so unified callers still write `model:`.

```ts
import { image } from "unmodel/fal";

const request = image({ endpoint: "fal-ai/flux/dev", prompt: "a cat", image_size: "landscape_4_3" });

JSON.stringify(request);
// → {"prompt":"a cat","image_size":"landscape_4_3"}
request.request.url; // "https://queue.fal.run/fal-ai/flux/dev"
```

`endpoint` is not enumerable on the result — the body is exactly what fal accepts.

**Auth is prose, never derived.** `Authorization: Key ${FAL_KEY}` — the `Key ` prefix is real and
fal's own OpenAPI security scheme omits it, so unmodel states it in every validator's JSDoc
rather than deriving a header from the schema (the vidu `Token` precedent). No unmodel export
takes your key.

**Types come from fal's own OpenAPI.** fal publishes an OpenAPI 3.0.4 document per endpoint
through its documented Platform API (`GET https://api.fal.ai/v1/models?endpoint_id=…&expand=openapi-3.0`),
which makes it the first provider where "types from docs, never SDKs" has a machine-readable
source. `bun run codegen:fal` regenerates `src/providers/fal/gen/` from committed snapshots in
`data/fal/openapi/`; `codegen:fal:refresh` re-fetches them; `codegen:fal:audit` crawls the
roster and reports drift without writing. The generator emits DATA and TYPES only — every check,
message, estimate and doc comment is hand-written beside it, and no generated file is ever
hand-edited. See [src/providers/HAND_CATALOGS.md](../src/providers/HAND_CATALOGS.md).

**What is hand-maintained, and on what clock:** `data/fal/curation.json` (which endpoints, under
which verb, and an `excluded` map with a reason per skip), `data/fal/pricing.json` (every rate
transcribed from the public model page with its URL, date and exact quote — a curated endpoint
with neither a rate nor an `unpriced` reason fails codegen), and `data/fal/overlays.json` (every
deviation from fal's schema, each needing reason + source + verified). Three files because they
change on three different clocks; one blob would make an overlay look ordinary.

**Roster drift is a real failure mode, not a hypothetical.** `fal-ai/veo3` and `fal-ai/whisper`
both vanished from fal during the week this integration was designed. A weekly scheduled job
(`.github/workflows/codegen-fal-refresh.yml`) re-fetches every curated snapshot, reports each
hash change, status flip and 404, and opens a rolling pull request with the regenerated
surface; the CI run itself stays offline, because a provider outage must never be able to fail
an unrelated pull request. A `retiredOn` date in `curation.json` then ships the row as
`deprecated` for 90 days and hard-fails codegen after that, so it cannot rot silently. Pricing
is deliberately NOT refreshed by the job: fal publishes no machine-readable rate, so a human
re-reads the page.

**Not yet:** `.toApi("fal")` — retargeting a first-party media request onto fal's queue needs a
media retarget layer that does not exist (chat only, today), and `EndpointAuth.scheme` has no
`"Key"` arm. Also uncurated by decision, with reasons in `curation.json`: fal's `llm` category
(an OpenRouter passthrough — unmodel ships the real OpenRouter), `training` (57 endpoints that
start a fine-tune rather than an inference request), `vision` (34 doing image-in/text-out, which
`unmodel/chat` already owns), `3d` (53 — a 3D vocabulary on a single witness is a guess), and
the ffmpeg / workflow-utils / subtitles plumbing.

## LLM creators without a public API today (catalog-only or excluded)

motif-technologies, xiaomi (MiMo), thinking-machines (Inkling), nex-agi, china-mobile,
sapiens-ai, inclusionai (Ant Ling/Ring), sk-telecom, ai9stars, lg-ai-research (EXAONE),
servicenow, multiverse-computing, mbzuai-ifm, korea-telecom, celeris, trillion-labs,
openbmb, nanbeige, tii-falcon, allenai (Olmo — weights only).

## Unified surfaces — coverage per category

Twelve entries take a **standardized camelCase vocabulary** instead of a wire body and
compile it to whichever provider the `"provider/model"` ref names. They are a layer *over*
the roster above, not a replacement for it: a unified call compiles to a provider's wire
params and then runs **that provider's own validator**, so there is exactly one definition
of a valid request and the wire-exact subpaths stay the substrate and the escape hatch.
See `docs/decisions.md` for why that layering is fixed.

`unmodel/chat` is the one entry that can be asked for *any* provider from a bare
`"provider/model"` string, so its ready form composes all 32 validators (~1.7 MB, and it
is the whole of what a chat result's `.toApi` / `.toSdk` are built from). The composition
is the same either way: `unmodel/chat/factory`'s `createChat({ … })` builds the identical
surface from only the validators an application registers (~144 KiB plus those), and the
two produce byte-identical requests — asserted in `test/chat/factory.test.ts`. The media
packs make the same split with `create*`, but from one entry, because their adapters are
leaves rather than whole validators.

| Entry | Function(s) | Adapters | Providers covered |
|---|---|---|---|
| `unmodel/chat` | `chat` | n/a — three dialect codecs, composed with all 32 concrete provider `chat` validators | 32: every chat-validating provider except the four endpoint factories (amazon-bedrock, azure, cloudflare-workers-ai, google-vertex — a bare ref cannot carry their config) and cohere (a fifth dialect with no codec) |
| `unmodel/chat/factory` | `createChat` | the same three codecs, no registry | whichever provider validators you register: `createChat({ anthropic, openai })` |
| `unmodel/image` | `image`, `createImage` | 17 | black-forest-labs, bria, bytedance, fal, google, ideogram, kling, krea, leonardo, luma, openai, recraft, reve, runway, stability, vidu, xai |
| `unmodel/tts` | `tts`, `createTts` | 19 | alibaba, breezeblue, cartesia, deepgram, elevenlabs, fal, fish-audio, google, hume, inworld, lmnt, minimax, murf, openai, resemble, rime, smallest-ai, speechify, stepfun |
| `unmodel/stt` | `stt`, `createStt` | 13 | assemblyai, cartesia, deepgram, elevenlabs, fal, gladia, google, inworld, mistral, openai, revai, soniox, speechmatics |
| `unmodel/video` | `video`, `createVideo` | 13 | alibaba, bytedance, fal, google, kling, lightricks, luma, minimax, openai, pixverse, runway, vidu, xai |
| `unmodel/image-edit` | `imageEdit`, `createImageEdit` | 5 | black-forest-labs, fal, ideogram, openai, recraft — the five whose primary editing route is *image + prompt, no mask* |
| `unmodel/music` | `music`, `createMusic` | 5 | elevenlabs, fal, google, mureka, stability |
| `unmodel/lipsync` | `lipsync`, `createLipsync` | 1 | fal — 10 endpoints behind one adapter, because at fal the route is a parameter rather than a provider |
| `unmodel/avatar` | `avatar`, `createAvatar` | 1 | fal — 8 endpoints; the still-driven twin of lipsync |
| `unmodel/upscale` | `upscale`, `createUpscale` | 1 | fal — 10 endpoints, seven taking a still and three taking a clip |
| `unmodel/3d` | `threeD`, `createThreeD` | 2 | fal (19 endpoints from seven vendors), tripo3d (4 models over two routes) — the first category shipped with two witnesses, and the only one where an aggregator's resale and the vendor's own API are both in the pack |
| `unmodel/voice-clone` | `voiceClone`, `createVoiceClone` | 6 | cartesia, elevenlabs, fish-audio, inworld, lmnt, minimax — speechify's clone route is wire-only (its consent challenge/response ceremony is a one-provider, multi-request flow) |
| `unmodel/voice-design` | `voiceDesign`, `createVoiceDesign` | 4 | elevenlabs, fish-audio, inworld, minimax — the unified surface is phase 1 (the generative call); the ElevenLabs/Inworld save steps are wire-only (`voiceDesignSave`, `voiceDesignPublish`) |

**Layout.** Each adapter lives in the provider's own directory as
`unified-<category>.ts`, re-exported from a single `unified.ts` barrel published as
`unmodel/<provider>/unified` (43 such subpaths). A provider serving more than one category
therefore splits per category, so no pack pays for another category's schemas or catalogs.
`test/bundle-budget.test.ts` asserts a pack can only reach a provider through that
provider's uniformly-named endpoint module — which is what makes the address-vs-wire
rename structural rather than cosmetic. The split is **derived from disk** rather than
listed: a provider with more than one `unified-<category>.ts` leaf is split, which is what
keeps a newly split provider from silently skipping every per-category budget.

**Types without runtime.** Every provider in the roster above also publishes
`unmodel/<provider>/types` (73 subpaths): its wire names verbatim plus one uniform
`<Endpoint>Body` alias per endpoint address it serves — 189 endpoints in all — and nothing
executable. `unmodel/types` is the matching hub for the canonical vocabulary
(`ChatParams`, `TtsParams`, `ImageParams`, …, `Issue`, `ValidateResult`), deliberately with
no aggregate of provider wire types. All 74 entries emit an empty JavaScript module, which
`test/types-entries.test.ts` asserts against a real build alongside the completeness drift
guard keyed on `src/cli-registry.ts`.

**Values without a validator.** The 42 providers with a unified adapter also publish
`unmodel/<provider>/values`: the runtime twin of those types — `<CATEGORY>_MODEL_PARAMS`,
`<CATEGORY>_MODELS` and `<CATEGORY>_FORMAT_SPEC` per category served, plus that provider's own
published enums (voices, sizes, ratios, durations, codecs, languages) under their own names.
The tables are the **same objects** the adapter compiles with, which is why they sit on
import-free `<category>-params.ts` leaves that both read: one import from a values entry costs
~1 KiB (19.4 KiB at the worst, runway's) instead of the 30–82 KiB a validator would drag.
`unmodel/values` is the canonical hub (the closed unions as arrays, `CANONICAL_KEY_LISTS`,
`CHAT_PROVIDERS`) and `unmodel/values/chat-refs` carries the 1,339 chat refs on their own
subpath because they are 45 KiB. `test/values-entries.test.ts` measures every export against a
real build and asserts the tables by reference.

**Contract, identical in all eleven.** A param a provider cannot express is an **error**
naming what it does offer; a value it can only express approximately is an
`approximated_param` **warning** naming both the requested and the achieved value;
everything else is silent — so zero warnings means the request mapped exactly, asserted per
category by a golden matrix that compiles one canonical request at every provider that can
express it. Anything genuinely one-off rides in `providerOptions`, keyed by provider and
deep-merged over the compiled body **before** validation.

**Declared gaps** (each is a typed refusal with a message naming the wire-only sibling that
does the job): black-forest-labs' Kontext
`input_image` is a JSON string, so its `imageInputs` is `["data", "url"]`; Google's
`fileData.fileUri` is a Files API name rather than an arbitrary URL and Gemini fetches no
third-party host, so `google.stt`'s `audioInputs` is `["data", "fileId"]` and `{ url }` is
refused with the upload path spelled out; Stability's
`musicFromAudio` / `musicInpaint` and the sixteen masked editing routes take controls no
other provider has, so a canonical vocabulary for them would be a vocabulary of one; Hume's
voice design IS its TTS wire (a description-only `/v0/tts` call, fully expressible through
`unmodel/hume`'s own `tts`), so a `voiceDesign` adapter there would return a TTS `Validated`
from a design call and muddle what the result is.

**Voice creation, and who is out.** The clone pack's excluded providers each carry a
documented reason rather than a gap: Speechify is wire-only (consent ceremony, above);
Resemble's voice building is a create-then-upload-then-build multi-endpoint flow (its
models.ts already catalogs unvalidated capabilities and this is one); Google's
`voices:generateVoiceCloningKey` is allowlist-gated and returns an opaque key rather than a
voice; smallest.ai's `add_voice` survives only in archived docs (the current docs describe
cloning as console-only); OpenAI, Gemini, Deepgram, Murf and Rime publish no self-serve
voice-creation endpoint at all.

**Roadmap.** Every category with more than one provider now has a pack, so a new adapter is
the unit of growth rather than a new entry. The voice-creation pair landed exactly the way
this paragraph has always prescribed — thirteen wire-exact endpoints first, the two packs
second — and embeddings, which still have neither, follow the same order when they land:
wire-exact subpath first, adapter second.

## Output targets — `.toSdk(target)` and `.toApi(provider)`

Two different vocabularies, both closed unions, both catalog-id-based.

**`.toSdk(target)` — every endpoint, 189 of them.** (The count is not maintained by hand:
`src/cli.test.ts`'s drift guard asserts `REGISTRY` + `MULTIPART_ONLY` are exactly the set of
module-level validators, so that test is the source of truth if this number ever rots.)
The target set is a property of
the *endpoint*: each `finalize` declares a literal map of zero-arg formatters and the
union is `keyof` that map. There is no zero-argument form and no global registry — a
registry would be order-dependent under bundled `.d.ts` emit and would offer
`unmodel/openai`'s `tts` endpoint Anthropic's targets. Targets are catalog provider
ids, plus exactly one reserved non-catalog id, `"ai-sdk"` (the `ai` npm package).

`"ai-sdk"` is declared only where the AI SDK's own API is stable (checked 2026-08-13):
`generateText`/`streamText` — so every chat endpoint. `experimental_generateVideo`,
`experimental_streamTranscribe` and `experimental_streamTranslate` keep video and the
streaming audio routes out for now. Offering a target the SDK cannot actually serve is
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
really is a `google.chat` (`:generateContent`) request.

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
translate through. The retargeting guide (validation.md) says so explicitly, because chat-has-it/media-doesn't
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
3. **New endpoint shapes**: TTS (`tts`), STT (`stt`), image
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
   `imageEditToFormData` / `sttToFormData`).
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
