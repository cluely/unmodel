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
| [Lipsync](#lipsync) | `unmodel/lipsync` | `unmodel/fal`, `unmodel/sync` |
| [Avatar](#avatar) | `unmodel/avatar` | `unmodel/fal`, `unmodel/sync` |
| [Upscale](#upscale) | `unmodel/upscale` | `unmodel/fal`, `unmodel/topaz` |
| [3D generation](#3d-generation) | `unmodel/3d` | `unmodel/tripo3d`, `unmodel/fal` |
| [Music generation](#music-generation) | `unmodel/music` | `unmodel/elevenlabs`, `unmodel/fal`, `unmodel/stability` |
| [Voice cloning](#voice-cloning) | `unmodel/voice-clone` | `unmodel/elevenlabs`, `unmodel/cartesia`, `unmodel/minimax` |
| [Voice design](#voice-design) | `unmodel/voice-design` | `unmodel/elevenlabs`, `unmodel/fish-audio`, `unmodel/minimax` |
| [Realtime audio config](#realtime-audio) | none | `unmodel/openai`, `unmodel/deepgram`, `unmodel/elevenlabs`, etc. |
| [Dubbing](#dubbing) | none | `unmodel/elevenlabs` |

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
image({ model: "openai/dall-e-3", prompt: "...", quality: "hd" });    // ✅
image({ model: "openai/gpt-image-2", prompt: "...", quality: "hd" }); // ❌ TypeScript error
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

Resolutions and durations narrow by model — including the ones the official SDK gets wrong (`openai@7.4.0` refuses `1920x1080` and `seconds: "16"` outright, and compiles `1792x1024` on `sora-2`, which renders 720p only):

```ts
video({ model: "openai/sora-2-pro", prompt: "...", resolution: "1080p", duration: 16 }); // ✅
video({ model: "openai/sora-2", prompt: "...", resolution: "1080p" }); // ❌ TypeScript error
```

## Lipsync

Redubbing a clip: a video goes in, an audio track goes in, and a clip whose
mouth matches the audio comes out.

```ts
import { lipsync } from "unmodel/lipsync";

const request = lipsync({
  model: "fal/fal-ai/sync-lipsync/v3",
  source: { url: "https://example.com/take-3.mp4" },
  audio: { url: "https://example.com/vo-french.wav" },
});
```

Five words — `model`, `source`, `audio`, `seed`, `providerOptions` — and no
size, length or shape, because the output's geometry **is** the input's. That
is what separates this from `unmodel/video`, where every one of those is a
decision the caller makes.

`source` narrows to the ref. Which shape a route accepts is a per-model fact,
so a still handed to a clip-only model is a compile error on `source` naming
the shape that model takes, rather than a request that 422s.

sync. (Sync Labs) is the category's second provider, and the overlap is the
point: four of fal's ten lipsync endpoints are sync.'s own models resold, so
the same weights are reachable both ways and the two calls compile to visibly
different bodies. (Two more of fal's ten are HeyGen's, which is the third
provider here, and two more are VEED's, which is the fourth.)

```ts
lipsync({ model: "fal/fal-ai/sync-lipsync/v2", source: { url: clip }, audio: { url: vo } });
// → {"video_url":"…","audio_url":"…"}
//   POST https://queue.fal.run/fal-ai/sync-lipsync/v2

lipsync({ model: "sync/lipsync-2", source: { url: clip }, audio: { url: vo } });
// → {"model":"lipsync-2","input":[{"type":"video","url":"…"},
//                                 {"type":"audio","url":"…"}]}
//   POST https://api.sync.so/v2/generate
```

Two flat URL fields at the reseller, a tagged `input` array at the vendor, and
the model id in opposite places: at fal the ENDPOINT is the model, so `lipsync-2`
has moved into the url and out of the body; natively it is a body field. Then
the array is what carries several voices, `refId`s, segments and dubbing,
none of which fal's flattening can express. `sync_mode` sits at the body root
at fal and under `options` natively, and fal accepts inline bytes as a `data:`
URI where sync. fetches URLs and asset ids only. Neither is a superset of the
other, which is why both are here.

VEED and HeyGen are the category's third and fourth providers, and between the
four there are now four wire shapes for one request:

```ts
lipsync({ model: "veed/lipsync-2.0", source: { url: clip }, audio: { url: vo } });
// → {"video_url":"…","audio_url":"…"}
//   POST https://api.veed.io/v1/lipsync-2.0

lipsync({ model: "heygen/lipsync-precision", source: { url: clip }, audio: { url: vo } });
// → {"video":{"type":"url","url":"…"},"audio":{"type":"url","url":"…"},"mode":"precision"}
//   POST https://api.heygen.com/v3/lipsyncs
```

VEED's is the smallest request surface in the library: `Lipsync20Input` is those
two required URLs and `additionalProperties: false`, so its row declares **no
extras at all** and every dial a caller reaches for from a neighbouring provider
is a compile error before it is a 422. HeyGen's is the other shape entirely —
the media fields are tagged objects, and the ref names a PRICE rather than a
model, because `POST /v3/lipsyncs` has no model field and `mode: "speed" |
"precision"` is a 2× difference per second. Four providers, four route
selectors: a pseudo-param stripped into the url at fal, a real `model` body
field that survives at sync., no selector at all at VEED (the model is the
path), and a real field under a *different name from the id* at HeyGen.

What is deliberately *not* in the vocabulary: "what to do when the audio
outlasts the clip". With four providers the promotion rule is finally testable —
two independent vendors spelling one word compatibly — and the answer is still
no. sync. spells it `sync_mode` with five arms, LatentSync `loop_mode` with two,
HeyGen `enable_dynamic_duration` as a boolean, and VEED does not spell it at
all. fal's resale keeps sync.'s word on sync.'s models and HeyGen's word on
HeyGen's, which makes five rows and three vendors: a vendor agreeing with itself
through a reseller is one witness. A canonical word would have to pick a value
space, and a boolean and a five-strategy enum have none in common. So it stays a
per-model extra, typed from that endpoint's own wire interface, and
`test/unified/lipsync-capabilities.test.ts` fails the day two of them agree.

Routes that take a script and a voice id instead of an audio track are TTS
composed with lipsync; composing them inside one call would hide which half
failed, so they are not curated.

## Avatar

Making a still speak — the twin of lipsync, split from it by what goes in.
`fal-ai/sync-lipsync/v3` and `fal-ai/sync-lipsync/v3/image-to-video` are one
vendor's one model behind two routes, and they land at two different entry
points here.

```ts
import { avatar } from "unmodel/avatar";

const request = avatar({
  model: "fal/fal-ai/sync-lipsync/v3/image-to-video",
  image: { url: "https://example.com/headshot.png" },
  audio: { url: "https://example.com/vo.wav" },
});
```

`image` narrows to the ref in three directions. Most routes animate a picture
you supply, and there it is **required**. Two of the twelve animate a
**catalogued performer** instead — `veed/avatars/audio-to-video` and
`argil/avatars/audio-to-video` pick from a closed list of trained presenters and
have no image field at all — and there it types as `never`:

```ts
avatar({ model: "fal/veed/avatars/audio-to-video", audio: { url } });                  // ok
avatar({ model: "fal/veed/avatars/audio-to-video", image: { url }, audio: { url } });  // compile error
```

The presenters themselves are reached through `providerOptions` — a 28-value
enum spelled `avatar_id` at one vendor and `avatar` at another is a coincidence
with a shape rather than a vocabulary. Neither is `prompt`: three of fal's eight
rows have no prompt field, one requires one, and two default theirs to `"."`.

At sync., the category's second provider, that same split lands on ONE model id
rather than on two routes. `sync/sync-3` is reachable from `unmodel/lipsync`
and from `unmodel/avatar` at the same url, and the only thing separating the two
calls is the tag on the first input item:

```ts
lipsync({ model: "sync/sync-3", source: { url: clip },  audio: { url: vo } });
// → {"model":"sync-3","input":[{"type":"video","url":"…"},
//                              {"type":"audio","url":"…"}]}

avatar({  model: "sync/sync-3", image:  { url: still }, audio: { url: vo } });
// → {"model":"sync-3","input":[{"type":"image","url":"…"},
//                              {"type":"audio","url":"…"}]}
```

`sync-3` is the only one of sync.'s five models that reads an image, so it is
the whole of that provider's avatar roster. `image` is **required** there rather
than `never`: sync. catalogues no preset performers and publishes no field to
name one, so there is nothing to animate without a picture.

VEED is the same vendor as one of the two performer routes above, and the
opposite row. `veed/avatars/audio-to-video` at fal is `sources: []`; VEED's own
API has no presenter roster at all (`POST /v1/avatars` answers a real JSON 404),
and what it does have is `fabric-1.0` — a picture you supply. It is also the one
route in the category that requires a word the vocabulary has not got:

```ts
avatar({ model: "veed/fabric-1.0", image: { url }, audio: { url }, resolution: "480p" });
// → {"image_url":"…","audio_url":"…","resolution":"480p"}

avatar({ model: "veed/fabric-1.0", image: { url }, audio: { url } });  // refused by NAME
```

`FabricInput.resolution` is `required` with no `default`, so VEED answers 422
without it — and it is what the price is conditioned on: $0.08 per second of
output at 480p, $0.15 at 720p. unmodel does not pick one for you, because a
default it invented would be a line item; the refusal quotes both rates instead.

HeyGen brings the third answer to inline bytes:

```ts
avatar({ model: "heygen/avatar_iv", image: { data, mimeType: "image/png" }, audio: { url } });
// → {"type":"image","engine":{"type":"avatar_iv"},
//    "image":{"type":"base64","media_type":"image/png","data":"…"},"audio_url":"…"}
```

fal builds a `data:` URI and puts it in a field that fetches URLs; sync. and
VEED refuse bytes, because their fields only fetch; HeyGen has a real
`{ type: "base64", … }` arm on its own `oneOf`, so the bytes go in structurally.
Its `audio_url` does *not* have that arm, so one request accepts bytes for the
still and refuses them for the track — an asymmetry that is HeyGen's, and the
refusal says so rather than reading as a contradiction.

Two of HeyGen's three engines are here. `avatar_iii` is in its catalog and at
its wire address and not in this pack: its own engine config says it does not
render raw image input, and this adapter compiles the raw-image arm. The
catalogued-look arm (`type: "avatar"`, `avatar_id`) is wire-only for a typed
reason rather than an oversight — an avatar row can say `image` is required,
forbidden or unknown and never "optional", and `avatar_iv` and `avatar_v` serve
both arms, so the pack compiles the one whose inputs a caller actually has (a
HeyGen `avatar_id` is a look you first train, at $1.00, and discover at
`GET /v3/avatars/looks`; there is no published roster). Reach it directly:

```ts
import { avatar } from "unmodel/heygen";
avatar({ type: "avatar", avatar_id: "abc123", audio_url: vo, engine: { type: "avatar_iii" } });
```

## Upscale

Making a frame bigger — the category that splits from `unmodel/image-edit` on
what comes OUT. An edit is described by what the result should look like; an
upscale by how much bigger it should be, and `factor` has no meaning in a
vocabulary whose size words are absolute. Some of these routes take a CLIP,
which `unmodel/image-edit` has no word for.

```ts
import { upscale } from "unmodel/upscale";

const request = upscale({
  model: "fal/fal-ai/clarity-upscaler",
  source: { url: "https://example.com/portrait.png" },
  factor: 2,
  prompt: "sharp fabric weave, natural skin texture",
});

JSON.stringify(request);
// → {"image_url":"https://example.com/portrait.png","upscale_factor":2,
//    "prompt":"sharp fabric weave, natural skin texture"}
```

Both narrowed fields are per model. `source` is a still at seven of the ten
endpoints and a clip at three — `fal-ai/seedvr/upscale/image` and
`fal-ai/seedvr/upscale/video` are one vendor's one product on two paths — and
`factor` has three answers:

```ts
upscale({ model: "fal/fal-ai/seedvr/upscale/video", source: { url }, factor: 2 });    // ok
upscale({ model: "fal/fal-ai/aura-sr", source: { url }, factor: 2 });                 // compile error: 4 only
upscale({ model: "fal/fal-ai/recraft/upscale/crisp", source: { url }, factor: 2 });   // compile error: no factor
```

`creativity`, `resemblance`, `denoise`, `sharpen` and the rest are per-model
extras: each is one vendor's dial with no second witness, and `creativity` alone
is a 0–1 number at Clarity, a 1–6 integer at Topaz and a two-member enum at
FLUX.

Topaz Labs is the category's second provider, and at its own API the ROUTE
follows the model rather than the input: two paths with disjoint model enums —
`/enhance/async` for the six classic Gigapixel upscalers, `/enhance-gen/async`
for the nine generative Wonder and Bloom ones — so the ref decides the url and
there is nothing for the caller to say. The ids are Topaz's own product names,
spaces and all.

```ts
import { toFormData } from "unmodel/topaz";

const enlarged = upscale({
  model: "topaz/Redefine",
  source: { url: "https://example.com/portrait.png" },
  prompt: "a wooden sailing boat at anchor",
});

enlarged.request.url;  // "https://api.topazlabs.com/image/v1/enhance-gen/async"
enlarged.request.body; // "form" — post toFormData(enlarged), not JSON.stringify

upscale({ model: "topaz/Standard V2", source: { url } });
// → POST https://api.topazlabs.com/image/v1/enhance/async
```

Every Topaz body is `multipart/form-data`, because neither path declares a JSON
arm — which is also why `.request.headers` is empty there: the boundary belongs
to the `FormData`, and a hand-set content-type would break the request.

`factor` types as `never` at every Topaz ref, for a different reason from
`fal-ai/recraft/upscale/crisp`'s: Topaz states an absolute output size
(`output_width`, `output_height`) rather than a multiplier, and a multiplier is
not derivable from a URL. The two refusals carry different messages because a
caller can act differently on each. What Topaz brought the category is a
second witness for `prompt` — nine of its fifteen models steer on one. The
tuning dials stay per-model extras: they are absent from Topaz's own OpenAPI
document and hand-transcribed here, and Topaz ignores a dial a model does not
read rather than refusing it, so a wrong one is a silent no-op at the API and a
warning here.

## 3D generation

Asking for an object rather than a picture of one — the first category in the
library to ship with TWO providers on its first day, and that is the point.
`unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale` each shipped on fal
alone and found their second provider later; 3D waited, because a vocabulary
read off one vendor is that vendor's request schema with the names changed, and
3D is where that shows fastest.
Two schemas in, `texture` already had five spellings — `texture` at Tripo,
`textured_mesh` at Hunyuan3D, `enable_texture` at Hi3D, `should_texture` at
Meshy, `texture_mode` at Rodin — and the output container had four more plus a
boolean that changes it as a side effect. None of them is in the vocabulary.

```ts
import { threeD } from "unmodel/3d";

const request = threeD({
  model: "tripo3d/v3.1-20260211",
  prompt: "a brass astrolabe on a walnut stand",
  seed: 7,
  texture_quality: "detailed",
});

JSON.stringify(request);
// → {"model":"v3.1-20260211","prompt":"a brass astrolabe on a walnut stand",
//    "model_seed":7,"texture_quality":"detailed"}
request.request.url;
// → "https://openapi.tripo3d.ai/v3/generation/text-to-model"
```

Five words, and the first category whose two content words are **alternatives**
rather than companions: a 3D route is asked for a thing either by describing it
(`prompt`) or by showing it (`image`), and each row says which of the two that
route reads.

```ts
threeD({ model: "fal/tripo3d/h3.1/text-to-3d", prompt: "a chair" });          // ok
threeD({ model: "fal/tripo3d/h3.1/text-to-3d", image: { url } });             // compile error: text-driven
threeD({ model: "fal/fal-ai/trellis", image: { url } });                      // ok
threeD({ model: "fal/fal-ai/trellis", prompt: "a chair" });                   // compile error: image-driven
threeD({ model: "fal/fal-ai/hyper3d/rodin/v2.5", prompt, image: { url } });   // ok — reads both
```

The third arm is not a hedge. `fal-ai/hyper3d/rodin/v2.5` publishes both fields
and requires neither: the prompt steers an image-driven reconstruction and also
stands alone. So do all four Tripo models, for a different reason — at the
native API the model id is the same string in both moods and the **route**
forks, `POST /v3/generation/text-to-model` versus
`POST /v3/generation/image-to-model`.

That overlap is deliberate. `tripo3d/h3.1/image-to-3d` at fal and
`tripo3d/v3.1-20260211` here are the same model reached two ways, and the two
requests compile to visibly different bodies:

```ts
threeD({ model: "fal/tripo3d/h3.1/image-to-3d", image: { url } });
// → {"image_url":"https://example.com/chair.png"}   POST https://queue.fal.run/tripo3d/h3.1/image-to-3d

threeD({ model: "tripo3d/v3.1-20260211", image: { url } });
// → {"model":"v3.1-20260211","input":"https://example.com/chair.png"}
//   POST https://openapi.tripo3d.ai/v3/generation/image-to-model
```

`seed` maps to the **geometry** seed wherever a route publishes more than one:
Tripo has `model_seed`, `image_seed` and `texture_seed`, pinning the mesh, the
internal text-to-image stage and the texturing separately, and the canonical
word is the one that decides whether you got the same object.

Everything else is a per-model extra, typed from that route's own wire
interface: the polygon budget (`face_limit` / `face_count` /
`target_polycount` / `decimation_target`), the texture and PBR switches, the
quad-mesh flag, the output container, and every sampler dial. There is no
`size`, `aspectRatio`, `resolution` or `n` — a mesh has no frame, and these
routes return one object per request.

Two things about the wire are worth knowing before your first call. Tripo's
`input` is one polymorphic string that accepts a `file_…` token, a public URL or
a prior `task_…` id and **never inline bytes**, so a `{ data }` ref is refused
here naming `POST /v3/files` rather than compiled into a `data:` URI Tripo would
reject. And seven of Tripo's parameters are gated on the model version —
`v2.5-20250123` takes none of them — which is a compile error rather than a 4xx.

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

## Dubbing

Wire-only, at `unmodel/elevenlabs`. There is no `unmodel/dubbing` and there deliberately will not be one until a second vendor's request shape agrees with this one — HeyGen's `/v3/video-translations` is the other witness and it is a one-shot job where ElevenLabs is a two-request project/target model with an editable transcript, a revision counter and a `stale` state. See the [provider roster](providers.md) for the recorded reason.

```ts
import { dub, dubLanguage, dubToFormData } from "unmodel/elevenlabs";

const project = dub({
  source_url: "https://example.com/promo.mp4",
  model_id: "dubbing_v2",
  source_language: "en",
});

const created = await fetch(project.request.url, {
  method: "POST",
  headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
  body: dubToFormData(project),
}).then((r) => r.json());

// …poll GET /v1/dubbing/project/{project_id} until status === "ready"…

const target = dubLanguage({ project_id: created.project_id, target_language: "es-MX" });
```

Four things the wire types carry that the docs make you dig for. The reference page most search results land on 308-redirects to the **legacy** `/v1/dubbing` route, which has no `model_id` at all and cannot reach Dubbing v2. `target_language` is narrowed per model against ElevenLabs' published BCP-47 tables — Dubbing v2 takes 94 base tags plus 14 dialects, Dubbing v1 takes 86 base tags and **no** dialects, so `es-MX` on v1 is refused by name with `es` suggested. Polling is two-level with a third axis: a language target can be `completed` and hold a **stale** output, which `checkDubbingLanguage` catches by comparing `output_revision` against `revision`. And the only v2 output is a signed, time-limited **audio** track — a dubbed video needs the legacy route or a Studio render, neither of which this surface reaches.

Cost is not knowable at request time: the rate is per minute of source media per language target, and the body carries a Blob or a URL, never a duration. `checkDubbingProject` prices it once the project GET reports `media.duration_s`. Polling, downloads and the Studio timeline stay out of scope, as they do everywhere else here.

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

## Response checks

The one surface that runs *after* the call. A `check*` helper takes a decoded response and returns a `ResponseReport` — never throws, never fetches. Import it from the provider that answered:

- **Chat** — `checkChat` at every chat provider (`unmodel/openai`, `unmodel/anthropic`, `unmodel/google`, `unmodel/cohere`, `unmodel/amazon-bedrock`, …).
- **Async jobs** — `checkJob` (`unmodel/revai`, `unmodel/speechmatics`), `checkPreRecorded` (`unmodel/gladia`), `checkTranscript` (`unmodel/assemblyai`), `checkTranscription` (`unmodel/soniox`), and `checkDubbingProject` / `checkDubbingLanguage` (`unmodel/elevenlabs`).
- **Media** — `checkImages` (`unmodel/openai`), `checkListen` (`unmodel/deepgram`), `checkStt` (`unmodel/cartesia`), `checkTranscription` (`unmodel/mistral`, `unmodel/elevenlabs`), `checkTts` (`unmodel/google`, `unmodel/murf`, `unmodel/resemble`, `unmodel/minimax`).

Handle HTTP and API error payloads yourself before calling one. What a checker is for is the failure a 200 does not tell you about.

### Three fields, three questions

```ts
report.finishReason; // WHAT HAPPENED — the provider's own vocabulary
report.warnings;     // WHAT IS WRONG WITH IT — findings, each with meta.kind
report.usage;        // WHAT IT COST — tokens, plus costUSD from catalog rates
```

**`finishReason` is the outcome**, not a warning count. It carries the provider's own words — `"failed"` from Rev AI, `"rejected"` from Speechmatics, `"length"` from a truncated chat — or its own numbers, where that is what the provider publishes. MiniMax's T2A route answers `200` for every outcome and puts the result on `base_resp.status_code`, so that is the vocabulary:

```ts
import { checkTts } from "unmodel/minimax";

const report = checkTts(await response.json(), { model: "speech-2.8-hd" });

report.finishReason;               // 0     ← the ONLY success, and it is falsy
report.warnings.length;            // 0
report.costUSD;                    // 0.0163
```

Branch on `!== 0`, never on truthiness. **`meta.kind` says which finding** you are looking at, and **`meta.retryable` says whether sending the same request again can work** — the answer a pass/fail verdict cannot give, because a rate limit clears and a bad key does not:

```ts
report.finishReason;               // 1002
report.warnings.map((w) => w.meta?.kind);
// → ["provider_error", "empty_audio"]
report.warnings[0].meta;
// → { kind: "provider_error", statusCode: 1002, statusMsg: "rate limit exceeded",
//     retryable: true, traceId: "01b8bf9bb7433cc7",
//     source: "https://platform.minimax.io/docs/api-reference/speech-t2a-http" }
```

The full code table is a value, not a comment — `MINIMAX_BASE_RESP_INFO` from `unmodel/minimax` maps each documented code to its message and, where MiniMax's own message answers it, `retryable`:

```ts
import { MINIMAX_BASE_RESP_INFO } from "unmodel/minimax";

MINIMAX_BASE_RESP_INFO[1004]; // { statusMsg: "authentication failed", retryable: false }
MINIMAX_BASE_RESP_INFO[1000]; // { statusMsg: "unknown error" }  ← no retryable: the docs do not say
```

Why there is no `outcome: "ok" | "failed"` field, and why `warnings` never holds error-severity issues: [decisions.md §9](decisions.md).

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
| `unmodel/values/chat-refs` | the 1,330 `"provider/model"` chat refs as an array (45 KiB) |

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
