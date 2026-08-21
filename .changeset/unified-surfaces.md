---
"unmodel": minor
---

**New: seven standardized surfaces that compile to any provider's exact wire
body** — `unmodel/chat`, plus one pack per media category.

unmodel's per-provider validators exist because they mirror a wire format
*exactly*: `unmodel/anthropic`'s `chat()` takes `max_tokens` and `cache_control`
because that is what `POST /v1/messages` takes, and a validator that renamed
things would be lying about the request it validates. That stays the default and
it is not going away. These entries are the other half of the trade — **one**
camelCase vocabulary, and the compiler emits whichever wire body the model ref
names:

```ts
import { chat } from "unmodel/chat";

const req = chat({
  model: "anthropic/claude-opus-5",
  messages: [{ role: "user", content: "Explain retargeting." }],
  reasoning: { budgetTokens: 2048 },
  maxOutputTokens: 4096,
});

req.request.url;      // https://api.anthropic.com/v1/messages
JSON.stringify(req);  // {"model":"claude-opus-5","max_tokens":4096,…,
                      //  "thinking":{"type":"enabled","budget_tokens":2048}}
```

Change the ref to `"openai/gpt-5.2"` and the same object compiles to
`max_completion_tokens` + `reasoning_effort: "low"` at
`api.openai.com/v1/chat/completions`, with an `approximated_param` warning
naming both the requested budget and the bucket it landed in. That is the entire
proposition.

**New package exports**

| Entry | Function(s) | Providers |
| --- | --- | --- |
| `unmodel/chat` | `chat` | 32 |
| `unmodel/chat/factory` | `createChat` | whichever you register |
| `unmodel/image` | `image`, `createImage` | 15 |
| `unmodel/tts` | `tts`, `createTts` | 14 |
| `unmodel/stt` | `stt`, `createStt` | 11 |
| `unmodel/video` | `video`, `createVideo` | 10 |
| `unmodel/image-edit` | `imageEdit`, `createImageEdit` | 4 |
| `unmodel/music` | `music`, `createMusic` | 2 |

…plus `unmodel/<provider>/unified` for each of the 36 providers that ship an
adapter, and `unified.image` / `unified.imageEdit` / `unified.music` /
`unified.tts` / `unified.stt` / `unified.video` on `unmodel validate`.

**The result is a provider result.** A unified call does not validate the
request itself. It compiles the canonical params to the provider's wire params
and then runs **that provider's own validator** — the same `image()` from
`unmodel/openai` you would have called by hand, with its catalog, its constraint
tables, its media limits and its cost estimate. So there is no second definition
of what a valid request is and the two cannot disagree, and what comes back is
an ordinary `Validated`: enumerable properties are the provider's exact wire
body, `.request` is its URL/method/static headers, `.toSdk(target)` is its SDK
shape. Dropping to the wire layer is deleting one import, not a migration.

**The ref convention.** `model` is `"provider/model"`, split on the **first**
slash. OpenRouter's own ids contain slashes, so
`"openrouter/anthropic/claude-opus-5"` is provider `openrouter`, model
`anthropic/claude-opus-5`; splitting on the last slash — the obvious
implementation — would route it to a provider called `openrouter/anthropic`. The
generated ref unions drive autocomplete but never gate the API, so a model
released after the catalog snapshot is still callable. `unmodel/chat`'s return
type is keyed off the provider half at the type level: `"anthropic/…"` is typed
as a `/v1/messages` body, `"google/…"` as a Gemini body with no `model` key (it
lives in the URL), everything else as chat-completions, and an unrecognised
provider degrades to the union of the three rather than to `any`.

**The loss policy, in three rules.** A param the provider cannot express at all
is an **error** naming what it does offer. A value it can only express
approximately is an `approximated_param` **warning** naming both the requested
and the achieved value. Everything else is silent. So `warnings.length === 0`
*means* the request mapped exactly — asserted per category by a golden matrix
that compiles one canonical request at every provider that can express it.

```ts
image({ model: "black-forest-labs/flux-pro-1.1", prompt: "…", aspectRatio: "16:9", resolution: "1k" }).warnings;
// [approximated_param] `aspectRatio` 16:9 at 1k does not land on this model's
// 32px grid: 1344×768 (1.750:1, requested 1.778:1).

image({ model: "openai/gpt-image-1", prompt: "…", seed: 7 });
// throws: `seed` is not supported by "openai/gpt-image-1" — POST
// /v1/images/generations has no seed field, so a seed could only be dropped.
```

**`providerOptions` is the escape hatch, and it is still validated.** Anything
genuinely one-off — OpenAI's `store`, OpenRouter's `provider` routing block,
Vidu's reference `images` — rides in a bucket keyed by provider id, deep-merged
over the compiled body **before** validation, so it goes through the provider's
own checks rather than around them. Buckets that do not match the ref are inert,
so one request object can carry tuned settings for several providers and stay
portable.

**Narrowings that happen at compile time.** `audio` narrows to the STT
route (AssemblyAI fetches a URL, Cartesia takes multipart bytes, Soniox takes a
URL or its own file id, Mistral takes all three); `image` narrows the same way
in `unmodel/image-edit`; `aspectRatio` and `dimensions` are an XOR; the presence
of `image` / `video` chooses the video endpoint, and a model with no arm for the
derived route says so by name; `operation` is `"edit"` and only `"edit"` in v1.
One declaration drives both halves in each case — the same array types the
caller's field and backs it at run time with a message naming the shapes the
route does take, for JavaScript callers and refs built at run time.

**What each vocabulary actually buys**, in one line per category — these are the
translations that would otherwise be hand-written per provider:

- **chat** — `maxOutputTokens` is `max_completion_tokens` / `max_tokens` /
  `generationConfig.maxOutputTokens`; `temperature` is canonical 0–2 and clamps
  (never rescales) to Anthropic's ceiling of 1 with a warning; `reasoning`
  buckets a token budget into `reasoning_effort` where no budget field exists;
  `tools` is a `Record` so duplicate names are unrepresentable rather than
  detectable; `cache` breakpoints reach `cache_control`, `cachePoint` and
  `prompt_cache_breakpoint`.
- **image / image-edit** — `aspectRatio` XOR `dimensions` plus a `resolution`
  tier compiles to all six shapes a provider might offer: a closed ratio enum, a
  grid-snapped pixel pair, a documented size enum, a free-form `WxH`, an open
  ratio string with numeric bounds, and a bare tier name.
- **image-edit** — `strength` means one thing in one direction: `0` keeps the
  source, `1` ignores it. Ideogram's `image_weight` runs **backwards**, so
  `strength: 0` compiles to `image_weight: 100`. Every adapter declares its
  scale as the wire values at canonical 0 and 1, so the inversion is one number
  swapped rather than a minus sign hidden in a branch, and the capability sweep
  asserts the direction by compiling two requests and checking which way the
  wire value moves.
- **video** — `duration` is a plain number of seconds and compiles to five wire
  shapes: `8`, `"8"`, `"8s"`, a nested `settings.duration`, and the documented
  `null` "automatic duration". A duration a model does not offer is an
  `invalid_enum_value` listing the ones it does — never the nearest, because a
  9-second clip is not approximately a 5-second one at any price.
- **stt** — `diarization: { enabled: true }` reaches a flag
  (`speaker_labels`, `diarize`, `enable_speaker_diarization`), an enum
  (`diarization: "speaker"`), an **inverted** flag (`skip_diarization: false`)
  and a flag-plus-config-object; `timestamps: "word"` is an array at OpenAI, a
  scalar enum at ElevenLabs, a boolean at Deepgram, and free at the four routes
  that report word timings unconditionally — where `timestamps: "segment"` is an
  error naming what they *do* report.
- **music** — the unit is in the name: `durationSeconds: 90` is
  `music_length_ms: 90000` at ElevenLabs and `duration: 90` at Stability. The
  conversion is exact and therefore silent; a length that lands between two
  milliseconds is refused rather than rounded.
- **tts** — `outputFormat` reconciles container, sample rate and bitrate
  across fourteen providers that each publish a different subset; a provider
  with no speaking-rate field says so instead of dropping `speed`.

**Bundle cost is opt-in and pinned.** Per-provider entries carry none of this;
the adapters live in their own `unified-<category>.ts` modules behind the
separate `unmodel/<provider>/unified` export, and `test/bundle-budget.test.ts`
holds every entry — provider and pack alike — to a committed byte budget
measured over the real `dist/` import graph. Measured today, unminified ESM with
`zod` excluded: chat 1718.7 KiB (`chat/factory` 144.0), image 755.7, video
614.4, tts 409.8, stt 401.7, image-edit 276.1, music 149.8. A pack is
the whole category;
`createTts([openai, rime])` and its siblings pay only for the providers you
register.

**Declared gaps, each a typed refusal rather than a surprise.**
`inworld.stt` carries base64 audio inside its JSON body, which a
synchronous compile step cannot produce from a `Blob`; Black Forest Labs'
Kontext `input_image` is a JSON string, so its `imageInputs` is
`["data", "url"]` and `{ file }` does not type-check; Recraft's `strength` is
required with no documented default, so a request without one is an error rather
than a number unmodel picked; Stability's `musicFromAudio` / `musicInpaint` and
the sixteen masked editing routes take controls no other provider has, so they
stay reachable by name at `unmodel/<provider>` where they work perfectly well.

**No `.toApi()` on a unified *media* result, deliberately.** A provider result
offers `.toApi(target)` because it starts in one dialect and may want another.
A unified media result has no dialect to leave: retargeting it means changing
`model` and calling again, which is a string edit rather than an API — and
adding `.toApi` would bundle the availability tables the six media packs exist
without. `unmodel/chat` is the exception and pays for it on purpose: it returns
the provider's own `Validated`, so `.toApi` and `.toSdk` are there because they
were never removed. See the `chat-composition` changeset.

## `unmodel/image` knows what *one model* takes

The two image surfaces narrow per **model**, not per provider — because that is
where the disagreement actually is. `gpt-image-2` takes a free-form `size` up to
3840 px and a `background` of `"opaque" | "auto"`; `gpt-image-1` — same
provider, same endpoint — takes a three-value `size` enum and a `background`
that also accepts `"transparent"`. One adapter, two request surfaces, and the
difference is the model id.

```ts
image({ model: "openai/gpt-image-2", prompt, size: "3840x2160" });
//                                          ^ that model's own presets

image({ model: "openai/gpt-image-1", prompt, background: "transparent" });  // ok
image({ model: "openai/gpt-image-2", prompt, background: "transparent" });  // compile error
```

That second line is the whole argument for this library in one call. The OpenAI
SDK's own type offers `transparent` on every GPT image model; gpt-image-2
answers a 400 — *"Requests with `background` set to `transparent` will return an
error for these models; use `opaque` or `auto` instead"* — which unmodel keeps
as a recorded fixture.

**What narrows.** `size` (a new canonical field, joining `aspectRatio` and
`dimensions` in the XOR — three spellings of one decision, at most one given),
`aspectRatio`, `resolution`, and the per-model params the canonical vocabulary
has no word for. `size` is a string on purpose: `"3840x2160"` is what the docs,
the dashboards and the models themselves call it, and one token autocompletes
where a `{ width, height }` pair cannot.

**The presets are provable.** A closed enum gets no template tail — the list
*is* the limit, so `size: "1920x1080"` does not compile on `dall-e-3`. A
free-form field gets `` `${number}x${number}` `` beside the presets, because it
genuinely accepts more than the list; there `"1920x1080"` compiles and fails at
run time on gpt-image-2's own 16-px rule, which is why it is absent from the
presets and `"2560x1440"` is in them. Every preset in every table — across all
19 adapters — is compiled through the adapter and run past the provider's own
validator, with zero errors and zero warnings, in
`test/unified/image-presets.test.ts`.

**The extras are identity, and still checked.** A per-model param is already
spelled the way the provider spells it, so it goes on the wire unchanged, before
`providerOptions` is merged (which therefore still wins). The provider's own
schema and deny tables then re-check it: a JavaScript caller who passes
`background: "transparent"` to gpt-image-2 gets the same refusal a TypeScript
caller got at compile time. An extra sent to a model that does not take it is an
`unsupported_param` naming the models that do.

Unknown and run-time-built refs degrade to the wide vocabulary, exactly as an
unrecognised model already does: the union drives autocomplete, it does not gate
the API.
