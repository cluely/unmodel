/**
 * `revana.musicQueue` — every music model on
 * `POST https://api.revana.si/v1/queue/revana/{model_id}`.
 *
 * The queue route runs the jobs `revana.music` validates, through fal's HTTP
 * convention: `model` is the URL path, the body is the input fields with no
 * `{ model, input }` wrapper, and `fal_webhook` has Revana POST the outcome
 * when the job ends. The per-model rules are `revana.music`'s — one battery,
 * the same tables (`./queue.ts`).
 *
 * The POST answers `202` with fal's envelope (`QueueEnvelope`): poll
 * `status_url`, then GET `response_url`. Auth is `Authorization: Key
 * <REVANA_API_KEY>` or `Bearer` — add it when fetching.
 *
 * ```ts
 * const body = revana.musicQueue({
 *   model: "suno-v6",
 *   prompt: "A song about low tide",
 *   style: "indie folk, warm vocals",
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
import type { RevanaMusicModelId } from "./gen/ids.gen";
import { musicModels } from "./gen/models-music.gen";
import { REVANA_MUSIC_PRICES } from "./gen/prices-music.gen";
import { REVANA_MUSIC_SHAPES } from "./gen/shapes-music.gen";

export const musicQueue = createQueueValidator<RevanaMusicModelId>({
  endpoint: "revana.musicQueue",
  catalog: musicModels,
  shapes: REVANA_MUSIC_SHAPES,
  prices: REVANA_MUSIC_PRICES,
  elsewhere: elsewhere("revana.musicQueue"),
});
