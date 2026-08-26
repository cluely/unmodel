# Text-to-speech integrator's matrix

Nineteen providers, one `tts()`. What follows is the per-provider wire detail that a
canonical vocabulary deliberately hides: where the request goes, which header the
credential rides in, where the audio comes back, and which endpoint quirks are silent
no-ops rather than errors.

## Why this file is split in two

Three of these facts are already machine-readable and four are not, so the file is
written two ways:

- **Generated.** URL, method and static headers are properties of a compiled
  `.request`. A hand-written table of them is a copy, and a copy is a thing that drifts,
  so the table below the marker is emitted by `scripts/gen-tts-matrix.ts` from real
  `tts()` calls (`bun run gen:tts-matrix`), and `test/docs/tts-matrix.test.ts` re-runs
  those calls against the committed rows. A stale cell fails the build.
- **Hand-written.** Auth, response delivery, response checkers and quirks. Auth has no
  API surface on purpose — `.request.headers` carries the static non-auth headers and
  nothing else, because unmodel never touches a key. Delivery and checkers *do* have an
  API surface, so those columns cite it by name rather than restating it.

Nothing in this file is knowledge that only exists here: every hand-written cell is
transcribed from the module header of the endpoint it describes, and those headers carry
the doc URLs the fact was verified against.

## The wire

The URL is not always constant, so each row names the request that produced it:
ElevenLabs interpolates the voice into the path and Deepgram URL-encodes the whole
option set into the query. Both use a placeholder `VOICE_ID` here. `content-type` is on
every row because all nineteen are JSON endpoints.

<!-- gen:tts-matrix — regenerate with `bun run gen:tts-matrix` -->

| Provider | Method | URL | Static headers |
| --- | --- | --- | --- |
| `openai` | POST | `https://api.openai.com/v1/audio/speech` | `content-type: application/json` |
| `elevenlabs` | POST | `https://api.elevenlabs.io/v1/text-to-speech/VOICE_ID` | `content-type: application/json` |
| `cartesia` | POST | `https://api.cartesia.ai/tts/bytes` | `Cartesia-Version: 2026-03-01`<br>`content-type: application/json` |
| `deepgram` | POST | `https://api.deepgram.com/v1/speak?model=aura-2-thalia-en` | `content-type: application/json` |
| `google` | POST | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent` | `content-type: application/json` |
| `hume` | POST | `https://api.hume.ai/v0/tts` | `content-type: application/json` |
| `minimax` | POST | `https://api.minimax.io/v1/t2a_v2` | `content-type: application/json` |
| `rime` | POST | `https://users.rime.ai/v1/rime-tts` | `content-type: application/json` |
| `lmnt` | POST | `https://api.lmnt.com/v1/ai/speech/bytes` | `content-type: application/json`<br>`lmnt-version: 1.2` |
| `fish-audio` | POST | `https://api.fish.audio/v1/tts` | `content-type: application/json`<br>`model: s2.1-pro` |
| `murf` | POST | `https://api.murf.ai/v1/speech/generate` | `content-type: application/json` |
| `resemble` | POST | `https://f.cluster.resemble.ai/synthesize` | `content-type: application/json` |
| `smallest-ai` | POST | `https://api.smallest.ai/waves/v1/tts` | `accept: audio/wav`<br>`content-type: application/json` |
| `speechify` | POST | `https://api.speechify.ai/v1/audio/speech` | `content-type: application/json` |
| `stepfun` | POST | `https://api.stepfun.ai/v1/audio/speech` | `content-type: application/json` |
| `breezeblue` | POST | `https://api.breeze.blue/v1/text-to-speech/VOICE_ID` | `content-type: application/json` |
| `alibaba` | POST | `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | `content-type: application/json` |
| `inworld` | POST | `https://api.inworld.ai/tts/v1/voice` | `content-type: application/json` |
| `fal` | POST | `https://queue.fal.run/fal-ai/kokoro/american-english` | `content-type: application/json` |

<!-- /gen:tts-matrix -->

## Auth

Names only. unmodel never handles a credential, which is why none of these appear in the
generated table above: `.request.headers` is the headers you cannot choose, and auth is
the one you must.

Nine shapes across nineteen providers, and the shape is a property of the *provider*,
not of the endpoint, so it does not vary by route:

| Provider | Header | Scheme |
| --- | --- | --- |
| `openai` | `authorization` | `Bearer <key>` |
| `elevenlabs` | `xi-api-key` | bare key |
| `cartesia` | `X-API-Key` | bare key |
| `deepgram` | `Authorization` | `Token <key>` |
| `google` | `x-goog-api-key` | bare key (or `?key=` on the URL) |
| `hume` | `X-Hume-Api-Key` | bare key |
| `minimax` | `authorization` | `Bearer <key>` |
| `rime` | `authorization` | `Bearer <key>` |
| `lmnt` | `X-API-Key` | bare key |
| `fish-audio` | `authorization` | `Bearer <key>` |
| `murf` | `api-key` | bare key |
| `resemble` | `authorization` | `Bearer <key>` |
| `smallest-ai` | `authorization` | `Bearer <key>` |
| `speechify` | `authorization` | `Bearer <key>` |
| `stepfun` | `authorization` | `Bearer <key>` |
| `breezeblue` | `xi-api-key` | bare key |
| `alibaba` | `Authorization` | `Bearer <key>` |
| `inworld` | `authorization` | `Basic <key>` |
| `fal` | `Authorization` | `Key <key>` |

Chat has the same table as data rather than prose — `CHAT_AUTH` from `unmodel/chat`, an
`EndpointAuth` per provider, checked against the retarget endpoint table by
`test/chat/providers.test.ts`. It exists there because `.toApi(provider)` moves a
request between hosts and the header has to move with it. Speech has no retarget, so
there is no runtime twin of this table and no reason to build one.

## Response delivery

Every adapter declares how its endpoint hands the audio back, as a `TtsDeliverySpec` on
the adapter's `delivery`. The consts below are the declarations themselves — importable
from `unmodel/<provider>/values` as `TTS_DELIVERY` — so read the const rather than
trusting a restatement of its paths here.

Three shapes: flat (one answer), `byRequestField` (one request field decides), and
`byModel` (the ref decides, because the models are served by different routes).

| Provider | Const | Shape |
| --- | --- | --- |
| `openai` | `OPENAI_TTS_DELIVERY` | by `stream_format` — raw bytes, or an SSE stream |
| `elevenlabs` | `ELEVENLABS_TTS_DELIVERY` | flat: raw bytes |
| `cartesia` | `CARTESIA_TTS_DELIVERY` | flat: raw bytes |
| `deepgram` | `DEEPGRAM_TTS_DELIVERY` | by `callback` — raw bytes, or an ack with no audio in it at all |
| `google` | `GOOGLE_TTS_DELIVERY` | by `responseFormat.audio.delivery` — an inline base64 part, or a URI to fetch |
| `hume` | `HUME_TTS_DELIVERY` | flat: base64 inside the JSON |
| `minimax` | `MINIMAX_TTS_DELIVERY` | by `output_format` — hex inside the JSON, or a URL to fetch |
| `rime` | `RIME_TTS_DELIVERY` | flat: raw bytes |
| `lmnt` | `LMNT_TTS_DELIVERY` | flat: raw bytes |
| `fish-audio` | `FISH_AUDIO_TTS_DELIVERY` | flat: raw bytes |
| `murf` | `MURF_TTS_DELIVERY` | by model — `gen2` answers JSON (base64 or URL, by `encodeAsBase64`), `falcon-2` answers bytes |
| `resemble` | `RESEMBLE_TTS_DELIVERY` | flat: base64 inside the JSON |
| `smallest-ai` | `SMALLEST_TTS_DELIVERY` | flat: raw bytes |
| `speechify` | `SPEECHIFY_TTS_DELIVERY` | flat: base64 inside the JSON |
| `stepfun` | `STEPFUN_TTS_DELIVERY` | by `stream_format` — raw bytes, or an SSE stream |
| `breezeblue` | `BREEZEBLUE_TTS_DELIVERY` | by the `delivery` query param — raw bytes, or a 202 job whose audio is a second request away |
| `alibaba` | `ALIBABA_TTS_DELIVERY` | by `stream` — a 24-hour WAV URL inside the JSON, or Base64-PCM SSE frames |
| `inworld` | `INWORLD_TTS_DELIVERY` | flat: base64 inside the JSON |
| `fal` | `FAL_TTS_DELIVERY` | flat: a URL inside the JSON — but of the QUEUE RESULT document, not of the submit response |

`url` is its own kind rather than a flag on `base64` because it is the case where there
are no bytes in hand yet: a caller who treats it as inline audio gets a string where
they expected a buffer. unmodel describes delivery and never parses it — no module in
this library reads a response body off a `TtsDeliverySpec`.

## Response checkers

Four of the nineteen ship one. A checker inspects a *decoded* response for quality and
usage signals; where a route answers raw bytes there is nothing to inspect, and where it
answers a JSON envelope carrying no signal beyond the audio itself there is nothing
worth reporting.

| Provider | Checker | What it is for |
| --- | --- | --- |
| `google` | `checkTts` from `unmodel/google` | Gemini serves TTS on the shared `:generateContent` route, so a response can finish `STOP` and cleanly contain *text* tokens instead of audio. That case is reported as `invalid_shape` / `empty_audio`, naming retry as the documented remedy, alongside the usual finish-reason and safety-block warnings. |
| `murf` | `checkTts` from `unmodel/murf` | `/v1/speech/generate` answers JSON (`audioFile`, `audioLengthInSeconds`, `remainingCharacterCount`, `wordDurations`). `/v1/speech/stream` answers an audio stream and has none. |
| `resemble` | `checkTts` from `unmodel/resemble` | The synchronous `/synthesize` answers JSON with `success` and `issues` fields to surface. `success` is the outcome, so it rides on `finishReason` (`"success"` / `"failure"`) rather than being inferred from the warning count; the `issues` entries are the findings. The streaming `/stream` route answers a chunked WAV stream and has none. |
| `minimax` | `checkTts` from `unmodel/minimax` | `/v1/t2a_v2` declares exactly one HTTP response — `200` — and reports failure IN BAND on `base_resp.status_code` (0 success, 1002 rate limit, 1004 auth failed, 1042 invalid-character ratio, …). That code IS `report.finishReason` — MiniMax's vocabulary is numeric, so branch on `!== 0`, never on truthiness. A non-zero code is also reported as `invalid_shape` with `meta.kind: "provider_error"`, quoting the documented `status_msg` and carrying `meta.retryable` where MiniMax's own message answers it (`1002` yes, `1004` no); a missing `data.audio` is `empty_audio`; and `extra_info.usage_characters` — the characters MiniMax itself billed — prices the call against the catalog rate. `MINIMAX_BASE_RESP_INFO` exports the whole code table. |

The other fifteen have none, and the reason is per provider rather than a blanket policy:

| Provider | Why no checker |
| --- | --- |
| `openai` | Raw audio bytes (or an SSE stream) — no JSON to check. |
| `elevenlabs` | Raw audio bytes. |
| `cartesia` | Raw audio bytes. |
| `deepgram` | Raw audio bytes, or a callback ack — never JSON. |
| `rime` | Raw audio bytes. |
| `lmnt` | `/v1/ai/speech/bytes` streams binary. `/v1/ai/speech` does answer JSON (base64 `audio` + word `timestamps`), but the envelope carries no quality or usage signal. |
| `fish-audio` | A chunked raw audio stream. |
| `smallest-ai` | Binary audio. |
| `hume` | JSON with base64 audio and nothing else to report — request validation is the scope. |
| `speechify` | JSON (`audio_data` + `billable_characters_count` + `speech_marks`) with no quality signal — request validation is the scope. |
| `inworld` | JSON, but it carries no quality or usage signal beyond `usage.processedCharactersCount`. |
| `stepfun` | Raw audio bytes, or an SSE stream. |
| `breezeblue` | Raw audio bytes; the async arm answers a job envelope whose audio is a second request away. |
| `alibaba` | JSON with a 24-hour WAV URL and a token count — no quality signal to report. |
| `fal` | The POST answers a queue ENVELOPE rather than audio at all, so the thing worth checking is two hops away. `unmodel/fal`'s `./urls.ts` documents the contract, including the fact that fal's queue declares no failure state. |

## Quirks

The failures that are *silent* (a request the provider accepts and then does not honour),
because those are the ones a validator can catch and a 200 cannot tell you about.

**ElevenLabs — the body is not the whole request.** `voice_id` is a path param;
`output_format`, `enable_logging` and `optimize_streaming_latency` are query params. All
four are stripped from the JSON body and moved onto `.request.url`. Sending them in the
body — which an SDK-shaped params object invites — is a silent no-op, and the one that
costs most is `enable_logging: false`, which is how zero-retention mode is requested.

**MiniMax — 200 for every outcome.** `POST /v1/t2a_v2` documents exactly one HTTP
response and puts the result on `base_resp.status_code` (`0` is the only success). A
caller who branches on `res.ok` reads `data.audio` — the empty string — off a request
that failed authentication or hit a TPM limit. `minimax.checkTts` is the read-back, and
it answers on `report.finishReason` — `0` is the only success, and `0` is falsy, so the
branch is `!== 0`. The same envelope rides on MiniMax's music and video routes, which is
why it is a checker rather than a field on `MINIMAX_TTS_DELIVERY`.

**Deepgram — everything rides in the query string.** The JSON body is exactly `{text}`;
every other option is URL-encoded onto `.request.url`. Putting `model` in the body is a
silent no-op that serves you `aura-asteria-en`, the server default. Deepgram is also the
provider where the voice *is* the model, so the model id is the voice picker.

**Speechify — two routes that are not the same shape.** `audio_format` exists only on
`/v1/audio/speech`; `output_format` is on both, but the streaming enum drops the `wav_*`
values; `Accept` is a header on `/v1/audio/stream` and does not exist on `/v1/audio/speech`.
The character cap differs too: 2,000 on speech, 20,000 on stream. Both counts include
SSML tags.

**Cartesia — a dormant cap.** Cartesia documents no per-request `transcript` cap, so the
`over_output_limit` check exists and never fires against the shipped catalog. It is
wired rather than absent so a published cap becomes a catalog edit, not a code change.

**Murf — regional routers.** Falcon 2 also publishes a global router
(`https://global.api.murf.ai/v1/speech/stream`) plus eleven regional hosts. `.request.url`
targets the documented default host; swap the origin yourself if you route regionally.
Note also the two model spellings across the two routes — `modelVersion: "GEN2"` on
generate, `model: "falcon-2" | "gen2"` on stream — resolved against one catalog.

**Fish Audio — `references` is MessagePack-only.** The endpoint accepts
`application/json` or `application/msgpack` and unmodel finalizes to JSON. The field
sets are identical, so the same validated object serializes to msgpack unchanged — but
`references` (zero-shot cloning with inline audio) carries raw bytes and is documented as
MessagePack-only, so pairing it with the JSON content type is flagged. `model` is a
header, not a body field; in the body it silently falls back to `s2.1-pro`.

**Google — the shared `:generateContent` route.** Gemini has no dedicated speech
endpoint: TTS is `generateContent` with `responseModalities: ["AUDIO"]` and a
`speechConfig`, so the TTS ids stay valid on `google.chat` and both surfaces run one
shared check battery. It is also why `checkTts` earns its keep here: a shared route can
finish cleanly having answered in text tokens, which is a failure no other provider in
this table can have.

**Resemble — the synthesis host is not the API host.** The REST API lives at
`https://app.resemble.ai/api/v2`; synthesis targets `https://f.cluster.resemble.ai`, and
the docs are explicit that streaming requests must not go to `app.resemble.ai`. There is
also no `model` field by design — the voice selects the model — so these validators
resolve no model id, and therefore no catalog gate and no cost estimate.

**Rime — the host is `users.rime.ai`.** Not `api.rime.ai`, which "serves internal
infrastructure and returns 404 for TTS requests". Format is chosen with `Accept`, not a
body field; and speed is direction-inverted across models (`timeScaleFactor` below 1.0
is *faster*, `speedAlpha` above 1.0 is faster), which no validator can fix.

**Smallest AI — the budget can silently never fire.** A per-character list price is
published for `lightning_v3.1_pro` only, and an omitted `model` resolves to the standard
`lightning_v3.1` pool. So a request that leaves `model` out gets no `costUSD`, and a
`maxCostUSD` budget has nothing to compare against.

## See also

- [Provider coverage and roadmap](providers.md)
- [Architecture decisions](decisions.md)
