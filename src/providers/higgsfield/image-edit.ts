/**
 * `higgsfield.imageEdit` — the image routes that take a picture to edit.
 *
 * A narrower VIEW of `higgsfield.image`, not a second endpoint: the URL, the
 * body and the check battery are the same (`docs/decisions.md` §4). What the
 * view adds is the two things that make a request an edit —
 *
 * - the route must be one Higgsfield files under `image_edit`
 *   (`HIGGSFIELD_IMAGE_EDIT_ENDPOINTS`). `higgsfield/ai-influencer` is filed
 *   there too and is NOT in the view: its optional `image_url` is an identity
 *   photo for a generated character sheet, not a picture being edited
 *   (`data/higgsfield/curation.json`);
 * - the request must carry the picture: `image_url` or `image_urls`,
 *   whichever the route declares. Several of these routes also generate from
 *   text alone (Marketing Studio, Ideogram 4.0, Grok Imagine Image), and a
 *   request without a picture is that.
 *
 * — and it exists so `unmodel/image-edit` reaches Higgsfield through a file
 * with the uniform name. Everything this view refuses, `higgsfield.image`
 * validates.
 *
 * The source is a URL Higgsfield fetches; no route takes bytes
 * (`FILES_GENERATE_UPLOAD_URL`). No route has a denoise or `strength` field,
 * and none takes a mask.
 *
 * ```ts
 * const params = higgsfield.imageEdit({
 *   endpoint: "alibaba/qwen-image-3/edit",
 *   prompt: "Make the jacket red",
 *   image_urls: ["https://example.com/portrait.png"],
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import type { HiggsfieldImageEditEndpointId } from "./gen/endpoints.gen";
import { HIGGSFIELD_IMAGE_EDIT_ENDPOINTS } from "./gen/endpoints.gen";
import { HIGGSFIELD_IMAGE_SHAPES } from "./gen/image-narrow.gen";
import type { HiggsfieldImageEditBodyById } from "./gen/image-wire.gen";
import { imageModels } from "./gen/models-image.gen";
import { createSubmitValidator } from "./submit";

export const imageEdit = createSubmitValidator<HiggsfieldImageEditEndpointId, HiggsfieldImageEditBodyById>({
  endpoint: "higgsfield.imageEdit",
  catalog: imageModels,
  shapes: HIGGSFIELD_IMAGE_SHAPES,
  ids: HIGGSFIELD_IMAGE_EDIT_ENDPOINTS,
  view: {
    does: "edit a picture",
    wide: "higgsfield.image",
    needsOneOf: ["image_url", "image_urls"],
  },
  elsewhere: elsewhere("higgsfield.image"),
});
