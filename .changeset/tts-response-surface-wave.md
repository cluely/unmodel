---
"unmodel": minor
---

**The speech response surface, said out loud — a false `empty_audio` fixed, a
delivery descriptor on all fifteen TTS adapters, the auth header named where
retargeting moves it, and `toRequestInit` so nobody retypes a fetch init
again.**

Every item here is the same shape of fix: the package already knew the thing
and made you find it somewhere else. Six of them.

## `google.checkTts` no longer reports `empty_audio` on a `fileData` response

A real bug, and the package's own validator is what proved it. `hasAudioPart`
scanned `candidates[0].content.parts[].inlineData.mimeType` only — so a
response to a request that set `responseFormat.audio.delivery: "URI"`, which
`google.tts` validates and `GEMINI_AUDIO_DELIVERY_MODES` enumerates, came back
as a `fileData` part carrying a `fileUri` and was reported as
`invalid_shape` / `empty_audio` with the message telling you to retry. The
checker now counts both deliveries, and the message names both
(`"neither inlineData nor a fileData URI"`) so the remaining case still reads
as the real one it is.

## `toRequestInit(result)` — the four fetch arguments, minus the key

```ts
const { url, ...init } = toRequestInit(request);
await fetch(url, { ...init, headers: { ...init.headers, authorization } });
```

url, method, static headers and the JSON framing are all things the package
knows and the caller currently retypes — and spreading a result to retype them
silently drops `.request`, which is non-enumerable by design. Returns
`FetchArgs` (`{ url, method, headers, body }`), with `headers` a copy so
adding auth to it cannot reach the validator's own object. It never calls
`fetch` and takes no credential.

Two whole classes of endpoint cannot reach it, both at compile time: socket
configs (`SocketMeta.method` is `"GET"`) and the multipart endpoints, whose
`ValidatedForm` result type makes the call a type error naming the
`toFormData` helper to use instead. `recraft.imageEdit`, the one endpoint
whose framing is decided per call, is caught at runtime with the same message.

Lives at `src/core/request-init.ts` — an import-free leaf reached only from
the root entry — so `unmodel/groq`, which never builds a fetch call, pays zero
bytes for it.

## `TargetEndpoint.auth` and `CHAT_AUTH` — the header retargeting invalidates

`.toApi("openai")` moves a validated Anthropic request to a new host, and the
`x-api-key` header the caller already wrote goes with it, unchanged and now
wrong. The retarget endpoint table is the only place that knows both halves of
that swap, so it now carries the second half:

```ts
import { CHAT_AUTH } from "unmodel/chat";

const { header, scheme } = CHAT_AUTH[provider];
headers[header] = scheme === undefined ? key : `${scheme} ${key}`;
```

Names only, never values — unmodel still never touches a key, the same way
`ProviderInfo.env` already names the env var without reading it. `CHAT_AUTH`
is a deliberate *mirror* of the endpoint table's new `auth` column rather than
a re-export of it: retaining any binding from `endpoints.ts` retains all 30
chat/completions URLs, which would put 6.1 KiB behind a 3 KiB per-export
budget on `unmodel/values`. Restating three frozen descriptors costs 0.3, and
`test/chat/providers.test.ts` compares every row against the endpoint that
provider actually resolves to, so the copy cannot drift. The four targets with
a second way in (google's `?key=`, azure's Entra token, google-vertex's
OAuth-only access token, bedrock's SigV4) are argued in the `EndpointAuth`
docblock, which names the one form that always works and why.

## `TtsDelivery` — where the audio is, on all fifteen adapters

A TTS response puts the audio in one of five places and a boolean would lie
about four of them, so `delivery` is a descriptor: `bytes`, `base64` (with the
path), `hex` (MiniMax), `url` (there are no bytes in hand — naming that is the
point) and `sse`. Three shapes, because the providers genuinely disagree about
what decides it: flat, `byRequestField` (OpenAI's `stream_format`, Deepgram's
`callback`, MiniMax's `output_format`, Gemini's `responseFormat.audio.delivery`,
Murf's `encodeAsBase64`), and `byModel` (Murf again, where `gen2` and
`falcon-2` are served by two different routes). A `byRequestField` variant
whose value is a *string* is a declared gap in the `unsupported` idiom: it
says why that request carries no audio at all, which is how Deepgram's
`callback` ack is spelled.

Declared as a const on each provider's import-free `tts-params` leaf and
re-exported as `TTS_DELIVERY` from `unmodel/<provider>/values`, so a picker
can read it without pulling that provider's validator. unmodel validates
requests, so this is a description and never a parser: no module in this
library reads a response body off one.

## `GEMINI_TTS_VOICE_INFO` — the 30 voice descriptors

Google publishes a one-word character note beside each preset voice ("Zephyr:
Bright", "Kore: Firm"), and a picker that wants to label the option had to
invent the word. Now it does not. Display data, never enforced: no check reads
this table, `voiceName` is still typed from `GEMINI_TTS_VOICES`, and the value
is an object rather than a bare string so a second published column can join
without breaking callers. `as const satisfies` makes a 31st voice a build
error until its descriptor is transcribed too.

## `docs/tts.md` — the integrator's matrix, split by provenance

Fifteen providers' auth header, response delivery, response checker and wire
quirks in one place, with the drift liability engineered out rather than
accepted. URL, method and static headers are already properties of a compiled
`.request`, so a hand-written table of them is a copy: those columns are
generated by `scripts/gen-tts-matrix.ts` (`bun run gen:tts-matrix`) from real
`tts()` calls, and `test/docs/tts-matrix.test.ts` re-runs those calls against
the committed rows, asserts the row set equals the adapters `unmodel/tts`
registers, and asserts the doc is byte-identical to a fresh regeneration. Auth
has no API surface on purpose and stays prose; the delivery and checker
columns cite the const and the export by name rather than restating them, and
the test pins those citations by reference.

Four module headers were wrong or silent about their own response side and are
fixed: `openai/tts.ts` was the one TTS module that never named its auth
scheme; `hume/tts.ts` and `speechify/tts.ts` both answer JSON and never said
why they have no checker; and `murf/tts.ts` read as if Murf had none, when
`/v1/speech/generate` has one and only `/v1/speech/stream` does not.

## README

Executed, not asserted, as always. The two hand-rolled JSON fetch inits are
now the `toRequestInit` idiom; the Values section states that `voices` exists
only where a provider publishes a closed list (OpenAI and Google, of fifteen)
and that `SPEECH_VOICES` / `GEMINI_TTS_VOICES` are `===` the row's array
rather than a rival API; a new "Estimating cost" block documents
`estimate.costUSD`, the `maxCostUSD` gate and the four public cost helpers
(`resolveModelInfo`, `computeCharacterCostUSD`, `computeAudioMinutesCostUSD`,
`computeCostUSD`) which had zero mentions; and the `getModel` example now says
it reads the models.dev snapshot only, pointing media users at
`import { models } from "unmodel/<provider>"` instead of an `undefined` they
would reasonably read as missing data.
