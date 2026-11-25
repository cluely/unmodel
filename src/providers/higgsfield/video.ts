/**
 * `higgsfield.video` — every Higgsfield route that answers a video.
 *
 * `POST https://api.higgsfield.ai/<endpoint>`, flat JSON body,
 * `Authorization: Key <KEY_ID>:<KEY_SECRET>`. The route id is the path:
 * `endpoint` selects it and never reaches the body (`./submit.ts`).
 *
 * ## One address, no `videoFromImage` / `videoEdit`
 *
 * Text-to-video, image-to-video, first-and-last-frame, reference-to-video,
 * motion control, clip editing and clip extension are not different wire
 * routes here. They are different KEYS on one route shape whose path is a
 * parameter, and the path's tail is not a rule: Higgsfield files
 * `alibaba/happy-horse/text-to-video` under `image2video`, and
 * `minimax/h3-lite/image-to-video` makes both of its frames optional. A
 * qualified address would have to be defined by a list. This is `fal.video`'s
 * case exactly (`src/cli-registry.ts`).
 *
 * So Higgsfield's own models (Cinema Studio, Genjutsu, Genjutsu Light) and
 * the ones it hosts (Seedance, Kling, Wan, Happy Horse, MiniMax, LTX,
 * PixVerse, MAGI-2, Grok Imagine Video) all validate here, per route, from
 * each route's own published schema (`HIGGSFIELD_VIDEO_SHAPES`).
 *
 * Things a body cannot state, and so are not checked: a source clip's
 * duration, size and pixel floors (Genjutsu trims a clip longer than 30
 * seconds; declare its length with `options.media` to have the estimate bill
 * it), and that a `preset_id` is in the live list it comes from
 * (`GENJUTSU_RESTYLE_PRESETS_URL`; only the UUID format is checked).
 *
 * The POST answers `{ status: "queued", request_id, status_url, cancel_url }`;
 * poll `status_url` and read `video` (`checkRequestStatus`).
 *
 * ```ts
 * const params = higgsfield.video({
 *   endpoint: "bytedance/seedance-2.5/text-to-video",
 *   prompt: "A fox walks through snow",
 *   resolution: "720p",
 *   duration: 5,
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import type { HiggsfieldVideoEndpointId } from "./gen/endpoints.gen";
import { HIGGSFIELD_VIDEO_ENDPOINTS } from "./gen/endpoints.gen";
import { videoModels } from "./gen/models-video.gen";
import { HIGGSFIELD_VIDEO_SHAPES } from "./gen/video-narrow.gen";
import type { HiggsfieldVideoBodyById } from "./gen/video-wire.gen";
import { createSubmitValidator } from "./submit";

export const video = createSubmitValidator<HiggsfieldVideoEndpointId, HiggsfieldVideoBodyById>({
  endpoint: "higgsfield.video",
  catalog: videoModels,
  shapes: HIGGSFIELD_VIDEO_SHAPES,
  ids: HIGGSFIELD_VIDEO_ENDPOINTS,
  elsewhere: elsewhere("higgsfield.video"),
});
