/**
 * unmodel/heygen — HeyGen's v3 generation API.
 *
 * `https://api.heygen.com/v3`, JSON bodies, `x-api-key: <HEYGEN_API_KEY>`.
 *
 * ## What is here
 *
 * The two generation routes, one address each:
 *
 * - `avatar` — `POST /v3/videos`. A performance INVENTED for a face: either a
 *   catalogued look from your workspace (`type: "avatar"`, `avatar_id`) or a
 *   picture you supply (`type: "image"`, `image`). Three engines —
 *   `avatar_iii`, `avatar_iv` (the default), `avatar_v` — which are what this
 *   provider catalogs, because HeyGen has no `model` field and the three are
 *   three products with three pages and a four-fold price spread.
 * - `lipsync` — `POST /v3/lipsyncs`. A performance PRESERVED: a clip and a new
 *   track, with `mode: "speed" | "precision"` deciding quality and price.
 *   unmodel catalogs those two as `lipsync-speed` and `lipsync-precision`,
 *   after HeyGen's own doc slugs.
 *
 * ## Two traps this provider exists to have already walked into
 *
 * **HeyGen serves two OpenAPI documents and both answer 200.**
 * `developers.heygen.com/openapi.yaml` is a v4.0.8 document with 52 v1/v2 paths
 * and NO `/v3/videos`; `developers.heygen.com/openapi/external-api.json` is the
 * current one, 98 paths and 300 schemas. Everything here comes from the second.
 *
 * **`docs.heygen.com` is gone and its slugs did not survive.** It 301s to
 * `developers.heygen.com`, where the old `/reference/create-an-avatar-video-v2`
 * 404s; the live page is `/reference/create-video`. Every URL in this provider
 * was re-resolved by fetching it.
 *
 * ## What is deliberately NOT here
 *
 * **`POST /v3/voices/speech` — text to speech.** The closest call in the
 * provider, and an exclusion: there is no model id on the wire (the engine is
 * fixed to Starfish and is stated only in prose), `voice_id` is an
 * account-scoped handle from `GET /v3/voices` with no published roster,
 * `input_type` is typed as a bare `string`, and there is no format, sample rate
 * or codec control at all. A `heygen.tts` would be a row that narrows nothing —
 * a me-too entry that widens the tts matrix without telling a caller anything.
 * It joins the day HeyGen publishes a voice roster or a second engine.
 *
 * **`type: "cinematic_avatar"` and `type: "studio"`** on the video route. The
 * first is a prompt-to-video model (4–15s, $7.00 flat, Seedance-backed) whose
 * required fields are a `prompt` and an ARRAY of look ids and which takes no
 * audio at all — a video model wearing an avatar route's URL. The second is a
 * `scenes` array of up to 50: a timeline document rather than a generation
 * request.
 *
 * **Translation, background removal, HyperFrames, AI clipping, filler-word
 * removal** — five more real, priced products, none of which matches a category
 * unmodel has. And the platform surface (avatars, looks, voices, assets, brand
 * kits, glossaries, folders, webhooks, templates, workflows, podcasts, video
 * agents, realtime streaming, batches, bulk statuses) — it mints and lists the
 * ids a generation request names, which unmodel types, and generates nothing.
 *
 * `src/providers/heygen/models.ts` carries the reason for each, one by one.
 *
 * ## Five things worth knowing before your first call
 *
 * **There is no `model` field on either route.** `engine` on the video route,
 * `mode` on the lipsync route — both optional, both with a server-side default
 * that is also a price. unmodel writes both out explicitly on every unified
 * call for exactly that reason.
 *
 * **`type` decides which visual source is required.** `"avatar"` needs
 * `avatar_id` and refuses `image`; `"image"` needs `image` and refuses
 * `avatar_id`. Both arms are `additionalProperties: false`, so the wrong field
 * is a 400 — HeyGen's own documented example error is that mistake.
 *
 * **`avatar_id` is account-scoped and unpublishable.** It is a look you trained
 * ($1.00 per Digital Twin) or a curated one your workspace can reach, listed at
 * `GET /v3/avatars/looks`. There is no global roster, which is why it is typed
 * as a `string` and why `unmodel/avatar` compiles the raw-image arm instead.
 *
 * **The two routes have DIFFERENT status enums.** `pending → processing →
 * completed | failed` for a video; `pending → running → completed | failed` for
 * a lipsync. One vendor, two lifecycles.
 *
 * **`Idempotency-Key` is worth setting on both POSTs.** 1–255 characters, a
 * 24-hour replay window, and a 409 `request_in_progress` for a retry that
 * overlaps the original. Renders are billed by the second.
 *
 * ## Versions
 *
 * v1 and v2 endpoints are supported until **October 31, 2026**
 * (`HEYGEN_V1_V2_SUNSET`). This provider types v3 exclusively; nothing here is
 * modelled on `POST /v2/video/generate`.
 */

export { avatar, avatarConstraints, HEYGEN_VIDEO_TYPES } from "./avatar";
export type { HeygenAvatarParams, HeygenVideoType } from "./avatar";

export { lipsync, lipsyncConstraints, DEFAULT_LIPSYNC_MODE } from "./lipsync";
export type { HeygenLipsyncParams } from "./lipsync";

export {
  AVATAR_LOOKS_URL,
  DOCS_BASE,
  HEYGEN_ASPECT_RATIOS,
  HEYGEN_BACKGROUND_TYPES,
  HEYGEN_BASE_URL,
  HEYGEN_CAPTION_FILE_FORMATS,
  HEYGEN_CAPTION_STYLES,
  HEYGEN_DEFAULT_ENGINE,
  HEYGEN_ELEVENLABS_MODELS,
  HEYGEN_ENGINES,
  HEYGEN_EXPRESSIVENESS,
  HEYGEN_EXPRESSIVENESS_ENGINES,
  HEYGEN_FISH_MODELS,
  HEYGEN_FITS,
  HEYGEN_FPS_MODES,
  HEYGEN_HEADERS,
  HEYGEN_IDEMPOTENCY_HEADER,
  HEYGEN_IDEMPOTENCY_KEY_PATTERN,
  HEYGEN_IMAGE_ENGINES,
  HEYGEN_LIPSYNC_MODELS,
  HEYGEN_LIPSYNC_MODES,
  HEYGEN_LIPSYNC_MODE_BY_MODEL,
  HEYGEN_LIPSYNC_MODEL_BY_MODE,
  HEYGEN_LIPSYNC_STATUSES,
  HEYGEN_MAX_CONCURRENT_JOBS,
  HEYGEN_MOTION_PROMPT_ENGINES,
  HEYGEN_OPENAPI_URL,
  HEYGEN_OUTPUT_FORMATS,
  HEYGEN_RESOLUTIONS,
  HEYGEN_V1_V2_SUNSET,
  HEYGEN_VIDEO_STATUSES,
  HEYGEN_VOICE_ENGINES,
  HEYGEN_WATERMARK_POSITIONS,
  LIPSYNCS_URL,
  USERS_ME_URL,
  VIDEOS_URL,
  VOICES_URL,
  engineOf,
  lipsyncUrl,
  videoUrl,
} from "./shared";
export type {
  HeygenAspectRatio,
  HeygenAssetBase64,
  HeygenAssetId,
  HeygenAssetRef,
  HeygenAssetUrl,
  HeygenBackground,
  HeygenBackgroundType,
  HeygenCaption,
  HeygenCreateLipsyncResponse,
  HeygenCreateVideoResponse,
  HeygenElevenLabsEngineSettings,
  HeygenEngineConfig,
  HeygenEngineSettings,
  HeygenEngineType,
  HeygenErrorResponse,
  HeygenExpressiveness,
  HeygenFishEngineSettings,
  HeygenFit,
  HeygenFpsMode,
  HeygenLipsyncDetail,
  HeygenLipsyncMode,
  HeygenLipsyncModelId,
  HeygenLipsyncStatus,
  HeygenMediaRef,
  HeygenOutputFormat,
  HeygenResolution,
  HeygenStarfishEngineSettings,
  HeygenVideoDetail,
  HeygenVideoStatus,
  HeygenVoiceEngine,
  HeygenVoiceSettings,
  HeygenWatermark,
  HeygenWatermarkPlacement,
  HeygenWatermarkPosition,
} from "./shared";

export { models, provider } from "./models";
export type { HeygenCatalogModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
