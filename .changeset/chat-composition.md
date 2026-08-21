---
"unmodel": minor
---

**`unmodel/chat` now composes the real provider validators, and there is a
narrow entry for applications that only call two of them.**

A unified chat call used to be checked against a slim per-model profile table
that lived beside the provider validators and could disagree with them. It no
longer is. `chat()` validates the canonical shape, compiles it to the target
dialect once, and hands the body to **that provider's own `chat()`** — the same
function `unmodel/anthropic` exports, with its schema, its catalog, its
hand-written constraint tables, its capability and media checks and its cost
estimate. There is one definition of a valid request per provider, and unified
chat is not a second one.

**What you get back is that provider's result.** Enumerable properties are its
exact wire body and `.request` is its URL, as before — but now `.toSdk(target)`
*and* `.toApi(target)` are the provider's own, typed off its generated
availability table. `chat({ model: "anthropic/claude-opus-5", … })
.toApi("openrouter")` retargets a request you authored canonically, and
`.toApi("groq")` on the same request is a compile error because the catalog
says Groq does not serve that model. (This corrects the "no `.toApi()` on a
unified result" note in the `unified-surfaces` changeset, which is now a
statement about the six media packs only.)

Issue paths still come back in the vocabulary you wrote: a finding the provider
reports at `["max_completion_tokens"]` is returned at `["maxOutputTokens"]` —
and the *message* now says which wire param it was compiled from, so a
canonical path never arrives attached to a sentence about a param that does not
exist in the API you are using. A wire param with no canonical name keeps its
wire spelling and gains ``(supplied via `providerOptions`)``.

**New export: `unmodel/chat/factory`.**

```ts
import { createChat } from "unmodel/chat/factory";
import { chat as anthropic } from "unmodel/anthropic";
import { chat as openai } from "unmodel/openai";

const chat = createChat({ anthropic, openai });
```

Same compiler, same vocabulary, byte-identical requests — from only the
validators you register. The registry key and the validator under it are one
claim: every chat validator is structurally identical and providers share model
ids, so `createChat({ groq: togetherai })` would otherwise compile and quietly
post to the wrong host. It is a compile error, and a `TypeError` at
construction for a hand-written validator that carries no provider claim.
A ref naming a provider you did not register has no usable result type either —
the call can only throw, so the type says so instead of offering `.request`.

`createChat` is **not** re-exported from `unmodel/chat`. It would be the same
function at eleven times the weight: `chat` is a top-level call that anchors the
whole registry, and no bundler removes it. The type re-exports are free and stay.

**Removed: `ChatOptions.catalog`.** A catalog layered beside a concrete provider
validator is a second authority that can disagree with the first — exactly the
thing this change removes everywhere else. Configure the validator instead and
register it:

```ts
const chat = createChat({
  openai: createOpenAICompatible<string, never, "openai">({
    id: "openai", baseUrl: "…", catalog: myCatalog,
  }).chat,
});
```

**Also removed:** `chatConstraintsFor` and `CHAT_CONSTRAINT_ENDPOINTS` from
`unmodel/chat`. They exposed the chat-side copy of the deny/enum tables, which
no longer exists; each provider's validator applies its own.

**New issue code: `media_declaration_dropped`** (warning). Only a compiling
surface can produce it: a `ValidateOptions.media` declaration whose part did not
survive compilation is reported and dropped, rather than forwarded at a path
that now addresses a different attachment.

**Deeper checks, everywhere — not just here.** Pushing validation down to the
substrate made several of them wider than they were, on the provider subpaths
as well as on `unmodel/chat`:

- `reasoning_effort` on a model the catalog marks `reasoning: false` is now an
  `unsupported_capability` error in the shared chat-completions battery, so
  OpenAI *and* all 30 OpenAI-compatible providers refuse a request their APIs
  400. It surfaces as `["reasoning"]` through `unmodel/chat`.
- `structuredOutput` is tri-state everywhere now: absent means "the catalog has
  no answer" and never fails a request. `google.chat` and `google-vertex.chat`
  used to read absent as `false`.
- Estimate findings carry a path: `over_context` / `near_context` point at the
  prompt-bearing param, `over_budget` at `["model"]`.
- A `tools` refusal names the tools that were supplied again.

**Bundle.** `unmodel/chat` measures **1718.7 KiB** (budget 1800) — 32 validators,
their catalogs and 11 availability tables. About 379 KiB of that is the
`chatProfiles` discovery snapshot, which is public API and no longer read by any
validation path; it is kept for discovery and priced honestly here rather than
quietly. `unmodel/chat/factory` measures **144.0 KiB** (budget 150) and contains
no provider module beyond the three dialect codecs, asserted rather than
described. `dist/chat/index.d.ts` is 455 KiB, down from 892, and now has a
budget of its own — a declaration regression is invisible to every other gate.
