# The unified surfaces

← back to the [README](../README.md)

One import per category, one camelCase vocabulary, `"provider/model"` refs. Every call compiles to provider-native wire params and finishes in that provider's validator.

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

See the full [provider and endpoint roster](providers.md), and the [TTS integrator's matrix](tts.md) for per-provider auth, response delivery and wire quirks.

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

Formats and some provider-only extras narrow to the selected model. Published languages and voices autocomplete where the provider publishes them. Custom values stay type-accepted, decided by provider validation.

`voice` is the one field where the wire and unified surfaces differ on purpose. `unmodel/openai`'s own `tts` gates the built-in names closed, because OpenAI publishes exactly that list. Unified `tts()` completes the same list and never gates it at compile time, because a cloned voice id is a working request at every provider and a union that refused it would be wrong for the caller who needs it most.

Cost estimation for TTS requests (`.safe()`'s `estimate`, `maxCostUSD`) is covered in [validation.md](validation.md#estimating-cost).

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

OpenAI, Cartesia, Deepgram, ElevenLabs, Inworld, and Soniox expose realtime config validators. See the [provider roster](providers.md) for each surface.

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
