/**
 * `revana.imageQueue` — every `kind: "image"` model on
 * `POST https://api.revana.si/v1/queue/revana/{model_id}`.
 *
 * The queue route runs the jobs `revana.image` validates, through fal's HTTP
 * convention: `model` is the URL path, the body is the input fields with no
 * `{ model, input }` wrapper, and `fal_webhook` has Revana POST the outcome
 * when the job ends. The per-model rules are `revana.image`'s — one battery,
 * the same tables (`./queue.ts`).
 *
 * The POST answers `202` with fal's envelope (`QueueEnvelope`): poll
 * `status_url`, then GET `response_url`. Auth is `Authorization: Key
 * <REVANA_API_KEY>` or `Bearer` — add it when fetching.
 *
 * ```ts
 * const body = revana.imageQueue({
 *   model: "nano-banana-pro",
 *   prompt: "A red paper kite over a grey sea",
 *   resolution: "2K",
 *   fal_webhook: "https://your-app.example/revana",
 * });
 * const res = await fetch(body.request.url, {
 *   method: body.request.method,
 *   headers: { ...body.request.headers, authorization: `Key ${process.env.REVANA_API_KEY}` },
 *   body: JSON.stringify(body), // no `model`, no `fal_webhook`: both are in the URL
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import { createQueueValidator } from "./queue";
import type { RevanaImageModelId } from "./gen/ids.gen";
import { imageModels } from "./gen/models-image.gen";
import { REVANA_IMAGE_PRICES } from "./gen/prices-image.gen";
import { REVANA_IMAGE_SHAPES } from "./gen/shapes-image.gen";

export const imageQueue = createQueueValidator<RevanaImageModelId>({
  endpoint: "revana.imageQueue",
  catalog: imageModels,
  shapes: REVANA_IMAGE_SHAPES,
  prices: REVANA_IMAGE_PRICES,
  elsewhere: elsewhere("revana.imageQueue"),
});
