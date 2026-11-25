/**
 * Photoroom's fixed facts — URLs, the feature headers, the byte limits and the
 * shapes of what comes back — on an **import-free** leaf.
 *
 * Kept apart from `./shared.ts` (which builds a zod schema and the check
 * battery) for the reason `stability/constraints.ts` exists: a caller who wants
 * one URL or one header name should not pay for a validator.
 *
 * Sources, all read 2026-11-24:
 *   https://image-api.photoroom.com/openapi                                              (paths, hosts, response headers, error schemas)
 *   https://docs.photoroom.com/getting-started/integrating-with-claude-code-codex-or-cursor.md   (the feature headers — none is in the OpenAPI document)
 *   https://docs.photoroom.com/image-editing-api-plus-plan/file-size-resolution-and-format.md
 *   https://docs.photoroom.com/remove-background-api-basic-plan/file-size-resolution-and-format.md
 */

/** The OpenAPI document both routes are typed from. Snapshotted at `data/photoroom/openapi.json`. */
export const PHOTOROOM_OPENAPI_URL = "https://image-api.photoroom.com/openapi";

/** `POST /v2/edit` — the Image Editing API ("Plus plan"). */
export const EDIT_URL = "https://image-api.photoroom.com/v2/edit";

/**
 * `POST /v1/segment` — the Remove Background API ("Basic plan"). A different
 * HOST from {@link EDIT_URL}, not just a different path.
 */
export const SEGMENT_URL = "https://sdk.photoroom.com/v1/segment";

// ---------------------------------------------------------------------------
// Request headers that select behaviour
// ---------------------------------------------------------------------------

/**
 * The five request headers that select a model or a mode on `POST /v2/edit`.
 *
 * "These are headers on the HTTP request, not parameters in the body or query
 * string" — and none of them is declared in the OpenAPI document; each is
 * documented on its feature page. `photoroom.imageEdit` takes them as params
 * under these exact names and moves them onto `.request.headers`.
 */
export const PHOTOROOM_REQUEST_HEADERS = [
  "pr-ai-background-model-version",
  "pr-ai-shadows-model-version",
  "pr-hd-background-removal",
  "pr-ai-upscale-model-version",
  "pr-ironing-model-version",
] as const;
export type PhotoroomRequestHeader = (typeof PHOTOROOM_REQUEST_HEADERS)[number];

/**
 * "Values: 3 (current default), background-studio-beta-2025-03-17 (recommended:
 * more photorealistic, better textures and props, a bit slower), 2 (deprecated;
 * the only model that honours background.negativePrompt)." — the agent prompt
 * linked in this file's header; the same three identifiers are listed on
 * https://docs.photoroom.com/image-editing-api-plus-plan/ai-backgrounds.md
 */
export const PHOTOROOM_AI_BACKGROUND_MODEL_VERSIONS = [
  "3",
  "background-studio-beta-2025-03-17",
  "2",
] as const;

/**
 * "add the HTTP header `pr-ai-shadows-model-version: 2026-04-15` to your API call"
 * https://docs.photoroom.com/image-editing-api-plus-plan/ai-shadows.md
 */
export const PHOTOROOM_AI_SHADOWS_MODEL_VERSIONS = ["2026-04-15"] as const;

/**
 * "To enable the feature, add this HTTP header to your API call:
 * `pr-hd-background-removal: auto`"
 * https://docs.photoroom.com/image-editing-api-plus-plan/hd-background-removal.md
 */
export const PHOTOROOM_HD_BACKGROUND_REMOVAL_VALUES = ["auto"] as const;

/**
 * "To test the new `ai.fast` model, additionally set the HTTP header
 * `pr-ai-upscale-model-version` to `ai-upscale-2025-07-29`"
 * https://docs.photoroom.com/image-editing-api-plus-plan/preview-ai-upscale.md
 */
export const PHOTOROOM_AI_UPSCALE_MODEL_VERSIONS = ["ai-upscale-2025-07-29"] as const;

/**
 * "To iron clothing in an image: 1. set the parameter `ironing.mode` to
 * `ai.auto` 2. add the HTTP header `pr-ironing-model-version: v2`"
 * https://docs.photoroom.com/image-editing-api-plus-plan/ai-ironing.md
 */
export const PHOTOROOM_IRONING_MODEL_VERSIONS = ["v2"] as const;

/**
 * The feature headers as params. Mirror the header names exactly.
 *
 * Every value is open (`| (string & {})`): Photoroom publishes the values it
 * documents today, not a closed list, and a model version it ships tomorrow
 * must not be a type error here.
 */
export interface PhotoroomRequestHeaders {
  /** Selects the AI Backgrounds model used with `background.prompt`. */
  "pr-ai-background-model-version"?:
    | (typeof PHOTOROOM_AI_BACKGROUND_MODEL_VERSIONS)[number]
    | (string & {});
  /**
   * Selects the new AI Shadows model. "Required to use
   * shadow.mode=ai.auto-with-overrides and the shadow.*Override parameters …
   * Without this header, only the legacy modes ai.soft | ai.hard | ai.floating
   * work; with it, use ai.auto-with-overrides, ai.preset-soft or ai.preset-hard."
   */
  "pr-ai-shadows-model-version"?:
    | (typeof PHOTOROOM_AI_SHADOWS_MODEL_VERSIONS)[number]
    | (string & {});
  /** HD Background Removal, "recommended for high-resolution inputs (≥ 2K)". */
  "pr-hd-background-removal"?:
    | (typeof PHOTOROOM_HD_BACKGROUND_REMOVAL_VALUES)[number]
    | (string & {});
  /** "early access to the newer model for upscale.mode=ai.fast". */
  "pr-ai-upscale-model-version"?:
    | (typeof PHOTOROOM_AI_UPSCALE_MODEL_VERSIONS)[number]
    | (string & {});
  /** The new AI Ironing model; the feature page makes it part of the `ironing.mode` recipe. */
  "pr-ironing-model-version"?: (typeof PHOTOROOM_IRONING_MODEL_VERSIONS)[number] | (string & {});
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MEBIBYTE = 1024 * 1024;

/**
 * "Maximum File Size: 30MB" on `/v2/edit`.
 *
 * Read as binary megabytes: the page does not say which, and the larger
 * reading is the one that cannot refuse a file the API accepts.
 */
export const PHOTOROOM_EDIT_MAX_BYTES = 30 * MEBIBYTE;

/** "Maximum File Size: 50MB" on `/v1/segment` — binary megabytes, as above. */
export const PHOTOROOM_SEGMENT_MAX_BYTES = 50 * MEBIBYTE;

/**
 * "up to 5 total images per request, including the main input image. In
 * practice, this means you can provide up to 4 additional reference images
 * via `editWithAI.additionalImages.*`."
 * https://docs.photoroom.com/image-editing-api-plus-plan/edit-with-ai.md
 */
export const PHOTOROOM_EDIT_WITH_AI_MAX_ADDITIONAL_IMAGES = 4;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * The response headers a 200 can carry (OpenAPI `responses.200.headers`).
 *
 * - `x-uncertainty-score` — both routes. "a number between 0 and 1. 0 means the
 *   model is very confident that the cutout is accurate, 1 means the model is
 *   unsure … If an image contains humans, it will return the value -1."
 * - `pr-ai-background-seed` — `/v2/edit`. "the seed used when generating the
 *   background".
 * - `pr-texts-detected` — `/v2/edit`. "When removing texts from an image, it
 *   will return the number of texts detected."
 * - `pr-unsupported-attributes` — `/v2/edit`. "[Temporary] If the request
 *   contains attributes that are not supported by the API, this header will be
 *   returned with a list of the unsupported attributes. Soon to be replaced by
 *   a 400 Bad Request response."
 *
 * There is no credits or usage header on either route.
 */
export const PHOTOROOM_RESPONSE_HEADERS = [
  "x-uncertainty-score",
  "pr-ai-background-seed",
  "pr-texts-detected",
  "pr-unsupported-attributes",
] as const;
export type PhotoroomResponseHeader = (typeof PHOTOROOM_RESPONSE_HEADERS)[number];

/**
 * An error body from `image-api.photoroom.com` (`/v2/edit`), at every status
 * the host answers: 400, 401, 402, 403, 500.
 *
 * 402 AND 403 both mean "out of credits or not allowed": the OpenAPI document
 * declares 402 ("API credits exhausted. …"), while the docs describe a zero
 * balance as `403 {"error":{"message":"Unauthorized"}}`.
 */
export interface PhotoroomEditError {
  error: { message: string };
}

/**
 * An error body from `sdk.photoroom.com` (`/v1/segment`) — a different shape
 * from {@link PhotoroomEditError}, because it is a different host. `type` is a
 * code such as `"missing_image"` or `"invalid_image"`.
 */
export interface PhotoroomSegmentError {
  detail: string;
  status_code: number;
  type: string;
}
