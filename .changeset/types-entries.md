---
"unmodel": minor
---

**Every type unmodel knows is now importable without importing unmodel.**
`unmodel/<provider>/types` (70 new subpaths) and `unmodel/types` (one hub) are
type-only entries: they emit an **empty JavaScript module**, so the whole
surface is free at runtime.

They exist for the developer who wants the doc-corrected request shapes and is
sending the request themselves — with `fetch`, with the vendor SDK, or through
a client they already have. Nothing here is new *knowledge*; the types were
already on the provider subpaths. What is new is that reaching them no longer
means resolving a module that also carries a zod schema, a generated catalog
and a validation pipeline, and that they are now uniformly discoverable.

```ts
import type { ImageBody } from "unmodel/openai/types";

const body = {
  model: "gpt-image-2",
  prompt: "a lighthouse at dusk",
  size: "3840x1280",
  background: "transparent",
} satisfies ImageBody;
// Type '"transparent"' is not assignable to type '"auto" | "opaque" | null | undefined'.
```

That error is the product: `gpt-image-2` returns a 400 for a transparent
background, so the type does not have the value — while `size` stays open to
the whole documented `WIDTHxHEIGHT` rule space. `satisfies` rather than an
annotation, so the literal types survive.

**Two families of name, and the difference is deliberate.** Each provider entry
re-exports that provider's **wire names verbatim** (`MessagesBody`,
`ListenParams`, `Flux2Body`, `GenerateTtsBody`) — they are how you find the
endpoint in the vendor's own documentation, and `docs/decisions.md` §2 is why
they are not respelled. Alongside them, one uniform **`<Endpoint>Body` alias per
endpoint address** the provider serves, named after the word you already type at
`unmodel/<provider>` and `unmodel validate`: `ChatBody`, `TtsBody`, `SttBody`,
`ImageBody`, `ImageEditBody`, `VideoBody`, `MusicBody`, plus the qualified
extras (`ImageFlux1Body`, `TtsStreamBody`, `VideoV3FromImageBody`,
`ImageEditSearchAndReplaceBody`, `RealtimeSessionBody`, …). 155 endpoint
addresses across 65 providers; 149 new alias declarations, 6 names that already
were the wire spelling, and 5 more `ChatBody` aliases for the factory-configured
providers that have no CLI endpoint id (amazon-bedrock, azure,
cloudflare-workers-ai, google-vertex, openai-compatible) — 154 alias
declarations in all. Every one is a pure `export type X = Y`: an addition,
never a rename.

Six of those names were **already** the provider's wire spelling — cohere's
`ChatBody`, fish-audio's and hume's and smallest-ai's `TtsBody`, openai's
`ImageEditBody` and `RealtimeSessionBody`. There, the wire name wins and *is*
the alias; declaring a second one would be the rename the law forbids.

Generic wire types stay generic through the alias, so the escape hatches
survive: `ImageBody<"gpt-image-9">` opts into the future-model arm exactly as
`ImagesBody<"gpt-image-9">` does, and the 31 OpenAI-compatible overlays get
`ChatBody<ModelId>` defaulted to **their own** catalog union — `unmodel/xai/types`
completes Grok ids, `unmodel/groq/types` completes Groq's, from the same shared
dialect leaf their validators check against. Those overlays also surface the
chat dialect's message, content-part and tool types for the first time on their
own subpath; previously they were reachable only via
`unmodel/openai-compatible`.

**`unmodel/types` is the hub, and it is small on purpose.** It carries the
canonical camelCase vocabulary the unified surfaces speak — `ChatParams`,
`TtsParams`, `SttParams`, `ImageParams`, `ImageEditParams`, `VideoParams`,
`MusicParams`, and the words they are built from (`AspectRatio`, `AudioFormat`,
`Voice`, `Diarization`, `Dimensions`, the media input refs) — the
`"provider/model"` ref unions (`ChatModelRef`, `ChatProviderId`), the result
vocabulary (`Issue`, `ValidateResult`, `ResponseReport`, `UsageReport`,
`TranslationWarning`, `Retargeted`, `SdkTargetId`, `ApiTargetId`) and the
catalog/constraint shapes.

It does **not** aggregate provider wire types, and that is the whole design.
The 70 provider entries carry ~2,140 type exports between them; one module
naming all of them is a ~900 KB declaration file that every consumer would
have to parse to reach one interface. Per-provider entries mean
you pay for the provider you call: the hub declares ~307 KiB (against 233 KiB
for the root `unmodel` entry it extends), and the fattest provider types entry
is ~298 KiB, dominated by that provider's own generated model-id union.

**The guarantees are tested, not asserted.** `test/types-entries.test.ts` pins,
against a real build:

- **zero runtime** — every one of the 71 built entries is an empty JavaScript
  module, and every source file contains `import type` / `export type`
  statements and nothing else (under `verbatimModuleSyntax` a value import here
  would be a value import in the output);
- **completeness drift** — the endpoint list comes from `src/cli-registry.ts`,
  so a new endpoint that lands without its `<Endpoint>Body` fails the build
  rather than shipping a release behind;
- **packaging** — every entry has its `exports` subpath and its tsdown entry.

`test/import-graph.test.ts` adds amendment A8: a provider types entry may name
only its own directory, its own generated catalog and the two structural
dialect bases (`openai-compatible`, and `google` for `google-vertex`); the hub
may name no provider at all. `test/bundle-budget.test.ts` pins the declaration
budgets, including the rule that a types entry can never cost more than that
provider's main entry. `test/types/types-entries.test-d.ts` checks the aliases
resolve to the wire types they claim to be — the one thing a regex over the
source cannot see.

Runtime values are unchanged and stay where they were: URL constants, `check*`
helpers, `toFormData`, the models tables and the validators remain on
`unmodel/<provider>`, which tree-shakes to the few bytes a URL string costs.
Nothing was renamed, moved or removed.
