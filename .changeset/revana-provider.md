---
"unmodel": minor
---

New provider: **Revana** (`unmodel/revana`, `unmodel/revana/types`, `unmodel/revana/unified`, `unmodel/revana/values`) — a router that serves image, video, speech, music and language models from two dozen makers behind one key.

Thirteen addresses over three routes:

- `revana.video`, `revana.image`, `revana.tts`, `revana.music` — every media model, on `POST /v1/generations`. One `{ model, input }` body for all of them; `input` is typed per model from Revana's own catalog (`resolution`, `aspect_ratio`, `duration`, `quality`, `voice`, `language_code`, which media fields the model takes).
- `revana.imageEdit`, `revana.upscale`, `revana.lipsync`, `revana.avatar` — narrower views of the same route, for the models and inputs that make a request an edit, an upscale, a lip-sync or an avatar.
- `revana.videoQueue`, `revana.imageQueue`, `revana.ttsQueue`, `revana.musicQueue` — the same media models on `POST /v1/queue/revana/{model_id}`, Revana's fal-convention route and the one with completion webhooks. The params are the input fields with no `input` wrapper; `model` and `fal_webhook` are moved into `.request.url`, where that route reads them, and `fal_webhook` is checked against the URL rules the API enforces at submit (public `https:`, port 443, no credentials, no fragment, no IPv6). The per-model rules are the generation route's, plus the two fields the queue reads its own way: `num_images` only as `1`, and `duration` also as fal's `"8"` / `"8s"`.
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

```ts
import { videoQueue } from "unmodel/revana";

const body = videoQueue({
  model: "veo-3.1",
  prompt: "A fox walks through snow",
  duration: 8,
  fal_webhook: "https://your-app.example/revana",
});
body.request.url; // "https://api.revana.si/v1/queue/revana/veo-3.1?fal_webhook=https%3A%2F%2Fyour-app.example%2Frevana"
JSON.stringify(body); // {"prompt":"A fox walks through snow","duration":8}
```

What comes back is typed by its own verdict, and checked:

- `Generation` is a union on `status`: `output.urls` and a numeric `cost_usd` exist on `"succeeded"`, `error` on `"failed"`. `revana.checkGeneration` reports `status` and the charge the document states.
- On the queue route a request that failed is `COMPLETED` too. `QueueEnvelope` narrows on `error`, and `revana.checkQueueStatus` reports that outcome as `ERROR`, so `finishReason === "COMPLETED"` means it worked. `QueueResult` is `images`, `video` or `audio`, each arm ruling the others out.
- `revana.verifyWebhook({ body, headers, secret })` is the receiving end of `fal_webhook`: it checks `Revana-Signature` (HMAC-SHA256, 300-second tolerance, WebCrypto) and returns the delivery typed. It takes the raw body and the account's signing secret — not the API key — and tells a forgery (`authentic: false`) from a genuine delivery it does not recognise.

```ts
import { verifyWebhook } from "unmodel/revana";

// POST https://your-app.example/revana
const verdict = await verifyWebhook({ body: await request.text(), headers: request.headers, secret });
if (!verdict.authentic) return new Response(verdict.message, { status: 400 });
if (verdict.ok && verdict.delivery.status === "OK") save(verdict.delivery.request_id, verdict.delivery.payload);
return new Response(null, { status: 204 });
```

Also exported: `generationUrl(id)` / `generationContentUrl(id, n)` for polling and download; `queueUrl`, `queueStatusUrl`, `queueResultUrl` and `WEBHOOKS_SECRET_URL` for the queue route, with its `QueueEnvelope`, `QueueResult` and `QueueWebhookDelivery` types and the two signature header names; the `Generation` / `Quote` response types and the `RevanaErrorCode` union; the shape and price tables; and `REVANA_VOICES`.
