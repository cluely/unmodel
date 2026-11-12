---
"unmodel": minor
---

New provider: **Revana** (`unmodel/revana`, `unmodel/revana/types`) — a router that serves image, video, speech, music and language models from two dozen makers behind one key.

Nine addresses over two routes:

- `revana.video`, `revana.image`, `revana.tts`, `revana.music` — every media model, on `POST /v1/generations`. One `{ model, input }` body for all of them; `input` is typed per model from Revana's own catalog (`resolution`, `aspect_ratio`, `duration`, `quality`, `voice`, `language_code`, which media fields the model takes).
- `revana.imageEdit`, `revana.upscale`, `revana.lipsync`, `revana.avatar` — narrower views of the same route, for the models and inputs that make a request an edit, an upscale, a lip-sync or an avatar.
- `revana.chat` — the OpenAI-compatible `POST /v1/chat/completions`, with the params the endpoint refuses (`web_search_options`, `prediction`, `audio`, non-text `modalities`, non-function tools) caught before sending. `revana.checkChat` reports the charge the response itself states (`usage.cost_usd`).

The per-model surface is generated from Revana's keyless model catalog (`bun run codegen:revana`) and refreshed weekly. Every rule is one the API states about the model; refusals that depend on which route is up that day are not turned into errors, and the one that is reported (`negative_prompt`) is a warning.

Cost estimates are Revana's **listed** price — a lower bound, since a backup route can cost more — and only when the request states what it is priced by. `REVANA_PRICING_CAVEAT` says so; `POST /v1/generations/quote` (`GENERATIONS_QUOTE_URL`) answers the exact figure for free.

Also exported: `generationUrl(id)` / `generationContentUrl(id, n)` for polling and download, the `Generation` / `Quote` response types, the shape and price tables, and `REVANA_VOICES`.
