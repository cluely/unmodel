# Decisions

Standing decisions for this repository. They are written down because both of
them look, from inside a single file, like inconsistencies worth "fixing" — and
fixing either one would break the library's central promise. If you are about to
make the codebase more uniform in one of the ways described below, read the
entry first and then don't.

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
  (`unmodel/{image,image-edit,speech,video,transcribe,music}`). They take one
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

The uniform verbs are `chat`, `image`, `imageEdit`, `speech`, `transcribe`,
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
| `elevenlabs.speech` | `TEXT_TO_SPEECH_BASE_URL`, `/v1/text-to-speech/{voice_id}` |
| `deepgram.transcribe` | `LISTEN_URL`, `/v1/listen` |
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
   `unmodel/transcribe` and the word you type at `unmodel/<provider>` are the
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
  POST; folding it into `speech` or `transcribe` would make one address mean two
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
