/**
 * Shared wire pieces for HeyGen's v3 API (`https://api.heygen.com/v3/...`),
 * transcribed from the OpenAPI 3.1.0 document at
 * https://developers.heygen.com/openapi/external-api.json and the reference
 * pages it backs — /reference/create-video, /reference/create-lipsync,
 * /avatar-iii, /avatar-iv, /avatar-v, /lipsync-speed, /lipsync-precision,
 * /docs/quick-start, /docs/pricing, /docs/usage-limits — verified 2026-08-25.
 *
 * ## Two traps before anything else: the wrong spec and the dead host
 *
 * **1. HeyGen serves TWO OpenAPI documents and both answer 200.**
 *
 * ```text
 * https://developers.heygen.com/openapi/external-api.json   3.1.0 · "HeyGen External API" 1.0.0 · 1.16 MB · 98 paths · CURRENT
 * https://developers.heygen.com/openapi.yaml                3.1.0 · "HeyGen API" 4.0.8     · 88 KB   · 52 paths · STALE
 * ```
 *
 * The second is v1/v2 only — its single `/v3` path is `/v3/template/{id}`, and
 * it contains no `/v3/videos` at all. A generator pointed at it would emit a
 * v2-shaped provider and nothing would fail loudly. Everything in this file
 * comes from `openapi/external-api.json`, and `HEYGEN_OPENAPI_URL` is pinned so
 * a refresh cannot drift onto the other one.
 *
 * **2. `docs.heygen.com` is gone and its old slugs do not survive the move.**
 * It 301s to `developers.heygen.com`, but the old canonical paths 404 at the
 * new host: `docs.heygen.com/reference/create-an-avatar-video-v2` →
 * `developers.heygen.com/reference/create-an-avatar-video-v2` → **404**. The
 * live page is `/reference/create-video`. Every URL cited in this provider was
 * re-resolved against the new host on 2026-08-25 rather than rewritten by
 * substitution.
 *
 * ## Auth is a header key, and there is a second scheme
 *
 * `x-api-key: <HEYGEN_API_KEY>` on every request — the spec's `ApiKeyAuth`,
 * and what /docs/quick-start shows (spelled `X-Api-Key` there; HTTP header
 * names are case-insensitive per RFC 9110, and the spec's lowercase form is
 * what unmodel documents). A `BearerAuth` scheme (`type: http, scheme: bearer`,
 * described as "OAuth2 bearer token") is also declared and is not what a key
 * from Settings → API is; the API key is the primary and the only one these
 * docs show a caller obtaining.
 *
 * Billing follows the scheme: "When you authenticate with an API Key
 * (`x-api-key` header), you are billed under the API tier" — a prepaid USD
 * wallet, readable at `GET /v3/users/me`.
 *
 * unmodel never touches credentials, so the key is yours to add;
 * `.request.headers` carries the content type and nothing else.
 *
 * ## Every generation is a job, and both jobs are `{ data: … }`
 *
 * `POST /v3/videos` answers **200** with `{ data: { video_id, status:
 * "waiting", output_format } }`; poll `GET /v3/videos/{video_id}` until
 * `status` is `completed` or `failed` ({@link HEYGEN_VIDEO_STATUSES}), then
 * read `video_url` — plus `captioned_video_url`, `subtitle_url`,
 * `thumbnail_url`, `gif_url` and the `duration` you were billed for. The URLs
 * expire.
 *
 * `POST /v3/lipsyncs` answers `{ data: { lipsync_id } }` and polls at
 * `GET /v3/lipsyncs/{lipsync_id}` over a DIFFERENT status enum
 * ({@link HEYGEN_LIPSYNC_STATUSES}: `running` where the video route says
 * `processing`, and no `pending`→`processing` distinction). Two routes, two
 * lifecycles, one vendor — do not share a state machine between them.
 *
 * `callback_url` on either body replaces the polling.
 *
 * ## `Idempotency-Key` is worth using here more than almost anywhere
 *
 * An optional request header on both POSTs: 1–255 characters matching
 * `[A-Za-z0-9_\-:.]`, a UUID being the safe default. A repeat within 24 hours
 * replays the original response; a repeat while the first is still in flight
 * answers **409 `request_in_progress`**. Scope is per-endpoint and
 * per-resource. Avatar renders are billed per second and a Cinematic Avatar is
 * $7.00 flat, so a duplicate submission from a retry is a real invoice line.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS } from "../../core/request";

export const HEYGEN_BASE_URL = "https://api.heygen.com";

export const HEYGEN_HEADERS: Record<string, string> = JSON_HEADERS;

/** The documentation root, after the migration off `docs.heygen.com`. */
export const DOCS_BASE = "https://developers.heygen.com";

/**
 * The CURRENT OpenAPI document. Pinned, because the other one also answers 200.
 *
 * A refresh that lands on `${DOCS_BASE}/openapi.yaml` gets a v4.0.8 document
 * with 52 v1/v2 paths and no `/v3/videos`; assert `/v3/videos` is in `paths`
 * before believing anything a re-fetch says.
 */
export const HEYGEN_OPENAPI_URL = `${DOCS_BASE}/openapi/external-api.json`;

/** `POST /v3/videos` — create an avatar video. */
export const VIDEOS_URL = `${HEYGEN_BASE_URL}/v3/videos`;

/** `GET /v3/videos/{video_id}` — poll a submitted video. */
export function videoUrl(videoId: string): string {
  return `${HEYGEN_BASE_URL}/v3/videos/${videoId}`;
}

/** `POST /v3/lipsyncs` — create a lipsync job. */
export const LIPSYNCS_URL = `${HEYGEN_BASE_URL}/v3/lipsyncs`;

/** `GET /v3/lipsyncs/{lipsync_id}` — poll a submitted lipsync. */
export function lipsyncUrl(lipsyncId: string): string {
  return `${HEYGEN_BASE_URL}/v3/lipsyncs/${lipsyncId}`;
}

/**
 * `GET /v3/avatars/looks` — the avatar looks this workspace can render.
 *
 * The source of every `avatar_id`, and the reason that field is a plain
 * `string` here rather than an enum: the roster is per-ACCOUNT. A look is
 * something you trained (a Digital Twin, $1.00 per call) or a curated public
 * one your workspace can reach; HeyGen publishes no global list, so there is no
 * closed set to type. `?avatar_type=digital_twin` filters it, and each look
 * carries `supported_api_engines`, which is what to check before naming an
 * engine.
 */
export const AVATAR_LOOKS_URL = `${HEYGEN_BASE_URL}/v3/avatars/looks`;

/** `GET /v3/voices` — the voice roster `voice_id` names. */
export const VOICES_URL = `${HEYGEN_BASE_URL}/v3/voices`;

/** `GET /v3/users/me` — the prepaid USD wallet an API-key caller is billed against. */
export const USERS_ME_URL = `${HEYGEN_BASE_URL}/v3/users/me`;

// ---------------------------------------------------------------------------
// Models — which at HeyGen means engines and modes
// ---------------------------------------------------------------------------

/**
 * The three avatar ENGINES, which are what `POST /v3/videos` has instead of a
 * model field.
 *
 * `engine` is a discriminated union on `type` and it is optional; **omitting it
 * means `avatar_iv`**, which is the server-side default and is why unmodel
 * always writes the engine out rather than leaving the choice implicit. The
 * three differ in price by a factor of four (see `./models.ts`), so a request
 * that does not say which one it wants is a request that does not know what it
 * costs.
 *
 * These ids are HeyGen's own: `{"type": "avatar_iii"}` is the literal wire
 * value, and `developers.heygen.com/avatar-iii` is the page.
 */
export const HEYGEN_ENGINES = ["avatar_iii", "avatar_iv", "avatar_v"] as const;
export type HeygenEngineType = (typeof HEYGEN_ENGINES)[number];

/** The engine `POST /v3/videos` applies when `engine` is omitted. */
export const HEYGEN_DEFAULT_ENGINE: HeygenEngineType = "avatar_iv";

/**
 * The engines that accept a RAW IMAGE (`type: "image"`).
 *
 * `AvatarIIIEngineConfig`'s own description: "Not supported for raw image input
 * (`type: "image"`)." The other two serve both arms.
 */
export const HEYGEN_IMAGE_ENGINES = ["avatar_iv", "avatar_v"] as const;

/**
 * The engines that read `expressiveness`.
 *
 * "Photo avatars only. Defaults to 'low' when omitted. **Avatar IV only**;
 * rejected when engine.type is 'avatar_v'." — and Avatar III's own description
 * says "`motion_prompt` and `expressiveness` are not supported with this
 * engine". So: Avatar IV, and nothing else.
 */
export const HEYGEN_EXPRESSIVENESS_ENGINES = ["avatar_iv"] as const;

/**
 * The engines that read `motion_prompt`.
 *
 * "Supported for photo avatars on either engine, and for video avatars when
 * engine.type is 'avatar_v'." — "either engine" there means IV and V; Avatar
 * III excludes it explicitly. Which of IV and V accepts it for a GIVEN request
 * depends on whether `avatar_id` names a photo avatar or a video avatar, which
 * is a property of the look rather than of the request, so unmodel checks the
 * engine and stops there.
 */
export const HEYGEN_MOTION_PROMPT_ENGINES = ["avatar_iv", "avatar_v"] as const;

/**
 * The two lipsync QUALITY MODES, as unmodel model ids.
 *
 * `POST /v3/lipsyncs` has no model field either; it has `mode: "speed" |
 * "precision"` (default `"speed"`), and the two are separate products with
 * separate pages (`/lipsync-speed`, `/lipsync-precision`), separate rows in
 * HeyGen's own price table, and a 2× price difference — $0.0333 vs $0.0667 per
 * second. So they are two catalog ids, spelled the way HeyGen's own doc slugs
 * spell them, and the wire value is recovered from the id rather than the other
 * way round.
 */
export const HEYGEN_LIPSYNC_MODELS = ["lipsync-speed", "lipsync-precision"] as const;
export type HeygenLipsyncModelId = (typeof HEYGEN_LIPSYNC_MODELS)[number];

/** `mode` on the wire — what the two model ids compile to. */
export const HEYGEN_LIPSYNC_MODES = ["speed", "precision"] as const;
export type HeygenLipsyncMode = (typeof HEYGEN_LIPSYNC_MODES)[number];

/** `mode` → catalog id. The default (`"speed"`) is what an absent `mode` means. */
export const HEYGEN_LIPSYNC_MODEL_BY_MODE = {
  speed: "lipsync-speed",
  precision: "lipsync-precision",
} as const satisfies Record<HeygenLipsyncMode, HeygenLipsyncModelId>;

/** Catalog id → `mode`. The inverse, for the unified adapter. */
export const HEYGEN_LIPSYNC_MODE_BY_MODEL = {
  "lipsync-speed": "speed",
  "lipsync-precision": "precision",
} as const satisfies Record<HeygenLipsyncModelId, HeygenLipsyncMode>;

// ---------------------------------------------------------------------------
// Published enums
// ---------------------------------------------------------------------------

/**
 * The two arms of `CreateVideoV3RequestBody` unmodel serves.
 *
 * HeyGen's `oneOf` has four — `avatar`, `image`, `cinematic_avatar`, `studio` —
 * discriminated on `type`. The last two are excluded with reasons in
 * `./models.ts`: one is a prompt-to-video model wearing an avatar route's URL,
 * the other is a fifty-scene timeline document.
 */
export const HEYGEN_VIDEO_TYPES = ["avatar", "image"] as const;
export type HeygenVideoType = (typeof HEYGEN_VIDEO_TYPES)[number];

/** `resolution` — the three output sizes. 4K is not offered on every engine. */
export const HEYGEN_RESOLUTIONS = ["720p", "1080p", "4k"] as const;
export type HeygenResolution = (typeof HEYGEN_RESOLUTIONS)[number];

/**
 * `aspect_ratio` — six values, default `"16:9"`.
 *
 * `"auto"` preserves the source's ratio (the avatar's frames, or the uploaded
 * image), short-edge anchored to `resolution` and capped at the tier's long
 * edge, falling back to `"16:9"` when the source dimensions cannot be read.
 */
export const HEYGEN_ASPECT_RATIOS = ["16:9", "9:16", "4:5", "5:4", "1:1", "auto"] as const;
export type HeygenAspectRatio = (typeof HEYGEN_ASPECT_RATIOS)[number];

/** `fit` — how the subject meets the canvas. Omitted lets HeyGen choose. */
export const HEYGEN_FITS = ["contain", "cover"] as const;
export type HeygenFit = (typeof HEYGEN_FITS)[number];

/**
 * `output_format` — default `"mp4"`.
 *
 * `"webm"` returns a transparent background (alpha channel), needs an avatar
 * trained with matting, applies background removal automatically, and **rejects
 * any `background` value**. {@link checkTransparentOutput} is that rule.
 */
export const HEYGEN_OUTPUT_FORMATS = ["mp4", "webm"] as const;
export type HeygenOutputFormat = (typeof HEYGEN_OUTPUT_FORMATS)[number];

/** `expressiveness` — Avatar IV, photo avatars. Defaults to `"low"`. */
export const HEYGEN_EXPRESSIVENESS = ["high", "medium", "low"] as const;
export type HeygenExpressiveness = (typeof HEYGEN_EXPRESSIVENESS)[number];

/** `background.type` — a hex colour, or an image by url or asset id. */
export const HEYGEN_BACKGROUND_TYPES = ["color", "image"] as const;
export type HeygenBackgroundType = (typeof HEYGEN_BACKGROUND_TYPES)[number];

/** `caption.file_format` — one member today, and an enum in the spec. */
export const HEYGEN_CAPTION_FILE_FORMATS = ["srt"] as const;

/** `caption.style` — set it to BURN captions in; omit it for a sidecar only. */
export const HEYGEN_CAPTION_STYLES = ["default"] as const;

/** `watermark.placement.position` — the anchor corner. */
export const HEYGEN_WATERMARK_POSITIONS = [
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
] as const;
export type HeygenWatermarkPosition = (typeof HEYGEN_WATERMARK_POSITIONS)[number];

/**
 * `fps_mode` on `POST /v3/lipsyncs`.
 *
 * ⚠️ The schema types this as a bare `string`; the three values live only in
 * the field's description ("Frame rate mode: 'vfr', 'cfr', or 'passthrough'").
 * So the type here carries a `(string & {})` tail and
 * {@link checkFpsMode} reports an unrecognised value as a WARNING rather than
 * refusing it — the spec does not authorise a refusal, and guessing that the
 * description is exhaustive is exactly the kind of guess this library does not
 * make.
 */
export const HEYGEN_FPS_MODES = ["vfr", "cfr", "passthrough"] as const;
export type HeygenFpsMode = (typeof HEYGEN_FPS_MODES)[number];

/** `voice_settings.engine_settings.engine_type` — which TTS backend to force. */
export const HEYGEN_VOICE_ENGINES = ["elevenlabs", "fish", "starfish"] as const;
export type HeygenVoiceEngine = (typeof HEYGEN_VOICE_ENGINES)[number];

/** The ElevenLabs models a voice backed by ElevenLabs can be driven with. */
export const HEYGEN_ELEVENLABS_MODELS = [
  "eleven_multilingual_v2",
  "eleven_turbo_v2_5",
  "eleven_flash_v2_5",
  "eleven_v3",
] as const;

/** The Fish Audio models. Default `"s1"`. */
export const HEYGEN_FISH_MODELS = ["s1", "s2-pro"] as const;

/** `status` on `GET /v3/videos/{id}`. `completed` and `failed` are terminal. */
export const HEYGEN_VIDEO_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type HeygenVideoStatus = (typeof HEYGEN_VIDEO_STATUSES)[number];

/**
 * `status` on `GET /v3/lipsyncs/{id}` — a DIFFERENT enum from the video route's.
 *
 * `running` where the video route says `processing`. Two lifecycles at one
 * vendor; a shared `switch` over them will fall through.
 */
export const HEYGEN_LIPSYNC_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type HeygenLipsyncStatus = (typeof HEYGEN_LIPSYNC_STATUSES)[number];

/**
 * The concurrency ceiling on the self-serve tier, per /docs/usage-limits.
 *
 * Ten in-flight video jobs — and the count spans video generation, Video Agent
 * sessions and translations together, so it is not a per-endpoint budget.
 * Overflow answers **429** with a `Retry-After` header in seconds and the code
 * `rate_limit_exceeded`. No per-endpoint RPM figures are published, so this is
 * the only number there is; it is a plan property rather than a request
 * property and therefore is not checked anywhere.
 */
export const HEYGEN_MAX_CONCURRENT_JOBS = 10;

/**
 * The `Idempotency-Key` request header, and the pattern its value must match.
 *
 * 1–255 characters from `[A-Za-z0-9_\-:.]`; a UUID is the safe default. Within
 * 24 hours the same key on the same endpoint and resource replays the original
 * response; a retry that arrives while the first is in flight gets 409
 * `request_in_progress`. Not a body field, so it is not a per-model extra —
 * add it to `fetch` beside the API key.
 */
export const HEYGEN_IDEMPOTENCY_HEADER = "Idempotency-Key";
export const HEYGEN_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_\-:.]{1,255}$/;

/**
 * The date HeyGen's v1 and v2 endpoints stop being supported.
 *
 * Per /docs/quick-start and the endpoint-version comparison. This provider
 * types v3 exclusively for that reason: `POST /v2/video/generate` and
 * `POST /v1/audio/text_to_speech` are both live today and both on the clock.
 */
export const HEYGEN_V1_V2_SUNSET = "2026-10-31";

// ---------------------------------------------------------------------------
// Media references
// ---------------------------------------------------------------------------

/**
 * A file by public URL. The spec's `AssetUrl` — "Publicly accessible HTTPS URL
 * for the asset".
 */
export interface HeygenAssetUrl {
  type: "url";
  url: string;
}

/** A file already uploaded, by id. `POST /v3/assets` mints these. */
export interface HeygenAssetId {
  type: "asset_id";
  asset_id: string;
}

/**
 * A file inline. **Not accepted everywhere** — `POST /v3/videos`'s `image` and
 * `watermark.image` take it; `POST /v3/lipsyncs`'s `video` and `audio` do not,
 * whose `oneOf` is `AssetUrl | AssetId` only.
 */
export interface HeygenAssetBase64 {
  type: "base64";
  /** e.g. `"image/png"`. */
  media_type: string;
  data: string;
}

/** The three-arm reference `POST /v3/videos` takes for a still. */
export type HeygenAssetRef = HeygenAssetUrl | HeygenAssetId | HeygenAssetBase64;

/** The two-arm reference `POST /v3/lipsyncs` takes for its clip and its track. */
export type HeygenMediaRef = HeygenAssetUrl | HeygenAssetId;

// ---------------------------------------------------------------------------
// Nested request objects
// ---------------------------------------------------------------------------

/** `background` — a solid colour, or an image by url or asset id. */
export interface HeygenBackground {
  type: HeygenBackgroundType;
  /** Hex, e.g. `"#ff0000"`. Required when `type` is `"color"`. */
  value?: string | null;
  /** Used when `type` is `"image"`. Mutually exclusive with `asset_id`. */
  url?: string | null;
  /** Used when `type` is `"image"`. Mutually exclusive with `url`. */
  asset_id?: string | null;
}

/**
 * `caption` — a sidecar subtitle file is ALWAYS produced (`subtitle_url` on the
 * finished video); setting `style` additionally burns captions into the frames.
 */
export interface HeygenCaption {
  /** Default `"srt"`. */
  file_format?: "srt";
  /** Omit for sidecar only. */
  style?: "default" | null;
}

/** `watermark.placement` — anchor corner plus a fractional nudge. */
export interface HeygenWatermarkPlacement {
  /** Default `"bottom_right"`. */
  position?: HeygenWatermarkPosition;
  /** −1…1, a fraction of frame WIDTH. */
  offset_x?: number | null;
  /** −1…1, a fraction of frame HEIGHT. */
  offset_y?: number | null;
}

/**
 * `watermark` — an enterprise-gated overlay.
 *
 * "Available as a premium option for select Enterprise customers." Typed
 * because it is in the schema; a self-serve key will not be able to use it.
 */
export interface HeygenWatermark {
  image: HeygenAssetRef;
  /** >0…2, default 1. */
  scale?: number;
  /** 0…1, default 1. */
  opacity?: number;
  placement?: HeygenWatermarkPlacement | null;
}

/** ElevenLabs-backed voice tuning. `eleven_v3` needs `stability` ∈ {0, 0.5, 1}. */
export interface HeygenElevenLabsEngineSettings {
  engine_type: "elevenlabs";
  model?: (typeof HEYGEN_ELEVENLABS_MODELS)[number] | null;
  /** 0…1. */
  similarity_boost?: number | null;
  /** 0…1. */
  stability?: number | null;
  /** 0…1. */
  style?: number | null;
  use_speaker_boost?: boolean | null;
}

/** Fish-Audio-backed voice tuning. */
export interface HeygenFishEngineSettings {
  engine_type: "fish";
  /** Default `"s1"`. */
  model?: (typeof HEYGEN_FISH_MODELS)[number] | null;
  /** 0…1. */
  stability?: number | null;
  /** 0…1. */
  similarity?: number | null;
}

/** Starfish routing. It has no tunable settings — the discriminator IS the setting. */
export interface HeygenStarfishEngineSettings {
  engine_type: "starfish";
}

export type HeygenEngineSettings =
  | HeygenElevenLabsEngineSettings
  | HeygenFishEngineSettings
  | HeygenStarfishEngineSettings;

/**
 * `voice_settings` — applies ONLY when the speech is synthesized from `script`
 * + `voice_id`. Uploaded audio bypasses TTS and ignores every field here, which
 * is what {@link checkSpeechSource} reports.
 */
export interface HeygenVoiceSettings {
  /** 0.5…1.5, default 1. */
  speed?: number;
  /** −50…50 semitones, default 0. */
  pitch?: number;
  /** 0…1, default 1. */
  volume?: number;
  /** A locale hint for multilingual voices, e.g. `"en-US"`. */
  locale?: string | null;
  engine_settings?: HeygenEngineSettings | null;
}

/** `engine` — the discriminated union that decides which product renders. */
export type HeygenEngineConfig =
  | { type: "avatar_iii" }
  | { type: "avatar_iv" }
  | {
      type: "avatar_v";
      /**
       * A `digital_twin` look in the same avatar group to animate from. Omitted,
       * video avatars self-reference and photo avatars pick from their group.
       */
      reference_look_id?: string | null;
    };

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** `data` on `POST /v3/videos`. */
export interface HeygenCreateVideoResponse {
  video_id: string;
  /** `"waiting"` on creation — the poll route's enum starts at `"pending"`. */
  status: string;
  output_format?: HeygenOutputFormat;
}

/** `data` on `GET /v3/videos/{video_id}`. `duration` is what you were billed for. */
export interface HeygenVideoDetail {
  id: string;
  status: HeygenVideoStatus;
  title?: string | null;
  created_at?: number | null;
  completed_at?: number | null;
  video_url?: string | null;
  captioned_video_url?: string | null;
  subtitle_url?: string | null;
  thumbnail_url?: string | null;
  gif_url?: string | null;
  /** Seconds. The billing quantity, and only knowable after the fact. */
  duration?: number | null;
  folder_id?: string | null;
  output_language?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  video_page_url?: string | null;
}

/** `data` on `POST /v3/lipsyncs`. */
export interface HeygenCreateLipsyncResponse {
  lipsync_id: string;
}

/** `data` on `GET /v3/lipsyncs/{lipsync_id}`. */
export interface HeygenLipsyncDetail {
  id: string;
  status: HeygenLipsyncStatus;
  title?: string | null;
  duration?: number | null;
  video_url?: string | null;
  caption_url?: string | null;
  callback_id?: string | null;
  created_at?: number | null;
  failure_message?: string | null;
}

/**
 * The error envelope on 400/401/404/409/429 — `{ error: … }`, never `{ data }`.
 *
 * `param` is the field that caused it, which is the thing to read: HeyGen's own
 * example is `{"code":"invalid_parameter","message":"Exactly one visual source
 * required: avatar_id, image_url, or image_asset_id.","param":"avatar_id"}`.
 */
export interface HeygenErrorResponse {
  error: {
    code: string;
    message: string;
    param?: string | null;
    doc_url?: string | null;
    errors?: ReadonlyArray<{ code: string; message: string; path?: string }>;
  };
}

// ---------------------------------------------------------------------------
// Shared zod fragments
// ---------------------------------------------------------------------------

const assetUrlSchema = z.looseObject({ type: z.literal("url"), url: z.string() });
const assetIdSchema = z.looseObject({ type: z.literal("asset_id"), asset_id: z.string() });
const assetBase64Schema = z.looseObject({
  type: z.literal("base64"),
  media_type: z.string(),
  data: z.string(),
});

/** The three-arm reference (`POST /v3/videos`). */
export const assetRefSchema = z.union([assetUrlSchema, assetIdSchema, assetBase64Schema]);

/** The two-arm reference (`POST /v3/lipsyncs`) — no inline arm. */
export const mediaRefSchema = z.union([assetUrlSchema, assetIdSchema]);

export const engineSchema = z.union([
  z.looseObject({ type: z.literal("avatar_iii") }),
  z.looseObject({ type: z.literal("avatar_iv") }),
  z.looseObject({
    type: z.literal("avatar_v"),
    reference_look_id: z.string().nullable().optional(),
  }),
]);

export const voiceSettingsSchema = z.looseObject({
  speed: z.number().min(0.5).max(1.5).optional(),
  pitch: z.number().min(-50).max(50).optional(),
  volume: z.number().min(0).max(1).optional(),
  locale: z.string().nullable().optional(),
  engine_settings: z
    .union([
      z.looseObject({
        engine_type: z.literal("elevenlabs"),
        model: z.enum(HEYGEN_ELEVENLABS_MODELS).nullable().optional(),
        similarity_boost: z.number().min(0).max(1).nullable().optional(),
        stability: z.number().min(0).max(1).nullable().optional(),
        style: z.number().min(0).max(1).nullable().optional(),
        use_speaker_boost: z.boolean().nullable().optional(),
      }),
      z.looseObject({
        engine_type: z.literal("fish"),
        model: z.enum(HEYGEN_FISH_MODELS).nullable().optional(),
        stability: z.number().min(0).max(1).nullable().optional(),
        similarity: z.number().min(0).max(1).nullable().optional(),
      }),
      z.looseObject({ engine_type: z.literal("starfish") }),
    ])
    .nullable()
    .optional(),
});

export const backgroundSchema = z.looseObject({
  type: z.enum(HEYGEN_BACKGROUND_TYPES),
  value: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  asset_id: z.string().nullable().optional(),
});

export const captionSchema = z.looseObject({
  file_format: z.enum(HEYGEN_CAPTION_FILE_FORMATS).optional(),
  style: z.enum(HEYGEN_CAPTION_STYLES).nullable().optional(),
});

export const watermarkSchema = z.looseObject({
  image: assetRefSchema,
  scale: z.number().gt(0).max(2).optional(),
  opacity: z.number().min(0).max(1).optional(),
  placement: z
    .looseObject({
      position: z.enum(HEYGEN_WATERMARK_POSITIONS).optional(),
      offset_x: z.number().min(-1).max(1).nullable().optional(),
      offset_y: z.number().min(-1).max(1).nullable().optional(),
    })
    .nullable()
    .optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * The shape the video-route checks read — every field they touch, widened.
 *
 * Written out rather than `Record<string, unknown>` for `tripo3d`'s reason: an
 * interface has no implicit index signature, so a check typed against the
 * record would not be assignable to `createValidator`'s `checks`.
 */
interface VideoParams {
  type?: string;
  avatar_id?: string;
  image?: unknown;
  script?: string;
  voice_id?: string;
  audio_url?: string;
  audio_asset_id?: string;
  voice_settings?: unknown;
  engine?: { type?: string };
  output_format?: string;
  background?: unknown;
  motion_prompt?: string;
  expressiveness?: string;
}

/** The engine a request will actually run on, default included. */
export function engineOf(params: { engine?: { type?: string } }): string {
  return params.engine?.type ?? HEYGEN_DEFAULT_ENGINE;
}

/**
 * The discriminator's own rule: `type` decides which visual source is REQUIRED
 * and which is refused.
 *
 * `CreateVideoFromAvatar` requires `["type", "avatar_id"]` and declares no
 * `image`; `CreateVideoFromImage` requires `["type", "image"]` and declares no
 * `avatar_id`. Both are `additionalProperties: false`, so the wrong field for
 * the arm is a 400 rather than an ignored one — HeyGen's own documented example
 * error is exactly this: "Exactly one visual source required: avatar_id,
 * image_url, or image_asset_id."
 */
export function checkVisualSource(source: string) {
  return (params: VideoParams, _info: unknown, ctx: PipelineContext): void => {
    const type = params.type;
    if (type !== "avatar" && type !== "image") return;
    const wanted = type === "avatar" ? "avatar_id" : "image";
    const forbidden = type === "avatar" ? "image" : "avatar_id";

    if (params[wanted] === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: [wanted],
        model: engineOf(params),
        message:
          `\`type: "${type}"\` requires \`${wanted}\`, and this request has none. ` +
          (type === "avatar"
            ? "An `avatar_id` is a look from YOUR workspace — list them at GET /v3/avatars/looks, or " +
              'switch to `type: "image"` and animate a picture you supply.'
            : "Pass `image: { type: \"url\", url }`, `{ type: \"asset_id\", asset_id }` or " +
              '`{ type: "base64", media_type, data }`.'),
        meta: { source, type },
      });
    }

    if (params[forbidden] !== undefined) {
      ctx.report({
        code: "unsupported_param",
        path: [forbidden],
        model: engineOf(params),
        message:
          `\`${forbidden}\` is not a field the \`type: "${type}"\` arm declares — its schema is ` +
          "`additionalProperties: false`, so HeyGen answers 400 rather than ignoring it. The two arms " +
          "are one route with two request shapes: `avatar` animates a look from your workspace, " +
          "`image` animates a picture you supply.",
        meta: { source, type },
      });
    }
  };
}

/**
 * Avatar III does not take a raw image, and says so on its own engine config.
 *
 * "Not supported for raw image input (`type: "image"`)." A hard refusal because
 * the fix is to change the engine (or the arm) rather than to drop a field —
 * and because Avatar III is the CHEAP engine, so a caller who lands here is
 * usually reaching for it on purpose.
 */
export function checkEngineArm(source: string) {
  return (params: VideoParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.type !== "image") return;
    const engine = engineOf(params);
    if ((HEYGEN_IMAGE_ENGINES as readonly string[]).includes(engine)) return;
    ctx.report({
      code: "unsupported_capability",
      path: ["engine", "type"],
      model: engine,
      message:
        `"${engine}" does not render raw image input — its own engine config says "Not supported for ` +
        `raw image input (type: \\"image\\")". The engines that do are ` +
        `${HEYGEN_IMAGE_ENGINES.map((id) => `"${id}"`).join(" and ")}; to keep this engine, train the ` +
        "picture into a photo avatar and name it with `avatar_id` on the `avatar` arm.",
      meta: { source, allowed: [...HEYGEN_IMAGE_ENGINES] },
    });
  };
}

/**
 * Two engine-gated fields, and HeyGen REJECTS both rather than ignoring them —
 * which is why these are errors where sync.'s and Topaz's equivalents are
 * warnings.
 *
 * `expressiveness`: "Avatar IV only; rejected when engine.type is 'avatar_v'",
 * and Avatar III's config says it is "not supported with this engine".
 * `motion_prompt`: supported on IV and V, and excluded by Avatar III's config
 * in the same sentence.
 *
 * The remaining half of each rule is about the LOOK rather than the request —
 * both are photo-avatar features, and whether an `avatar_id` names a photo
 * avatar is a property of `GET /v3/avatars/looks` — so unmodel checks the
 * engine and stops. The message says where the other half lives.
 */
const ENGINE_GATED: ReadonlyArray<{
  readonly key: "expressiveness" | "motion_prompt";
  readonly engines: readonly string[];
  readonly why: string;
}> = [
  {
    key: "expressiveness",
    engines: HEYGEN_EXPRESSIVENESS_ENGINES,
    why: "Avatar V drives expression from its reference look and Avatar III has no expression control",
  },
  {
    key: "motion_prompt",
    engines: HEYGEN_MOTION_PROMPT_ENGINES,
    why: "Avatar III's engine config excludes it by name",
  },
];

export function checkEngineGatedFields(source: string) {
  return (params: VideoParams, _info: unknown, ctx: PipelineContext): void => {
    const engine = engineOf(params);
    for (const gate of ENGINE_GATED) {
      if (params[gate.key] === undefined) continue;
      if (gate.engines.includes(engine)) continue;
      ctx.report({
        code: "unsupported_param",
        path: [gate.key],
        model: engine,
        message:
          `\`${gate.key}\` is accepted by ${gate.engines.map((id) => `"${id}"`).join(", ")} and this ` +
          `request runs on "${engine}" — ${gate.why}. HeyGen REJECTS it rather than ignoring it, so ` +
          "this is a 400 and not a silent no-op. (The other half of the rule is about the LOOK: both " +
          "fields are photo-avatar features, and whether an `avatar_id` names one is on " +
          "GET /v3/avatars/looks.)",
        meta: { source, allowed: [...gate.engines] },
      });
    }
  };
}

/**
 * The speech source is a three-way exclusion the schema cannot express.
 *
 * `script` is "Mutually exclusive with audio_url/audio_asset_id"; `audio_url`
 * and `audio_asset_id` say the same thing back. `voice_id` is "Required when
 * script is provided, unless avatar_id is set (the avatar's default voice is
 * used as fallback)". And `voice_settings` "applies only when 'script' +
 * 'voice_id' are provided — not when audio_url/audio_asset_id is used (uploaded
 * audio bypasses TTS)", which is a silent no-op and therefore a warning.
 *
 * Every one of those is optional in the schema, so a body with a script AND a
 * track type-checks; this is where it stops.
 */
export function checkSpeechSource(source: string) {
  return (params: VideoParams, _info: unknown, ctx: PipelineContext): void => {
    const engine = engineOf(params);
    const hasScript = params.script !== undefined;
    const tracks = (["audio_url", "audio_asset_id"] as const).filter(
      (key) => params[key] !== undefined,
    );

    if (hasScript && tracks.length > 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["script"],
        model: engine,
        message:
          `\`script\` is mutually exclusive with ${tracks.map((key) => `\`${key}\``).join(" and ")}: ` +
          "one has HeyGen synthesize the speech and the other hands it a recording, and a request " +
          "cannot ask for both. Drop one.",
        meta: { source, tracks: [...tracks] },
      });
    }

    if (tracks.length > 1) {
      ctx.report({
        code: "invalid_shape",
        path: ["audio_url"],
        model: engine,
        message:
          "`audio_url` and `audio_asset_id` are two spellings of the same input — a URL HeyGen " +
          "fetches, or an asset it already holds. Pass one.",
        meta: { source },
      });
    }

    if (hasScript && params.voice_id === undefined && params.avatar_id === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["voice_id"],
        model: engine,
        message:
          "`voice_id` is required when `script` is set, unless `avatar_id` is too — a look carries a " +
          "default voice and a raw image does not. List the voices at GET /v3/voices.",
        meta: { source },
      });
    }

    if (params.voice_settings !== undefined && !hasScript) {
      ctx.report({
        code: "unknown_param",
        path: ["voice_settings"],
        model: engine,
        message:
          "`voice_settings` tunes text-to-speech and this request supplies its own audio, which " +
          "bypasses TTS entirely — HeyGen ignores every field in it. Set `script` and `voice_id` to " +
          "have the settings mean something, or drop them.",
        meta: { source },
      });
    }
  };
}

/**
 * `output_format: "webm"` and `background` cannot both be set.
 *
 * "'webm' returns a video with a transparent background (alpha channel) … When
 * 'webm' is selected, any 'background' value is REJECTED and background removal
 * is applied automatically — the caller does not need to set
 * 'remove_background'." A rejection, so an error, and the message says the
 * `remove_background` half too because that is the field a caller reaches for
 * next.
 */
export function checkTransparentOutput(source: string) {
  return (params: VideoParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.output_format !== "webm") return;
    if (params.background === undefined) return;
    ctx.report({
      code: "invalid_shape",
      path: ["background"],
      model: engineOf(params),
      message:
        '`output_format: "webm"` returns an alpha channel instead of a background, and HeyGen rejects ' +
        "any `background` value alongside it. Drop `background` for a transparent render (background " +
        "removal is applied automatically — `remove_background` is not needed either), or switch to " +
        '`output_format: "mp4"` to keep the backdrop.',
      meta: { source },
    });
  };
}

// ---------------------------------------------------------------------------
// Checks — the lipsync route
// ---------------------------------------------------------------------------

/** The shape the lipsync checks read. See `VideoParams` for why it is written out. */
interface LipsyncCheckParams {
  mode?: string;
  fps_mode?: string;
  start_time?: number;
  end_time?: number;
  enable_caption?: boolean;
}

/**
 * `fps_mode`'s three values live in a DESCRIPTION, not in an enum — so an
 * unrecognised one is a warning.
 *
 * The schema types the field `string | null`; only the prose says "Frame rate
 * mode: 'vfr', 'cfr', or 'passthrough'". A closed check would refuse values
 * HeyGen may well accept, which is a false negative on a working request — the
 * one failure mode worse than no narrowing at all. So the type carries a
 * `(string & {})` tail and this says "the docs name three" without refusing a
 * fourth.
 */
export function checkFpsMode(source: string) {
  return (params: LipsyncCheckParams, _info: unknown, ctx: PipelineContext): void => {
    const value = params.fps_mode;
    if (value === undefined || value === null) return;
    if ((HEYGEN_FPS_MODES as readonly string[]).includes(value)) return;
    ctx.report({
      code: "unknown_param",
      path: ["fps_mode"],
      message:
        `\`fps_mode: "${value}"\` is not one of the three values HeyGen's field description names ` +
        `(${HEYGEN_FPS_MODES.map((mode) => `"${mode}"`).join(", ")}). The schema types this field as a ` +
        "plain string rather than an enum, so this is a warning and not a refusal — the three may not " +
        "be exhaustive.",
      meta: { source, documented: [...HEYGEN_FPS_MODES] },
    });
  };
}

/**
 * The partial-lipsync window has to run forwards.
 *
 * `start_time` and `end_time` are "Start/End time in seconds for partial
 * lipsync" and both are plain optional numbers, so a backwards or negative
 * window type-checks. Nothing in the docs says what HeyGen does with one, which
 * is the argument FOR catching it here: an unstated behaviour is not a
 * behaviour to rely on.
 */
export function checkLipsyncWindow(source: string) {
  return (params: LipsyncCheckParams, _info: unknown, ctx: PipelineContext): void => {
    const { start_time: start, end_time: end } = params;
    if (start !== undefined && start < 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["start_time"],
        message: `\`start_time\` is ${start}s. The window is measured in seconds from the start of the clip.`,
        meta: { source },
      });
    }
    if (start === undefined || end === undefined) return;
    if (start < end) return;
    ctx.report({
      code: "invalid_shape",
      path: ["start_time"],
      message:
        `The partial-lipsync window runs from ${start}s to ${end}s, which is ` +
        `${start === end ? "empty" : "backwards"}. \`start_time\` must be less than \`end_time\`.`,
      meta: { source, start, end },
    });
  };
}

/**
 * `enable_caption` is deprecated AND ignored, which is the worst combination:
 * the request succeeds, is billed identically, and the field did nothing.
 *
 * Verbatim from the schema: "Deprecated and ignored: captions are always
 * generated; whether to display them is a download-side choice." The finished
 * job carries `caption_url` either way.
 */
export function checkDeprecatedCaption(source: string) {
  return (params: LipsyncCheckParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.enable_caption === undefined) return;
    ctx.report({
      code: "unknown_param",
      path: ["enable_caption"],
      message:
        "`enable_caption` is deprecated and ignored — HeyGen's own words: captions are always " +
        "generated, and whether to display them is a download-side choice. The finished job carries " +
        "`caption_url` whatever you set here.",
      meta: { source },
    });
  };
}
