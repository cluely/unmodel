# unmodel

Validation layer for LLM API calls: catalog-aware, zod-powered request validation and response sanity checks — bring your own SDK or fetch.

unmodel does **not** perform generation and never touches your API keys. You build and validate request params through unmodel, then send them yourself: over raw `fetch`, or through an SDK via `.toSdk(target)`. After the call, `check*` helpers inspect the raw response for silent quality problems (truncation, refusals, content filtering) and price the actual usage.

**Wire-exact by construction, unified by choice.**

- **Wire-exact params.** Every validator's params *are* the provider's raw REST body, byte for byte — `max_tokens` at Anthropic, `max_completion_tokens` at OpenAI, `generationConfig.maxOutputTokens` at Google, `voice_id` in ElevenLabs' URL. Nothing is renamed, so there is no intermediate format standing between your object and the request the provider answers. This is the substrate, it is what every other feature is built out of, and it is not going away.
- **A standardized surface on top, when you want one.** `unmodel/chat` and the six [unified media packs](#unified-surfaces) give one camelCase vocabulary that reads the same at every provider, so a portable call site is a string edit rather than a rewrite. They **compile down** to exactly the wire body above — same object, same `.request`, same provider validator — so the thing you inspect, log, tweak and send is still the provider's own request. You can always drop a layer; nothing hides underneath.
- **Catalog-aware.** Backed by a generated [models.dev](https://models.dev) catalog: context windows, output limits, per-token pricing, capabilities, deprecations.
- **Types that beat the SDK.** Params are typed from each provider's current **documentation**, not from its SDK: narrowed where the SDK permits what the API rejects, widened where the SDK's enum is a subset of the documented reality. Every deviation cites the doc URL it came from.
- **Retarget, don't rewrite.** `.toApi(provider)` moves an **already validated** chat request to another provider that serves the same model — translating the wire format and respelling the model id. Which providers those are is typed per model, so the wrong destination is a compile error rather than a 404. The model's home provider is always among them, as the identity retarget, so a provider-generic call site needs no special case for "the provider I already am". (This answers a different question from the unified surface above: `unmodel/chat` writes *one request* that many providers can serve, `.toApi` moves *a request you already have* to one of them. See [Unified surfaces](#unified-surfaces).)
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

## Quickstart: one request, any provider

The two quickstarts above are the substrate: you named a provider by importing
it, and you wrote that provider's exact wire params. The layer on top inverts
that — you write **one** standardized request and the provider is a string:

```ts
import { chat } from "unmodel/chat";

const req = chat({
  model: "anthropic/claude-opus-5", // "provider/model", split on the FIRST slash
  messages: [{ role: "user", content: "Explain retargeting." }],
  reasoning: { budgetTokens: 2048 },
  maxOutputTokens: 4096,
});

req.request.url; // https://api.anthropic.com/v1/messages
JSON.stringify(req);
// {"model":"claude-opus-5","max_tokens":4096,
//  "messages":[{"role":"user","content":[{"type":"text","text":"Explain retargeting."}]}],
//  "thinking":{"type":"enabled","budget_tokens":2048}}
req.warnings; // [] — nothing was lost on the way to this body
```

Change one string, and the same params compile to a different API:

```ts
const viaOpenAI = chat({
  model: "openai/gpt-5.2", // ← the only difference
  messages: [{ role: "user", content: "Explain retargeting." }],
  reasoning: { budgetTokens: 2048 },
  maxOutputTokens: 4096,
});

viaOpenAI.request.url; // https://api.openai.com/v1/chat/completions
JSON.stringify(viaOpenAI);
// {"model":"gpt-5.2","messages":[{"role":"user","content":"Explain retargeting."}],
//  "max_completion_tokens":4096,"reasoning_effort":"low"}

viaOpenAI.warnings;
// [approximated_param] a 2048-token reasoning budget has no chat-completions
//                      equivalent; it was bucketed to `reasoning_effort: "low"`,
//                      which the target sizes on its own terms.
```

The result is an ordinary `Validated`: its enumerable properties are the
provider's wire body, `.request` is that provider's URL, method and static
headers, and you send it with the same `fetch` as the first quickstart. Nothing
new to learn about *sending* — only about *writing*.

One thing to know before you reach for it: `unmodel/chat` is the *ready-made*
pack and it costs ~1.7 MB, because compiling for any provider from a bare
`"provider/model"` string means carrying all 32 of their real validators. If
you only ever call two of them, `createChat` from
[`unmodel/chat/factory`](#bundle-story) builds the identical surface out of
just those (~144 KiB plus the validators you register).

Media works the same way, one canonical vocabulary per category:

```ts
import { image } from "unmodel/image";

const shot = image({
  model: "black-forest-labs/flux-pro-1.1",
  prompt: "a lighthouse in fog",
  aspectRatio: "16:9",
  resolution: "1k",
});

JSON.stringify(shot);  // {"prompt":"a lighthouse in fog","width":1344,"height":768}
shot.request.url;      // https://api.bfl.ai/v1/flux-pro-1.1

shot.warnings;
// [approximated_param] `aspectRatio` 16:9 at 1k does not land on this model's
//                      32px grid: 1344×768 (1.750:1, requested 1.778:1).
```

Sizes and per-model params autocomplete from the model the ref names, so the
editor knows what one model takes before the API does:

```ts
image({ model: "openai/gpt-image-2", prompt: "...", size: "3840x2160" });
//                                                        ^ that model's presets

image({ model: "openai/gpt-image-1", prompt: "...", background: "transparent" });  // ok
image({ model: "openai/gpt-image-2", prompt: "...", background: "transparent" });  // compile error
//   "Requests with `background` set to `transparent` will return an error for
//    these models; use `opaque` or `auto` instead." -- the recorded 400.
```

BFL has no `aspectRatio` and no `resolution` — it has a pixel pair on a 32-px
grid — so the request is *derived* rather than translated, and it says so
instead of quietly shipping the wrong ratio. Point the same object at
`"openai/gpt-image-2"` and you get `size: "1360x768"`; at
`"google/imagen-4.0-generate-001"`, an Imagen `:predict` body carrying
`parameters.aspectRatio: "16:9"` — which is exact, and so warns about nothing.

Importing a media pack costs every provider in it. If you only ever call two,
the `create*` registry forms build a pack from the adapter leaves at
`unmodel/<provider>/unified`, and the ref union narrows with it —
`createImage([openai, ideogram])`, `createSpeech([…])`, and one per category.
See [Unified surfaces](#unified-surfaces) for the whole contract and
[Bundle story](#bundle-story) for what each entry costs.

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
  media serving is real, the same machinery generates it. Writing *one* media
  request that many providers can serve is a different question, and it is
  answered by the [unified media packs](#unified-surfaces).
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

## Unified surfaces

Seven entries — one for chat and one per media category — take a **standardized
camelCase vocabulary** instead of a wire body, and compile it to whichever
provider the `"provider/model"` ref names. They are the portability layer; the
per-provider validators under [Providers](#providers) remain the substrate and
the escape hatch.

| Import | Function | Providers | Canonical vocabulary |
| --- | --- | --- | --- |
| `unmodel/chat` | `chat` | 32 | `messages`, `system`, `maxOutputTokens`, `temperature` (canonical 0–2), `topP`, `topK`, `reasoning`, `tools` (a `Record`, so duplicate names are unrepresentable), `nativeTools`, `toolChoice`, `responseFormat`, `cache` breakpoints, `stream` |
| `unmodel/image` | `image`, `createImage` | 15 | `prompt`, `size` XOR `aspectRatio` XOR `dimensions`, `resolution` tier, `n`, `seed`, `negativePrompt`, `outputFormat`, `outputDelivery`, plus that model's own typed extras |
| `unmodel/image-edit` | `imageEdit`, `createImageEdit` | 4 | `operation`, `prompt`, `image` (`file` / `url` / `data`), `strength`, `size` XOR `aspectRatio` XOR `dimensions`, `n`, `seed`, `outputFormat`, plus that model's own typed extras |
| `unmodel/speech` | `speech`, `createSpeech` | 14 | `text`, `voice`, `outputFormat`, `speed`, `language` |
| `unmodel/video` | `video`, `createVideo` | 10 | `prompt`, `duration` (seconds), `resolution` tier, `aspectRatio`, `image` (first / last / reference), `video`, `negativePrompt`, `seed`, `n` |
| `unmodel/transcribe` | `transcribe`, `createTranscribe` | 11 | `audio` (`file` / `url` / `fileId`), `language`, `languages`, `diarization`, `timestamps`, `prompt` |
| `unmodel/music` | `music`, `createMusic` | 2 | `prompt`, `durationSeconds`, `instrumental`, `outputFormat`, `seed` |

**The contract.** A unified call compiles the canonical params to one provider's
wire params and then runs **that provider's own validator** — the same `chat()`
or `image()` you would have imported from `unmodel/<provider>` by hand, with its
catalog, its constraint tables, its media limits and its cost estimate. There is
no second definition of what a valid request is, so the two cannot disagree, and
what you get back is that provider's ordinary `Validated`: enumerable properties
are its exact wire body, `.request` is its URL/method/static headers, `.toSdk`
is its SDK shape. Anything the vocabulary cannot say rides in `providerOptions`,
keyed by provider and deep-merged over the compiled body **before** validation,
so it is checked rather than smuggled past the checks. Dropping to the wire
layer is therefore never a migration — it is deleting one import.

Typed calls keep exact-key checking on both the throwing form and `.safe()`.
When the value comes from JSON, a queue, or another untyped boundary, all seven
standardized surfaces expose a separate `.safeUnknown(value)` method:

```ts
const value: unknown = JSON.parse(text);
const result = image.safeUnknown(value);
```

Keeping this separate is intentional: an `unknown` overload on `.safe()` would
also accept a typoed object literal after the exact-key overload rejected it.
`safeUnknown` instead performs the runtime shape checks without weakening the
normal TypeScript call.

**The ref convention.** `model` is `"provider/model"`, split on the **first**
slash. OpenRouter's own ids contain slashes, so
`"openrouter/anthropic/claude-opus-5"` is provider `openrouter`, model
`anthropic/claude-opus-5`; splitting on the last slash — the obvious
implementation — would route it to a provider called `openrouter/anthropic`. The
generated ref unions drive autocomplete but do not gate the API: a model
released after the catalog snapshot is still callable.

**The loss policy, in three rules.** A param the provider cannot express at all
is an **error** naming what it does offer. A value it can only express
approximately is an `approximated_param` **warning** naming both the requested
and the achieved value. Everything else is silent. So `warnings.length === 0`
*means* the request mapped exactly — asserted per category by a golden matrix
that compiles one canonical request at every provider that can express it.

**Narrowings that happen at compile time**, not at 400-time:

- **`audio` narrows to the transcribe route.** AssemblyAI fetches a URL,
  Cartesia takes multipart bytes, Soniox takes a URL or its own file id, Mistral
  takes all three — so `transcribe({ model: "cartesia/ink-whisper", audio: { url } })`
  is a type error, and the runtime check backs it up for JavaScript callers.
- **`image` narrows the same way in `unmodel/image-edit`.** OpenAI takes
  `{ file }` only; FLUX Kontext takes `{ data }` or `{ url }` only.
- **Sizing is an XOR.** `size`, `aspectRatio` and `dimensions` are three
  spellings of one decision and at most one may be given, in `image` or
  `image-edit`, because no provider has a coherent reading of two.
- **`size` and the extras narrow per *model*.** Each image adapter carries a
  per-model table, and the ref selects a row: `image({ model:
  "openai/gpt-image-2", size: ... })` autocompletes *that* model's presets
  (`"3840x2160"`, `"2560x1440"`, `"auto"`, ...), `resolution` narrows to the
  tiers it can reach, `aspectRatio` to the ratios it accepts, and the params the
  vocabulary has no word for appear with their exact types --
  `background: "transparent"` compiles on `openai/gpt-image-1` and is a
  **compile error** on `openai/gpt-image-2`, which answers a recorded 400 for
  it. Extras go on the wire under the provider's own spelling, unchanged, and
  one sent to a model that does not take it is an `unsupported_param` naming the
  ones that do. Every preset in every table is compiled through the adapter and
  run past the provider's validator in `test/unified/image-presets.test.ts`, so
  a suggestion is one the API accepts. An unknown or run-time-built ref degrades
  to the wide vocabulary, exactly as an unrecognised model already does.
- **The inputs choose the video endpoint.** A prompt is text-to-video; adding
  `image` makes it image-to-video; `role: "reference"` makes it
  reference-to-video; `video` makes it video-to-video. A model with no arm for
  the route you derived says so by name.
- **The audio categories narrow per model too.** `outputFormat` completes the
  codecs *that* endpoint emits, in both spellings — the shorthand and the
  fully-spelled object — so `outputFormat: "flac"` compiles on `openai/tts-1`
  and is a compile error on `hume/octave`, whose `format.type` is mp3, wav or
  pcm. `timestamps` completes the granularities the transcription route can
  return (`whisper-1` has word and segment; `gpt-4o-transcribe` has neither),
  `language` completes the codes the wire enumerates without gating the field
  (`"pt-BR"` is a working request that the adapter sends as `"pt"`), and each
  model's non-canonical knobs arrive typed. `voice` deliberately stays wide
  on the unified surface: voice catalogs are per-account, thousands of entries
  long, and replaced between releases, so a union of them would be stale and
  would refuse the caller's own cloned voice. (The providers that *do* publish
  a closed list — OpenAI's nine and thirteen, Gemini TTS's thirty — are
  catalogued and enforced at their own wire surfaces, `unmodel/openai` and
  `unmodel/google`.) Sample rate and bitrate stay run time's job —
  their legal values depend on the codec chosen beside them, and at ElevenLabs
  the legal pairs are not even the cross product.
- **`operation` is `"edit"` and only `"edit"` in v1.** Masked routes stay
  reachable by name at `unmodel/<provider>`.

`unmodel/chat` is the ready-made 32-provider pack: it includes each provider's
real chat validator, catalog and available `.toApi` targets. A narrow exact
pack comes from the provider-free factory entry:

```ts
import { createChat } from "unmodel/chat/factory";
import { chat as anthropic } from "unmodel/anthropic";
import { chat as openai } from "unmodel/openai";

const chat = createChat({ anthropic, openai });
```

The registry key and the validator under it are one claim, not two: every chat
validator has the same shape and providers share model ids, so
`createChat({ groq: togetherai })` would otherwise compile, validate against
Together's catalog and post to Together's host with zero warnings. It is a
**compile error** — each validator states which provider it speaks for — and a
`TypeError` at construction for a hand-written one that carries no such claim.
`createChat` lives only at `unmodel/chat/factory`; reaching it through
`unmodel/chat` would drag the whole ready registry in, so that re-export does
not exist.

The former `ChatOptions.catalog` override is intentionally gone: layering a
second catalog beside a concrete provider validator creates two authorities
that can disagree. Register a provider validator configured for the catalog
you need instead. The six media packs likewise ship `create*` registry forms —
`createImage([openai, ideogram])` over the adapter leaves at
`unmodel/<provider>/unified` — so a two-provider app pays for two providers.
Per-category detail (every vocabulary, the exact translations, and the honest
gaps) is in
[Unified media](#unified-media-one-vocabulary-per-category).

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

This section is the per-category detail. The shared contract — compile to the
provider's wire params, then run **that provider's own validator**; unsupported
is an error, derived is a warning, zero warnings means exact; `providerOptions`
for anything one-off — is stated once under
[Unified surfaces](#unified-surfaces) and holds for every category here.

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

Both halves of the loss policy, on one line each:

```ts
image({ model: "black-forest-labs/flux-pro-1.1", prompt: "…", aspectRatio: "16:9", resolution: "1k" }).warnings;
// [approximated_param] `aspectRatio` 16:9 at 1k does not land on this model's
// 32px grid: 1344×768 (1.750:1, requested 1.778:1).

image({ model: "openai/gpt-image-1", prompt: "…", seed: 7 });
// throws: `seed` is not supported by "openai/gpt-image-1" — POST
// /v1/images/generations has no seed field, so a seed could only be dropped.
```

The vocabularies themselves are tabulated under
[Unified surfaces](#unified-surfaces); what follows is what each one *costs* to
translate.

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

**The three audio categories narrow per *model*, the way `image` and `video`
do.** Each adapter carries a `modelParams` table keyed by bare model id, and
the ref selects a row:

```ts
speech({ model: "openai/tts-1",     text, outputFormat: "flac" });   // ok
speech({ model: "hume/octave",      text, outputFormat: "flac" });   // compile error — mp3 / pcm only
speech({ model: "cartesia/sonic-3", text, outputFormat: { format: "pcm_f32le", sampleRate: 44100 } });
speech({ model: "openai/gpt-4o-mini-tts", text, instructions: "…" }); // ok
speech({ model: "openai/tts-1",           text, instructions: "…" }); // compile error

transcribe({ model: "openai/whisper-1",         audio, timestamps: "segment" });  // ok
transcribe({ model: "openai/gpt-4o-transcribe", audio, timestamps: "segment" });  // compile error
transcribe({ model: "deepgram/nova-3", audio, keyterm: "unmodel" });              // ok
transcribe({ model: "deepgram/nova-2", audio, keyterm: "unmodel" });              // compile error

music({ model: "elevenlabs/music_v1",      prompt, outputFormat: "opus" });       // ok
music({ model: "stability/stable-audio-2", prompt, outputFormat: "opus" });       // compile error
```

`outputFormat` narrows in *both* spellings — the codec shorthand and the
fully-spelled object's `format` — because the object form is the one a caller
reaches for precisely when the encoding matters. `language` completes the codes
the wire enumerates **without** gating the field: the canonical `language` is a
BCP-47 tag, and `"pt-BR"` is a working request that the adapter sends as `"pt"`
with a warning naming the subtag it could not express. `voice` deliberately
stays wide on this surface — voice catalogs are per-account (every one of
these supports cloning), thousands of entries long, and replaced between
releases; where a provider publishes a closed list instead, its own wire
surface catalogues and enforces it. Sample rate and bitrate stay run time's job
for a related reason:
their legal values depend on the codec chosen beside them, and at ElevenLabs the
legal combinations are not even the cross product. Every value in every table
is compiled through the adapter and run past the provider's own validator in
`test/unified/{speech,transcribe,music}-presets.test.ts`, and one off-set
neighbour of each is asserted to fail — so a suggestion is one the API accepts,
and a closed list means what it says in both directions.

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

Provider body aliases are closed over their documented model arms by default,
so annotating a value does not erase those model-specific checks. A future
model remains an explicit escape hatch:

```ts
import type { ImagesBody } from "unmodel/openai";

const known: ImagesBody = {
  model: "gpt-image-2",
  prompt: "a watercolor fox",
  background: "transparent", // ✗ still rejected through the annotation
};

const future: ImagesBody<"gpt-image-9"> = {
  model: "gpt-image-9",
  prompt: "a watercolor fox",
  experimental_option: true,
};
```

Use `ImagesBody<string>` only when the model id is genuinely discovered at
runtime; that explicit widening also deliberately gives up per-model narrowing.

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
// `checkChat` is the uniform name at every chat provider — unmodel/anthropic,
// unmodel/google, unmodel/google-vertex, unmodel/amazon-bedrock, unmodel/cohere
// and every OpenAI-compatible overlay export exactly that.
//
// Also: checkImages (unmodel/openai), and the speech-side checkers, each named
// for the response document it reads —
// checkTranscription (unmodel/elevenlabs, unmodel/soniox, unmodel/mistral),
// checkStt (unmodel/cartesia), checkListen (unmodel/deepgram),
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

# Media endpoints are addressed the same way, with the same uniform verbs the
# library uses: <provider>.<verb>.
echo '{"model":"sora-2","prompt":"a red fox in snow","seconds":"8","size":"1280x720"}' \
  | unmodel validate openai.video
# ok: openai.video params are valid
# estimate: max cost ~$0.8

# The unified surfaces are addressed as unified.<category> — the params are the
# canonical vocabulary and `model` is a "provider/model" ref, so the ref decides
# which provider's validator actually runs.
echo '{"model":"black-forest-labs/flux-pro-1.1","prompt":"a lighthouse in fog",
       "aspectRatio":"16:9","resolution":"1k"}' \
  | unmodel validate unified.image
# ok: unified.image params are valid
# estimate: max cost ~$0.04

# Pass an unknown target to print every registered endpoint.
unmodel validate list-them-all
```

`unmodel validate` covers the 138 endpoints whose params are expressible as
JSON — including the ones that are *posted* as `multipart/form-data` but carry
no `Blob` (`speechmatics.transcribe`, `mistral.transcribe`,
`stability.music`, …). For those the CLI prints a
`transport: multipart/form-data` note pointing at the subpath's `toFormData`.
The six unified surfaces are registered alongside them as `unified.image`,
`unified.imageEdit`, `unified.music`, `unified.speech`, `unified.transcribe` and
`unified.video` — camelCase after the dot like every other endpoint id, because
`unmodel validate` addresses endpoints while `unmodel/image-edit` is an import.
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
import { chat } from "unmodel/google"; // the wire subpath — see the note below

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

**`media[].path` is in the vocabulary of the entry you called**, and the two
vocabularies differ. On a wire subpath — `unmodel/google`, as above — it
addresses the wire body: `["contents", 0, "parts", 1]`. On `unmodel/chat` it
addresses the request *you* wrote, so the same declaration is
`["messages", 1, "content", 0]`; unified chat carries it across compilation by
matching the payload, so it survives Gemini's `contents`/`parts` rename and the
system message chat-completions inserts. A declaration whose part does not
survive compilation at all is dropped with a `media_declaration_dropped`
warning rather than re-aimed at whatever now occupies that slot. When in doubt,
call without it: the `media_*_undeclared` warning prints the exact path to
declare.

`chat.providers` lists the provider ids a chat validator was built with —
all 32 on the ready `unmodel/chat`, exactly what you registered on a
`createChat` pack.

## Bundle story

Every provider lives on its own subpath; importing one pulls in nothing from the others, and `"sideEffects": false` lets bundlers tree-shake the rest:

| Import | Contents |
| --- | --- |
| `unmodel` | Core types and helpers only (`Issue`, `Validated`, `UnmodelValidationError`, `computeCostUSD`, …) — no provider code |
| `unmodel/<provider>` | That provider's validators, checkers, and typed catalog — see [Providers](#providers) |
| `unmodel/openai-compatible` | The `createOpenAICompatible` factory and shared Chat Completions dialect pieces |
| `unmodel/catalog` | models.dev snapshot: `catalog`, `getProvider`, `getModel` |
| `unmodel/ai-sdk` | The `withJsonSchemaTools` adapter for `.toSdk("ai-sdk")` — types plus one pure function, no dependency on `ai` |
| `unmodel/<provider>/unified` | One provider's adapters for the [unified media surfaces](#unified-surfaces) — that provider's endpoint module and the kernel, nothing else |
| `unmodel/chat` | Ready-made standardized chat pack: three dialect encoders plus all 32 concrete provider validators, catalogs and their `.toApi` availability data |
| `unmodel/chat/factory` | Provider-free `createChat(registry)` compiler entry; add only the concrete provider chat validators your application uses |
| `unmodel/image`, `unmodel/image-edit`, `unmodel/speech`, `unmodel/video`, `unmodel/transcribe`, `unmodel/music` | A ready-made pack: every adapter in that category, and therefore every one of those providers. `createImage([…])` / `createImageEdit([…])` / `createSpeech([…])` / `createVideo([…])` / `createTranscribe([…])` / `createMusic([…])` is how you pay for two instead of fifteen |

Retargeting keeps that story intact. The wire-format **codecs** are per dialect
(three of them), not per provider, so `unmodel/anthropic` reaches
`openai-compatible`'s codec module and nothing else of that provider's —
not its schema, not its constraints, not its catalog. And 90.4% of retarget edges
are OpenAI-compatible → OpenAI-compatible, which is pure data: an id respell
and a URL swap, no codec at all.

### What the unified entries cost

The unified surfaces do not change what a provider subpath weighs. **A
per-provider entry carries none of the unified layer** — the adapters live in
their own modules (`unified-image.ts`, `unified-speech.ts`, …) behind a separate
`unmodel/<provider>/unified` export, so `unmodel/anthropic` never sees a kernel
and `unmodel/elevenlabs` never sees the speech vocabulary. That is pinned rather
than claimed: `test/bundle-budget.test.ts` walks the real `dist/` import graph
and holds each provider entry to a committed byte budget (and asserts a pack can
only reach a provider through that provider's uniformly-named endpoint module),
while `test/import-graph.test.ts` enforces the same rules over every import
specifier in `src/`.

A unified entry is priced the way `unmodel/catalog` is: an explicit opt-in that
buys breadth, and you only pay for it if you import it. Measured on a real
build, in KiB of unminified ESM (transitive chunk graph, `zod` excluded):

| Entry | Size | What dominates it |
| --- | --- | --- |
| `unmodel/chat` | 1718.7 KiB | all 32 providers' exact validators, catalogs and available retarget tables, plus the canonical compiler. ~379 KiB of it is the `chatProfiles` discovery snapshot, which no validation path reads |
| `unmodel/chat/factory` | 144.0 KiB | provider-free canonical compiler and the three dialect codecs; registered provider validators add their own weight |
| `unmodel/image` | 755.7 KiB | fifteen providers' schemas, constraint tables, hand-maintained catalogs and per-model size tables |
| `unmodel/video` | 614.4 KiB | ten providers across twenty-one endpoint modules, plus their per-model duration/resolution/ratio tables |
| `unmodel/speech` | 409.8 KiB | fourteen providers, each with a voice/format roster and a per-model codec/language table |
| `unmodel/transcribe` | 401.7 KiB | eleven providers — the widest wire surfaces in the library, and therefore the widest per-model extras tables |
| `unmodel/image-edit` | 276.1 KiB | four providers |
| `unmodel/music` | 149.8 KiB | two providers |

The ready-pack numbers are the *whole category*; `chat/factory` is the
provider-free base. A pack you build yourself pays only for the providers you
register — `createSpeech([openai, rime])` lands in the 40–60 KiB range on top
of the kernel, and the equivalent holds for every category. If you want exactly
one provider, importing its subpath directly is still the smallest thing in the
library.

## Status

Current coverage: **153 wire-exact request validators** across **65 provider
subpaths**, plus **4 endpoint-factory subpaths** (Azure OpenAI, Vertex AI,
Amazon Bedrock, Cloudflare Workers AI) whose factories return the same
surface — 69 provider subpaths in all, out of 118 package exports. Chat is 33 of
those validators; the rest are speech, transcription, image, image editing,
video, music and realtime session configs.

On top of them, **seven standardized surfaces**: `unmodel/chat` over 32
providers, and the six media packs — `unmodel/image` over 15, `unmodel/speech`
over 14, `unmodel/transcribe` over 11, `unmodel/video` over 10,
`unmodel/image-edit` over 4, `unmodel/music` over 2 — each also available as a
per-provider adapter at `unmodel/<provider>/unified` (36 of those). The suite is
**9,963 tests across 193 files**.

- **OpenAI** — Chat Completions, Images + image edits, Speech (TTS), Transcription (STT), Sora videos, Realtime session config.
- **Anthropic** `chat` (Messages); **Google** Gemini `chat`, Imagen `image`, Veo `video`; **Cohere** v2 Chat.
- **Cloud-endpoint factories** for Azure OpenAI, Vertex AI, Amazon Bedrock (Converse), and Cloudflare Workers AI.
- **A 29-provider OpenAI-compatible chat fleet** (Groq, xAI, Mistral, DeepSeek, OpenRouter, …).
- **TTS** — OpenAI, Cartesia, Deepgram (Aura), ElevenLabs, Fish Audio, Hume (Octave), Inworld, LMNT, MiniMax (T2A v2), Murf, Resemble, Rime, Smallest AI, Speechify.
- **STT** — OpenAI, AssemblyAI, Cartesia, Deepgram, ElevenLabs (Scribe), Gladia, Inworld (inline base64 audio), Mistral (Voxtral), Rev AI, Soniox, Speechmatics.
- **Realtime session configs** — OpenAI (GA session), Cartesia (TTS + STT sockets), Deepgram (Live, Flux, Aura streaming), ElevenLabs (stream-input TTS, Scribe v2 Realtime), Inworld (STT + TTS bidirectional), Soniox. The config objects only; socket lifecycle stays out of scope.
- **Image** — Black Forest Labs (FLUX.2, FLUX 1.x, Kontext, FLUX Tools), Bria (FIBO), ByteDance (Seedream), Ideogram (v3 + v4), Kling, Krea, Leonardo, Luma (Photon), Recraft, Reve (v1 + v2), Runway, Stability (generate + the six edit routes), Vidu.
- **Video** — Sora, Veo, ByteDance (Seedance), Kling, Lightricks (LTX-2), Luma (Ray + `videoModify`/`videoReframe`/`videoUpscale`/`videoAddAudio`), MiniMax (Hailuo + H3), PixVerse, Runway (text/image/video-to-video), Vidu.
- **Music / audio** — ElevenLabs (Eleven Music), Stability (Stable Audio 2.x).
- **Unified surfaces** — `unmodel/chat` compiling to three wire dialects across 32 providers, and one canonical vocabulary per media category over the providers listed above. Wire-exact per-provider validators remain the substrate: every unified call ends in one of them.

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

`docs/decisions.md` records the two standing decisions that shape the whole
codebase — the wire-exact/unified **layering**, and the **address-vs-wire naming
law** — with what would have to change for either to be revisited. Read it before
making the tree "more consistent" in either direction. `docs/providers.md` has
the provider roster, the coverage roadmap and the retargeting internals.

## License

MIT
