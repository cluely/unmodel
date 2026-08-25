---
"unmodel": minor
---

**New provider: fal.ai**, and three new unified categories that arrived with it.

`unmodel/fal` covers **146 curated endpoints across nine verbs** — `image` (32),
`imageEdit` (17), `video` (30), `lipsync` (10), `upscale` (10), `avatar` (8), `tts` (23),
`stt` (6), `music` (10) — all bare ids, plus a unified adapter per category at
`unmodel/fal/unified`, wire types at `unmodel/fal/types` and runtime tables at
`unmodel/fal/values`.

Three things about fal are unlike every other provider in this package:

- **The model IS the route.** `POST https://queue.fal.run/{endpoint_id}` takes a flat JSON
  body with no model field in it, so the route selector is a pseudo-param named `endpoint`
  that is stripped in `finalize` and interpolated into the URL. It could not be `model`,
  because `model` is a genuine wire field on several fal endpoints (sync-lipsync v2, the
  Topaz and ESRGAN upscalers, Gemini TTS); codegen hard-errors on a top-level `model`
  property unless `data/fal/curation.json` allow-lists it. Unified refs are unaffected:
  `"fal/fal-ai/flux/dev"` splits on the FIRST slash, so unified callers still write `model:`.
- **`.request.url` is the queue submit.** The response is an envelope (`request_id`, `status`,
  and the `response_url` / `status_url` / `cancel_url` to follow), not a file. `unmodel/fal`
  exports `falQueueUrl` / `falSyncUrl` / `falStatusUrl` / `falResultUrl` / `falCancelUrl` and
  documents the contract, including the two traps: fal's queue declares no failure state,
  and `metadata.model_url` is the sync host rather than the submit URL. Polling stays with
  your transport code.
- **Auth is stated, never derived.** `Authorization: Key ${FAL_KEY}`. The `Key ` prefix is
  real and fal's own OpenAPI security scheme omits it, so no unmodel export builds this
  header for you.

**Types generated from the provider's own published OpenAPI.** fal serves an OpenAPI 3.0.4
document per endpoint through its documented Platform API, which makes it the first provider
where "types from docs, never SDKs" has a machine-readable source. `scripts/codegen-fal.ts`
emits `src/providers/fal/gen/` (wire interfaces, one `looseObject` union schema per category,
the per-endpoint constraint IR, unified rows and catalog rows) from per-endpoint snapshots
committed under `data/fal/openapi/`. The generator emits DATA and TYPES only: every check,
message, estimate and doc comment is hand-written beside it, and no generated file is ever
hand-edited. New commands: `codegen:fal`, `codegen:fal:refresh`, `codegen:fal:check`,
`codegen:fal:audit`, plus a weekly refresh workflow. Curation, pricing and overlays stay
hand-maintained in `data/fal/`, each row carrying a source URL, a date and a quote.

**Three new unified categories**, each a full buildout rather than an arm bolted onto an
existing one:

- **`unmodel/lipsync`** (`lipsync`, `createLipsync`) — a clip in, an audio track in, a clip
  whose mouth matches the audio out. Five canonical words (`model`, `source`, `audio`,
  `seed`, `providerOptions`) and no geometry, because the output's shape is the input's.
- **`unmodel/avatar`** (`avatar`, `createAvatar`) — the still-driven twin. The split from
  lipsync is by INPUT rather than by vendor, which is why `fal-ai/sync-lipsync/v3` and
  `fal-ai/sync-lipsync/v3/image-to-video` land in different categories. `image` is narrowed
  per model and types as `never` at the two routes whose performer is a catalogued id.
- **`unmodel/upscale`** (`upscale`, `createUpscale`) — `factor` is the one cross-vendor
  word, and it has three answers per model: a range, a closed set, or absent. The only
  category with no fixed modality: seven of the ten routes take a still and three take a
  clip, so `source` is narrowed per model and the output modality is read off each
  endpoint's own response schema.

Each ships the full set: vocabulary, kernel id and canonical keys, pack entry and package
subpath, CLI id, `unmodel/values` entries, `unmodel/types` entries and test scaffolding.
Existing packs gain fal too: `image()` now spans 17 providers, `tts()` 19, `video()` 13,
`stt()` 13, `image-edit()` 5 and `music()` 5.

**Repo rules that landed with the generated data**, and are enforced by
`test/import-graph.test.ts`:

- `src/providers/*/gen/**` is DATA: wire modules are type-only, only the schema module may
  import zod, and no generated module may reach the pipeline, request layer, validators or
  catalog.
- A `<category>-params.ts` leaf may import `./gen/<category>-params.gen.ts` and nothing else
  under `gen/`, which is what keeps zod from ending up behind a values entry.
- `src/providers/fal/gen/**` is importable only from `src/providers/fal/**`, and the merged
  `models.ts` catalog only from `index.ts` — asserted explicitly, because the same-directory
  rule cannot catch a sibling import.
- The SPLIT provider set (providers whose adapters are one file per category) is now
  **derived from disk** rather than listed, so a newly split provider cannot silently skip
  its per-category budgets.
- Every pack now carries a `.d.ts` declaration budget alongside its bundle budget.

**Not yet:** `.toApi("fal")`. Retargeting a first-party media request onto fal's queue needs
a media retarget layer that does not exist today (chat only), and `EndpointAuth.scheme` has
no `"Key"` arm.
