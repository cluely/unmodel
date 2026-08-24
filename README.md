# UnModel

Type-safe validation and translation for AI API requests: chat, speech, images, video, and music.

unmodel checks your request against what the provider actually accepts, before you send it. Optional cross-provider params compile to real wire bodies. Raw responses get checked for truncation, refusals, filtering, usage, and cost. It never sends anything, never sees a credential. You keep `fetch`, your SDK, and your keys.

## Why: the SDKs lie, the docs don't

Every example below was executed against `openai@7.4.0` and this package. The
errors are pasted from real `tsc` runs, not written by hand.

The official SDK accepts requests the API rejects. `gpt-image-2` has no
transparent background. OpenAI answers 400, and that recorded response is a
test fixture here. The SDK types `background` as one flat enum for every model,
so this compiles with **zero errors** and fails in production:

### OpenAi
```ts
import OpenAI from "openai";

const params: OpenAI.Images.ImageGenerateParams = {
  model: "gpt-image-2",
  prompt: "a lighthouse",
  background: "transparent", // ❌ compiles, the API answers 400
};
```

### UnModel
```ts
import type { ImageBody } from "unmodel/openai/types";

const params = {
  model: "gpt-image-2",
  prompt: "a lighthouse",
  background: "transparent",  // ✅ ERROR: Type '"transparent"' is not assignable to type '"auto" | "opaque" | null | undefined'.
} satisfies ImageBody;
```
UnModel types `background` per model, so the same object is a compile error :)

The SDK also hides parameters a model accepts. At `size:` on a `gpt-image-2`
request it completes **8** values: a mixed DALL·E bag (`256x256`, `1792x1024`,
…) offered regardless of model, none of them the 4K, 2:1 or 21:9 resolutions
gpt-image-2 renders. Its `(string & {})` tail swallows anything else. unmodel
completes the real **23** presets (`2880x2880`, `3840x2160`, `2048x1024`,
`3360x1440`, …), each proven against the validator by a test. Free-form `WxH`
stays legal, grid and pixel rules enforced:

```ts
import { image } from "unmodel/openai";

image({
  model: "gpt-image-2",
  prompt: "a lighthouse",
  size: "3840x2160" // ✅ UnModel completes 4K. OpenAi SDK doesn't even suggest it
});
```

Allowed values autocomplete per model. Gemini TTS has exactly 30 preset
voices. Type `voice: "` and all 30 complete. An off-list voice is refused with
the full list in the message:

```ts
import { tts } from "unmodel/tts";

tts({
  model: "google/gemini-2.5-flash-preview-tts",
  text: "Have a wonderful day!",
  voice: "Kore" 
});
// voice: "¦" → completes Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, … (all 30)
// voice: "Zephyrr" → `voiceName` must be one of the 30 prebuilt Gemini TTS voices; got "Zephyrr".
```

The same lists ship as runtime values for your UI. `GEMINI_TTS_VOICES` from
`unmodel/google/values` is the array the validator enforces, by object
identity.

- 📖 Provider docs drive the types and runtime checks, including model-specific limits and exceptions.
- 🗂️ A generated [models.dev](https://models.dev) catalog adds capabilities, context limits, pricing, and deprecations.
- 🪶 Provider SDKs are optional. No runtime dependency on them.
- ⚡ Runs on Node 20+, Bun, and Cloudflare Workers.

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
  - [💬 Chat](#chat)
  - [🗣️ Text to speech](#text-to-speech)
  - [🎧 Speech to text](#speech-to-text)
  - [🎨 Image generation](#image-generation)
  - [✏️ Image editing](#image-editing)
  - [🎬 Video generation](#video-generation)
  - [🎵 Music generation](#music-generation)
  - [🎙️ Voice cloning](#voice-cloning)
  - [🧪 Voice design](#voice-design)
  - [🔌 Realtime audio](#realtime-audio)
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

Write one request, validate it against the selected provider, send the body yourself:

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

The enumerable result is the exact HTTP body. `.request` holds the URL, method, and static headers. Auth stays yours.

## Choose a surface

| Goal | Use | Input |
| --- | --- | --- |
| One shape across providers | `unmodel/chat`, `unmodel/tts`, `unmodel/stt`, etc. | camelCase params + `"provider/model"` |
| Exact provider API | `unmodel/openai`, `unmodel/anthropic`, etc. | provider-native fields + bare model id |
| Small cross-provider bundle | `createChat` from `unmodel/chat/factory`; media factories from their category entries | serves only registered providers |
| Move validated chat to another host | `.toApi(provider)` | an existing validated request |
| [Types with no runtime](#types-only) | `unmodel/<provider>/types`, `unmodel/types` | nothing (the entries emit no JavaScript) |
| [Runtime lists for pickers](#values) | `unmodel/<provider>/values`, `unmodel/values` | nothing (arrays out, ~1 KiB per import) |

Unified calls compile to provider-native params and finish in that provider's validator:

```text
canonical params → provider wire params → provider validator → fetch or SDK
```

Use the provider subpath when you know the API and want every native field:

```ts
import { chat } from "unmodel/anthropic";

const request = chat({
  model: "claude-opus-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

Provider validators take provider-native fields. After validation, path and query fields move into `.request.url`. For JSON endpoints the rest is the exact body. Multipart endpoints use the provider's form-data helper.

Unified model refs split on the first slash. `openrouter/anthropic/claude-opus-5` means provider `openrouter`, model `anthropic/claude-opus-5`.

## Types only

Already have a client, or build the body in one place and send it from another? Every type is published on its own subpath, and those subpaths ship **no JavaScript at all**.

`unmodel/<provider>/types` is one provider's whole type surface: the doc-corrected wire bodies, the per-model arms, the closed enums and preset unions, the model-id unions, the response `*Like` shapes.

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

A real `tsc` message, and the point of the entry. `gpt-image-2` returns a 400 for a transparent background, so the type does not have the value. `size` stays open to the documented `WIDTHxHEIGHT` rule space, closed to everything else. Use `satisfies`, not an annotation, so the literal types survive.

Each provider entry exports its **wire names verbatim**: `MessagesBody`, `ListenParams`, `Flux2Body`, straight from the vendor's docs. On top sits one uniform `<Endpoint>Body` alias per endpoint address it serves: `ChatBody`, `TtsBody`, `SttBody`, `ImageBody`, `ImageEditBody`, `VideoBody`, `MusicBody`, plus qualified extras (`ImageFlux1Body`, `TtsStreamBody`, `VideoV3FromImageBody`). Aliases are additions, never renames. Where the alias already *is* the wire name (cohere's `ChatBody`, hume's `TtsBody`), the wire name wins, no duplicate.

`unmodel/types` is the small hub: the canonical camelCase vocabulary the unified surfaces speak (`ChatParams`, `TtsParams`, `SttParams`, `ImageParams`, `ImageEditParams`, `VideoParams`, `MusicParams`, plus `AspectRatio`, `AudioFormat`, `Voice`, `Diarization` and friends), the `"provider/model"` ref unions (`ChatModelRef`, `ChatProviderId`), the result vocabulary (`Issue`, `ValidateResult`, `ResponseReport`, `TranslationWarning`, `Retargeted`).

```ts
import type { ChatParams } from "unmodel/types";

export const prompt = {
  model: "anthropic/claude-sonnet-4-5",
  messages: [{ role: "user", content: "Summarise this." }],
  maxOutputTokens: 512,
} satisfies ChatParams;
```

The hub deliberately does **not** aggregate provider wire types. The 70 provider entries carry ~2,140 type exports. One module naming all of them is a ~900 KB declaration file every consumer parses to reach one interface. Import the provider you actually call.

Three properties are tested rather than promised, in `test/types-entries.test.ts` against a real build:

- **zero runtime**: every one of the 71 entries emits an empty JavaScript module.
- **complete**: every endpoint id the CLI can validate has a `<Endpoint>Body` type on its provider's entry, so no endpoint ships with types a release behind.
- **packaged**: every entry has its `exports` subpath and its build entry.

URL constants, `check*` helpers, `toFormData` and the models tables are runtime values, so they stay on the main subpath (`unmodel/openai`). It tree-shakes to the few bytes a URL string costs, if that is all you import.

## Values

A type cannot be rendered. `unmodel/<provider>/values` publishes the same vocabulary as **runtime arrays**: the voices, sizes, aspect ratios, durations, resolutions, codecs, sample rates, languages, timestamp granularities and model ids behind the enriched types. Use them for the `<select>` a user picks from, and to validate form fields client-side.

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

Each entry exports three uniform names per category it serves: `<CATEGORY>_MODEL_PARAMS`, `<CATEGORY>_MODELS`, and `<CATEGORY>_FORMAT_SPEC` where the category has an audio format spec. Prefixes are `IMAGE_`, `IMAGE_EDIT_`, `VIDEO_`, `TTS_`, `STT_`, `MUSIC_`, `VOICE_CLONE_`, `VOICE_DESIGN_`. Next to those sit the provider's own lists under their own names (`GEMINI_TTS_VOICES`, `GPT_IMAGE_2_SIZES`, `BFL_ASPECT_RATIOS`, `RECRAFT_V3_STYLES`, `KLING_ASPECT_RATIOS`, …). 36 providers ship a values entry: exactly the ones with a unified adapter.

The tables are **the same objects the adapter compiles with**, re-exported not copied, so a picker and the request it builds cannot disagree. `test/values-entries.test.ts` asserts that by reference (`===`), not deep equality.

`unmodel/values` is the canonical hub: the closed unions as arrays.

```ts
import { ASPECT_RATIO_PRESETS, AUDIO_FORMAT_CODECS, CANONICAL_KEY_LISTS } from "unmodel/values";

const isCodec = (value: string): value is (typeof AUDIO_FORMAT_CODECS)[number] =>
  (AUDIO_FORMAT_CODECS as readonly string[]).includes(value);

CANONICAL_KEY_LISTS.tts; // ["model", "text", "voice", "speed", "outputFormat", "language", "providerOptions"]
```

`ASPECT_RATIO_PRESETS`, `RESOLUTION_TIERS`, `VIDEO_RESOLUTIONS`, `IMAGE_OUTPUT_FORMATS`, `OUTPUT_DELIVERIES`, `AUDIO_FORMAT_CODECS`, `AUDIO_CONTAINERS`, `TIMESTAMP_GRANULARITIES`, `AUDIO_INPUT_KINDS`, `CANONICAL_KEY_LISTS` and `CHAT_PROVIDERS`. `test/types/values-hub.test-d.ts` proves each array equal to its union in both directions, so a word added to the vocabulary and forgotten in the array is a compile error, not a picker that quietly offers eight options out of nine.

The 1,339 `"provider/model"` chat refs are the runtime twin of `ChatModelRef`. They get their own subpath because they are 45 KiB:

```ts
import { CHAT_MODEL_REFS } from "unmodel/values/chat-refs";
```

What this costs, measured against a real build, per export, with a tree-shaking bundler. `test/values-entries.test.ts` runs the measurement and holds each entry to a budget:

| Import | Cost |
| --- | --- |
| any one array from `unmodel/values` | 0.2–1.5 KiB |
| the median export of a provider entry | ~1 KiB |
| the most expensive one (`unmodel/runway/values`) | 19.4 KiB |
| `CHAT_MODEL_REFS` | 49 KiB, hence its own subpath |

That is the point of the layout. The per-model tables live on import-free `<category>-params.ts` leaves the adapter also reads, so importing one voice list does not pull that provider's validator, zod schema or catalog. Before that split the same measurement read 30–82 KiB.

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
| [Realtime audio config](#realtime-audio) | none | `unmodel/openai`, `unmodel/deepgram`, `unmodel/elevenlabs`, etc. |

See the full [provider and endpoint roster](docs/providers.md).

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

The model ref selects the result type, URL, SDK targets, catalog, and validation rules. Cohere and providers that need endpoint, project, account, or region config use their direct provider modules instead.

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

Formats and some provider-only extras narrow to the selected model. Published languages and voices autocomplete. Custom values stay type-accepted, decided by provider validation.

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

stt({ model: "assemblyai/universal-2", audio: { url } });  // ✅ provider fetches a URL
stt({ model: "assemblyai/universal-2", audio: { file } }); // ❌ TypeScript error

stt({ model: "cartesia/ink-whisper", audio: { file } });   // ✅ multipart bytes
stt({ model: "cartesia/ink-whisper", audio: { url } });    // ❌ TypeScript error
```

Supported inputs are `{ file }`, `{ url }`, `{ fileId }`, and `{ data, mimeType }`. Each model exposes only the forms its route accepts.

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
image({ model: "openai/gpt-image-1", prompt: "...", background: "transparent" }); // ✅
image({ model: "openai/gpt-image-2", prompt: "...", background: "transparent" }); // ❌ TypeScript error
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

Source inputs narrow by route. OpenAI takes `{ file }`, FLUX Kontext takes `{ data }` or `{ url }`. Masked and specialized edits live on provider subpaths.

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

Adding `image`, `video`, or a reference image selects the matching route. unmodel validates job submission. Polling and downloads stay with your transport code.

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

Audio-conditioned Stability routes stay provider-native because no other provider shares their controls.

## Voice cloning

`unmodel/voice-clone` creates a voice from reference recordings. Sample shape narrows per model at compile time: multipart `{ file }` at ElevenLabs, Fish Audio, Cartesia and LMNT, base64 `{ data }` at Inworld, an upload-handle `{ fileId }` at MiniMax. Sample counts are enforced per route, bounds in the message:

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

The vocabulary carries the facts an invoice would otherwise teach. Fish Audio defaults new voices to **public**, so `visibility` is a param and the validator warns when you omit it. MiniMax requires a caller-chosen `voiceId` everyone else refuses. Per-sample `transcript`s exist wherever a wire field does. You get back the created voice's id, which `unmodel/tts` takes as `voice`. Managing stored voices is out of scope. Speechify's clone route (a consent challenge/response ceremony) is wire-only at `unmodel/speechify`.

## Voice design

`unmodel/voice-design` invents a voice from a text description. `prompt` is the generative word (`voice_description`, `instruction`, `designPrompt` on the wires), never `description`, which is voice-clone metadata:

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

The unified surface is phase 1, the generative call. ElevenLabs and Inworld return previews that a second, provider-shaped call persists. Those saves are wire-only (`elevenlabs.voiceDesignSave`, `inworld.voiceDesignPublish`) because their correlating handles share no vocabulary. MiniMax is single-phase. Fish Audio's candidates are deliberately ephemeral. Hume's voice design rides its own TTS wire, on `unmodel/hume`.

## Realtime audio

unmodel validates realtime config objects, not socket lifecycles:

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

`.request.headers` holds the required static headers such as `content-type` or `anthropic-version`. Never credentials.

### Provider SDKs

`.toSdk(target)` returns an endpoint's declared handoff shape. Official SDK targets are reshaped as needed. Providers without an official SDK may expose their wire shape:

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

For tools, wrap the emitted JSON Schemas with your AI SDK's `jsonSchema`:

```ts
import { jsonSchema } from "ai";
import { withJsonSchemaTools } from "unmodel/ai-sdk";

const options = withJsonSchemaTools(request.toSdk("ai-sdk"), jsonSchema);
```

`"ai-sdk"` is an SDK target. `"vercel"` in `.toApi("vercel")` means Vercel AI Gateway.

### Multipart and WebSockets

Multipart endpoints export form-data helpers such as `sttToFormData`, `imageEditToFormData`, or provider-level `toFormData`. Do not set `content-type`. `fetch` adds the boundary.

WebSocket validators return either a ready `wss://` URL in `.request.url` or a validated first-frame/config object plus a provider URL builder.

## Validation

Invalid params throw `UnmodelValidationError`. An unregistered or structurally unavailable translation throws `TranslationUnavailableError`. Use `.safe()` to get either back as issues:

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

Keeping them separate preserves exact-key and model-specific inference on normal TypeScript calls. Direct provider validators expose `.safe()`. `.safeUnknown()` belongs to the standardized surfaces.

For standardized calls, `result.warnings` reports validation findings and `result.params.warnings` reports compilation loss. The throwing form exposes the latter as `request.warnings`.

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

Known `providerOptions` fields get types, autocomplete, and provider validation. Unknown keys stay accepted for forward compatibility and may produce `unknown_param` warnings:

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

Pass unmodel options as the second argument so the request body stays provider-native:

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

Use `<string>` only for model IDs genuinely discovered at runtime. It gives up per-model narrowing on purpose.

A new model at a registered provider stays callable. It emits `unknown_model` and continues with the checks that do not need catalog metadata.

## Retarget chat

Chat validators backed by an availability map expose `.toApi(provider)`. It moves one validated request to another provider that serves the same model:

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

`.toApiSafe(provider)` is the non-throwing form. Retargeting reruns the destination deny/enum rules it has available. For full schema, nested, catalog, context, and budget checks, pass the result through the destination validator. Chat-only, one hop.

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

Every chat provider uses `checkChat`. Use the checker from the provider that returned the response: change the request provider and the response shape changes with it. Handle HTTP/API error payloads before calling a checker. Media checker names follow their response documents, such as `checkImages`, `checkTranscription`, `checkListen`, or `checkTts`.

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

Catalog model IDs are plain strings. Provider modules export generated model unions for autocomplete. Request validators may still accept future IDs and warn at runtime.

Query and validate from the terminal:

```sh
npx unmodel models openai gpt-5.2
npx unmodel validate openai.chat request.json
npx unmodel validate unified.image image.json --max-cost 0.05
npx unmodel validate unified.stt transcription.json --json
```

`validate` exits non-zero for invalid params. Blob-only inputs stay library-only because JSON cannot represent them.

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

The package is marked `sideEffects: false`.

| Import | Includes |
| --- | --- |
| `unmodel` | shared types and helpers; no provider runtime |
| `unmodel/<provider>` | one provider's validators, checks, and catalog |
| `unmodel/chat` | ready chat compiler plus its concrete provider validators |
| `unmodel/chat/factory` | provider-free `createChat(registry)` |
| `unmodel/image`, `unmodel/tts`, etc. | every adapter in that category |
| `unmodel/<provider>/unified` | one provider's unified adapters, where available |
| `unmodel/<provider>/types`, `unmodel/types` | types only (the emitted JavaScript is an empty module) |
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

Registered chat providers narrow result types. Media registries also narrow model autocomplete. Chat keeps its global, forward-compatible ref input and brands unregistered results as unusable. Ready packs trade bundle size for zero setup, so prefer narrow factories in browser and edge bundles.

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
