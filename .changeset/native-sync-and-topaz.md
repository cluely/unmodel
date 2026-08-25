---
"unmodel": minor
---

**Two native providers — `unmodel/sync` and `unmodel/topaz` — and with them, second witnesses
for `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale`.**

Those three categories shipped on fal alone, which was always the thing to fix rather than a
property of them. A vocabulary read off one provider is that provider's request schema with the
field names changed, and here the risk was sharper than usual: four of fal's ten lipsync
endpoints ARE sync.'s models resold, so the words were being checked against the same vendor
twice. Now they are checked against the vendor's own API, and against a second vendor in
`upscale`, and the disagreements are exactly where a second witness earns its keep.

```ts
import { lipsync } from "unmodel/lipsync";

JSON.stringify(lipsync({ model: "sync/lipsync-2", source: { url: clip }, audio: { url: vo } }));
// → {"model":"lipsync-2","input":[{"type":"video","url":"…"},{"type":"audio","url":"…"}]}
//   POST https://api.sync.so/v2/generate

JSON.stringify(lipsync({ model: "fal/fal-ai/sync-lipsync/v2", source: { url: clip }, audio: { url: vo } }));
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
upscale({ model: "fal/fal-ai/recraft/upscale/crisp", source, factor: 2 });  // no multiplier: it chooses
upscale({ model: "topaz/Standard V2",                source, factor: 2 });  // no multiplier: you state a size
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
