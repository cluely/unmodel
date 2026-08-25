---
"unmodel": minor
---

**Two more native providers — `unmodel/veed` and `unmodel/heygen` — which take `unmodel/lipsync`
and `unmodel/avatar` from two providers to four, and finally make the category's oldest open
vocabulary question answerable.**

Four of fal's ten lipsync endpoints are sync.'s models resold; two more are VEED's and two more
are HeyGen's. Those three vendors are now here at their own APIs, which means the words in
`LipsyncParams` and `AvatarParams` are checked against four independent request schemas rather
than against one aggregator's flattening of them.

```ts
import { lipsync } from "unmodel/lipsync";

JSON.stringify(lipsync({ model: "veed/lipsync-2.0", source: { url: clip }, audio: { url: vo } }));
// → {"video_url":"…","audio_url":"…"}
//   POST https://api.veed.io/v1/lipsync-2.0

JSON.stringify(lipsync({ model: "heygen/lipsync-precision", source: { url: clip }, audio: { url: vo } }));
// → {"video":{"type":"url","url":"…"},"audio":{"type":"url","url":"…"},"mode":"precision"}
//   POST https://api.heygen.com/v3/lipsyncs
```

## The promotion rule ran, and the answer was no

`unmodel/lipsync` has never had a canonical word for "what happens when the track and the clip
are different lengths", and the rule for adding one is two INDEPENDENT vendors spelling it
compatibly. With four providers that is finally testable:

| vendor | field | value space |
|---|---|---|
| sync. (natively, and resold at fal) | `sync_mode` / `options.sync_mode` | 5-arm enum |
| LatentSync (at fal) | `loop_mode` | 2-arm enum |
| HeyGen (natively, and resold at fal) | `enable_dynamic_duration` | boolean, default `true` |
| VEED | — | the route has no such field |

Five rows, three vendors — a vendor agreeing with itself through a reseller is one witness.
Three shapes and one outright absence is not a vocabulary: a canonical `durationMismatch` would
have to pick a value space, and a boolean and a five-strategy enum have none in common. So it
stays a per-model extra everywhere, and `test/unified/lipsync-capabilities.test.ts` now holds
that as an assertion which FAILS the day two of them agree.

## `unmodel/veed` — the smallest request surface in the library

`https://api.veed.io/v1`, JSON, `Authorization: Bearer vp_…` (`VEED_API_KEY`). Two URLs with
disjoint schemas: `veed.lipsync` posts `{ video_url, audio_url }` to `/v1/lipsync-2.0`, and
`veed.avatar` posts `{ image_url, audio_url, resolution }` to `/v1/fabric-1.0`. Everything is
typed from one publicly fetchable OpenAPI 3.1.0 document; VEED ships no SDK, so there was no
tiebreak to run.

Three facts from that document decide the provider. Every request schema is
`additionalProperties: false`, so an undeclared key is a **422 with no job created** rather than
a field VEED ignores — the opposite of sync. and Topaz, and the reason the unknown-param check
here reports an error where theirs report warnings. Every media field carries the pattern
`^[Hh][Tt][Tt][Pp][Ss]?://` and an 8192-character ceiling, and VEED publishes **no upload arm of
any kind** — no multipart, no base64, no asset ids — so a `data:` URI, an `s3://` reference and
a bare path are three 422s that look like URLs. And `resolution` on `fabric-1.0` is `required`
with **no default**, which makes `{ image_url, audio_url }` a 422 and makes this the one route
in either category that needs a word the vocabulary has not got. It rides as a per-model extra,
and the refusal quotes both rates rather than choosing: 480p is $0.08 per second of output and
720p is $0.15, so a default unmodel invented would be a line item.

Pricing is in the spec — each submit operation carries an `x-veed-pricing` extension with
currency, unit, rounding and rates that may be conditioned on a request field — so the rates
change in the same diff as a schema change. Where the published numbers disagree, veed.io/api
says Fabric is $0.08–$0.20/sec and the model page, the tools page and the machine-readable
extension all say $0.08–$0.15; the outlier is not followed.

VEED's lipsync row declares **no extras at all**, and that emptiness is the evidence behind the
promotion decision above. Its avatar row is the OPPOSITE of the same vendor's row at fal:
`fal/veed/avatars/audio-to-video` is a presenter library with `sources: []`, and VEED's own API
has no presenter roster (`POST /v1/avatars` answers a real JSON 404), so `veed/fabric-1.0` is
`sources: ["image"]`. Same vendor, two products, opposite rows.

Not served: the `video-background-removal` family — three variants and six of VEED's ten
operations. A real, priced, documented product that matches no category unmodel has, and a
one-provider `matting` category read off a single witness is what this library declines to
build.

⚠️ VEED's docs, schemas and playground are fully public, but keys are not self-serve: every page
links to contact-sales. The types are as exact as any in the library and were never exercised
against a live key.

## `unmodel/heygen` — the one with two specs and a moved doc host

`https://api.heygen.com/v3`, JSON, `x-api-key: <HEYGEN_API_KEY>`. `heygen.avatar` is
`POST /v3/videos` and `heygen.lipsync` is `POST /v3/lipsyncs` — two URLs with two response
shapes and **two different status enums** (`processing` on the video route, `running` on the
lipsync one; a shared polling `switch` over them falls through).

Two traps this provider exists to have already walked into. HeyGen serves **two** OpenAPI
documents and both answer 200: `developers.heygen.com/openapi.yaml` is a v4.0.8 document with 52
v1/v2 paths and no `/v3/videos` at all, and `openapi/external-api.json` is the current one (98
paths, 300 schemas). And `docs.heygen.com` is gone — it 301s to `developers.heygen.com`, where
the old canonical slugs 404. Every URL cited here was re-resolved by fetching it.

**Neither route has a `model` field, and both defaults are prices.** The video route has an
`engine` discriminated union — `avatar_iii`, `avatar_iv` (applied when `engine` is omitted),
`avatar_v` — and those three are the catalog rows, because they are three products with three
pages and a four-fold price spread. The lipsync route has `mode: "speed" | "precision"` (default
`"speed"`), catalogued as `lipsync-speed` and `lipsync-precision` after HeyGen's own doc slugs.
Both adapters write the wire value out on every call: a ref that names a price should not depend
on a server-side default to get it.

Seven cross-field rules are checked, every one of them prose in the spec on fields that are all
individually optional: `type` decides which visual source is required and which is refused (both
arms are `additionalProperties: false`, and HeyGen's own documented example error is that
mistake); Avatar III does not render raw image input; `expressiveness` is Avatar IV only and
`motion_prompt` is not Avatar III, both REJECTED rather than ignored; `script` and the audio
fields are mutually exclusive; `voice_id` is required with a script unless `avatar_id` supplies
a default voice; `voice_settings` is silently ignored beside uploaded audio (a warning, because
it is a no-op); and `output_format: "webm"` rejects any `background`.

HeyGen brings the category a third answer to inline bytes. fal builds a `data:` URI for a field
that fetches URLs; sync. and VEED refuse bytes because their fields only fetch; HeyGen has a
real `{ type: "base64", media_type, data }` arm on its own `oneOf`, so the bytes go in
structurally — and its `audio_url` does not have that arm, so one request accepts bytes for the
still and refuses them for the track.

Pricing is public USD. Two of the five rows carry a band, because HeyGen's table is keyed by
engine × avatar type and the avatar type lives on the look rather than in the request: Avatar
III $0.0167–$0.0433/sec, Avatar IV $0.05–$0.0667, Avatar V $0.0667 exactly, lipsync speed
$0.0333 and precision $0.0667 exactly. Rows carry the top of each band. Nothing estimates: every
rate is per second of output and the output's length follows the audio's.

**`heygen.tts` is a deliberate exclusion.** `POST /v3/voices/speech` publishes no model id at all
(the engine is fixed to Starfish and stated only in prose), `voice_id` is an account-scoped
handle with no published roster, `input_type` is a bare `string`, and there is no format, sample
rate, codec or bitrate control — which is most of what `unmodel/tts`'s vocabulary is. A row that
narrows nothing would widen the tts matrix while telling a caller less than every other row in
it. Also excluded with reasons: `type: "cinematic_avatar"` (a prompt-to-video model wearing an
avatar route's URL — no audio input, a `prompt` and an array of look ids), `type: "studio"` (a
fifty-scene timeline document), video translation, background removal, HyperFrames, AI clipping,
filler-word removal, and the whole platform surface.

**Argil and Tencent's native Hunyuan3D** were researched in the same rounds and are recorded as
declined in `docs/providers.md`: Argil publishes no aggregated OpenAPI document (the advertised
one 404s; the schemas exist only as fences in 23 `.md` pages) and no USD pricing at all, and
Hunyuan3D's native API is a Tencent Cloud product whose auth is TC3-HMAC-SHA256 request signing
rather than a header key. Both vendors' models remain reachable through fal.

## New subpaths

`unmodel/veed`, `unmodel/veed/unified`, `unmodel/veed/types`, `unmodel/veed/values`,
`unmodel/heygen`, `unmodel/heygen/unified`, `unmodel/heygen/types`, `unmodel/heygen/values`.
`unmodel/lipsync` and `unmodel/avatar` gain two providers each with no API change; pack budgets
move 350 → 445 KiB (measured 395.2) and 345 → 445 KiB (measured 396.4), and the two stay within
2% of each other, which is the assertion that has teeth.
