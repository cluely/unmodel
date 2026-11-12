/**
 * `revana.video` — every `kind: "video"` model on
 * `POST https://api.revana.si/v1/generations`.
 *
 * # One id, and no `videoFromImage`
 *
 * Revana has one POST path for every media model and `model` is a real,
 * required body field. Text-to-video, image-to-video, first-and-last-frame,
 * reference-to-video and video-to-video are not routes and not even separate
 * ids here: `veo-3.1` is one id whose `input` decides the task (`image_url`
 * makes it image-to-video). A qualified sibling would name neither a second
 * path nor a second model, so there is none — the same conclusion, for a
 * stronger reason, as `atlascloud.video` (`src/cli-registry.test.ts`).
 *
 * # The widest video surface, with two narrower views beside it
 *
 * This address types EVERY video model, the talking-avatar and lip-sync ones
 * included: they are video models on the same route and a request for one is a
 * legal request here. `revana.lipsync` and `revana.avatar` are narrower views
 * over the same route for the two unified packs that need those names; they
 * share this module's check battery and add nothing this address refuses
 * (`docs/decisions.md` §4).
 *
 * # Three input schemas
 *
 * `seedance-2.5` takes `SeedanceInput`, `nemesis` and `nemesis-lite` take
 * `NemesisInput`, and the rest take `ModelInput` narrowed by their catalog row
 * — see `./generation-wire.ts`. A known id gets its own arm at compile time: `resolution`
 * is that model's list, `duration` its seconds, and a media field its tasks do
 * not take is an error.
 *
 * # Async
 *
 * The POST answers `202` with a queued `Generation`; poll `generationUrl(id)`.
 * Auth is `Authorization: Bearer <REVANA_API_KEY>` — add it when fetching.
 *
 * ```ts
 * const params = revana.video({
 *   model: "veo-3.1",
 *   input: { prompt: "A fox walks through snow", resolution: "1080p", duration: 8, audio: true },
 *   max_cost_usd: 4,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.REVANA_API_KEY}` },
 *   body: JSON.stringify(params),
 * });
 * const { id } = await res.json(); // then poll generationUrl(id)
 * ```
 */

import { elsewhere } from "./addresses";
import { createGenerationValidator } from "./generation";
import type { RevanaVideoModelId } from "./gen/ids.gen";
import { videoModels } from "./gen/models-video.gen";
import { REVANA_VIDEO_PRICES } from "./gen/prices-video.gen";
import { REVANA_VIDEO_SHAPES } from "./gen/shapes-video.gen";

export const video = createGenerationValidator<RevanaVideoModelId>({
  endpoint: "revana.video",
  catalog: videoModels,
  shapes: REVANA_VIDEO_SHAPES,
  prices: REVANA_VIDEO_PRICES,
  elsewhere: elsewhere("revana.video"),
});
