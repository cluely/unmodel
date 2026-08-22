# unmodel

Type-safe validation and translation for AI API requests: chat, speech, images, video, and music.

unmodel validates provider-native params, compiles optional cross-provider params to real wire bodies, and checks raw responses for truncation, refusals, filtering, usage, and cost. It never sends requests or handles credentials—you keep `fetch`, your SDK, and your keys.

- Provider docs drive the types and runtime checks, including model-specific limits and exceptions.
- A generated [models.dev](https://models.dev) catalog adds capabilities, context limits, pricing, and deprecations.
- Provider SDKs are optional; unmodel has no runtime dependency on them.
- Node 20+, Bun, and Cloudflare Workers are supported.

```sh
npm install unmodel
# or: bun add unmodel
```

## Contents

- [Quick start](#quick-start)
- [Choose a surface](#choose-a-surface)
- [Types only](#types-only)
- [Values](#values)
- [API index](#api-index)
  - [Chat](#chat)
  - [Text to speech](#text-to-speech)
  - [Speech to text](#speech-to-text)
  - [Image generation](#image-generation)
  - [Image editing](#image-editing)
  - [Video generation](#video-generation)
  - [Music generation](#music-generation)
  - [Voice cloning](#voice-cloning)
  - [Voice design](#voice-design)
  - [Realtime audio](#realtime-audio)
- [Send requests](#send-requests)
  - [Fetch](#fetch)
  - [Provider SDKs](#provider-sdks)
  - [Vercel AI SDK](#vercel-ai-sdk)
  - [Multipart and WebSockets](#multipart-and-websockets)
- [Validation](#validation)
- [Retarget chat](#retarget-chat)
- [Check responses](#check-responses)
- [Catalog and CLI](#catalog-and-cli)
- [Providers](#providers)
- [Bundles and custom packs](#bundles-and-custom-packs)
- [Development](#development)

## Quick start

Write one request, validate it against the selected provider, then send the emitted body yourself:

```ts
import { chat } from "unmodel/chat";
import { checkChat } from "unmodel/openai";

const request = chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "Explain this code in one sentence." }],
  maxOutputTokens: 256,
});

JSON.stringify(request);
// → {"model":"gpt-5.2","messages":[...],"max_completion_tokens":256}

const response = await fetch(request.request.url, {
  method: request.request.method,
  headers: {
    ...request.request.headers,
    authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
  },
  body: JSON.stringify(request),
});

const payload = await response.json();
if (!response.ok) {
  throw new Error(`OpenAI ${response.status}: ${JSON.stringify(payload)}`);
}

const report = checkChat(payload);
report.finishReason; // "stop", "length", ...
report.costUSD;      // actual catalog-priced usage, when available
```

The enumerable result is the exact HTTP body. `.request` contains the URL, method, and static headers; auth remains yours.

## Choose a surface

| Goal | Use | Input |
| --- | --- | --- |
| One shape across providers | `unmodel/chat`, `unmodel/tts`, `unmodel/stt`, etc. | camelCase params + `"provider/model"` |
| Exact provider API | `unmodel/openai`, `unmodel/anthropic`, etc. | provider-native fields + bare model id |
| Small cross-provider bundle | `createChat` from `unmodel/chat/factory`; media factories from their category entries | serves only registered providers |
| Move validated chat to another host | `.toApi(provider)` | an existing validated request |
| [Types with no runtime](#types-only) | `unmodel/<provider>/types`, `unmodel/types` | nothing — the entries emit no JavaScript |
| [Runtime lists for pickers](#values) | `unmodel/<provider>/values`, `unmodel/values` | nothing — arrays out, ~1 KiB per import |

Unified calls compile to provider-native params and finish in that provider's own validator:

```text
canonical params → provider wire params → provider validator → fetch or SDK
```

Use the provider subpath when you already know the API and want every native field:

```ts
import { chat } from "unmodel/anthropic";

const request = chat({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

Provider validators take provider-native request fields. After validation, path and query fields move into `.request.url`; for JSON endpoints, the remaining enumerable object is the exact body. Multipart endpoints use the provider's form-data helper.

Unified model refs split on the first slash. For example, `openrouter/anthropic/claude-opus-5` means provider `openrouter`, model `anthropic/claude-opus-5`.

## Types only

If you want unmodel's request shapes but not its runtime — you already have a client, or you are building the body in one place and sending it in another — every type is published on its own subpath, and those subpaths ship **no JavaScript at all**.

`unmodel/<provider>/types` is one provider's complete type surface: the doc-corrected wire bodies, the per-model arms, the closed enums and preset unions, the model-id unions, the response `*Like` shapes.

```ts
import type { ImageBody } from "unmodel/openai/types";

const body = {
  model: "gpt-image-2",
  prompt: "a lighthouse at dusk",
  size: "3840x1280",
  background: "transparent",
} satisfies ImageBody;
```

```text
error TS1360: Type '{ model: "gpt-image-2"; prompt: string; size: "3840x1280"; background: "transparent"; }'
  does not satisfy the expected type 'ImageBody'.
  Types of property 'background' are incompatible.
    Type '"transparent"' is not assignable to type '"auto" | "opaque" | null | undefined'.
```

That is a real `tsc` message, and it is the point of the entry: `gpt-image-2` returns a 400 for a transparent background, so the type does not have the value. `size` stays open to the documented `WIDTHxHEIGHT` rule space and closed to everything else. Use `satisfies` rather than an annotation so the literal types survive.

Each provider entry exports its **wire names verbatim** — `MessagesBody`, `ListenParams`, `Flux2Body`, the names you find in the vendor's own docs — plus one uniform `<Endpoint>Body` alias per endpoint address it serves: `ChatBody`, `TtsBody`, `SttBody`, `ImageBody`, `ImageEditBody`, `VideoBody`, `MusicBody`, and the qualified extras (`ImageFlux1Body`, `TtsStreamBody`, `VideoV3FromImageBody`). The aliases are additions, never renames; where the alias name already *is* the wire name (cohere's `ChatBody`, hume's `TtsBody`), the wire name wins and there is no duplicate.

`unmodel/types` is the small hub: the canonical camelCase vocabulary the unified surfaces speak (`ChatParams`, `TtsParams`, `SttParams`, `ImageParams`, `ImageEditParams`, `VideoParams`, `MusicParams`, plus `AspectRatio`, `AudioFormat`, `Voice`, `Diarization` and friends), the `"provider/model"` ref unions (`ChatModelRef`, `ChatProviderId`), and the result vocabulary (`Issue`, `ValidateResult`, `ResponseReport`, `TranslationWarning`, `Retargeted`).

```ts
import type { ChatParams } from "unmodel/types";

export const prompt = {
  model: "anthropic/claude-sonnet-4-5",
  messages: [{ role: "user", content: "Summarise this." }],
  maxOutputTokens: 512,
} satisfies ChatParams;
```

The hub deliberately does **not** aggregate provider wire types: the 70 provider entries carry ~2,140 type exports between them, and one module naming all of them is a ~900 KB declaration file every consumer would have to parse to reach one interface. Import the provider you actually call.

Three properties are tested rather than promised, in `test/types-entries.test.ts` against a real build:

- **zero runtime** — every one of the 71 entries emits an empty JavaScript module;
- **complete** — every endpoint id the CLI can validate has a `<Endpoint>Body` type on its provider's entry, so a new endpoint cannot ship with the types a release behind;
- **packaged** — every entry has its `exports` subpath and its build entry.

URL constants, `check*` helpers, `toFormData` and the models tables are runtime values, so they stay on the main subpath (`unmodel/openai`) — which tree-shakes to the few bytes a URL string costs if that is all you import.

## Values

A type cannot be rendered. `unmodel/<provider>/values` publishes the same vocabulary as **runtime arrays**: the voices, sizes, aspect ratios, durations, resolutions, codecs, sample rates, languages, timestamp granularities and model ids behind the enriched types — for the `<select>` a user picks from, and for validating a form field on the client.

```tsx
import { TTS_MODELS, TTS_MODEL_PARAMS } from "unmodel/openai/values";

<select name="model">
  {TTS_MODELS.map((id) => <option key={id}>{id}</option>)}
</select>;

// The row is per model, because the answer is: gpt-4o-mini-tts has 13 voices,
// tts-1 has 9, and offering the wrong nine is a 400 the user sees.
const voices = TTS_MODEL_PARAMS["gpt-4o-mini-tts"].voices;
<select name="voice">
  {voices.map((voice) => <option key={voice}>{voice}</option>)}
</select>;
```

Each entry exports, per category it serves, three uniform names — `<CATEGORY>_MODEL_PARAMS`, `<CATEGORY>_MODELS`, and `<CATEGORY>_FORMAT_SPEC` where the category has an audio format spec (`IMAGE_`, `IMAGE_EDIT_`, `VIDEO_`, `TTS_`, `STT_`, `MUSIC_`, `VOICE_CLONE_`, `VOICE_DESIGN_`) — plus that provider's own published lists under their own names (`GEMINI_TTS_VOICES`, `GPT_IMAGE_2_SIZES`, `BFL_ASPECT_RATIOS`, `RECRAFT_V3_STYLES`, `KLING_ASPECT_RATIOS`, …). 36 providers ship one; the ones that do are exactly the providers with a unified adapter.

The tables are **the same objects the adapter compiles with**, re-exported rather than copied, so a picker and the request it builds cannot disagree. `test/values-entries.test.ts` asserts that by reference (`===`), not by deep equality.

`unmodel/values` is the canonical hub — the closed unions as arrays:

```ts
import { ASPECT_RATIO_PRESETS, AUDIO_FORMAT_CODECS, CANONICAL_KEY_LISTS } from "unmodel/values";

const isCodec = (value: string): value is (typeof AUDIO_FORMAT_CODECS)[number] =>
  (AUDIO_FORMAT_CODECS as readonly string[]).includes(value);

CANONICAL_KEY_LISTS.tts; // ["model", "text", "voice", "speed", "outputFormat", "language", "providerOptions"]
```

`ASPECT_RATIO_PRESETS`, `RESOLUTION_TIERS`, `VIDEO_RESOLUTIONS`, `IMAGE_OUTPUT_FORMATS`, `OUTPUT_DELIVERIES`, `AUDIO_FORMAT_CODECS`, `AUDIO_CONTAINERS`, `TIMESTAMP_GRANULARITIES`, `AUDIO_INPUT_KINDS`, `CANONICAL_KEY_LISTS` and `CHAT_PROVIDERS`. Each array is proved equal to its union in both directions by `test/types/values-hub.test-d.ts`, so a word added to the vocabulary and forgotten in the array is a compile error rather than a picker that quietly offers eight options out of nine.

The 1,339 `"provider/model"` chat refs are the runtime twin of `ChatModelRef`, and they live on their own subpath because they are 45 KiB:

```ts
import { CHAT_MODEL_REFS } from "unmodel/values/chat-refs";
```

**What this costs.** Measured against a real build, per export, with a bundler that tree-shakes (`test/values-entries.test.ts` runs the measurement and holds each entry to a budget):

| Import | Cost |
| --- | --- |
| any one array from `unmodel/values` | 0.2–1.5 KiB |
| the median export of a provider entry | ~1 KiB |
| the most expensive one (`unmodel/runway/values`) | 19.4 KiB |
| `CHAT_MODEL_REFS` | 49 KiB — hence its own subpath |

That is the whole point of the layout: the per-model tables live on import-free `<category>-params.ts` leaves that the adapter reads too, so importing one voice list does not pull that provider's validator, its zod schema or its catalog. Before that split the same measurement read 30–82 KiB.

## API index

| Task | Portable import | Provider-native example |
| --- | --- | --- |
| [Chat](#chat) | `unmodel/chat` | `unmodel/openai`, `unmodel/anthropic`, `unmodel/google` |
| [Text to speech](#text-to-speech) | `unmodel/tts` | `unmodel/openai`, `unmodel/elevenlabs`, `unmodel/deepgram` |
| [Speech to text](#speech-to-text) | `unmodel/stt` | `unmodel/openai`, `unmodel/deepgram`, `unmodel/assemblyai` |
| [Image generation](#image-generation) | `unmodel/image` | `unmodel/openai`, `unmodel/google`, `unmodel/black-forest-labs` |
| [Image editing](#image-editing) | `unmodel/image-edit` | `unmodel/openai`, `unmodel/black-forest-labs`, `unmodel/ideogram` |
| [Video generation](#video-generation) | `unmodel/video` | `unmodel/openai`, `unmodel/google`, `unmodel/runway` |
| [Music generation](#music-generation) | `unmodel/music` | `unmodel/elevenlabs`, `unmodel/stability` |
| [Voice cloning](#voice-cloning) | `unmodel/voice-clone` | `unmodel/elevenlabs`, `unmodel/cartesia`, `unmodel/minimax` |
| [Voice design](#voice-design) | `unmodel/voice-design` | `unmodel/elevenlabs`, `unmodel/fish-audio`, `unmodel/minimax` |
| [Realtime audio config](#realtime-audio) | — | `unmodel/openai`, `unmodel/deepgram`, `unmodel/elevenlabs`, etc. |

See the complete [provider and endpoint roster](docs/providers.md).

## Chat

`unmodel/chat` uses one message vocabulary across its ready provider set:

```ts
import { chat } from "unmodel/chat";

const anthropic = chat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "Why is the sky blue?" }],
  maxOutputTokens: 1024,
});

anthropic.max_tokens; // 1024

const openai = chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "Why is the sky blue?" }],
  maxOutputTokens: 1024,
});

openai.max_completion_tokens; // 1024
```

The model ref selects the concrete result type, URL, SDK targets, catalog, and validation rules. Cohere and providers that require endpoint, project, account, or region configuration use their direct provider modules instead.

## Text to speech

```ts
import { tts } from "unmodel/tts";

const request = tts({
  model: "openai/gpt-4o-mini-tts",
  text: "The lighthouse is ready.",
  voice: "alloy",
  outputFormat: "mp3",
});

JSON.stringify(request);
// → {"model":"gpt-4o-mini-tts","input":"The lighthouse is ready.",
//    "voice":"alloy","response_format":"mp3"}
```

Formats and some provider-only extras narrow to the selected model. Published languages and voices provide autocomplete while custom values remain type-accepted and are decided by provider validation.

## Speech to text

```ts
import { stt } from "unmodel/stt";

const request = stt({
  model: "deepgram/nova-3",
  audio: { url: "https://example.com/interview.wav" },
  diarization: { enabled: true },
  timestamps: "word",
});

JSON.stringify(request);
// → {"url":"https://example.com/interview.wav"}

request.request.url;
// → https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&utterances=false
```

Audio input narrows by route:

```ts
declare const url: string;
declare const file: Blob;

stt({ model: "assemblyai/universal-2", audio: { url } });  // ✓ provider fetches a URL
stt({ model: "assemblyai/universal-2", audio: { file } }); // TypeScript error

stt({ model: "cartesia/ink-whisper", audio: { file } });   // ✓ multipart bytes
stt({ model: "cartesia/ink-whisper", audio: { url } });    // TypeScript error
```

Supported inputs are `{ file }`, `{ url }`, `{ fileId }`, and `{ data, mimeType }`; each model exposes only the forms its route accepts.

## Image generation

```ts
import { image } from "unmodel/image";

const request = image({
  model: "openai/gpt-image-2",
  prompt: "a lighthouse in fog",
  aspectRatio: "16:9",
  resolution: "1k",
});

JSON.stringify(request);
// → {"model":"gpt-image-2","prompt":"a lighthouse in fog","size":"1360x768"}
```

Sizing and extras narrow by model:

```ts
image({ model: "openai/gpt-image-1", prompt: "...", background: "transparent" }); // ✓
image({ model: "openai/gpt-image-2", prompt: "...", background: "transparent" }); // TypeScript error
```

`size`, `aspectRatio`, and `dimensions` describe the same decision and are mutually exclusive.

## Image editing

```ts
import { imageEdit } from "unmodel/image-edit";
import { imageEditToFormData } from "unmodel/openai";

const source = await fetch("https://example.com/source.png").then((r) => r.blob());
const request = imageEdit({
  operation: "edit",
  model: "openai/gpt-image-1.5",
  prompt: "make it winter",
  image: { file: source },
});

await fetch(request.request.url, {
  method: request.request.method,
  headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
  body: imageEditToFormData(request),
});
```

Source inputs narrow by route: OpenAI takes `{ file }`; FLUX Kontext takes `{ data }` or `{ url }`. Masked and specialized edits remain available on provider subpaths.

## Video generation

```ts
import { video } from "unmodel/video";

const request = video({
  model: "luma/ray-2",
  prompt: "a drone shot over a fjord",
  duration: 5,
  resolution: "1080p",
  aspectRatio: "16:9",
});

JSON.stringify(request);
// → {"model":"ray-2","prompt":"a drone shot over a fjord","duration":"5s",
//    "resolution":"1080p","aspect_ratio":"16:9"}
```

Adding `image`, `video`, or a reference image selects the matching route. unmodel validates job submission; polling and downloads stay with your transport code.

## Music generation

```ts
import { music } from "unmodel/music";

const request = music({
  model: "elevenlabs/music_v1",
  prompt: "slow post-rock build, no vocals",
  durationSeconds: 45,
  instrumental: true,
});

JSON.stringify(request);
// → {"prompt":"slow post-rock build, no vocals","model_id":"music_v1",
//    "music_length_ms":45000,"force_instrumental":true}
```

Audio-conditioned Stability routes remain provider-native because no other provider shares their controls.

## Voice cloning

`unmodel/voice-clone` creates a voice from reference recordings. The samples' shape narrows per model at compile time — multipart `{ file }` at ElevenLabs, Fish Audio, Cartesia and LMNT, base64 `{ data }` at Inworld, an upload-handle `{ fileId }` at MiniMax — and each route's sample count is enforced with the bounds in the message:

```ts
import { voiceClone } from "unmodel/voice-clone";

const request = voiceClone({
  model: "elevenlabs/ivc",
  operation: "clone",
  name: "Narrator",
  samples: [{ audio: { file: recording } }],
  description: "A warm narrator voice for audiobooks",
});

await fetch(request.request.url, {
  method: "POST",
  headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
  body: elevenlabs.voiceCloneToFormData(request),
});
```

The vocabulary carries the facts an invoice would otherwise teach: `visibility` (Fish Audio defaults new voices to **public** — the validator warns when it is omitted), the caller-chosen `voiceId` MiniMax requires and everyone else refuses, and per-sample `transcript`s where a wire field exists. The result is the created voice's id, which `unmodel/tts` takes as `voice`; managing stored voices is out of scope. Speechify's clone route (a consent challenge/response ceremony) is wire-only at `unmodel/speechify`.

## Voice design

`unmodel/voice-design` invents a voice from a text description — `prompt` is the generative word (`voice_description`, `instruction`, `designPrompt` on the wires), never `description`, which is voice-clone metadata:

```ts
import { voiceDesign } from "unmodel/voice-design";

const request = voiceDesign({
  model: "elevenlabs/eleven_ttv_v3",
  operation: "design",
  prompt: "An elderly British gentleman with a warm, gravelly storytelling tone",
});

JSON.stringify(request);
// → {"voice_description":"An elderly British gentleman with a warm, gravelly
//    storytelling tone","model_id":"eleven_ttv_v3","auto_generate_text":true}
```

The unified surface is phase 1 — the generative call. ElevenLabs and Inworld return previews a second, provider-shaped call persists; those saves are wire-only (`elevenlabs.voiceDesignSave`, `inworld.voiceDesignPublish`) because their correlating handles share no vocabulary. MiniMax is single-phase and Fish Audio's candidates are deliberately ephemeral. Hume's voice design rides its own TTS wire and stays on `unmodel/hume`.

## Realtime audio

unmodel validates realtime configuration objects, not socket lifecycles:

```ts
import { listenLive } from "unmodel/deepgram";

const session = listenLive({
  model: "nova-3",
  encoding: "linear16",
  sample_rate: 16000,
  interim_results: true,
});

const socket = new WebSocket(session.request.url, [
  "token",
  process.env.DEEPGRAM_API_KEY ?? "",
]);
```

OpenAI, Cartesia, Deepgram, ElevenLabs, Inworld, and Soniox expose realtime config validators. See the [provider roster](docs/providers.md) for each surface.

## Send requests

### Fetch

For JSON endpoints, send the validated object directly:

```ts
await fetch(request.request.url, {
  method: request.request.method,
  headers: { ...request.request.headers, authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(request),
});
```

`.request.headers` contains required static headers such as `content-type` or `anthropic-version`, never credentials.

### Provider SDKs

`.toSdk(target)` returns an endpoint's declared handoff shape. Official SDK targets are reshaped as needed; providers without an official SDK may expose their wire shape:

```ts
import OpenAI from "openai";
import { chat } from "unmodel/openai";

const client = new OpenAI();
const request = chat({
  model: "gpt-5.2",
  messages: [{ role: "user", content: "Hello!" }],
});

await client.chat.completions.create(request.toSdk("openai"));
```

Targets are typed per endpoint and always explicit. Google uses `"google"`, Vertex uses `"google-vertex"`, and OpenAI-compatible, Anthropic, Google, and Vertex chat endpoints expose `"ai-sdk"`.

### Vercel AI SDK

```sh
npm install ai @ai-sdk/openai
```

```ts
import { generateText } from "ai";
import { openai as model } from "@ai-sdk/openai";
import { chat } from "unmodel/chat";

const request = chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "Hello!" }],
});

await generateText({
  model: model("gpt-5.2"),
  ...request.toSdk("ai-sdk"),
});
```

For tools, wrap the emitted JSON Schemas with your installed AI SDK's `jsonSchema`:

```ts
import { jsonSchema } from "ai";
import { withJsonSchemaTools } from "unmodel/ai-sdk";

const options = withJsonSchemaTools(request.toSdk("ai-sdk"), jsonSchema);
```

`"ai-sdk"` is an SDK target. `"vercel"` in `.toApi("vercel")` means Vercel AI Gateway.

### Multipart and WebSockets

Multipart endpoints export form-data helpers such as `sttToFormData`, `imageEditToFormData`, or provider-level `toFormData`. Do not set `content-type`; `fetch` adds the boundary.

WebSocket validators return either a ready `wss://` URL in `.request.url` or a validated first-frame/config object plus a provider URL builder.

## Validation

Invalid params throw `UnmodelValidationError`; an unregistered or structurally unavailable translation throws `TranslationUnavailableError`. Use `.safe()` to receive either as issues:

```ts
const result = chat.safe({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "Hello!" }],
});

if (result.ok) {
  result.params;   // validated provider body
  result.warnings; // non-fatal validation findings
  result.estimate; // input tokens and worst-case cost, when known

  result.params.warnings;
  // unified compilation loss: approximated_param, dropped_param, ...
} else {
  result.errors;
}
```

Use `.safe()` for typed values. The seven standardized surfaces also expose `.safeUnknown()` for JSON, queues, and other untrusted boundaries:

```ts
const value: unknown = JSON.parse(text);
const result = image.safeUnknown(value);
```

Keeping these separate preserves exact-key and model-specific inference on normal TypeScript calls. Direct provider validators expose `.safe()`; `.safeUnknown()` belongs to the standardized surfaces.

For standardized calls, `result.warnings` reports validation findings and `result.params.warnings` reports compilation loss. The throwing result exposes the latter directly as `request.warnings`.

### What is checked

- Shape, unknown fields, enums, and mutually exclusive params
- Model existence, deprecation, capabilities, and per-model exceptions
- Context, input, output, media, and provider-specific limits
- Estimated budget via `maxCostUSD`
- Unsupported or lossy unified translations

Unified compilation never drops intent silently:

| Mapping | Media packs | Chat |
| --- | --- | --- |
| Exact | no warning | no warning |
| Approximate | `approximated_param` warning | `approximated_param` warning |
| No target representation | validation error | explicit `dropped_*` warning |

```ts
const request = image({
  model: "black-forest-labs/flux-pro-1.1",
  prompt: "a lighthouse in fog",
  aspectRatio: "16:9",
  resolution: "1k",
});

request.warnings[0];
// → [approximated_param] 16:9 at 1k became 1344×768 on this model's 32px grid
```

Known `providerOptions` fields receive types, autocomplete, and provider validation. Forward-compatible unknown keys remain accepted and may produce `unknown_param` warnings:

```ts
image({
  model: "vidu/viduq1",
  prompt: "a quiet train platform",
  providerOptions: {
    vidu: { images: ["https://example.com/reference.png"] },
  },
});
```

### Options

Pass unmodel options as the second argument so the request body remains provider-native:

```ts
const result = chat.safe(params, {
  maxCostUSD: 0.05,
  tokenizer: { count: (text) => tokenizer.encode(text).length },
  severity: { near_context: "error", deprecated_model: "off" },
  media: [{ path: ["messages", 0, "content", 0], durationSeconds: 42 }],
});
```

`media[].path` uses the vocabulary you called: canonical paths for unified entries, wire paths for provider entries.

### Future model IDs

Model-discriminated body aliases that expose a future-model generic are closed over known models by default:

```ts
import type { ImagesBody } from "unmodel/openai";

const future: ImagesBody<"gpt-image-9"> = {
  model: "gpt-image-9",
  prompt: "a watercolor fox",
  experimental_option: true,
};
```

Use `<string>` only for model IDs genuinely discovered at runtime; it intentionally gives up per-model narrowing.

A new model at a registered provider remains callable: it emits `unknown_model` and continues with the checks that do not require catalog metadata.

## Retarget chat

Chat validators backed by an availability map expose `.toApi(provider)`. It translates one validated request to another provider that serves the same model:

```ts
import { chat } from "unmodel/anthropic";

const request = chat({
  model: "claude-opus-5",
  max_tokens: 4096,
  thinking: { type: "enabled", budget_tokens: 2048 },
  messages: [{ role: "user", content: "Explain retargeting." }],
});

const moved = request.toApi("openrouter");
moved.model;       // "anthropic/claude-opus-5"
moved.request.url; // https://openrouter.ai/api/v1/chat/completions
moved.warnings;    // id respelling or lossy translations

request.toApi("openai");
//            ~~~~~~~~ TypeScript error: OpenAI does not serve Claude
```

`.toApiSafe(provider)` is the non-throwing form. Retargeting reruns available destination deny/enum rules; pass the result through the destination validator for its full schema, nested, catalog, context, and budget checks. Retargeting is chat-only and one hop.

## Check responses

Provider `check*` helpers inspect raw responses and normalize quality and usage signals:

```ts
import { checkChat } from "unmodel/openai";

const payload = await response.json();
if (!response.ok) throw new Error(`Provider error ${response.status}`);

const report = checkChat(payload);
report.warnings;     // truncation, filtering, refusals
report.finishReason; // normalized finish reason
report.usage;        // input, output, cached, reasoning
report.costUSD;      // actual cost from catalog rates
```

Every chat provider uses `checkChat`. Use the checker from the provider that returned the response; changing the request provider also changes the response shape. Handle HTTP/API error payloads before calling a checker. Media checker names follow their response documents, such as `checkImages`, `checkTranscription`, `checkListen`, or `checkTts`.

## Catalog and CLI

Read the generated models.dev snapshot:

```ts
import { getModel, getProvider } from "unmodel/catalog";

const model = getModel("openai", "gpt-5.2");
model?.limit.context;
model?.limit.output;
model?.cost?.input;

const provider = getProvider("anthropic");
```

Catalog model IDs are plain strings. Provider modules export generated model unions for autocomplete, while request validators may accept future IDs and warn at runtime.

Query and validate from the terminal:

```sh
npx unmodel models openai gpt-5.2
npx unmodel validate openai.chat request.json
npx unmodel validate unified.image image.json --max-cost 0.05
npx unmodel validate unified.stt transcription.json --json
```

`validate` exits non-zero for invalid params. Blob-only inputs remain library-only because JSON cannot represent them.

## Providers

Each implemented provider validator has its own subpath with native field names, model IDs, routes, pricing, and quirks:

```ts
import { chat, image, imageEdit, tts, stt, video } from "unmodel/openai";
```

Providers whose URL depends on your account expose factories:

- `createAzure({ endpoint })`
- `createGoogleVertex({ project, location })`
- `createAmazonBedrock({ region })`
- `createCloudflare(accountId)`

The [provider roster](docs/providers.md) lists every validator, unified adapter, SDK target, transport, and planned endpoint. Catalog metadata may include embeddings or rerank models, but those request validators are not implemented yet.

For a proxy or self-hosted Chat Completions endpoint, build a validator with `createOpenAICompatible` from `unmodel/openai-compatible`.

## Bundles and custom packs

Every implemented provider validator has its own subpath, and the package is marked `sideEffects: false`.

| Import | Includes |
| --- | --- |
| `unmodel` | shared types and helpers; no provider runtime |
| `unmodel/<provider>` | one provider's validators, checks, and catalog |
| `unmodel/chat` | ready chat compiler plus its concrete provider validators |
| `unmodel/chat/factory` | provider-free `createChat(registry)` |
| `unmodel/image`, `unmodel/tts`, etc. | every adapter in that category |
| `unmodel/<provider>/unified` | one provider's unified adapters, where available |
| `unmodel/<provider>/types`, `unmodel/types` | types only — the emitted JavaScript is an empty module |
| `unmodel/<provider>/values`, `unmodel/values` | the runtime lists behind those types: arrays and per-model tables, ~1 KiB per import |
| `unmodel/values/chat-refs` | the 1,339 `"provider/model"` chat refs as an array (45 KiB) |

Build a narrow chat pack with concrete provider validators:

```ts
import { createChat } from "unmodel/chat/factory";
import { chat as anthropic } from "unmodel/anthropic";
import { chat as openai } from "unmodel/openai";

const chat = createChat({ anthropic, openai });
```

Media factories use adapter arrays:

```ts
import { createImage } from "unmodel/image";
import { image as ideogram } from "unmodel/ideogram/unified";
import { image as openai } from "unmodel/openai/unified";

const image = createImage([ideogram, openai]);
```

Registered chat providers narrow result types; media registries also narrow model autocomplete. Chat keeps its global, forward-compatible ref input and brands unregistered results as unusable. Ready packs trade bundle size for zero setup; prefer narrow factories in browser and edge bundles.

## Development

```sh
bun install
bun test
bun run check
bun run build
bun run lint:pkg
bun run codegen         # regenerate from the checked-in catalog snapshot
bun run codegen:refresh # refresh models.dev, then regenerate
```

- [Provider coverage and roadmap](docs/providers.md)
- [Architecture decisions](docs/decisions.md)

## License

MIT
