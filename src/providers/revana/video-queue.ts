/**
 * `revana.videoQueue` — every `kind: "video"` model on
 * `POST https://api.revana.si/v1/queue/revana/{model_id}`.
 *
 * The queue route runs the jobs `revana.video` validates, through fal's HTTP
 * convention: `model` is the URL path, the body is the input fields with no
 * `{ model, input }` wrapper, and `fal_webhook` has Revana POST the outcome
 * when the job ends. The per-model rules are `revana.video`'s — one battery,
 * the same tables (`./queue.ts`).
 *
 * The POST answers `202` with fal's envelope (`QueueEnvelope`): poll
 * `status_url`, then GET `response_url`. Auth is `Authorization: Key
 * <REVANA_API_KEY>` or `Bearer` — add it when fetching.
 *
 * ```ts
 * const body = revana.videoQueue({
 *   model: "veo-3.1",
 *   prompt: "A fox walks through snow",
 *   resolution: "1080p",
 *   duration: 8,
 *   audio: true,
 *   max_cost_usd: 4,
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
import type { RevanaVideoModelId } from "./gen/ids.gen";
import { videoModels } from "./gen/models-video.gen";
import { REVANA_VIDEO_PRICES } from "./gen/prices-video.gen";
import { REVANA_VIDEO_SHAPES } from "./gen/shapes-video.gen";

export const videoQueue = createQueueValidator<RevanaVideoModelId>({
  endpoint: "revana.videoQueue",
  catalog: videoModels,
  shapes: REVANA_VIDEO_SHAPES,
  prices: REVANA_VIDEO_PRICES,
  elsewhere: elsewhere("revana.videoQueue"),
});
