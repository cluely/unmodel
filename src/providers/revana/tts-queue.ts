/**
 * `revana.ttsQueue` — every speech model on
 * `POST https://api.revana.si/v1/queue/revana/{model_id}`.
 *
 * The queue route runs the jobs `revana.tts` validates, through fal's HTTP
 * convention: `model` is the URL path, the body is the input fields with no
 * `{ model, input }` wrapper, and `fal_webhook` has Revana POST the outcome
 * when the job ends. The per-model rules are `revana.tts`'s — one battery,
 * the same tables (`./queue.ts`).
 *
 * The POST answers `202` with fal's envelope (`QueueEnvelope`): poll
 * `status_url`, then GET `response_url`. Auth is `Authorization: Key
 * <REVANA_API_KEY>` or `Bearer` — add it when fetching.
 *
 * ```ts
 * const body = revana.ttsQueue({
 *   model: "elevenlabs-v3",
 *   text: "The tide is out.",
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
import type { RevanaTtsModelId } from "./gen/ids.gen";
import { ttsModels } from "./gen/models-tts.gen";
import { REVANA_TTS_PRICES } from "./gen/prices-tts.gen";
import { REVANA_TTS_SHAPES } from "./gen/shapes-tts.gen";

export const ttsQueue = createQueueValidator<RevanaTtsModelId>({
  endpoint: "revana.ttsQueue",
  catalog: ttsModels,
  shapes: REVANA_TTS_SHAPES,
  prices: REVANA_TTS_PRICES,
  elsewhere: elsewhere("revana.ttsQueue"),
});
