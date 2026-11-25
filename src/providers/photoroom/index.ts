/**
 * unmodel/photoroom — Photoroom's Remove Background and Image Editing APIs.
 *
 * Two routes on two HOSTS, both multipart, both `x-api-key: <PHOTOROOM_API_KEY>`:
 *
 * - `imageEdit` — `POST https://image-api.photoroom.com/v2/edit`, the Image
 *   Editing API ("Plus plan", $0.10 a call). One route for background removal,
 *   AI backgrounds, shadows, relighting, text removal, expand, uncrop, upscale,
 *   beautify, ironing, flat lay, ghost mannequin, virtual model, templating and
 *   prompt-driven edits — and "Edits can be combined in a single call".
 * - `imageEditRemoveBackground` — `POST https://sdk.photoroom.com/v1/segment`,
 *   the Remove Background API ("Basic plan", $0.02 a call): a cut-out and
 *   nothing else, with remove.bg's field names.
 *
 * The bare verb goes to `/v2/edit` because it is the provider's primary
 * editing route; the qualifier says what the other one does, as
 * `stability.imageEditRemoveBackground` does. The wire names keep Photoroom's
 * spelling — `EDIT_URL`, `SEGMENT_URL`, `EditParams`, `SegmentParams`.
 *
 * ## Four things worth knowing before your first call
 *
 * **The body is a FORM, and the keys have dots in them.** `/v2/edit` answers a
 * JSON body with `400 "Only multipart form data is supported by this
 * endpoint."`. Structure lives in the field NAME — `background.blur.radius`,
 * `virtualModel.model.preset.name` — so the params are a flat object with
 * quoted dotted keys, and `toFormData(validated)` is the body. Do not set
 * `content-type`: `fetch` derives the boundary.
 *
 * **Five features are switched by a request HEADER.** `pr-ai-shadows-model-version`
 * and four siblings (`PHOTOROOM_REQUEST_HEADERS`) appear in no schema; Photoroom
 * documents them on feature pages. `imageEdit` takes them as params under their
 * own names and hands them back on `.request.headers` — spread that next to
 * your key.
 *
 * **A typo on `/v2/edit` is billed and ignored.** The server does not refuse a
 * field it does not know: it answers 200 and lists it in the
 * `pr-unsupported-attributes` response header, which is "[Temporary] … Soon to
 * be replaced by a 400 Bad Request response" (OpenAPI, read 2026-11-24). Here
 * it is an `unknown_param` warning before the send.
 *
 * **`removeBackground` defaults to `true`.** A request that only asks for a
 * relight or an AI edit gets a cut-out of the result unless it also sends
 * `removeBackground: false` — every whole-picture example in the docs does.
 *
 * ## What comes back
 *
 * 200 is the image BYTES on both routes — no JSON envelope, no job, no polling
 * — which is why there is no response checker here. `PHOTOROOM_RESPONSE_HEADERS`
 * names the headers worth reading; there is no credits or usage header. Errors
 * are JSON in a different shape per host: `PhotoroomEditError`
 * (`{ error: { message } }`) and `PhotoroomSegmentError`
 * (`{ detail, status_code, type }`). On `/v2/edit` both 402 and 403 can mean
 * "out of credits". The default rate limit is "60 images per minute" (429).
 *
 * A key prefixed `sandbox_` makes free, watermarked calls ("1,000 per month,
 * 100 per day"). It is a property of the KEY, so nothing here models it.
 *
 * ## What is deliberately NOT here
 *
 * - **`GET /v2/edit`** — the same parameters as a query string, and the only
 *   route that takes the picture as a URL (`imageUrl`). Not addressed:
 *   `.request.method` is `"POST"` for every HTTP endpoint in this library
 *   (`src/core/request.ts`), and a body-less GET needs a request shape that
 *   does not exist. So `imageUrl` is not a field of `imageEdit`, and a picture
 *   behind a URL has to be fetched and passed as `imageFile`.
 * - **The JSON body on `/v1/segment`** (`{"image_file_b64": "…"}`) — described
 *   in the docs and absent from the OpenAPI document, with no statement of
 *   which other fields may accompany it.
 * - **`GET /v2/account` / `/v1/account`** — a balance read, not a generation.
 * - **`POST /v3/visual-qa`, `/v2/visual-qa`** — Enterprise-only JSON analysis
 *   ("requests authenticated with a non-Enterprise API key receive a 403").
 * - **`/v1/render`** — titled "[LEGACY] Image Editing v1".
 * - **The Video API, the Visual Agent API and Perspective Correction** — no
 *   endpoint or parameter is documented for any of them.
 *
 * The form-field tables under `./gen/` are GENERATED from the committed
 * OpenAPI snapshot (`data/photoroom/`, `bun run codegen:photoroom`); the
 * catalog, the checks and everything else here are hand-written. Research:
 * `docs/research/photoroom-api-2026-11-24.md`.
 */

export { imageEdit } from "./image-edit";
export type { EditParams } from "./image-edit";

export { imageEditRemoveBackground } from "./image-edit-remove-background";
export type { SegmentParams } from "./image-edit-remove-background";

export { toFormData } from "./form";

export {
  EDIT_URL,
  SEGMENT_URL,
  PHOTOROOM_OPENAPI_URL,
  PHOTOROOM_REQUEST_HEADERS,
  PHOTOROOM_RESPONSE_HEADERS,
  PHOTOROOM_AI_BACKGROUND_MODEL_VERSIONS,
  PHOTOROOM_AI_SHADOWS_MODEL_VERSIONS,
  PHOTOROOM_AI_UPSCALE_MODEL_VERSIONS,
  PHOTOROOM_HD_BACKGROUND_REMOVAL_VALUES,
  PHOTOROOM_IRONING_MODEL_VERSIONS,
  PHOTOROOM_EDIT_MAX_BYTES,
  PHOTOROOM_SEGMENT_MAX_BYTES,
  PHOTOROOM_EDIT_WITH_AI_MAX_ADDITIONAL_IMAGES,
} from "./constants";
export type {
  PhotoroomEditError,
  PhotoroomRequestHeader,
  PhotoroomRequestHeaders,
  PhotoroomResponseHeader,
  PhotoroomSegmentError,
} from "./constants";

export { PHOTOROOM_EDIT_FIELDS, PHOTOROOM_EDIT_FAMILIES } from "./gen/image-edit-fields.gen";
export { PHOTOROOM_SEGMENT_FIELDS } from "./gen/image-edit-remove-background-fields.gen";
export type {
  PhotoroomFamilyNotation,
  PhotoroomFamilySpec,
  PhotoroomFieldSpec,
  PhotoroomFieldType,
} from "./field-types";

export { models, provider, PHOTOROOM_PRICING_CAVEAT, PHOTOROOM_PRICING_SOURCE } from "./models";
export type { PhotoroomModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
