# unmodel

Validation layer for LLM API calls: catalog-aware, zod-powered request validation and response sanity checks — bring your own SDK or fetch.

unmodel does **not** perform generation and never touches your API keys. You build and validate request params through unmodel, then send them yourself: over raw `fetch`, or through an SDK via `.toSdk(target)`. After the call, `check*` helpers inspect the raw response for silent quality problems (truncation, refusals, content filtering) and price the actual usage.

- **Wire-format params.** Params mirror each provider's raw REST body exactly — no unified cross-provider format to learn or debug through.
- **Catalog-aware.** Backed by a generated [models.dev](https://models.dev) catalog: context windows, output limits, per-token pricing, capabilities, deprecations.
- **Types that beat the SDK.** Params are typed from each provider's current **documentation**, not from its SDK: narrowed where the SDK permits what the API rejects, widened where the SDK's enum is a subset of the documented reality. Every deviation cites the doc URL it came from.
- **Retarget, don't rewrite.** `.toApi(provider)` moves a validated chat request to any provider that serves the same model — translating the wire format and respelling the model id. Which providers those are is typed per model, so the wrong destination is a compile error rather than a 404. The model's home provider is always among them, as the identity retarget, so a provider-generic call site needs no special case for "the provider I already am".
- **Zero provider dependencies.** Provider SDKs are never imported at runtime. `zod` is the only dependency of the library entry points — including the Vercel AI SDK adapter, which takes `ai`'s `jsonSchema` as an argument instead of importing it.

Runtime-agnostic: Node ≥ 20, Bun, Cloudflare Workers.

```sh
npm install unmodel   # or bun add unmodel
```

## Quickstart: raw fetch

```ts
import { chat } from "unmodel/openai";

// Throws UnmodelValidationError with precise, path-addressed issues if invalid.
const validated = chat({
  model: "gpt-5.2",
  messages: [{ role: "user", content: "Hello!" }],
  max_completion_tokens: 256,
});

// Enumerable properties ARE the exact fetch body.
const res = await fetch(validated.request.url, {
  method: validated.request.method, // "POST"
  headers: {
    ...validated.request.headers, // static non-auth headers only
    authorization: `Bearer ${process.env.OPENAI_API_KEY}`, // you own auth
  },
  body: JSON.stringify(validated),
});
```

`.request` carries whatever static headers the endpoint requires — e.g. for Anthropic it includes `anthropic-version` alongside `content-type`. Auth is deliberately your job.

## Quickstart: your provider SDK

```ts
import OpenAI from "openai";
import { chat } from "unmodel/openai";

const openai = new OpenAI();

const validated = chat({
  model: "gpt-5.2",
  messages: [{ role: "user", content: "Hello!" }],
});

// .toSdk(target) re-shapes the body for one SDK (non-enumerable, so it never
// leaks into JSON.stringify).
const completion = await openai.chat.completions.create(validated.toSdk("openai"));
```

`.toSdk` takes a **target** because a validated body has more than one honest
SDK shape, and which shapes exist is a property of the *endpoint*, not of the
library. Each endpoint declares its own map of formatters, so the union is
exactly what that endpoint can produce — asking for anything else is a compile
error rather than a wrongly-shaped object:

| Endpoint family | `.toSdk` targets |
| --- | --- |
| `openai.chat` and every OpenAI-compatible overlay (`unmodel/groq`, `unmodel/openrouter`, `unmodel/togetherai`, …) | `"openai"`, `"ai-sdk"` |
| `anthropic.chat` | `"anthropic"`, `"ai-sdk"` |
| `google.chat`, `google-vertex.chat` | `"google"`, `"ai-sdk"` |
| `amazon-bedrock.chat` | `"amazon-bedrock"` (Converse command input) |
| `cohere.chat` | `"cohere"` |
| image / speech / video endpoints | that provider's own SDK id |

The whole OpenAI-compatible fleet declares the same `"openai"` target, because
that is genuinely the SDK you call them with (`new OpenAI({ baseURL })`, or a
vendor fork of it with the same param shape). There is no zero-argument
`.toSdk()`: an endpoint with one target still names it, so adding a second one
later is not a breaking change.

### The Vercel AI SDK: `.toSdk("ai-sdk")`

Chat endpoints also format for the [AI SDK](https://ai-sdk.dev)'s
`generateText` / `streamText` options — messages, settings, and tools, with
everything non-portable routed into `providerOptions`:

```ts
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { chat } from "unmodel/anthropic";

const v = chat({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});

await generateText({ model: anthropic("claude-opus-5"), ...v.toSdk("ai-sdk") });
```

Tools need one extra step. unmodel emits each tool's `inputSchema` as plain
JSON Schema, but the AI SDK's JSON-Schema path wants its own `jsonSchema()`
wrapper — a symbol-branded value unmodel cannot forge without depending on
`ai`. So `unmodel/ai-sdk` takes the wrapper as an argument instead:

```ts
import { generateText, jsonSchema } from "ai";
import { withJsonSchemaTools } from "unmodel/ai-sdk";

await generateText({
  model: anthropic("claude-opus-5"),
  ...withJsonSchemaTools(v.toSdk("ai-sdk"), jsonSchema),
});
```

That keeps `ai` out of unmodel's dependencies *and* out of its peer
dependencies, and it works across `ai` versions because the wrapper is yours.
Requests without tools need no adapter at all.

> ⚠️ **`"ai-sdk"` and `"vercel"` are different things — same company.**
> `toSdk("ai-sdk")` formats options for the `ai` npm package (Vercel's AI SDK).
> `toApi("vercel")` retargets the request to the Vercel **AI Gateway**, a
> models.dev provider with its own HTTP API — the one `unmodel/vercel`
> validates. `"ai-sdk"` is the only target id in the library that is not a
> catalog provider id; every other one, on both methods, is.

## Retargeting: `.toApi(provider)`

Chat validators also carry `.toApi(provider)`, which rewrites a validated
request for any provider that serves the same model — translating the wire
format when the target speaks a different dialect, and respelling the model id,
because providers do not agree on what a model is called:

```ts
import { chat } from "unmodel/anthropic";

const req = chat({
  model: "claude-opus-5",
  max_tokens: 4096,
  thinking: { type: "enabled", budget_tokens: 2048 },
  messages: [{ role: "user", content: "Explain retargeting." }],
});

const viaOpenRouter = req.toApi("openrouter");
viaOpenRouter.model;       // "anthropic/claude-opus-5" — OpenRouter's spelling
viaOpenRouter.messages;    // Anthropic blocks → Chat Completions message parts
viaOpenRouter.request.url; // https://openrouter.ai/api/v1/chat/completions
viaOpenRouter.warnings;    // what the translation cost — see below
```

**The target list is typed per model**, from a generated availability table
scoped to the provider you imported. So the wrong destination is a compile
error, not a 404 three seconds into a request:

```ts
req.toApi("openai");
//         ~~~~~~~~ Argument of type '"openai"' is not assignable to
//                  '"anthropic" | "openrouter" | "vercel"'.
//                  OpenAI does not serve Claude.
```

**A model's home provider is always a valid target**, as the identity retarget:
`.toApi("anthropic")` on a Claude request — or `.toApi("openai")` on
`chat({ model: "gpt-5.2" })` — returns the same wire body at the same URL, with
no warnings. It is there so a provider-generic call site
(`req.toApi(providerFromConfig)`) does not need a special case for the provider
it already is, and so a model nobody else serves still gets a target union of
exactly one id instead of degrading to "every provider, runtime-checked".

The table is per provider on purpose: `unmodel/anthropic` carries availability
for Anthropic's own models — a dozen entries — not for the ~6,000
provider×model pairs in the catalog. A single global map measured at +29,000
types and 1.39 MB of `.d.ts` on *every* subpath consumer; the per-provider one
is 4 KB.

The result is a one-hop `Validated`: enumerable properties are the target's
wire body, plus non-enumerable `.request`, `.toSdk(target)`, `.target` and
`.warnings`. There is no `.toApi` on the result — one hop is all it takes, and
chaining would drag every provider's availability data into every bundle.
`.toApiSafe(provider)` is the non-throwing form, and it never throws — a target
whose codec this build does not ship comes back as `{ ok: false }` with
`meta.structural` on the error, not as an exception, so a `safe()` caller never
needs a `try`.

### What the translation cost

`.toApi` never throws on lossiness and never silently drops. Every removal or
approximation emits exactly one warning, so `warnings` is a complete audit
trail rather than a hint:

```ts
for (const w of viaOpenRouter.warnings) console.warn(w.code, w.message);
// id_respelled       "claude-opus-5" is spelled "anthropic/claude-opus-5" on
//                    openrouter; the retargeted body carries the target's id.
// approximated_param a 2048-token reasoning budget has no chat-completions
//                    equivalent; it was bucketed to `reasoning_effort: "low"`,
//                    which the target sizes on its own terms.
```

`id_respelled` is present whenever the two providers spell the model
differently — it is the record of the swap — so **a translation whose only
warning is `id_respelled` is lossless**, and one with *no* warnings at all
(the identity retarget, or a hop where both ends use the same id) changed
nothing whatsoever. Anything
else (`dropped_param`, `approximated_param`, `dropped_content`, `dropped_tool`,
`synthesized_tool_call_id`, `capability_narrowed`) names the param, both
dialects, and why.

### What retargeting checks, and what it does not

It **does** re-run the destination's hand-written param rules. Groq's
OpenAI-compatible endpoint 400s on `logprobs`, `logit_bias` and `top_logprobs`,
so retargeting a body carrying them raises a `UnmodelValidationError` naming
each param and citing Groq's compatibility doc, rather than shipping a request
the wire rejects:

```ts
chat({ model: "Qwen/Qwen3.6-27B", messages, logprobs: true }).toApi("groq");
// UnmodelValidationError: Invalid params for deepinfra.chat → groq.chat:
//   - [unsupported_param] logprobs: `logprobs` is not supported by
//     "qwen/qwen3.6-27b": Groq's OpenAI-compatible endpoint returns a 400 error
```

Those tables are tiny hand-written literals, so this costs essentially nothing.

It does **not** re-run the destination's **catalog** checks — context windows,
pricing, capabilities — because that would mean loading every possible target's
model list into every subpath. This gap is real: across the catalog only ~41%
of cross-provider model pairs share the same context limit. Generated `narrows`
metadata covers the two cases that actually bite (a smaller context window, a
lost input modality) as `capability_narrowed` warnings, at zero import cost.
Rules that need the target's own catalog to even *evaluate* (xAI's
"reasoning models reject `stop`", which is keyed off a catalog flag) are out
for the same reason.

For a full catalog-aware pass, hand the retargeted body to the destination's
own validator. You already import it — that is what makes you care — so you pay
for that catalog only if you ask for it:

```ts
import { chat as openrouterChat } from "unmodel/openrouter";

// The extras are non-enumerable, so they are not part of the wire body;
// splitting them off is what makes the rest exactly this provider's params.
const { request, toSdk, target, warnings, ...body } = req.toApi("openrouter");
const checked = openrouterChat(body);
```

### Scope

- **Chat only.** Media endpoints (`image`, `speech`, `transcribe`,
  `video`, …) have `.toSdk` but no `.toApi`. That asymmetry is a scope
  decision, not an oversight: across the providers unmodel implements there are
  exactly five multi-provider media model groups in the catalog, and their wire
  formats share no dialect to translate through. The moment cross-provider
  media serving is real, the same machinery generates it.
- **No factory providers as targets, yet.** `amazon-bedrock`, `google-vertex`
  and `azure` are excluded from the `.toApi` union in this release: `.toApi` is
  synchronous and total, and it cannot build a URL without a `region`,
  a `project` + `location`, or your resource `endpoint`. Their edges are
  already in the generated availability data, and a two-argument overload —
  `toApi("amazon-bedrock", { region })` — is reserved as a non-breaking
  follow-up. Until then use those providers' own factories
  (`createAmazonBedrock({ region }).chat(…)`), which are the first-class
  path anyway.
- **A few edges are denied on purpose.** Claude on Azure and Claude on Vertex
  are in the catalog but their wire surfaces are unverified (Vertex serves
  Claude through a `rawPredict` route unmodel has no module for), so those
  edges are switched off in `data/availability-overrides.json` rather than
  shipped as a compile-time promise that 404s.

## Providers

### Chat — native wire formats

| Subpath | Validators |
| --- | --- |
| `unmodel/openai` | `chat`, `checkChat`, `realtimeSession` (session config) — the image, speech and video validators are listed in their own sections below |
| `unmodel/anthropic` | `chat`, `checkChat` |
| `unmodel/google` | `chat`, `checkChat` — Imagen and Veo below |
| `unmodel/cohere` | `chat` (v2 Chat API), `checkChat` |

Some endpoints have no provider-wide static URL — the URL embeds your cloud
resource, project, or region. Those subpaths export a factory that returns the
same validator surface bound to your endpoint:

| Subpath | Factory | Validators returned |
| --- | --- | --- |
| `unmodel/azure` | `createAzure({ endpoint })` | `chat`, `checkChat`, `estimateChatTokens` (Azure OpenAI v1; `model` = your deployment name) |
| `unmodel/google-vertex` | `createGoogleVertex({ project, location })` | `chat`, `checkChat` (Gemini on Vertex AI) |
| `unmodel/amazon-bedrock` | `createAmazonBedrock({ region })` | `chat`, `checkChat` (Bedrock Converse; `modelId` moves into `.request.url`) |
| `unmodel/cloudflare-workers-ai` | `createCloudflare(accountId)` | `chat`, `checkChat`, `estimateChatTokens` (Workers AI, OpenAI-compatible) |

### Chat — OpenAI-compatible fleet

These providers speak the OpenAI Chat Completions dialect. Each subpath exports
the same surface — `chat`, `checkChat`, `estimateChatTokens`, `models`,
`provider` — with `model` narrowed to that provider's catalog and hand-written
constraints for its documented quirks:

`unmodel/alibaba` (Qwen / DashScope), `unmodel/baseten`, `unmodel/cerebras`,
`unmodel/deepinfra`, `unmodel/deepseek`, `unmodel/fireworks-ai`,
`unmodel/friendli`, `unmodel/groq`, `unmodel/huggingface` (router),
`unmodel/inception` (Mercury), `unmodel/longcat`, `unmodel/meta` (Model API),
`unmodel/minimax`, `unmodel/mistral`, `unmodel/moonshotai` (Kimi),
`unmodel/nebius`, `unmodel/novita-ai`, `unmodel/nvidia` (NIM),
`unmodel/openrouter`, `unmodel/perplexity`, `unmodel/sarvam`,
`unmodel/scaleway`, `unmodel/siliconflow`, `unmodel/stepfun`,
`unmodel/togetherai`, `unmodel/upstage` (Solar), `unmodel/vercel` (AI
Gateway), `unmodel/xai` (Grok), `unmodel/zhipuai` (GLM).

```ts
import { chat } from "unmodel/groq";

const validated = chat({
  model: "llama-3.3-70b-versatile", // Groq's catalog autocompletes; unknown ids warn at runtime
  messages: [{ role: "user", content: "Hello!" }],
});

const res = await fetch(validated.request.url, {
  method: validated.request.method,
  headers: {
    ...validated.request.headers,
    authorization: `Bearer ${process.env.GROQ_API_KEY}`,
  },
  body: JSON.stringify(validated),
});
```

For an OpenAI-compatible endpoint unmodel doesn't ship (a proxy, a self-hosted
server), `unmodel/openai-compatible` exports the `createOpenAICompatible`
factory the fleet itself is built on — bring your own base URL and catalog.

### Speech — TTS and STT

Native wire formats, hand-maintained catalogs, non-token pricing
(per-character TTS, per-second/minute STT).

**Text to speech**

Every provider addresses its synthesis route as `speech` — the wire spellings
(`/v1/text-to-speech/{voice_id}`, `/tts/bytes`, `/v1/speak`, `/v1/t2a_v2`,
`/synthesize`) survive on the URL constants and the wire types, not on the
export you call. All fourteen also ship a `unified.ts` adapter, so the same
request can be written once against
[`unmodel/speech`](#unified-media-one-vocabulary-per-category).

| Subpath | Validators |
| --- | --- |
| `unmodel/openai` | `speech` — `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`, `gpt-4o-mini-tts-2025-12-15` |
| `unmodel/cartesia` | `speech` (Sonic) |
| `unmodel/deepgram` | `speech` (Aura 1 / Aura 2) |
| `unmodel/elevenlabs` | `speech` |
| `unmodel/fish-audio` | `speech` (S2 / speech-1.x — msgpack or JSON body) |
| `unmodel/hume` | `speech` (Octave, `octave` / `octave-2`) |
| `unmodel/inworld` | `speech` |
| `unmodel/lmnt` | `speech` (audio bytes), `speechDetailed` (JSON + durations) |
| `unmodel/minimax` | `speech` (T2A v2) |
| `unmodel/murf` | `speech` + `checkSpeech`, `speechStream` |
| `unmodel/resemble` | `speech` + `checkSpeech`, `speechStream` |
| `unmodel/rime` | `speech` (Arcana / Mist) |
| `unmodel/smallest-ai` | `speech` (Lightning v3.1 / v3.1 Pro) |
| `unmodel/speechify` | `speech`, `speechStream` (Simba) |

**Speech to text**

Every provider addresses its transcription route as `transcribe` — the wire
spellings (`/v1/audio/transcriptions`, `/v1/speech-to-text`, `/v1/listen`,
`/v2/transcript`, `/v2/pre-recorded`, `/speechtotext/v1/jobs`, `/v2/jobs`,
`/stt`) survive on the URL constants and the wire types, not on the export you
call. All eleven also ship a `unified.ts` adapter, so the same request can be
written once against
[`unmodel/transcribe`](#unified-media-one-vocabulary-per-category) — where the
`audio` shapes each route accepts are enforced at compile time.

| Subpath | Validators |
| --- | --- |
| `unmodel/openai` | `transcribe` + `transcribeToFormData` — `gpt-transcribe`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe-diarize`, `whisper-1` |
| `unmodel/assemblyai` | `transcribe` + `checkTranscript` |
| `unmodel/cartesia` | `transcribe` + `toFormData` + `checkStt` |
| `unmodel/deepgram` | `transcribe` + `checkListen` |
| `unmodel/elevenlabs` | `transcribe` + `toFormData` + `checkTranscription` |
| `unmodel/gladia` | `transcribe` + `toUploadFormData` + `checkPreRecorded` |
| `unmodel/inworld` | `transcribe` — base64 audio inline in the JSON body (no multipart route; the ~16MB cap is a request-size cap) |
| `unmodel/mistral` | `transcribe` + `toFormData` + `checkTranscription` (Voxtral) |
| `unmodel/revai` | `transcribe` + `toFormData` + `checkJob` |
| `unmodel/soniox` | `transcribe` + `toUploadFormData` + `checkTranscription` |
| `unmodel/speechmatics` | `transcribe` + `toFormData` + `checkJob` |

Every STT form-data helper builds the `multipart/form-data` body for audio
bytes, so the validated params stay wire-shaped and the `Blob` never has to
round-trip through JSON. Which body a route wants differs by provider:

- **Multipart is the route** — `cartesia.transcribe`,
  `elevenlabs.transcribe`, `mistral.transcribe`, `speechmatics.transcribe`: post
  `toFormData(validated)`,
  never `JSON.stringify`. `.request.headers` names no content type (only a
  required version header, where the provider has one) precisely because the
  boundary belongs to the `FormData` and `fetch` derives it.
- **Multipart is the byte-upload alternative** — `revai.transcribe`: JSON with a
  remote `source_config.url`, or `toFormData` when you hold the bytes.
- **Multipart is a separate upload endpoint** — `gladia.toUploadFormData`
  (`UPLOAD_URL`) and `soniox.toUploadFormData` (`FILES_URL`) upload the audio first;
  the transcription request itself stays JSON and references what came back.

```ts
import { speech } from "unmodel/elevenlabs";

const validated = speech(
  {
    voice_id: "JBFqnCBsd6RMkjVDRZzb", // path param — moved into .request.url
    text: "Hello from unmodel!",
    model_id: "eleven_multilingual_v2",
    output_format: "mp3_44100_128", // query param — also moved into the URL
  },
  // Character-priced: fails with over_budget if the text would cost more.
  { maxCostUSD: 0.05 },
);

const res = await fetch(validated.request.url, {
  method: validated.request.method,
  headers: {
    ...validated.request.headers,
    "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
  },
  body: JSON.stringify(validated), // wire body only — no voice_id/output_format
});
const audio = await res.arrayBuffer();
```

**Realtime session configs**

A realtime speech API is configured by one JSON object — a connection-URL query
set, a first configuration frame, or a per-chunk generation message — and *that
object* is what unmodel validates, on the same terms as `openai.realtimeSession`.
The socket lifecycle around it (opening the connection, framing audio,
keepalives, transcript/audio events, closing) is transport and stays out of
scope; every module says so in its header, next to the doc URL it was verified
against.

| Subpath | Validators | The config object |
| --- | --- | --- |
| `unmodel/openai` | `realtimeSession` | The GA session config — both the `session` field of `POST /v1/realtime/client_secrets` and the `session.update` client event |
| `unmodel/cartesia` | `ttsWebsocket` + `ttsWebsocketUrl`, `sttWebsocket` + `sttWebsocketUrl` | TTS: one generation message per transcript chunk of a context. STT: the connection query set — `ink-2` is realtime-only, the mirror of batch `/stt` |
| `unmodel/deepgram` | `listenLive`, `listenFlux` + `fluxConfigure`, `speakLive` | Live STT (`v1/listen`), turn-based Flux STT (`v2/listen`) plus its mid-stream `Configure` message, and Aura streaming TTS (`v1/speak`) — query-param configs, so the config *is* the URL |
| `unmodel/elevenlabs` | `textToSpeechStreamInput` + `textToSpeechStreamInputUrl` + `toInitializeConnectionMessage`, `speechToTextRealtime` + `speechToTextRealtimeUrl` | TTS: the socket query params plus the first `InitializeConnection` message. STT: the Scribe v2 Realtime query set (`scribe_v2_realtime` only) |
| `unmodel/inworld` | `realtimeTranscribeConfig`, `realtimeVoiceContext` | The first frame of each bidirectional socket: `transcribeConfig` (STT) and the `create` payload that opens a voice context (TTS) |
| `unmodel/soniox` | `realtimeTranscription` | The configuration message sent as the first message after connecting |

Where the socket address is knowable from the config alone — the params *are*
the query (`deepgram`) or the address is fixed and the config travels as a frame
(`inworld`, `soniox`) — `.request` describes that socket instead of a POST:
`.request.url` is the `wss://` address and `.request.method` is `"GET"`, because
a WebSocket handshake is an HTTP GET upgrade and carries no body. Where the
address has to be assembled from params that are not the whole config, or the
config is one message on an already-open socket, there is no `.request` at all
and the subpath exports a URL builder instead (`cartesia`, `elevenlabs`).
`openai.realtimeSession` is the odd one out and keeps a real REST `.request`:
minting a client secret is an ordinary POST.

```ts
import { listenLive } from "unmodel/deepgram";

// Catalog-aware like any other endpoint: unknown models warn, documented
// bounds and per-model gates are enforced, encodings are checked against the
// live roster (not the batch one).
const session = listenLive({
  model: "nova-3",
  encoding: "linear16",
  sample_rate: 16000,
  interim_results: true,
  utterance_end_ms: 1000,
});

// The whole config rides in the query, so .request.url is ready to open.
// Auth and the connection itself stay yours.
const socket = new WebSocket(session.request.url, [
  "token",
  process.env.DEEPGRAM_API_KEY ?? "",
]);
```

### Image generation

Native wire formats, hand-maintained catalogs, per-image (or per-megapixel /
credit-based) pricing:

| Subpath | Generation | Editing |
| --- | --- | --- |
| `unmodel/openai` | `image` (gpt-image + DALL·E), `checkImages` | `imageEdit` + `imageEditToFormData` |
| `unmodel/google` | `image` (Imagen 4 fast/standard/ultra) | — (Gemini image editing goes through `chat`) |
| `unmodel/black-forest-labs` | `image` (FLUX.2 route family), `imageFlux1` (FLUX 1.1 / dev / ultra), `imageEdit` | `imageEditFill`, `imageEditExpand`, `imageEditOutpainting`, `imageEditErase`, `imageEditDeblur`, `imageEditVto` |
| `unmodel/bria` | `image`, `imageLite` (FIBO / Fibo Lite) | `imageEdit` |
| `unmodel/bytedance` | `image` (Seedream 4.x/5.x on BytePlus ModelArk — reference images ride the same route) | — |
| `unmodel/kling` | `image`, `imageOmni` | — |
| `unmodel/krea` | `image` | — |
| `unmodel/leonardo` | `image` (Lucid Origin/Realism, Phoenix) | — |
| `unmodel/recraft` | `image` | `imageEdit`, `imageEditInpaint`, `imageEditOutpaint`, `imageEditGenerateBackground`, `imageEditReplaceBackground` (+ `toFormData`) |
| `unmodel/ideogram` (+ `toFormData`) | `image` (v3), `imageV4` | `imageEdit`, `imageEditRemix`, `imageEditReframe`, `imageEditReplaceBackground` |
| `unmodel/reve` | `image` (v1), `imageV2` | `imageEdit`, `imageEditRemix` |
| `unmodel/stability` (+ `toFormData`) | `image` (Ultra), `imageCore`, `imageSd3` | `imageEditErase`, `imageEditInpaint`, `imageEditOutpaint`, `imageEditSearchAndReplace`, `imageEditSearchAndRecolor`, `imageEditRemoveBackground` |
| `unmodel/luma` | `image` (Photon) | `imageEditReframe` |
| `unmodel/runway` | `image` | — |
| `unmodel/vidu` | `imageFromReference` | — |

Every generation route above is addressed as `image` whatever the wire calls it
(`/v1/images/generations`, `:predict`, `/v1/ideogram-v3/generate`,
`/v1/text_to_image`, `/ent/v2/reference2image`); a provider with more than one
generation route qualifies the extras (`imageCore`, `imageV4`, `imageFlux1`) and
never the primary one. The URL constants and wire types keep their wire
spelling. One canonical `image()` over all fifteen lives at
[`unmodel/image`](#unified-media-one-vocabulary-per-category).

The editing column follows the same law with its own verb: every image-to-image
route is `imageEdit`, and each extra route qualifies by *what it does to the
picture* (`imageEditInpaint`, `imageEditErase`, `imageEditReframe`,
`imageEditSearchAndReplace`) rather than by the wire path or the vendor's
product name — `/v1/images/imageToImage`, `/v1/ideogram-v3/remix`,
`/v2beta/stable-image/edit/search-and-replace` and FLUX Kontext all keep their
spellings on the URL constants and the `*Params` types. One canonical
`imageEdit()` over four of them lives at
[`unmodel/image-edit`](#unified-media-one-vocabulary-per-category).

`toFormData` sits on the subpath, not on one route: Ideogram's and Stability's
image routes are multipart end to end, so the same helper builds the body for
every validator in those rows (and for Stability's audio routes below).
Recraft's is listed with the edit routes because `image` is plain JSON —
only the transform routes switch to multipart, and only when you pass a `Blob`.

```ts
import { image } from "unmodel/black-forest-labs";

// BFL has no `model` body field — the model IS the route. unmodel strips it
// from the wire body and interpolates it into .request.url.
const validated = image({
  model: "flux-2-pro",
  prompt: "a watercolor fox in the snow",
  width: 1024,
  height: 1024,
  output_format: "png",
});

// POST https://api.bfl.ai/v1/flux-2-pro — an async job: the response is
// { id, polling_url }, which you poll yourself (BFL_GET_RESULT_URL).
const res = await fetch(validated.request.url, {
  method: validated.request.method,
  headers: {
    ...validated.request.headers,
    "x-key": process.env.BFL_API_KEY ?? "", // auth is your job
  },
  body: JSON.stringify(validated), // wire body only — no `model`
});
```

### Video generation

| Subpath | Validators |
| --- | --- |
| `unmodel/openai` | `video` (Sora 2) |
| `unmodel/google` | `video` (Veo) |
| `unmodel/bytedance` | `video` (Seedance / Dreamina Seedance on BytePlus ModelArk) |
| `unmodel/kling` | `video`, `videoFromImage` (`POST /v1/videos/*`) — plus the EXPERIMENTAL path-addressed `videoV3`, `videoV3FromImage`, `videoOmni` |
| `unmodel/lightricks` | `video`, `videoFromImage`, `videoFromAudio` (LTX-2 family) |
| `unmodel/luma` | `video` (Ray) — plus the post-production routes `videoModify`, `videoReframe`, `videoUpscale`, `videoAddAudio` |
| `unmodel/minimax` | `video` (Hailuo), `videoV2` (MiniMax-H3) |
| `unmodel/pixverse` | `video`, `videoFromImage` |
| `unmodel/runway` | `video`, `videoFromImage`, `videoFromVideo` (Aleph 2 and the hosted Hailuo/Seedance routes) |
| `unmodel/vidu` | `video`, `videoFromImage`, `videoFromReference` |

Every generation route above is addressed as `video` whatever the wire calls it
(`/v1/videos`, `:predictLongRunning`, `/v1/videos/text2video`, `/ent/v2/text2video`,
`/api/v3/contents/generations/tasks`); a provider with more than one video route
qualifies the extras by what makes them different — what the clip is made from
(`videoFromImage`, `videoFromVideo`, `videoFromReference`, `videoFromAudio`),
which route family serves it (`videoV2`, `videoV3`, `videoOmni`), or what it does
to a finished clip (`videoModify`, `videoUpscale`). The URL constants and wire
types keep their wire spelling. One canonical `video()` over all ten lives at
[`unmodel/video`](#unified-media-one-vocabulary-per-category).

```ts
import { video } from "unmodel/openai";

const validated = video({
  model: "sora-2",
  prompt: "a red fox trotting through fresh snow, golden hour",
  seconds: "8",       // strings on the wire
  size: "1280x720",   // sora-2-pro unlocks 1024p/1080p sizes — typed per model
});

// Priced per second of output: on the ok branch, video.safe(params) estimates { costUSD: 0.8 }
const res = await fetch(validated.request.url, {
  method: validated.request.method, // POST https://api.openai.com/v1/videos
  headers: {
    ...validated.request.headers,
    authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify(validated),
});
// The response is a video job — poll GET /v1/videos/{id} yourself.
```

Video and most image endpoints are async-job APIs: unmodel validates the
submit request; polling and downloads are transport, so they stay your job.

### Music and audio generation

Both providers address their text-to-music route as `music`; Stability's two
audio-conditioned routes qualify by what they are made from
(`musicFromAudio`) and what they do to a finished track (`musicInpaint`). One
canonical `music()` over the two text-to-music routes lives at
[`unmodel/music`](#unified-media-one-vocabulary-per-category).

| Subpath | Validators |
| --- | --- |
| `unmodel/elevenlabs` | `music` (Eleven Music — prompt or composition plan, priced per audio minute) |
| `unmodel/stability` (+ `toFormData`) | `music`, `musicFromAudio`, `musicInpaint` (Stable Audio 2.x, credit-priced) |

## Unified media: one vocabulary per category

Everything above is a provider's **own** wire format, which is the point of this
library — but sometimes you want to write one request and point it at any
provider. `unmodel/image`, `unmodel/image-edit`, `unmodel/speech`,
`unmodel/video`, `unmodel/transcribe` and `unmodel/music` are that: one
canonical camelCase vocabulary per media category, compiled to whichever
provider the `"provider/model"` ref names.

```ts
import { image } from "unmodel/image";

const req = image({
  model: "openai/gpt-image-2",
  prompt: "a lighthouse in fog",
  aspectRatio: "16:9",
  resolution: "1k",
});

await fetch(req.request.url, {
  method: req.request.method,
  headers: { ...req.request.headers, authorization: `Bearer ${key}` },
  body: JSON.stringify(req),          // enumerable props ARE the wire body
});
```

Change the ref to `"google/imagen-4.0-generate-001"` and the same object
compiles to an Imagen `:predict` body; to `"black-forest-labs/flux-2-pro"` and
it becomes a grid-snapped `width`/`height` pair; to `"ideogram/ideogram-3.0-quality"`
and the ref itself chooses both the route and its `rendering_speed`.

**What you get back is a provider result.** `image()` does not validate the
request itself. It compiles the canonical params to the provider's wire params
and then runs **the provider's own validator** — the same `image()` from
`unmodel/openai` you would have called by hand, with its catalog, its
constraint tables, its media limits and its cost estimate. There is no second
definition of what a valid request is, so the two cannot disagree.

**The loss contract is the product.** A param a provider cannot express is an
**error** naming what it does offer; a value it can only express approximately
is an `approximated_param` **warning** naming both the requested and the
achieved value. So `warnings.length === 0` *means* the request mapped exactly:

```ts
image({ model: "black-forest-labs/flux-pro-1.1", prompt: "…", aspectRatio: "16:9", resolution: "1k" }).warnings;
// [approximated_param] `aspectRatio` 16:9 at 1k does not land on this model's
// 32px grid: 1344×768 (1.750:1, requested 1.778:1).

image({ model: "openai/gpt-image-1", prompt: "…", seed: 7 });
// throws: `seed` is not supported by "openai/gpt-image-1" — POST
// /v1/images/generations has no seed field, so a seed could only be dropped.
```

| Entry | Providers | Vocabulary |
| --- | --- | --- |
| `unmodel/image` | 15 | `prompt`, `aspectRatio` XOR `dimensions`, `resolution` tier, `n`, `seed`, `negativePrompt`, `outputFormat`, `outputDelivery` |
| `unmodel/image-edit` | 4 | `operation`, `prompt`, `image` (`file` / `url` / `data`), `strength`, `aspectRatio` XOR `dimensions`, `n`, `seed`, `outputFormat` |
| `unmodel/speech` | 14 | `text`, `voice`, `outputFormat`, `speed`, `language` |
| `unmodel/video` | 10 | `prompt`, `duration` (seconds), `resolution` tier, `aspectRatio`, `image` (first / last / reference), `video`, `negativePrompt`, `seed`, `n` |
| `unmodel/transcribe` | 11 | `audio` (`file` / `url` / `fileId`), `language`, `languages`, `diarization`, `timestamps`, `prompt` |
| `unmodel/music` | 2 | `prompt`, `durationSeconds`, `instrumental`, `outputFormat`, `seed` |

**In `unmodel/image-edit`, `strength` means one thing in one direction — and
`image` narrows to the route.** `strength: 0` keeps the source, `strength: 1`
ignores it. Providers spell that a dozen ways and at least one spells it
*backwards*: Ideogram's `image_weight` is how strongly the output should
**resemble** the input, so `strength: 0` compiles to `image_weight: 100` and
`strength: 0.5` to `image_weight: 50` — which is also that route's own default.
Recraft's `strength` already runs the canonical way and is passed through
untouched; OpenAI and Black Forest Labs have no dial at all and say so.

The source picture arrives differently per route, and — exactly as `audio` does
at `unmodel/transcribe` — the ref decides which shapes type-check:

```ts
import { imageEdit } from "unmodel/image-edit";

imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { file } });  // ok
imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { url } });   // compile error
imageEdit({ operation: "edit", model: "black-forest-labs/flux-kontext-pro", prompt, image: { data } }); // ok
imageEdit({ operation: "edit", model: "black-forest-labs/flux-kontext-pro", prompt, image: { file } }); // compile error
```

`operation` is `"edit"` and only `"edit"` in v1. Inpainting, outpainting,
erase, background replacement and virtual try-on all need a mask or a second
image the vocabulary has no word for, so they stay reachable by name at
`unmodel/<provider>` (`recraft.imageEditInpaint`,
`stability.imageEditSearchAndReplace`, `black-forest-labs.imageEditFill`, …).
The discriminant exists so they can join later without widening the type.

**In `unmodel/transcribe`, `audio` narrows to the route — at compile time.**
Transcription APIs disagree about how audio arrives, and the disagreement is
per *route*: AssemblyAI fetches a URL, Cartesia takes multipart bytes, Soniox
takes a URL or a file id from its own upload API, Mistral takes all three. Each
adapter declares which, and the ref you write decides which `audio` shapes
type-check:

```ts
import { transcribe } from "unmodel/transcribe";

transcribe({ model: "assemblyai/universal-2", audio: { url } });   // ok
transcribe({ model: "assemblyai/universal-2", audio: { file } });  // compile error
transcribe({ model: "cartesia/ink-whisper",  audio: { file } });   // ok
transcribe({ model: "cartesia/ink-whisper",  audio: { url } });    // compile error
```

The runtime check backs it up for JavaScript callers and for refs built at
run time, naming the shapes the route does take:

```ts
transcribe({ model: "assemblyai/universal-2", audio: { file } });
// throws: `audio` was given as `{ file }`, which this model has no wire field
// for — it takes `{ url }`. Upload local bytes to POST /v2/upload first; its
// `upload_url` is an `audio_url`.
```

The rest of the vocabulary translates the way the others do: `diarization:
{ enabled: true }` is `speaker_labels` at AssemblyAI, `diarization: "speaker"`
at Speechmatics and the **inverted** `skip_diarization: false` at Rev AI;
`timestamps: "word"` is an array at OpenAI, a scalar enum at ElevenLabs and a
boolean at Deepgram — and at the four routes that report word timings
unconditionally it costs nothing, while `timestamps: "segment"` there is an
error naming what they do report.

**In `unmodel/music`, the unit is in the name.** `durationSeconds: 90` is
`music_length_ms: 90000` at ElevenLabs and `duration: 90` at Stability. The
conversion is exact and therefore silent; a length that lands between two
milliseconds is an error rather than a rounded value nobody asked for.
Stability's audio-conditioned routes (`musicFromAudio`, `musicInpaint`) stay
wire-only — they take controls no other provider has, so a canonical vocabulary
for them would be a vocabulary of one.

**In `unmodel/video`, the inputs choose the endpoint.** A prompt is
text-to-video; adding `image` makes it image-to-video; tagging that image
`role: "reference"` makes it reference-to-video; and `video` makes it
video-to-video. At four of the ten providers those are four different URLs, and
a model with no arm for the route you derived says so in those words:

```ts
import { video } from "unmodel/video";

video({ model: "kling/kling-v3", prompt: "a fox in snow", duration: 5, resolution: "1080p" });
// → POST /v1/videos/text2video  { duration: "5", mode: "pro", … }   — seconds as a STRING
video({ model: "luma/ray-2",     prompt: "a fox in snow", duration: 5, resolution: "1080p" });
// → POST /generations           { duration: "5s", resolution: "1080p" }
video({ model: "openai/sora-2",  prompt: "a fox in snow", duration: 8, aspectRatio: "16:9" });
// → POST /v1/videos             { seconds: "8", size: "1280x720" }

video({ model: "runway/gen4_turbo", prompt: "a fox in snow", duration: 5 });
// throws: "gen4_turbo" has no text-to-video route; it serves image-to-video —
// pass `image`.
```

Anything genuinely one-off rides in `providerOptions`, keyed by provider and
deep-merged over the compiled body **before** validation — so it is checked by
the provider's own four layers rather than smuggled past them:

```ts
image({
  model: "vidu/viduq1",
  prompt: "…",
  aspectRatio: "16:9",
  providerOptions: { vidu: { images: ["https://example.com/reference.png"] } },
});
```

Importing a pack costs all of its providers. To pay for two instead of fifteen,
build your own from the adapter leaves — the refs that autocomplete and the
return type narrow with it:

```ts
import { createImage } from "unmodel/image";
import { image as openai } from "unmodel/openai/unified";
import { image as ideogram } from "unmodel/ideogram/unified";

const image = createImage([openai, ideogram]);
```

## Catching what SDKs let through

unmodel's types are written from the provider's **documentation**, not from its SDK — so they narrow where the SDK is too loose *and* widen where it is too tight.

**Narrowed.** The OpenAI SDK types `background` identically for every gpt-image model, but the image-generation guide says `gpt-image-2` errors on `transparent`. unmodel makes that a compile error *and* a runtime issue, while leaving the values the docs do allow:

```ts
import { image } from "unmodel/openai";

image({
  model: "gpt-image-2",
  prompt: "a watercolor fox",
  background: "transparent", // ✗ compile error; runtime invalid_enum_value
});

image({ model: "gpt-image-2", prompt: "a watercolor fox", background: "opaque" }); // ✓
image({ model: "gpt-image-1", prompt: "a watercolor fox", background: "transparent" }); // ✓
```

**Widened.** The same SDK types `size` as a three-value enum. The docs say `gpt-image-2` takes free-form `WIDTHxHEIGHT` — both edges divisible by 16, long:short at most 3:1, edges up to 3840px. unmodel accepts the documented range at the type level and enforces the bounds at runtime:

```ts
image({ model: "gpt-image-2", prompt: "a watercolor fox", size: "1808x1024" }); // ✓
image({ model: "gpt-image-2", prompt: "a watercolor fox", size: "1810x1024" }); // ✗ not divisible by 16
```

Every such deviation carries the doc URL that justifies it, in the constraint's `source` field.

Validation also catches, per model: unknown/deprecated models, unsupported params and capabilities, invalid enum values, prompts over the context window, output limits, unsupported/oversized media, and budget overruns.

### Non-throwing variant

```ts
const result = chat.safe(params);
if (result.ok) {
  result.params;   // the Validated object
  result.warnings; // Issue[]
  result.estimate; // { inputTokens?, costUSD? }
} else {
  result.errors;   // Issue[]
}
```

## After the API call

`check*` helpers take the raw response, never throw, and report what the provider won't shout about:

```ts
import { checkChat } from "unmodel/openai";
// also: checkImages, and checkChat on unmodel/anthropic, unmodel/google,
// unmodel/google-vertex, unmodel/amazon-bedrock, unmodel/cohere and every
// OpenAI-compatible overlay, and the
// speech checkers — checkTranscription (unmodel/elevenlabs, unmodel/soniox,
// unmodel/mistral), checkStt (unmodel/cartesia), checkListen (unmodel/deepgram),
// checkTranscript (unmodel/assemblyai), checkPreRecorded (unmodel/gladia),
// checkJob (unmodel/revai, unmodel/speechmatics),
// checkSpeech (unmodel/murf, unmodel/resemble)

const report = checkChat(await res.json());
report.warnings;     // truncation, content filter, refusals — as Issue[]
report.finishReason; // e.g. "length"
report.usage;        // normalized token usage (input/output/reasoning/cached)
report.costUSD;      // actual cost, priced from catalog rates
```

## Catalog

`unmodel/catalog` exposes the generated models.dev snapshot directly:

```ts
import { getModel, getProvider, catalog } from "unmodel/catalog";

const info = getModel("openai", "gpt-5.2");
info?.limit.context; // context window
info?.cost?.input;   // USD per million input tokens (cost is optional)
info?.modalities;    // { input: [...], output: [...] }
```

Model ids are plain strings here — `unmodel/catalog` is the widened registry, so it stays useful for models newer than the snapshot. The strict model-id unions live in each provider module's own typed surface (`unmodel/openai`, `unmodel/groq`, `unmodel/elevenlabs`, …), where the validators enforce them.

## CLI

The package ships an `unmodel` binary (`npx unmodel`, `bunx unmodel`) for
catalog queries and one-off validation:

```sh
# List every provider in the catalog / one provider's models / one model.
unmodel models
unmodel models openai
unmodel models openai gpt-image-1

# Validate request params (JSON from a file or stdin) against an endpoint.
echo '{"model":"gpt-5.2","messages":[{"role":"user","content":"Hello!"}]}' \
  | unmodel validate openai.chat
# ok: openai.chat params are valid
# estimate: ~6 input tokens, max cost ~$1.7920105

unmodel validate groq.chat params.json --max-cost 0.05

# Media endpoints are addressed the same way: <provider>.<validator>.
echo '{"model":"sora-2","prompt":"a red fox in snow","seconds":"8","size":"1280x720"}' \
  | unmodel validate openai.video
# ok: openai.video params are valid
# estimate: max cost ~$0.8

# Pass an unknown target to print every registered endpoint.
unmodel validate list-them-all
```

`unmodel validate` covers the 138 endpoints whose params are expressible as
JSON — including the ones that are *posted* as `multipart/form-data` but carry
no `Blob` (`speechmatics.transcribe`, `mistral.transcribe`,
`stability.music`, …). For those the CLI prints a
`transport: multipart/form-data` note pointing at the subpath's `toFormData`.
[Realtime session configs](#speech--tts-and-stt) are covered too, with a
`transport: websocket` note: they validate like anything else, but the result is
a config to open a socket with, not a body to post.

The 15 endpoints that *require* a `Blob` body part (`openai.imageEdit`,
`openai.transcribe`, `cartesia.transcribe`, the Ideogram and Stability editors, and
the two Stability audio-input routes) cannot be expressed as JSON at all, so
they are library-only — the CLI says so rather than failing on a type error.

`unmodel validate` exits non-zero on invalid params, and `--json` emits the
full machine-readable result (wire body, `.request`, warnings, estimate) for
scripting. `unmodel models --json` does the same for catalog data.

## Options

Everything unmodel-specific goes in a second argument — params stay byte-for-byte wire-shaped:

```ts
import { encodingForModel } from "js-tiktoken";

const enc = encodingForModel("gpt-4o");

const validated = chat(params, {
  // Fail with over_budget when the estimated worst-case cost exceeds this.
  maxCostUSD: 0.05,

  // Precise token counting; default is a ~4 chars/token heuristic so no
  // tokenizer weights land in your bundle.
  tokenizer: { count: (text) => enc.encode(text).length },

  // Promote, demote, or silence individual issue codes.
  severity: { near_context: "error", deprecated_model: "off" },

  // Declare metadata the validator can't inspect from bytes
  // (e.g. duration of a URL-referenced video).
  media: [{ path: ["contents", 0, "parts", 1], durationSeconds: 42 }],
});
```

## Bundle story

Every provider lives on its own subpath; importing one pulls in nothing from the others, and `"sideEffects": false` lets bundlers tree-shake the rest:

| Import | Contents |
| --- | --- |
| `unmodel` | Core types and helpers only (`Issue`, `Validated`, `UnmodelValidationError`, `computeCostUSD`, …) — no provider code |
| `unmodel/<provider>` | That provider's validators, checkers, and typed catalog — see [Providers](#providers) |
| `unmodel/openai-compatible` | The `createOpenAICompatible` factory and shared Chat Completions dialect pieces |
| `unmodel/catalog` | models.dev snapshot: `catalog`, `getProvider`, `getModel` |
| `unmodel/ai-sdk` | The `withJsonSchemaTools` adapter for `.toSdk("ai-sdk")` — types plus one pure function, no dependency on `ai` |
| `unmodel/<provider>/unified` | One provider's adapters for the [unified media surfaces](#unified-media-one-vocabulary-per-category) — that provider's endpoint module and the kernel, nothing else |
| `unmodel/image`, `unmodel/image-edit`, `unmodel/speech`, `unmodel/video`, `unmodel/transcribe`, `unmodel/music` | A ready-made pack: every adapter in that category, and therefore every one of those providers. `createImage([…])` / `createImageEdit([…])` / `createSpeech([…])` / `createVideo([…])` / `createTranscribe([…])` / `createMusic([…])` is how you pay for two instead of fifteen |

Retargeting keeps that story intact. The wire-format **codecs** are per dialect
(four of them), not per provider, so `unmodel/anthropic` reaches
`openai-compatible`'s codec module and nothing else of that provider's —
not its schema, not its constraints, not its catalog. And 85% of retarget edges
are OpenAI-compatible → OpenAI-compatible, which is pure data: an id respell
and a URL swap, no codec at all.

## Status

Current coverage: 153 request validators across 70 provider subpaths, plus all
six unified media surfaces (`unmodel/image` over 15 providers, `unmodel/speech`
over 14, `unmodel/transcribe` over 11, `unmodel/video` over 10,
`unmodel/image-edit` over 4, `unmodel/music` over 2).

- **OpenAI** — Chat Completions, Images + image edits, Speech (TTS), Transcription (STT), Sora videos, Realtime session config.
- **Anthropic** Messages; **Google** Gemini `chat`, Imagen `image`, Veo `video`; **Cohere** v2 Chat.
- **Cloud-endpoint factories** for Azure OpenAI, Vertex AI, Amazon Bedrock (Converse), and Cloudflare Workers AI.
- **A 29-provider OpenAI-compatible chat fleet** (Groq, xAI, Mistral, DeepSeek, OpenRouter, …).
- **TTS** — OpenAI, Cartesia, Deepgram (Aura), ElevenLabs, Fish Audio, Hume (Octave), Inworld, LMNT, MiniMax (T2A v2), Murf, Resemble, Rime, Smallest AI, Speechify.
- **STT** — OpenAI, AssemblyAI, Cartesia, Deepgram, ElevenLabs (Scribe), Gladia, Inworld (inline base64 audio), Mistral (Voxtral), Rev AI, Soniox, Speechmatics.
- **Realtime session configs** — OpenAI (GA session), Cartesia (TTS + STT sockets), Deepgram (Live, Flux, Aura streaming), ElevenLabs (stream-input TTS, Scribe v2 Realtime), Inworld (STT + TTS bidirectional), Soniox. The config objects only; socket lifecycle stays out of scope.
- **Image** — Black Forest Labs (FLUX.2, FLUX 1.x, Kontext, FLUX Tools), Bria (FIBO), ByteDance (Seedream), Ideogram (v3 + v4), Kling, Krea, Leonardo, Luma (Photon), Recraft, Reve (v1 + v2), Runway, Stability (generate + the six edit routes), Vidu.
- **Video** — Sora, Veo, ByteDance (Seedance), Kling, Lightricks (LTX-2), Luma (Ray + `videoModify`/`videoReframe`/`videoUpscale`/`videoAddAudio`), MiniMax (Hailuo + H3), PixVerse, Runway (text/image/video-to-video), Vidu.
- **Music / audio** — ElevenLabs (Eleven Music), Stability (Stable Audio 2.x).

More endpoints (embeddings, further realtime surfaces) are coming — see `docs/providers.md` for the roadmap. If a validator sees a model it doesn't know, it warns (`unknown_model`) and validates what it can — it never blocks you from using a brand-new model.

## Development

```sh
bun install
bun test              # run tests
bun run check         # typecheck (tsc --noEmit)
bun run build         # build dist/ with tsdown
bun run lint:pkg      # publint + arethetypeswrong publish checks
bun run codegen       # regenerate src/catalog/**/*.gen.ts from data/models-dev.json
                      # (model catalogs + the per-provider .toApi availability
                      #  tables, filtered by data/availability-overrides.json)
bun run codegen:refresh # re-download models.dev data, then regenerate
```

## License

MIT
