/**
 * `higgsfield.image` — every Higgsfield route that answers images.
 *
 * `POST https://api.higgsfield.ai/<endpoint>`, flat JSON body,
 * `Authorization: Key <KEY_ID>:<KEY_SECRET>`. The route id is the path:
 * `endpoint` selects it and never reaches the body (`./submit.ts`).
 *
 * The widest picture surface: Higgsfield's own models (Soul, Soul 2,
 * Marketing Studio, Ads Studio, AI Influencer) and the ones it hosts
 * (Seedream, Qwen Image, Kling Image, Recraft, Ideogram, Grok Imagine,
 * Z-Image), text-to-image and editing alike. Several routes are both — a
 * Marketing Studio or Ideogram request with a source picture IS an edit — so
 * all of them validate here, and `higgsfield.imageEdit` is a narrower view
 * over the same route and the same check battery (`docs/decisions.md` §4).
 *
 * Per route, from its own published schema: the parameters it declares, their
 * vocabularies and bounds, its cross-field rules, and whether it refuses an
 * undeclared key. Nothing is shared between routes but the transport —
 * `resolution` is `720p | 1080p` on Soul and `1k | 2k | 4k` on Marketing
 * Studio — which is why the checks live in rows (`HIGGSFIELD_IMAGE_SHAPES`).
 *
 * Things a body cannot state, and so are not checked: that a `style_id` or
 * `preset_id` is in the live list it comes from (`SOUL_STYLES_URL`,
 * `MARKETING_STUDIO_IMAGE_PRESETS_URL`; only the UUID format is checked), and
 * that a `custom_reference_id` is a completed Soul ID of the matching
 * `model_version`.
 *
 * The POST answers `{ status: "queued", request_id, status_url, cancel_url }`;
 * poll `status_url` and read `images[]` (`checkRequestStatus`).
 *
 * ```ts
 * const params = higgsfield.image({
 *   endpoint: "higgsfield-ai/soul/standard",
 *   prompt: "Editorial portrait in soft daylight",
 *   resolution: "1080p",
 *   batch_size: 4,
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import type { HiggsfieldImageEndpointId } from "./gen/endpoints.gen";
import { HIGGSFIELD_IMAGE_ENDPOINTS } from "./gen/endpoints.gen";
import { HIGGSFIELD_IMAGE_SHAPES } from "./gen/image-narrow.gen";
import type { HiggsfieldImageBodyById } from "./gen/image-wire.gen";
import { imageModels } from "./gen/models-image.gen";
import { createSubmitValidator } from "./submit";

export const image = createSubmitValidator<HiggsfieldImageEndpointId, HiggsfieldImageBodyById>({
  endpoint: "higgsfield.image",
  catalog: imageModels,
  shapes: HIGGSFIELD_IMAGE_SHAPES,
  ids: HIGGSFIELD_IMAGE_ENDPOINTS,
  elsewhere: elsewhere("higgsfield.image"),
});
