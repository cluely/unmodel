# Hand-maintained catalogs

Some providers (speech, image, video vendors) are absent from models.dev, so
they cannot get a generated `src/catalog/<id>.gen.ts`. Those providers keep a
hand-written `models.ts` colocated with their validator instead.

There are three kinds of catalog in this repo, and it is worth being explicit
about which one a `models.ts` is:

1. **Generated from models.dev** — `src/catalog/<id>.gen.ts`, emitted by
   `scripts/codegen.ts` from `data/models-dev.json`. Nothing here is hand-edited.
2. **Hand-written** — a `models.ts` beside the validator, for a provider
   models.dev does not carry. Every row is a human reading a pricing page. The
   rules below are about this kind.
3. **Generated from the provider's own published OpenAPI (fal)** — rows are
   emitted by `scripts/codegen-fal.ts` from the per-endpoint snapshots committed
   under `data/fal/openapi/`, into `src/providers/fal/gen/models-<verb>.gen.ts`,
   and merged for the catalog export by `src/providers/fal/models.ts`. The
   generator is what keeps the SHAPE honest; the parts a schema cannot state are
   still hand-maintained in `data/fal/` and are what the provenance header cites:
   `curation.json` (which endpoints, under which verb, why the excluded ones are
   excluded), `pricing.json` (every rate transcribed from the public model page
   with its URL, date and exact quote), `overlays.json` (every deviation from
   fal's schema, each needing a reason, a source and a verification date). A
   curated endpoint with neither a rate nor an `unpriced` reason fails codegen.
   No generated file is ever hand-edited: a wrong row is fixed in `data/fal/`.

Rules for kind 2, identical to the codegen contract:

- `export const models = { ... } as const satisfies Record<string, ModelInfo>;`
  and id unions derived from it (`export type FooModelId = keyof typeof models;`).
- Header comment at the top of the file:
  `// Hand-maintained — <provider> is not in models.dev; refresh from <pricing/docs URLs>.`
  Keep the refresh URLs current — they are the file's provenance.
- `limit.context: 0` for non-token models (TTS/STT/image/video) — the
  pipeline skips context-window checks when `context` is 0.
- Media pricing lives on `ModelCost`: `perMillionCharacters` (TTS input),
  `perAudioMinute` (STT), `perImage`, `perVideoSecond`. TTS input caps live on
  `ModelLimit.characters`. Cost helpers: `computeCharacterCostUSD` /
  `computeAudioMinutesCostUSD` in `src/core/cost.ts`.
- **Synthetic ids** — a validator whose wire has NO model field still needs a
  catalog address (the unified `"provider/model"` ref, `unknown_model`, and
  every catalog-keyed check hang off one). The id names the documented mode
  when the wire has one (`elevenlabs/ivc` — Instant Voice Cloning, reserving
  `pvc`; `fish-audio/fast` — the `train_mode` const), and the route noun when
  it does not (`cartesia/voice-clone`, `inworld/voice-design`, …). Every
  synthetic row carries a comment saying it is synthetic and which route it
  addresses, and the validator pins it via `modelId: () => "<id>"`.
