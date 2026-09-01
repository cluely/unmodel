---
"unmodel": minor
---

**New category: `unmodel/sts` — voice conversion, two providers, four refs.**

A recording goes in, the same performance comes out in a different voice. The
sixth category added in 2026 and the smallest pack in the library, and the only
one where **three of five canonical words are required**.

```ts
import { sts } from "unmodel/sts";

sts({
  model: "elevenlabs/eleven_multilingual_sts_v2",
  audio: { file: recording },
  voice: "21m00Tcm4TlvDq8ikWAM",
});
// → { audio: <Blob>, model_id: "eleven_multilingual_sts_v2" }
//   …posted to /v1/speech-to-speech/21m00Tcm4TlvDq8ikWAM, because at this
//   endpoint the voice is a URL PATH segment.

sts({ model: "hume/voice-conversion", audio: { file: recording }, voice: { name: "Male English Actor" } });
// → { audio: <Blob>, voice: { name: "Male English Actor" } }
```

**Five canonical words** — `model`, `audio`, `voice`, `outputFormat?` plus
`providerOptions`. `model`, `audio` and `voice` are all **required**: a
text-to-speech request can omit the voice and get a default speaker, and a
conversion with no target voice is not a conversion. There is no `text`, no
`speed` and no `language`, because the words, the timing and the delivery all
come from the recording.

**The address is `<provider>.sts`** — the category id, the same construction
`tts` and `stt` use, all three being the operation's own initialism rather than
a wire path. `voiceConvert` was the near-miss and lost on the property
`src/cli-registry.test.ts` exists to keep: the word you type at
`unmodel/<category>` and the word you type at `unmodel/<provider>` must be the
same word, and `unmodel/voice-convert` would have put a fourth `voice*` entry
point next to `voiceClone` and `voiceDesign` for an operation that creates no
voice at all — it spends one. Retired before they ever shipped, and pinned in
that test so a rename has to delete an assertion: `elevenlabs.speechToSpeech`
(the wire path), `elevenlabs.voiceChanger` (ElevenLabs' *and* Cartesia's product
name), `elevenlabs.voiceConvert`, `hume.voiceConversion`.

**The whole category is library-only, by design.** `audio` is a required binary
form part at both witnesses with no URL, base64 or upload-handle alternative, so
no JSON params document can express a request: `elevenlabs.sts` and `hume.sts`
are `MULTIPART_ONLY` and there is deliberately **no `unified.sts` CLI entry** —
the only pack without one. Send it with each provider's own
`stsToFormData(validated)`.

**New addresses.**

- `elevenlabs.sts` — `POST /v1/speech-to-speech/{voice_id}`, multipart, typed
  from the live `api.elevenlabs.io/openapi.json` (re-fetched 2026-08-31). Three
  models. `voice_id` is a PATH segment and `output_format` + `enable_logging` are
  QUERY params, so all three are stripped from the body and live in
  `.request.url`; the 27-value format enum is byte-identical to the
  text-to-speech one and is reused rather than re-declared. `voice_settings` is a
  **JSON-encoded string** part — typed structured, serialized by `stsToFormData`.
  `model_id` defaults to `eleven_english_sts_v2` server-side (the English model,
  not the multilingual one the docs recommend). Priced at $0.12 per minute of
  processed audio, estimated from
  `options.media = [{ path: ["audio"], durationSeconds }]`.
- `hume.sts` — `POST /v0/tts/voice_conversion/file`, multipart. Six fields and
  that is the complete list. **No model field and no `version`**, so the catalog
  row is the synthetic id `voice-conversion` and the ref is
  `hume/voice-conversion`. No cost: hume.ai/pricing carries voice conversion as a
  feature-availability row with no rate attached, so the estimate returns
  `undefined` rather than a guess.

**`voice` is the word the two vendors spell differently**, and it is the only
canonical word in the library that lands outside the request body at one provider
and inside it at another: a URL path segment at ElevenLabs (`{ id }` only —
`{ name }` is an error naming the id) and a form part at Hume (`{ id }` and
`{ name }` both, which is what the canonical `Voice`'s three arms exist for).

**Two deliberate ElevenLabs omissions.** `optimize_streaming_latency` is a fourth
query param the OpenAPI marks `deprecated: true` *on this operation*, so it is
not typed. And `/v1/speech-to-speech/{voice_id}/stream` is not a second address:
a normalised diff of the two body schemas is identical except for the schema
title, and their query sets match, so there is nothing for a second validator to
validate.

**The 5-minute / 10,000-character tension, resolved as no check.** The capability
page says "Maximum segment length: 5 minutes"; the models page publishes a
10,000-character limit annotated "~10 minutes". They measure different things —
a per-request cap and a billing quota at 1,000 characters per minute — and
neither becomes a check, because unmodel cannot read a duration out of a `Blob`
and the `options.media` figure is for pricing, not for refusing a request the API
may well fulfil.

**Two vendors with catalogued speech-to-speech models are excluded, each with a
reason, a source and a date recorded in its own `models.ts`.**

- **cartesia** — `POST /voice-changer/bytes` and `/voice-changer/sse` are
  **sunset**: the deprecations page lists them under "These endpoints are being
  sunset. Requests after an endpoint's sunset date return an error." with
  replacement "—" and sunset date **August 20, 2026** (fetched 2026-08-31), and
  both are gone from the api-reference index. `@cartesia/cartesia-js` 4.1.0,
  published six days *after* that date, still ships an undeprecated
  `VoiceChanger` resource; the docs are the stronger source, and typing a route
  that answers an error is the reverse of what this library is for.
- **resemble** — its speech-to-speech is not a separate endpoint. It is the same
  `POST /synthesize` route already addressed as `resemble.tts`, switched into
  conversion mode by passing SSML containing `<resemble:convert src="…">` — where
  the source is an **HTTPS URL**, not a file part. A second address for one wire
  is what the naming law forbids, and the category cannot reach it anyway.

**What is not a canonical word:** every knob on both wires, because every one has
exactly ONE witness — `remove_background_noise`, `seed`, `voice_settings`,
`file_format`, `enable_logging` at ElevenLabs; `strip_headers`, `context`,
`include_timestamp_types` at Hume. Each is a per-model extra typed from its own
route's wire interface, and `test/unified/sts-capabilities.test.ts` holds the
decline as an assertion that FAILS the day a name appears on both rows.

**Also new:** `unmodel/elevenlabs` gains `sts`, `stsToFormData`,
`speechToSpeechUrl`, `SPEECH_TO_SPEECH_BASE_URL`, `DEFAULT_STS_MODEL_ID`,
`STS_FILE_FORMATS`, `STS_SEED_MIN`/`STS_SEED_MAX` and `STS_MODEL_IDS`;
`unmodel/hume` gains `sts`, `stsToFormData`, `VOICE_CONVERSION_URL`,
`VOICE_CONVERSION_JSON_URL` and `STS_MODEL_ID`; both providers' `/types` entries
gain `StsBody` (plus `SpeechToSpeechParams`/`SpeechToSpeechFormFields`/
`SpeechToSpeechSdkParams`/`ElevenlabsStsFileFormat` and
`VoiceConversionBody`/`VoiceConversionSdkParams`); both `/values` entries gain
`STS_MODEL_PARAMS`, `STS_MODELS` and `STS_FORMAT_SPEC`; `unmodel/types` gains
`StsParams`, `StsParamsBase` and `StsAudioInput`; and the CLI gains
`elevenlabs.sts` and `hume.sts` as `MULTIPART_ONLY` entries.

**Also:** `unmodel/hume/unified` becomes a barrel over `unified-tts.ts` and
`unified-sts.ts`, so `unmodel/tts` no longer reaches this provider through a
module that also carries the conversion adapter. The exported names are
unchanged. And `scripts/leaderboard-audit.ts`'s `speech-to-speech` row moves from
`categories: null` to `["sts"]` — the last AA media category unmodel had no
surface for, so the weekly audit now sweeps it like any other.
