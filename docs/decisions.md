# Decisions

Standing decisions for this repository. They are written down because each of
them looks, from inside a single file, like an inconsistency worth "fixing" —
and fixing any one of them would break the library's central promise. If you
are about to make the codebase more uniform in one of the ways described below,
read the entry first and then don't.

Each entry states the decision, the reason, and what would have to be true for
it to change.

---

## 1. The layering: wire-exact validators are the substrate; unified surfaces compile down to them

**Decision.** unmodel has exactly two layers, and they are not peers.

- **The substrate** is `unmodel/<provider>`. Its params *are* that provider's
  raw REST body, byte for byte. Nothing is renamed, reordered, defaulted or
  normalised. Wire types mirror the documented request exactly, including the
  parts unmodel finds ugly.
- **The layer on top** is `unmodel/chat` and the six media packs
  (`unmodel/{image,image-edit,tts,video,stt,music}`). They take one
  standardized camelCase vocabulary, **compile** it to one provider's wire
  params, and then hand those params to **that provider's own validator** from
  the substrate.

A unified call therefore *ends* in a substrate call. There is no second
definition of a valid request, no parallel schema, no "unified validation".
`warnings` records what the compile step cost, and the returned object is an
ordinary `Validated`: enumerable properties are the provider's exact wire body,
`.request` is its URL/method/static headers, `.toSdk(target)` is its SDK shape.

**Why.**

1. **Exactness is the product.** The reason to reach for unmodel over an SDK is
   that what you build is what gets sent. A unified format that params had to
   pass *through* would reintroduce exactly the debugging problem the library
   exists to remove — you would be reading someone else's translation of your
   request instead of your request.
2. **Portability is a real need, and it does not have to cost exactness.**
   Making it a separate, opt-in layer that compiles *down* means you get one
   vocabulary when you want one and the wire when you need it, and switching
   between them is deleting an import rather than a migration.
3. **One definition of valid.** Because the unified path terminates in the
   provider's own validator, the two layers cannot drift apart or disagree.
   Adding validation to the unified layer would create a second source of truth
   that would be wrong within a release.
4. **Bundle honesty.** Substrate entries carry none of the unified layer; the
   adapters live in separate `unified-<category>.ts` modules behind a separate
   `unmodel/<provider>/unified` export. `test/bundle-budget.test.ts` pins this
   in bytes against a real build.

**Therefore, never:**

- Rename, normalise, camelCase or "clean up" a wire type or a validator's params
  in `src/providers/`. If a provider's field is misspelled on the wire, it is
  misspelled here. The ~25 `mirror … exactly` comments on the wire leaves are
  load-bearing documentation of this rule, not boilerplate.
- Move validation logic into `src/unified/` or `src/chat/`. Those directories
  compile and delegate; they do not decide what is valid.
- Remove or bypass a provider validator because "the unified surface already
  checked it". It didn't, and that is the design.
- Make the unified surface the *only* way to reach a provider. Every endpoint
  stays reachable by name at `unmodel/<provider>`, including the ones no
  vocabulary covers (masked image edits, Stability's audio-conditioned music,
  the realtime session configs).

**A gap in the unified layer is expressed as a typed refusal, not as a
workaround.** When a provider cannot express a canonical param, the adapter
declares that and the call fails with a message naming what the provider *does*
offer and which wire-only sibling does the job. Inventing a default, silently
dropping the param, or widening the canonical vocabulary to one provider's
private feature are all worse than the error.

**What would change this.** Nothing about a new provider or a new category.
Only a change in what the library is *for* — and at that point it is a different
library, not a refactor.

---

## 2. The address-vs-wire naming law

**Decision.** Two kinds of name exist in this codebase, and they follow opposite
rules.

- **Address-shaped names** — the validator export, its `check*` helper, its
  `*Constraints` / `*FamilyRules` tables, its `*SdkTargets` type, its CLI id,
  its module filename — are **uniform across providers**. They answer "which
  endpoint am I calling", and that question has the same answer everywhere.
- **Wire-shaped names** — body/param interfaces, URL constants, URL builders,
  dialect ids, response types — **keep the provider's own wire spelling**. They
  describe the bytes on the wire, and respelling them would make the type lie.

The uniform verbs are `chat`, `image`, `imageEdit`, `tts`, `stt`,
`video` and `music`. A provider's primary route in a category is the bare verb;
every *extra* route qualifies by what makes it different — what it is made from
(`videoFromImage`, `imageFromReference`, `musicFromAudio`), which route family
serves it (`imageV4`, `videoV3`, `chatMaas`), or what it does to a finished
artefact (`imageEditInpaint`, `videoUpscale`, `musicInpaint`). Never by the wire
path, never by the vendor's product name.

**Examples, all from the same files:**

| Address (uniform) | Wire (keeps its spelling) |
| --- | --- |
| `anthropic.chat` | `MessagesBody`, `MESSAGES_URL`, `POST /v1/messages` |
| `google.chat` | `GenerateContentBody`, `generateContentUrl`, `:generateContent` |
| `amazon-bedrock.chat` | `ConverseParams`, the Converse command shape |
| `openai.image` | `IMAGES_GENERATIONS_URL`, `POST /v1/images/generations` |
| `black-forest-labs.image` | `Flux2Body` |
| `krea.image` | `krea2Url` |
| `vidu.imageFromReference` | `REFERENCE2IMAGE_URL`, `/ent/v2/reference2image` |
| `elevenlabs.tts` | `TEXT_TO_SPEECH_BASE_URL`, `/v1/text-to-speech/{voice_id}` |
| `deepgram.stt` | `LISTEN_URL`, `/v1/listen` |
| `stability.music` | `STABLE_AUDIO_TEXT_TO_AUDIO_URL` |
| `recraft.imageEdit` | `IMAGE_TO_IMAGE_URL`, `ImageToImageParams` |

So `anthropic.chat` and `MessagesBody` sitting in the same module is **correct**
and is not a naming inconsistency to clean up. Renaming `MessagesBody` to
`ChatBody` would erase the fact that the type mirrors `/v1/messages`; renaming
the *address* back to the wire verb would make it depend on a vendor's
vocabulary, and the next provider's verb would disagree again. The retired
spellings are listed once, in the `uniform-endpoint-names` changeset, and
nowhere else — they are not names this codebase still knows.

**Why.**

1. **The address is the thing a caller reaches for.** Before this law, eleven
   providers spelled "transcribe this audio" eight different ways. Learning one
   provider taught you nothing about the next.
2. **It is what makes the unified refs readable.** The word you type at
   `unmodel/stt` and the word you type at `unmodel/<provider>` are the
   same word, at every provider, in every category.
3. **The wire spelling still has to survive somewhere**, because it is how you
   find the endpoint in the provider's docs — so it survives exactly where it is
   descriptive: on the URL constant and the body type.

**Enforcement.** `src/cli-registry.test.ts` is the executable rename map: it
pins every current endpoint id, asserts every retired id is gone, and asserts
per category that the verb is uniform. A rename cannot happen quietly — it has
to be typed out there, in the diff. `test/bundle-budget.test.ts` additionally
asserts a unified pack can only reach a provider through a file with the uniform
name, which makes the filename half structural rather than cosmetic.

**Deliberate exceptions, and why they are not violations:**

- **Realtime surfaces keep their own names** (`listenLive`, `speakLive`,
  `ttsWebsocket`, `speechToTextRealtime`, `realtimeTranscription`,
  `realtimeSession`, …). A socket config is a *different endpoint* from a batch
  POST; folding it into `tts` or `stt` would make one address mean two
  transports.
- **`google-vertex` has three chat addresses** — `chat`, `chatMaas`,
  `chatRawPredict` — because Vertex genuinely serves three wire surfaces. The
  qualifier names the surface, which is exactly what the law prescribes for
  extra routes.
- **`toFormData` / `toUploadFormData` are not endpoint addresses.** They are
  transport helpers, and the pair is deliberately kept distinct:
  `toFormData(validated)` re-encodes the *same* endpoint's validated body as
  multipart; `toUploadFormData(params)` builds the body for a *distinct* upload
  endpoint whose response id then feeds the validator.

**What would change this.** A new category gets a new verb, chosen the same way
(what the operation is, not what any one vendor calls it). Nothing else.

---

## 3. `unmodel/chat` ships in two entries; the media packs ship in one

**Decision.** Six of the seven unified surfaces expose their ready pack and
their `create*` registry form from **one** entry — `image` and `createImage`
both live at `unmodel/image`. Chat does not: `chat` is at `unmodel/chat` and
`createChat` is at `unmodel/chat/factory`, and `unmodel/chat` deliberately does
**not** re-export `createChat` as a value.

**Why.** The asymmetry is not chat being special about ergonomics; it is chat
being special about *weight*, in a way tree-shaking cannot reach.

1. **A media adapter is a leaf; a chat adapter is a whole validator.** A media
   pack composes `unified-<category>.ts` modules — a schema fragment and a
   compile function. Chat composes the providers' real `chat()` validators,
   with their generated catalogs, constraint tables and availability tables.
   The ready chat pack is ~1.7 MB against ~150–750 KiB for a media pack.
2. **The ready pack cannot be shaken out of a shared entry.** `src/chat/index.ts`
   is `export const chat = createChat(CHAT_PROVIDER_VALIDATORS)` — a top-level
   call with side-effect-unknown semantics that no bundler removes, even under
   `"sideEffects": false`. Measured with `bun build --minify` against a real
   `dist/`: anything imported from `dist/chat/index.js` drags **1.20 MB**;
   `createChat` from `dist/chat/factory.js` is **340 KB**. The declaration
   graph splits the same way — 45 files (1818 KiB) against 7 (178 KiB).
3. **So the cheap path has to be the only path.** A `createChat` re-export on
   `unmodel/chat` would be the identical function at eleven times the cost, on
   the more obvious specifier, with nothing in the type or the autocomplete to
   say so. Type re-exports are free and stay.

**The word "factory" is overloaded here, knowingly.** Inside `src/chat`,
"factory-configured" means a provider whose URL needs config a bare
`"provider/model"` ref cannot carry (azure, google-vertex, amazon-bedrock,
cloudflare-workers-ai) — the four providers `unmodel/chat` *refuses*. The
subpath means the opposite: the entry you use to build a pack yourself. The
collision is real and the subpath name was kept because it matches the
`create*` vocabulary the six media packs already use.

**Enforcement.** `test/bundle-budget.test.ts` pins both entries separately, and
asserts that `unmodel/chat/factory`'s graph contains *no* provider module
beyond the three dialect codecs and that its declaration graph never references
the ready registry. `test/chat/factory.test.ts` asserts the two produce
byte-identical requests, so the split costs no behavioural divergence.

**What would change this.** A bundler-visible way to make the ready pack
removable — a `/*#__PURE__*/` annotation that real bundlers honour on a call of
this shape, or lazy per-provider registration. Then one entry would be honest
again.

---

## 4. One wire route may carry several addresses; the widest one never gets narrower

**Decision.** Gemini has no speech endpoint. TTS is `:generateContent` with
`responseModalities: ["AUDIO"]` and a `speechConfig`; STT is `:generateContent`
with audio parts. unmodel ships **three** validators over that one URL —
`google.chat`, `google.tts`, `google.stt` — and the rule between them is fixed:

- **The wire-truthful surface keeps everything it can send.** A TTS model id is
  a legal `google.chat` request, so `google.chat` still accepts it. Narrowing
  chat to "text in, text out" so the taxonomy looks tidier would make the
  validator refuse a request the API fulfils, which is the one failure this
  library must never have.
- **The modality surfaces are narrower *views*, not different endpoints.**
  `google.tts` requires `generationConfig`, pins `responseModalities` to
  `["AUDIO"]`, XORs `speechConfig`'s two arms, bounds `speakerVoiceConfigs` to
  a 1-or-2 tuple, discriminates `responseFormat.audio` so `bitRate` exists only
  on compressed formats, and marks every chat-only knob `?: never` — including
  the ones nested in `generationConfig`, which have to be spelled out or the
  callable's intersection re-admits them. `google.stt` narrows `contents` to
  text and audio parts, closes `inlineData.mimeType` to the seven published
  audio types, and types `audioTranscriptionConfig`.
- **The checks live in ONE battery both surfaces call** (`tts-checks.ts`), so
  the two cannot drift about what a valid speech request is, and the rules
  `google.tts` adds are rules `google.chat` gains for free.
- **The wide surface signposts the narrow one.** `google.chat` on a TTS id
  without `["AUDIO"]` names `google.tts` and `unmodel/tts` in the error. That
  is the only thing the split adds to chat: a pointer, never a refusal.

**Why.** Modality is a property of the *request*, not of the URL. Providers
that ship separate speech endpoints let the address carry that information for
free; Gemini does not, and the choice is either to lose the typing or to add an
address. Losing the typing was the status quo and it cost the library its whole
value proposition on this provider — thirty voices and a 78-language table
sitting inside a bag of chat params that also accepts tools, thinking budgets
and image config. Adding an address costs one module and buys the same
compile-time story every other TTS and STT provider already has, plus a
`"google/…"` ref in the unified packs.

**The corollary for vocabularies: a kind is added when a real route needs it,
not when a provider is added.** Gemini takes audio as inline base64 or as a
Files-API id and fetches no third-party host, which the existing three audio
kinds (`file`, `url`, `fileId`) could not express. So the STT vocabulary gained
a fourth, `data` — `DataRef` verbatim, the same `{ data, mimeType? }` `image`,
`image-edit` and `video` already carry, which is why it is a *widening* rather
than a new concept. It immediately retired a wart: inworld's `audioInputs` had
been `[]`, a provider in the pack that no canonical request could reach. The
alternative — smuggling base64 in under `file` or `url` — would have made two
kinds mean three things.

**Therefore, never:**

- Remove a model id from `google.chat` because a narrower surface now serves
  it. The narrow surface is additive.
- Give `google.tts` or `google.stt` a private copy of a check. If a rule is
  worth enforcing on one, it belongs in the shared battery.
- Read this as licence to split every provider by modality. The split exists
  because the *wire* fuses modalities into one route. A provider with a real
  `/v1/audio/speech` needs no second address.

**What would change this.** Google shipping a dedicated speech or transcription
endpoint. Then `google.tts` / `google.stt` retarget to it and the chat overlap
becomes history rather than design.

---

## 5. Validation runs on zod, behind a Standard Schema seam — not ArkType, not zod/mini

**Decision.** The wire schemas are zod 4, imported from the classic barrel, and
they are pure runtime gates: no public type is derived from a schema
(`z.infer` appears nowhere), error formatting is unmodel's own, and the
pipeline consumes schemas through the vendor-neutral `StandardSchemaV1`
interface (`src/core/standard-schema.ts`), not through `z.ZodType`.

**Why.** Evaluated against ArkType 2.x in 2026-08, with first-party
measurements — see `docs/research/arktype-evaluation.md` for the full study.
ArkType's compiled validators really are ~11–18× faster under our passthrough
semantics, and it bundles smaller than the full zod barrel. But the win lands
on a cold path (three `safeParse` call-sites, once per request build) while
its costs land on the hot ones: schema construction is ~6.3× slower at import
time — this package builds ~292 schemas eagerly at module scope, and cheap
imports are what the per-entry budget architecture exists to protect — its
inference costs ~4.7× the type instantiations, paid by every consumer's `tsc`,
and its global type registry retains heap across GC (arktype#1584). The parts
of ArkType worth having were taken instead: `@ark/attest` instantiation
budgets (`bun run bench:types`), the Standard Schema seam, and the
`type.declare`-style codegen width checks (`<cat>-check.gen.ts`).

**Therefore, never:**

- Put `z.ZodType` back in a public signature. The seam is the contract;
  zod-specific behavior belongs behind an `instanceof` check that degrades
  gracefully (see `reportUnknownTopLevelKeys`).
- Derive a public type from a schema. The moment `z.infer` enters the public
  surface, the validator choice stops being an implementation detail and every
  future evaluation like this one becomes a breaking change.
- Assume `~standard.validate` throws synchronously. zod's goes async when the
  *value* throws mid-read; `shapeIssues` documents and contains this.

**What would change this.** The attest benches showing zod as a measurable
share of instantiation cost; ArkType fixing its registry retention and
shipping ahead-of-time compilation (both tracked in the research doc's
"revisit if" list); or the hot path changing shape to pure predicate checks,
where ArkType's `.allows()` is ~18× faster and unmatched. Bundle-weight
pressure alone points at `zod/mini`, a far cheaper move than a library swap.

## 6. `.toApi` attaches in `finalize` for chat and in `index.ts` for media

**Decision.** Chat validators wire the retargeter into their `finalize`
(`toValidated(body, request, { sdk, api })`). Media validators do not: they wire
nothing, and their provider entry — `src/providers/<p>/index.ts` — wraps the
exported validator with `withApiTarget(validator, retargeter)`
(`src/core/translate/media-retarget.ts`), which hangs `.toApi` / `.toApiSafe`
non-enumerably off each result.

**Why.** Who imports the endpoint module differs, and that is the whole reason.
A chat endpoint module is reached by its own entry and by `unmodel/chat`'s
validator registry — both of which *want* `.toApi`, since a compiled chat result
carries the provider's retarget surface through. A media endpoint module is
reached by its own entry **and by up to twelve category packs**, through the
`unified-<category>.ts` adapter leaves that import `./video` / `./tts` /
`./image` directly. A unified result's declared type has no `.toApi` on it, so
every byte of the engine, the target table and the family's overlap table would
be dead weight in `unmodel/video`, `unmodel/image`, `unmodel/tts` and the rest —
in bundles that cannot call it.

The obvious place to wire `api:` is therefore exactly the wrong one here, which
is why this is written down rather than left to be re-derived. `index.ts` is the
one module only `unmodel/<p>` imports (the barrel-trap rule R1 keeps adapters
out of it), so the seam applied there costs the packs nothing.

The cost of the split is that the wrapped validator's public type is restated in
`index.ts` — `withApiTarget` is generic over the *result* and cannot add a member
to the return of a generic call signature — which is ~12 lines per endpoint and
the reason the roster is curated rather than exhaustive.

**Therefore, never:**

- Import a `fal-target.ts` from anything but its own directory's `index.ts`.
  Asserted in `test/bundle-budget.test.ts` ("no adapter leaf or endpoint module
  imports a fal-target"), because a single stray import silently re-adds the
  seam to a dozen packs.
- Wire `api:` into a media endpoint module's `finalize`, for the same reason.
- Let the per-pack composition tests go vacuous. They are negative assertions,
  so they are paired with a positive one naming the six entries that *do* carry
  the seam.

**What would change this.** A media pack that genuinely wants `.toApi` on its
unified results — which would mean a canonical media retarget vocabulary rather
than a per-family hand mapping, and a target union derivable from the kernel's
own model refs. Nothing in the current design points that way: the mapping is
per wire family by necessity, because media has no shared dialect.

---

## 7. `unmodel/chat` compiles Chat Completions; `/v1/responses` is a substrate item, not a fifth dialect

**Decision.** `unmodel/chat` targets OpenAI through `POST /v1/chat/completions`
and only that. OpenAI's Responses API is not a `DialectId`, has no codec in
`src/chat/compile.ts`, and will not get one. When unmodel serves it, it will be
as `openai.chatResponses` — a wire-exact validator at `unmodel/openai`, sitting
beside `chat` the way `google-vertex`'s `chat` / `chatMaas` / `chatRawPredict`
sit beside each other. That surface is queued, not built.

The immediate consequence, and the reason this entry exists at all: the nine
OpenAI catalog rows that `/v1/chat/completions` refuses — `gpt-5.3-codex`,
`gpt-5.3-codex-spark`, three `text-embedding-*`, three image rows and
`gpt-realtime-2.1` — are no longer `ChatModelRef` arms
(`chatScopeExclude` in `data/availability-overrides.json`), and `openai.chat`
warns on them by name (`NON_CHAT_ROUTES` in `src/providers/openai/chat.ts`).
Until v0.3.1 they were offered by autocomplete, compiled clean and addressed the
chat endpoint: nine refs that could only ever come back 400.

**Why.**

*OpenAI's own position is that Chat Completions is supported.* "While Chat
Completions remains supported, Responses is recommended for all new projects"
(developers.openai.com/api/docs/guides/migrate-to-responses, checked
2026-08-26). Chat Completions is not on the deprecations page — the only entry
there is Assistants. So compiling to it is not a bet on a dying route; the
recommendation is about new projects, and `unmodel/chat`'s promise is that one
request object reaches thirty-two providers, not that it reaches OpenAI's
newest surface first.

*What does not migrate is real, and it is not a rename.* Responses adds
capabilities that have no Chat Completions spelling at all: the built-in tools
(web search, file search, computer use, code interpreter, remote MCP), reasoning
summaries, `previous_response_id` / `store` statefulness, encrypted reasoning,
`background`, `include`, `truncation`, and `image_url.detail: "original"` (the
Responses-only fourth value — Chat Completions takes `auto | low | high`, which
is what `openai-compatible/wire.ts` declares). The codex models are the extreme
case: they have no Chat Completions form whatsoever. A "translation" that
silently dropped that list would be a worse answer than not offering it.

*The unified surface cannot carry it, structurally.* Provider → dialect is 1:1
in four places, each of which would need a second key with nothing to key it
on: `DialectId` (`core/translate/endpoints.ts`), `DialectOf<P>`
(`retarget/dialects.ts`), the three-decoder set in `src/chat/compile.ts` whose
own header calls a fourth codec "a deliberate, reviewable edit", and the
one-validator-per-provider registry in `src/chat/providers.ts`. There is no ref
syntax that selects a *surface* — `"openai/gpt-5.2"` names a provider and a
model, and that is the whole vocabulary. A Responses codec would also serve
exactly one addressable provider, against thirty-two on `openai-chat`. This is
decision #1's answer, applied: a gap in the unified layer is expressed as a
typed refusal, not as a workaround.

**Therefore, never:**

- Add `"openai-responses"` to `DialectId` and wire a codec into
  `src/chat/compile.ts`. `bedrock-converse` is the standing precedent for a
  dialect that exists in the table with no codec and refuses refs; a *fifth*
  dialect that reaches one provider is not that.
- Reach for `providerOptions.openai` to smuggle a Responses-only field into a
  Chat Completions body. The bucket is merged verbatim into a
  `/v1/chat/completions` request; `previous_response_id` there is a 400.
- Re-add the nine refs by loosening `chatScopeExclude`. `test/chat/refs.test.ts`
  asserts every surviving `openai/…` ref is an `OpenaiChatModelId`, which is the
  type `NonChatModelId` shapes.

**What would change this.** Either half of the keying problem being solved:
a per-model or explicit surface selector at the ref layer (a syntax that can say
"openai, but the other surface" without widening every result type), **or** a
second provider adopting the Responses wire format, which would make it a
dialect in the sense the other four are — a format several providers speak —
rather than one vendor's second route. Until then the honest shape is a
substrate address: `openai.chatResponses`, wire-exact, reached by name.

---

## 8. `detail` is canonical vocabulary; `verbosity` is not — the witness rule, applied twice in one wave

**Decision.** `ChatFilePart.detail?: "auto" | "low" | "medium" | "high"` is part
of the unified chat vocabulary. OpenAI's `verbosity` is not, and lives at
`providerOptions.openai.verbosity` — typed, enumerated and gated there, but not
promoted.

**Why.** The rule is the same one that deferred `unmodel/3d` to wave 3 and keeps
`creativity`/`resemblance` out of `unmodel/upscale`: *a word joins the canonical
vocabulary when a second provider independently has the same concept.* Both
halves of this wave were tested against it and it answered differently, which is
what makes it a rule rather than a preference.

*`detail` has two witnesses, and unmodel was already paying for the gap twice.*
OpenAI spells it `image_url.detail` (`auto | low | high`, default `auto`);
Gemini spells it per-`Part` `mediaResolution.level`
(`MEDIA_RESOLUTION_{UNSPECIFIED,LOW,MEDIUM,HIGH}`, which overrides the
request-level `generationConfig.mediaResolution`). Both are first-party,
documented, and about exactly one thing: how many tokens the attachment costs.
The evidence that they are the same concept was already in the codebase, as a
matched pair of warnings — `openai-compatible/interop.ts` dropped
`image_url.detail` saying it "is an OpenAI chat-completions concept with no
equivalent in the other dialects", and `google/interop.ts` said the mirror
sentence about `mediaResolution`. Two encoders each asserting the other's field
does not exist is the signature of a missing vocabulary word.

The union is taken, not the intersection — the `ChatReasoningEffort` rule.
`medium` is Gemini's and OpenAI has no equivalent, so the Chat Completions codec
raises it to `high` with an `approximated_param` rather than making it
unsayable. Rounding *up* is deliberate: a request that costs a few more tokens
is recoverable, one that quietly loses resolution on a document scan is not.
Anthropic has no per-attachment hint at all (`/v1/messages` sizes an image by
its pixel dimensions), so it drops it with a named `dropped_param` — the same
sentence, now said once, on the one crossing where it is true.

The estimate half rides along, because a token hint that does not move the token
estimate is decoration. `imageTokensByDetail` on `EndpointConstraints` is
catalog-driven and sparse on purpose: Gemini publishes 280 tokens for an image
or PDF page at `MEDIA_RESOLUTION_LOW`, so that row exists; **OpenAI's table
deliberately has none**, because its vision guide states that `low` does not
always use fewer tokens than `high` on current models. The historical
85-token low-detail figure is a GPT-4o-era number, and a plausible wrong number
in an estimate is worse than a coarse right one.

*`verbosity` has one witness, and the fix was somewhere else.* It is first-party
and documented (`low | medium | high`, default `medium`), and unmodel has typed,
enumerated and validated it since 0.1 — but a repo-wide search and a live check
of OpenRouter's, Gemini's and Anthropic's chat references found no second
provider with the concept. Anthropic's `output_config.effort` is *effort*, which
`ChatReasoning` already carries. So it stays out of `ChatParams`. What was
actually wrong was that `providerOptions.openai` was typed off the *shared*
`openai-chat` dialect body, which by design excludes the twelve params only
OpenAI's endpoint takes — so the one place a caller writes `verbosity` completed
nothing and checked nothing, while the validator two layers down knew all three
legal values. That bucket now reads the endpoint body, and
`verbosity: "extreme"` is a compile error instead of a runtime one.

**Therefore, never:**

- Promote a param on the strength of one provider having it, however
  well-documented. The bar is a second *independent* vocabulary, not a good
  vendor doc.
- Take the intersection when the union is expressible. A level one dialect lacks
  becomes an `approximated_param`, not an unsayable request.
- Put a per-level token figure in a constraint table because it is widely
  repeated. `imageTokensByDetail` rows carry a URL and a date, or they do not
  exist.
- Add `detail: "original"`. It is a Responses-only value on Responses-only input
  images (see §7).

**What would change this.** For `verbosity`: a second provider shipping a
response-length dial that is not an effort bucket — at which point it is a
canonical field and the openai bucket keeps its own spelling anyway. For
`detail`: a fourth level with two witnesses, or a provider that expresses
resolution as a number rather than a bucket, which would make the union the
wrong shape rather than the wrong width.
