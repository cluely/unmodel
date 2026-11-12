---
"unmodel": minor
---

New provider: **Revana** (`unmodel/revana`, `unmodel/revana/types`, `unmodel/revana/unified`, `unmodel/revana/values`) — a router that serves image, video, speech, music and language models from two dozen makers behind one key.

Nine addresses over two routes:

- `revana.video`, `revana.image`, `revana.tts`, `revana.music` — every media model, on `POST /v1/generations`. One `{ model, input }` body for all of them; `input` is typed per model from Revana's own catalog (`resolution`, `aspect_ratio`, `duration`, `quality`, `voice`, `language_code`, which media fields the model takes).
- `revana.imageEdit`, `revana.upscale`, `revana.lipsync`, `revana.avatar` — narrower views of the same route, for the models and inputs that make a request an edit, an upscale, a lip-sync or an avatar.
- `revana.chat` — the OpenAI-compatible `POST /v1/chat/completions`, with the params the endpoint refuses (`web_search_options`, `prediction`, `audio`, non-text `modalities`, non-function tools) caught before sending. `revana.checkChat` reports the charge the response itself states (`usage.cost_usd`).

The per-model surface is generated from Revana's keyless model catalog (`bun run codegen:revana`) and refreshed weekly. Every rule is one the API states about the model; refusals that depend on which route is up that day are not turned into errors, and the one that is reported (`negative_prompt`) is a warning.

Cost estimates are Revana's **listed** price — a lower bound, since a backup route can cost more — and only when the request states what it is priced by. `REVANA_PRICING_CAVEAT` says so; `POST /v1/generations/quote` (`GENERATIONS_QUOTE_URL`) answers the exact figure for free.

`revana/<model>` is also a ref in eight category packs — `unmodel/video` (69 models), `unmodel/image` (56), `unmodel/image-edit` (46), `unmodel/tts` (4), `unmodel/avatar` (4), `unmodel/lipsync`, `unmodel/upscale` and `unmodel/music` (one each) — with per-model narrowing generated from the same catalog and published on `unmodel/revana/values`:

```ts
import { video } from "unmodel/video";

video({ model: "revana/veo-3.1", prompt: "A fox walks through snow", duration: 8, resolution: "4k", audio: true });
// → { model: "veo-3.1", input: { prompt: "…", duration: 8, resolution: "4K", audio: true } }
```

Things to know before reaching for one:

- Every media reference must be a public `https://` URL. Inline bytes are refused, naming `POST /v1/uploads` (`UPLOADS_URL`).
- A canonical size tier maps to a model's resolution only when it is the same word (`"4k"` → `"4K"`). Sizes Revana spells its own way (`2K` on a video model, `1MP` on a picture one) go through `providerOptions.revana.input.resolution`.
- `unmodel/music` needs the `style` or `lyrics` extra at Revana: a prompt alone is not a request its API takes.
- No Revana model takes `outputFormat`; `unmodel/upscale` takes a still and no `factor`; a speech `dialogue` is `revana.tts`'s, not `unmodel/tts`'s.

Also exported: `generationUrl(id)` / `generationContentUrl(id, n)` for polling and download, the `Generation` / `Quote` response types, the shape and price tables, and `REVANA_VOICES`.
