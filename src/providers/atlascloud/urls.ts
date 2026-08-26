/**
 * Atlas Cloud's URLs, and nothing else.
 *
 * **Import-free on purpose.** Everything here is a string or a function over
 * strings, so a caller who wants only the route — to poll a prediction, to
 * upload a file, to refresh a schema snapshot — pays a few bytes rather than
 * the validator, its zod schema and the catalog.
 *
 * Verified live 2026-08-26 against
 * https://www.atlascloud.ai/docs/models/video (the video API reference) and
 * https://www.atlascloud.ai/docs/upload-files (the media upload page):
 *
 * > **Base URL:** `https://api.atlascloud.ai/api/v1`
 * > Video Generation: `/model/generateVideo`
 * > Upload Media: `/model/uploadMedia`
 * > Check Status: `/model/prediction/{prediction_id}` (GET)
 *
 * Auth is `Authorization: Bearer <ATLASCLOUD_API_KEY>` — Atlas's own model-page
 * sample is literally `-H "Authorization: Bearer $ATLASCLOUD_API_KEY"`
 * (https://www.atlascloud.ai/models/bytedance/seedance-2.5/reference-to-video,
 * read 2026-08-26), while the docs site writes the same header with a
 * placeholder key. unmodel never touches credentials: add the header yourself.
 *
 * ## Three routes for nine verbs, and one of them is ours
 *
 * Atlas serves ALL media generation from exactly three POST paths —
 * `/model/generateVideo`, `/model/generateImage`, `/model/generateAudio` — and
 * the body's `model` field picks the model. unmodel serves the video route
 * only (see ./models.ts for the roster and the recorded scope).
 *
 * ## The polling path has two documented spellings
 *
 * Atlas's per-model OpenAPI documents disagree with each other about where a
 * submitted job is read back from. The Seedance 2.x, Wan 3.0 and MiniMax
 * schemas declare `GET /api/v1/model/prediction/{request_id}`; the Seedance
 * v1.5 pro and Veo 3.1 schemas declare `GET /api/v1/model/result/{request_id}`
 * for the same envelope. The docs site documents only the first. Both are
 * exported rather than picked, because guessing which one a given model
 * answers on is exactly the kind of silent wrong turn a URL helper exists to
 * prevent — {@link predictionUrl} is the documented default and
 * {@link resultUrl} is the spelling those five schemas use.
 *
 * Polling itself is transport and stays out of unmodel's scope, the same call
 * `bytedance`, `minimax` and `vidu` make for their create-then-poll routes.
 */

/** `https://api.atlascloud.ai/api/v1` — every Atlas media route hangs off this. */
export const ATLASCLOUD_BASE_URL = "https://api.atlascloud.ai/api/v1";

/** `POST` — the one video-generation route; `model` in the body selects the model. */
export const GENERATE_VIDEO_URL = `${ATLASCLOUD_BASE_URL}/model/generateVideo`;

/** `POST` — multipart `file` upload; answers `{ url }` with a temporary URL. */
export const UPLOAD_MEDIA_URL = `${ATLASCLOUD_BASE_URL}/model/uploadMedia`;

/**
 * `POST /api/v1/model/uploadMedia`.
 *
 * "Use uploaded file URLs within the same session. Do not rely on them for
 * long-term storage." — https://www.atlascloud.ai/docs/upload-files
 */
export function uploadMediaUrl(): string {
  return UPLOAD_MEDIA_URL;
}

/**
 * `GET /api/v1/model/prediction/{request_id}` — the documented status route.
 *
 * "Video generation is asynchronous. Use the prediction ID to poll for
 * results" (https://www.atlascloud.ai/docs/models/video). The POST answers
 * `{ code, message, data: { id, status, outputs } }`; poll this until `status`
 * leaves `processing`.
 */
export function predictionUrl(id: string): string {
  return `${ATLASCLOUD_BASE_URL}/model/prediction/${encodeURIComponent(id)}`;
}

/**
 * `GET /api/v1/model/result/{request_id}` — the same read-back, spelled the
 * way the Seedance v1.5 pro and Veo 3.1 schemas spell it. See the module
 * docstring: this is a documented disagreement inside Atlas's own OpenAPI set,
 * not a second API.
 */
export function resultUrl(id: string): string {
  return `${ATLASCLOUD_BASE_URL}/model/result/${encodeURIComponent(id)}`;
}

/**
 * `GET https://api.atlascloud.ai/api/v1/models` — the keyless media catalog
 * (473 rows on 2026-08-26). `scripts/atlascloud-audit.ts` diffs it against
 * `data/atlascloud/curation.json`.
 */
export const MODELS_CATALOG_URL = `${ATLASCLOUD_BASE_URL}/models`;

/** Where a model's OpenAPI document lives: the id with `/` replaced by `-`. */
export function modelSchemaUrl(modelId: string): string {
  return `https://static.atlascloud.ai/model/schema/${modelId.replace(/\//g, "-")}.json`;
}
