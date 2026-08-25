/**
 * Shared wire pieces for sync.'s v2 API (`https://api.sync.so/v2/...`),
 * transcribed from the curated OpenAPI 3.1 document at
 * https://sync.so/docs/openapi.json and the endpoint reference pages —
 * `/api-reference/api/generate-api/create`, `/models/lipsync`, `/models/sync-3`,
 * `/api-reference/guides/authentication`, `/api-reference/guides/rate-limits`,
 * `/api-reference/guides/webhooks` — verified 2026-08-25. Every docs route also
 * serves raw Markdown at `<route>.md`, which is what was read.
 *
 * ## Two specs, and which one this file follows
 *
 * sync. publishes TWO unauthenticated OpenAPI documents: a curated
 * developer-facing one at `https://sync.so/docs/openapi.json` (96 KB, 19 paths)
 * and the full backend spec at `https://sync.so/openapi.json` (661 KB, 161
 * paths, including billing, orgs, OAuth and dashboard routes). unmodel types
 * the CURATED one, because the full spec's extra surface is not a product a
 * caller can reach with an API key. Where the two disagree, the tiebreak went to
 * `@sync.so/sdk@0.3.0`'s shipped `.d.ts` (the wire-typing policy: docs, then the
 * reference, then the SDK). Four disagreements were found and all four are
 * resolved here:
 *
 * 1. **The model roster.** The curated spec enumerates five ids; the full spec
 *    adds `lipsync-2-mini` and `appearence-1`. `Model.d.ts` in the SDK declares
 *    exactly the five, and neither extra id has a docs page or a published rate.
 *    {@link SYNC_MODELS} is the five.
 * 2. **`options.prompt`.** The curated spec types it as the six-arm
 *    {@link SYNC_EMOTIONS} enum; the full spec types it as a free-form string
 *    (an appearance-edit instruction for `appearence-1`). `GenerationOptions.d.ts`
 *    declares `prompt?: Sync.Emotion`. It is the enum.
 * 3. **The request content type.** The curated spec declares only
 *    `multipart/form-data` on `POST /v2/generate` (its one operation there is
 *    "Create Generation with Files"); the prose docs and the SDK both use JSON.
 *    `generations/client/Client.js` posts `contentType: "application/json"`,
 *    `requestType: "json"` to `/v2/generate`. **JSON is the primary path** and is
 *    what unmodel compiles to; the multipart form exists only for direct file
 *    uploads and is not modelled.
 * 4. **`GenerationOptions`.** The curated spec exposes six fields, the full spec
 *    about twenty (several deprecated, several undocumented:
 *    `prompt_image_uris`, `i2v_prompt`, `reasoning_enabled`, `blending_mode`,
 *    `face_boxes_url`, `output_bucket_name`, plus deprecated `pads`, `speedup`,
 *    `fps`, `output_format`, `output_resolution`). The SDK's `GenerationOptions`
 *    declares the same six as the curated spec. Six it is.
 *
 * The SDK is one release BEHIND the curated spec in one place, and that is the
 * one case where it does not win: `Input.d.ts` types the union as
 * `Video | Audio | Tts` with no `Image` member, and ships no `Image.d.ts` at
 * all. Image input is documented on `sync-3`'s own model page, is in the
 * curated spec, and is the whole content of {@link SYNC_IMAGE_MODELS} — so it is
 * typed. A tiebreaker settles a disagreement, not an absence.
 *
 * ## Auth is a header key, and there are two 401 shapes
 *
 * `x-api-key: <SYNC_API_KEY>` on every request
 * (/api-reference/guides/authentication; the SDK reads the same env var).
 * unmodel never touches credentials, so it is yours to add — `.request.headers`
 * carries the content type and nothing else. The API also accepts a dashboard
 * session cookie, which is why a MISSING header and an INVALID key answer
 * differently:
 *
 * ```text
 * no header      401 {"message":"Either Cookie or x-api-key header must be provided","error":"Unauthorized","statusCode":401}
 * bad key        401 {"message":"Unauthorized","statusCode":401}
 * ```
 *
 * Two shapes, one status. An error mapper that reads `error` will find it
 * missing on the second. (Both probed live on 2026-08-25.)
 *
 * ## Every generation is a job
 *
 * `POST /v2/generate` answers **201** with a {@link SYNC_GENERATION_STATUSES}
 * `PENDING` generation; poll `GET /v2/generate/{id}` until `COMPLETED`,
 * `FAILED` or `REJECTED`, then read `outputUrl`. Set `webhookUrl` to be told
 * instead of asking — the callback is signed with `Sync-Signature:
 * t=<unix>,v1=<hmac_sha256>` over `${timestamp}.` + the RAW body, keyed on the
 * `whsec_…` secret from `GET /v2/organizations/webhook/secret`.
 *
 * ⚠️ The webhook payload is **not** the polling payload. `GenerationNotification`
 * spells the failure code `error_code` where the polled `Generation` spells it
 * `errorCode`, and omits `outputFileName`, `projectId` and
 * `synthesizedAudioUrl`. Two wire shapes for one logical object; do not unify
 * them.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS } from "../../core/request";

export const SYNC_BASE_URL = "https://api.sync.so";

export const SYNC_HEADERS: Record<string, string> = JSON_HEADERS;

export const DOCS_BASE = "https://sync.so/docs";

/** `POST /v2/generate` — create a generation. Both verbs post here. */
export const GENERATE_URL = `${SYNC_BASE_URL}/v2/generate`;

/** `GET /v2/generate/{id}` — poll a submitted generation. */
export function generationUrl(id: string): string {
  return `${SYNC_BASE_URL}/v2/generate/${id}`;
}

/**
 * `POST /v2/analyze/cost` — a pre-flight quote for the SAME body.
 *
 * It takes a `CreateGenerationDto` and answers
 * `{ estimatedFrameCount, estimatedGenerationCost }` in USD, which makes it the
 * exact answer to the question unmodel can only approximate: the price is
 * per second of OUTPUT and the output's duration is the input clip's, which a
 * URL does not reveal. unmodel never calls it — it never makes a network
 * request — but a validated body is the right shape to send here first.
 */
export const ANALYZE_COST_URL = `${SYNC_BASE_URL}/v2/analyze/cost`;

/** `GET /v2/models` — the live roster, with `deprecatedAt` models filtered out. */
export const MODELS_URL = `${SYNC_BASE_URL}/v2/models`;

/**
 * `GET /v2/errors` — the full failure catalog, **unauthenticated**.
 *
 * Returns `{ code, message, suggestion }[]`. It is where
 * {@link SYNC_ERROR_CODES} was transcribed from and is the refresh source when
 * it goes stale.
 */
export const ERRORS_URL = `${SYNC_BASE_URL}/v2/errors`;

/** `GET /v2/organizations/webhook/secret` — the `whsec_…` webhook signing key. */
export const WEBHOOK_SECRET_URL = `${SYNC_BASE_URL}/v2/organizations/webhook/secret`;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/**
 * The five model ids `POST /v2/generate` accepts.
 *
 * The curated spec's `Model` enum, confirmed against `@sync.so/sdk@0.3.0`'s
 * `Model.d.ts`. The full backend spec adds `lipsync-2-mini` and `appearence-1`;
 * neither has a docs page, neither has a published rate, and neither is in the
 * SDK — so unmodel does not type them.
 */
export const SYNC_MODELS = [
  "sync-3",
  "lipsync-2",
  "lipsync-2-pro",
  "lipsync-1.9.0-beta",
  "react-1",
] as const;
export type SyncModelId = (typeof SYNC_MODELS)[number];

/**
 * The models that accept an IMAGE as their visual input — one, and it is the
 * whole reason `unmodel/avatar` reaches this provider.
 *
 * Verbatim from the create-generation reference: "Image inputs are only
 * supported with the sync-3 model." `sync-3`'s own page repeats it — "sync-3 is
 * the only model that supports image input" — and adds the formats: JPEG, PNG,
 * WebP. Note that `react-1`, which is otherwise the most capable model here,
 * is NOT on this list: expression control needs a performance to react to.
 */
export const SYNC_IMAGE_MODELS = ["sync-3"] as const;
export type SyncImageModelId = (typeof SYNC_IMAGE_MODELS)[number];

/**
 * The models `options.temperature` applies to.
 *
 * From the per-model options matrix on /models/lipsync: `temperature` is "Yes"
 * for `lipsync-2` and `lipsync-2-pro`, "No (native)" for `sync-3` and "No" for
 * `lipsync-1.9.0-beta`. `react-1` is absent from that matrix; the full spec
 * describes the field as lipsync-2-family only, so it is not listed here.
 */
export const SYNC_TEMPERATURE_MODELS = ["lipsync-2", "lipsync-2-pro"] as const;

/**
 * The models `options.occlusion_detection_enabled` applies to.
 *
 * Same matrix: "Yes" for `lipsync-2`, `lipsync-2-pro` and `lipsync-1.9.0-beta`,
 * "No (automatic)" for `sync-3` — which detects obstructions natively and has
 * no switch because it never needed one.
 */
export const SYNC_OCCLUSION_MODELS = ["lipsync-2", "lipsync-2-pro", "lipsync-1.9.0-beta"] as const;

/**
 * The models `options.model_mode` and `options.prompt` apply to.
 *
 * Both fields say so in their own descriptions — "only works with react-1" —
 * and `react-1` is the only model in the roster whose `ModelInfo.type` is
 * `"react"` rather than `"lipsync"`.
 */
export const SYNC_REACT_MODELS = ["react-1"] as const;

// ---------------------------------------------------------------------------
// Published enums
// ---------------------------------------------------------------------------

/**
 * `options.sync_mode` — what to do when the clip and the track are different
 * lengths. Defaults to `"bounce"`.
 *
 * Five arms, each a different answer to the same question (from the SDK's
 * per-arm doc comments, which are richer than the spec's):
 *
 * - `bounce` — clip shorter than audio: play it forwards then backwards to fill.
 * - `loop` — clip shorter: repeat it.
 * - `cut_off` — audio longer: truncate the audio to the clip.
 * - `silence` — clip longer: pad the audio with silence.
 * - `remap` — change the clip's playback speed to match the audio exactly.
 *
 * Otherwise (clip longer than audio) every mode crops the clip.
 *
 * ⚠️ **Ignored for image inputs**, which have no intrinsic duration. See
 * {@link checkImageOptions}.
 *
 * This is also the field `fal-ai/sync-lipsync/v2` exposes under the same name
 * with the same five arms — because it IS this model, resold. One vendor
 * agreeing with itself through a reseller is one witness, so `sync_mode` is a
 * per-model extra at both providers rather than canonical vocabulary.
 */
export const SYNC_SYNC_MODES = ["bounce", "loop", "cut_off", "silence", "remap"] as const;
export type SyncSyncMode = (typeof SYNC_SYNC_MODES)[number];

/**
 * `options.model_mode` — how much of the face `react-1` is allowed to move.
 * Defaults to `"face"`. `"head"` adds natural talking-head motion.
 */
export const SYNC_MODEL_MODES = ["lips", "face", "head"] as const;
export type SyncModelMode = (typeof SYNC_MODEL_MODES)[number];

/**
 * `options.prompt` — the emotion `react-1` performs.
 *
 * A six-arm ENUM and not a sentence: "Only single word emotions are supported
 * at the moment." The full backend spec types the same field as a free-form
 * string, describing it as an appearance-edit instruction for the undocumented
 * `appearence-1` model; the SDK types it `Sync.Emotion`, and the SDK wins.
 */
export const SYNC_EMOTIONS = [
  "happy",
  "sad",
  "angry",
  "disgusted",
  "surprised",
  "neutral",
] as const;
export type SyncEmotion = (typeof SYNC_EMOTIONS)[number];

/**
 * The states `GET /v2/generate/{id}` reports.
 *
 * `COMPLETED`, `FAILED` and `REJECTED` are terminal. `REJECTED` is the one worth
 * handling separately: it means the request never ran (moderation, plan limits)
 * rather than that it ran and failed, and it is charged differently.
 */
export const SYNC_GENERATION_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "REJECTED",
] as const;
export type SyncGenerationStatus = (typeof SYNC_GENERATION_STATUSES)[number];

/** `ModelInfo.type` on `GET /v2/models` — the two model families. */
export const SYNC_MODEL_TYPES = ["lipsync", "react"] as const;
export type SyncModelType = (typeof SYNC_MODEL_TYPES)[number];

/** The one TTS provider sync. proxies for `type: "text"` inputs and dubbing. */
export const SYNC_TTS_PROVIDERS = ["elevenlabs"] as const;
export type SyncTtsProvider = (typeof SYNC_TTS_PROVIDERS)[number];

/**
 * `dubParams.targetLang` — the 93 languages sync.'s dubbing integration takes.
 *
 * `dubParams.sourceLang` is the same list plus `"auto"`, which is its default.
 * Transcribed from `type_common:DubLanguage` in the curated spec, in the spec's
 * own order, 2026-08-25.
 */
export const SYNC_DUB_LANGUAGES = [
  "en", "gu", "no", "sl", "pa", "ta", "az", "gl", "is", "sw", "my", "fi", "el",
  "he", "lt", "ms", "sv", "fr", "ca", "hr", "lv", "ro", "sd", "th", "tn", "pl",
  "ceb", "da", "hu", "mr", "tl", "ug", "wo", "zu", "zh", "hi", "as", "ha", "kk",
  "ki", "rn", "ky", "st", "te", "war", "ak", "be", "cs", "ka", "mn", "bo", "ts",
  "ar", "ss", "nl", "tr", "af", "bs", "et", "rw", "ne", "ko", "it", "es", "sq",
  "eu", "kn", "sk", "su", "ve", "pt", "am", "hy", "doi", "de", "jv", "mk", "ja",
  "vi", "cy", "nso", "uk", "bg", "id", "lg", "yo", "ml", "fa", "tg", "ur", "uz",
  "ru", "fil",
] as const;
export type SyncDubLanguage = (typeof SYNC_DUB_LANGUAGES)[number];

/** `dubParams.sourceLang` — the target list plus automatic detection. */
export const SYNC_DUB_SOURCE_LANGUAGES = ["auto", ...SYNC_DUB_LANGUAGES] as const;
export type SyncDubSourceLanguage = (typeof SYNC_DUB_SOURCE_LANGUAGES)[number];

/**
 * Every `errorCode` sync. publishes, transcribed from `GET /v2/errors` on
 * **2026-08-25** — 62 codes, in the catalog's own order.
 *
 * A hand catalog rather than a generated one on purpose. The endpoint is
 * unauthenticated and could be fetched at build time, but the value of the list
 * is that it is REVIEWED: a code appearing or disappearing is a change to the
 * failure surface a caller branches on, and a generator would land it silently.
 * Refresh it by re-reading {@link ERRORS_URL}, which also carries a `message`
 * and an actionable `suggestion` per code.
 *
 * `errorCode` is the field to branch on — the `message` text is not stable.
 */
export const SYNC_ERROR_CODES = [
  "generation_unsupported_model",
  "generation_pipeline_failed",
  "generation_unknown_error",
  "generation_input_validation_failed",
  "generation_infra_storage_error",
  "generation_infra_resource_exhausted",
  "generation_infra_service_unavailable",
  "generation_input_video_inaccessible",
  "generation_input_audio_inaccessible",
  "generation_input_image_inaccessible",
  "generation_input_video_invalid",
  "generation_input_audio_invalid",
  "generation_input_segments_invalid",
  "generation_input_trim_invalid",
  "generation_input_face_selection_invalid",
  "generation_input_resolution_unsupported",
  "generation_input_duration_greater_than_max_duration",
  "generation_model_duration_exceeded",
  "generation_plan_duration_exceeded",
  "dubbing_duration_exceeded",
  "free_tier_generations_exhausted",
  "plan_feature_unavailable",
  "account_payment_required",
  "account_on_hold",
  "voice_clone_limit_reached",
  "elevenlabs_quota_exceeded",
  "generation_input_asset_type_mismatch",
  "generation_input_too_many_visual",
  "generation_input_dub_audio_conflict",
  "concurrency_limit_reached",
  "rate_limit_exceeded",
  "generation_not_deletable_while_processing",
  "invalid_generation_id",
  "unsupported_generation_id_format",
  "generation_not_found",
  "generation_conflict",
  "generation_media_probe_timeout",
  "generation_media_probe_unavailable",
  "controller_timeout",
  "controller_unavailable",
  "controller_dependency_error",
  "internal_error",
  "project_not_found",
  "asset_not_found",
  "asset_forbidden",
  "invalid_asset_id_format",
  "uploaded_file_not_found",
  "file_not_in_org_storage",
  "file_size_exceeds_plan_limit",
  "voice_not_found",
  "voice_sample_not_accessible",
  "voice_sample_type_unsupported",
  "voice_sample_upload_required",
  "voice_sample_extraction_failed",
  "voice_sample_source_too_large",
  "voice_sample_too_short",
  "voice_sample_invalid",
  "voice_name_conflict",
  "voice_clone_busy",
  "elevenlabs_api_key_invalid",
  "elevenlabs_service_unavailable",
  "usage_dependency_unavailable",
] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

/**
 * The documented request ceilings, per
 * /api-reference/guides/rate-limits.
 *
 * Concurrency (in-flight `PENDING` + `PROCESSING` generations) is plan-bound —
 * 1 on Free and Hobbyist, 3 Creator, 6 Growth, 15 Scale — and overflow answers
 * **429** with `activeGenerations`, `concurrencyLimit`, `retryAfterSeconds` and
 * `upgradeUrl` on the body, which a plain rate-limit 429 does not carry. Max
 * clip duration is plan-bound too (1 minute on Hobbyist up to 30 on Scale+), so
 * neither is checkable from a request.
 */
export const SYNC_RATE_LIMITS = {
  /** `POST /v2/generate` — 100 requests per minute. */
  create: 100,
  /** `GET /v2/generate/{id}` — 600 requests per minute. */
  poll: 600,
} as const;

// ---------------------------------------------------------------------------
// Input items
// ---------------------------------------------------------------------------

/**
 * The `url`-or-`assetId` pair every media input item carries.
 *
 * The spec encodes the pairing as `allOf: [{ anyOf: [{required:["url"]},
 * {required:["assetId"]}] }]` — an `anyOf`, so it is "at least one" rather than
 * exclusive, and both fields are individually optional. {@link checkInputRefs}
 * is what turns "at least one" into a message.
 */
export interface SyncMediaRef {
  /** A publicly reachable URL sync. fetches. */
  url?: string;
  /** An asset id from your media library (`POST /v2/assets`). */
  assetId?: string;
}

/** A source clip. `refId` labels it for a `segments` entry to point back at. */
export interface SyncVideoInput extends SyncMediaRef {
  type: "video";
  refId?: string;
  /** @deprecated Use the top-level `segments` array. */
  segments_secs?: unknown;
  /** @deprecated Use the top-level `segments` array. */
  segments_frames?: unknown;
}

/**
 * A still to animate. **`sync-3` only** — see {@link SYNC_IMAGE_MODELS}.
 * JPEG, PNG or WebP.
 */
export interface SyncImageInput extends SyncMediaRef {
  type: "image";
  refId?: string;
}

/** A recorded voice track. */
export interface SyncAudioInput extends SyncMediaRef {
  type: "audio";
  /** Required when `segments` is used — that is how a segment names its track. */
  refId?: string;
}

/** The ElevenLabs voice configuration a `type: "text"` input speaks with. */
export interface SyncTtsProviderConfig {
  name: SyncTtsProvider;
  /** A sync. voice id (cloned in Studio) or an ElevenLabs voice id. */
  voiceId: string;
  script: string;
  /** 0–1, default 0.5. Lower is more expressive and less repeatable. */
  stability?: number;
  /** 0–1, default 0.75. How closely to adhere to the original voice. */
  similarityBoost?: number;
}

/**
 * A script instead of a track: sync. synthesizes it, then lip-syncs to it.
 *
 * The finished generation carries `synthesizedAudioUrl` — reuse it as an
 * {@link SyncAudioInput} to keep the exact same take across generations rather
 * than re-synthesizing and getting a different one.
 */
export interface SyncTtsInput {
  type: "text";
  provider: SyncTtsProviderConfig;
  /** Required when `segments` is used. */
  refId?: string;
}

/** The two ways a voice arrives: recorded, or written and spoken for you. */
export type SyncAudioLikeInput = SyncAudioInput | SyncTtsInput;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Which face in the frame to sync, when there is more than one.
 *
 * Three ways to say it, in ascending order of how much you already know:
 * `auto_detect` (let sync. find the talker), `frame_number` + `coordinates`
 * (point at one face in one frame), or `bounding_boxes` / `bounding_boxes_url`
 * (you already ran detection and have a box per frame).
 *
 * `coordinates` are RAW PIXELS in the source's own space, not normalized ratios
 * — the spec says so explicitly, and it is the easy mistake here.
 */
export interface SyncActiveSpeaker {
  /** Defaults to `false`. **Not supported for image inputs** — see {@link checkImageOptions}. */
  auto_detect?: boolean;
  /** Use ASD v3. */
  v3?: boolean;
  /** Which frame `coordinates` refers to. `0` for an image input. */
  frame_number?: number;
  /** `[x, y]` in the source's native pixel space. Not normalized. */
  coordinates?: number[];
  /** `[x1, y1, x2, y2]` per frame, or null where no face was found. */
  bounding_boxes?: (number[] | null)[];
  /** A JSON file with a `bounding_boxes` array, for payloads too big to inline. */
  bounding_boxes_url?: string;
}

/**
 * The six generation options the developer-facing spec publishes.
 *
 * Four of the six are model-gated, and sync. IGNORES an option a model does not
 * take rather than refusing the request ("Unsupported options are ignored if
 * included in a request" — /models/lipsync). So the gate is reported as a
 * WARNING here: refusing would reject a request the API honours, and staying
 * silent would let a caller believe a dial did something.
 */
export interface SyncGenerationOptions {
  /** Duration-mismatch strategy; default `"bounce"`. Ignored for image inputs. */
  sync_mode?: SyncSyncMode;
  /** `react-1` only. Which region the model may move; default `"face"`. */
  model_mode?: SyncModelMode;
  /** `react-1` only. The emotion to perform — one word, from a closed set. */
  prompt?: SyncEmotion;
  /** `lipsync-2` / `lipsync-2-pro` only. 0 least expressive, 1 most; default 0.5. */
  temperature?: number;
  /** Which face to sync when the frame has several. */
  active_speaker_detection?: SyncActiveSpeaker;
  /** Not on `sync-3`, which does it natively. Default `false`; slows generation. */
  occlusion_detection_enabled?: boolean;
}

/** Per-segment overrides — the same options, applied to one time range only. */
export interface SyncSegmentOptionsOverride {
  sync_mode?: SyncSyncMode;
  temperature?: number;
  occlusion_detection_enabled?: boolean;
  active_speaker_detection?: SyncActiveSpeaker;
}

/** Which track plays over one stretch of the clip, and which slice of it. */
export interface SyncSegmentAudioInput {
  /** The `refId` of an audio or text input in the same request. */
  refId: string;
  /** Crop the referenced track. `startTime` and `endTime` come as a pair. */
  startTime?: number;
  endTime?: number;
}

/**
 * One `[startTime, endTime]` stretch of the clip and the track that covers it.
 *
 * Segments are how one video takes several voices. Every audio or text input
 * must carry a unique `refId` when this array is present, because the segment
 * names its track by that id — {@link checkSegmentRefIds} says so before sync.
 * does.
 */
export interface SyncGenerationSegment {
  /** Seconds. Must be ≤ `endTime`. */
  startTime: number;
  /** Seconds. Must be ≥ `startTime`. */
  endTime: number;
  audioInput: SyncSegmentAudioInput;
  optionsOverride?: SyncSegmentOptionsOverride;
}

/**
 * Redub the clip into another language before lip-syncing it.
 *
 * A dubbed request is a DIFFERENT request shape rather than an extra option:
 * the voice comes out of the video's own audio track, so the body carries
 * exactly one video input and no audio or text input at all. Sending both is
 * rejected with `generation_input_dub_audio_conflict`, which
 * {@link checkDubParams} catches first.
 */
export interface SyncDubParams {
  providerName: SyncTtsProvider;
  targetLang: SyncDubLanguage | (string & {});
  /** Defaults to `"auto"`. */
  sourceLang?: SyncDubSourceLanguage | (string & {});
  /** @deprecated Ignored — dubbing v2 detects speakers automatically. */
  numSpeakers?: number;
}

// ---------------------------------------------------------------------------
// Shared zod fragments
// ---------------------------------------------------------------------------

const mediaRefSchema = {
  url: z.string().optional(),
  assetId: z.string().optional(),
  refId: z.string().optional(),
};

export const videoInputSchema = z.looseObject({
  type: z.literal("video"),
  ...mediaRefSchema,
});

export const imageInputSchema = z.looseObject({
  type: z.literal("image"),
  ...mediaRefSchema,
});

export const audioInputSchema = z.looseObject({
  type: z.literal("audio"),
  ...mediaRefSchema,
});

export const ttsInputSchema = z.looseObject({
  type: z.literal("text"),
  provider: z.looseObject({
    name: z.enum(SYNC_TTS_PROVIDERS),
    voiceId: z.string(),
    script: z.string(),
    stability: z.number().min(0).max(1).optional(),
    similarityBoost: z.number().min(0).max(1).optional(),
  }),
  refId: z.string().optional(),
});

export const activeSpeakerSchema = z.looseObject({
  auto_detect: z.boolean().optional(),
  v3: z.boolean().optional(),
  frame_number: z.number().int().optional(),
  coordinates: z.array(z.number()).optional(),
  bounding_boxes: z.array(z.union([z.array(z.number()), z.null()])).optional(),
  bounding_boxes_url: z.string().optional(),
});

export const optionsSchema = z.looseObject({
  sync_mode: z.enum(SYNC_SYNC_MODES).optional(),
  model_mode: z.enum(SYNC_MODEL_MODES).optional(),
  prompt: z.enum(SYNC_EMOTIONS).optional(),
  temperature: z.number().optional(),
  active_speaker_detection: activeSpeakerSchema.optional(),
  occlusion_detection_enabled: z.boolean().optional(),
});

/** `outputFileName` — up to 255 characters; sync. sanitizes and appends `.mp4`. */
export const OUTPUT_FILE_NAME_MAX_CHARS = 255;

/** The fields both verbs share, as one zod fragment. */
export const generationCommonSchema = {
  model: z.string(),
  options: optionsSchema.optional(),
  webhookUrl: z.string().optional(),
  outputFileName: z.string().max(OUTPUT_FILE_NAME_MAX_CHARS).optional(),
  projectId: z.string().optional(),
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * The shape every check below reads — the union of both verbs' fields, with
 * everything widened to its base type.
 *
 * Written out rather than `Record<string, unknown>` for `tripo3d`'s reason: an
 * interface has no implicit index signature, so a check typed against the
 * record would not be assignable to `createValidator`'s `checks` for either
 * verb. The enums are enforced by each verb's own zod schema.
 */
interface GenerationParams {
  model: string;
  input?: readonly { type?: string; url?: string; assetId?: string; refId?: string }[];
  options?: {
    sync_mode?: string;
    model_mode?: string;
    prompt?: string;
    temperature?: number;
    occlusion_detection_enabled?: boolean;
    active_speaker_detection?: { auto_detect?: boolean };
  };
  segments?: readonly unknown[];
  dubParams?: unknown;
}

const VISUAL_TYPES = new Set(["video", "image"]);
const VOICE_TYPES = new Set(["audio", "text"]);

/**
 * The arity rule, stated verbatim in the spec and enforced here.
 *
 * "Normal lipsync requests must include exactly one visual input (video or
 * image) and one audio or text input." It is the first thing a caller gets
 * wrong — `input` is an ARRAY, so passing two clips or forgetting the track
 * both type-check — and the API's own refusal
 * (`generation_input_too_many_visual`) arrives after a round trip.
 *
 * A dubbed request is the documented exception and is checked by
 * {@link checkDubParams} instead: it carries one video and NO voice, on
 * purpose.
 */
export function checkInputArity(source: string, visual: "video" | "image") {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const input = params.input;
    if (!Array.isArray(input)) return;
    const visuals = input.filter((item) => VISUAL_TYPES.has(String(item?.type)));
    const voices = input.filter((item) => VOICE_TYPES.has(String(item?.type)));

    if (visuals.length !== 1) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `A generation takes exactly one visual input; this request has ${visuals.length}. ` +
          `Pass a single \`{ type: "${visual}", url }\` (or \`assetId\`) item` +
          (visuals.length > 1
            ? " — several clips is a several-generation job, not one request."
            : "."),
        meta: { source, visuals: visuals.length },
      });
    }

    // A dubbed request supplies its voice from the video's own track; the
    // "no voice input" half of that rule is checked where it belongs.
    if (params.dubParams !== undefined) return;

    if (voices.length === 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          "A generation needs something to say: add an `{ type: \"audio\", url }` item, or a " +
          '`{ type: "text", provider: { name: "elevenlabs", voiceId, script } }` item to have sync. ' +
          "speak a script for you. (A `dubParams` request is the one exception — it takes the voice " +
          "out of the video's own track.)",
        meta: { source, voices: 0 },
      });
    } else if (voices.length > 1 && params.segments === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `${voices.length} audio or text inputs were given and no \`segments\` array to place them. ` +
          "Several tracks over one clip is the `segments` feature: give each track a unique `refId` " +
          "and add a segment naming it, or send one track.",
        meta: { source, voices: voices.length },
      });
    }
  };
}

/**
 * Each media item needs a `url` or an `assetId`.
 *
 * The spec spells this as an `anyOf` over two `required` lists, which is a
 * shape zod's loose object cannot express and a caller cannot see: both fields
 * are individually optional, so `{ type: "video" }` type-checks and 422s.
 */
export function checkInputRefs(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const input = params.input;
    if (!Array.isArray(input)) return;
    input.forEach((item, index) => {
      const type = String(item?.type);
      if (!VISUAL_TYPES.has(type) && type !== "audio") return;
      if (item?.url !== undefined || item?.assetId !== undefined) return;
      ctx.report({
        code: "invalid_shape",
        path: ["input", index, "url"],
        model: params.model,
        message:
          `\`input[${index}]\` is a \`${type}\` item with neither \`url\` nor \`assetId\`. sync. needs one ` +
          "of the two: a publicly reachable URL it fetches, or the id of an asset you uploaded with " +
          "POST /v2/assets.",
        meta: { source, index, type },
      });
    });
  };
}

/**
 * An image input narrows the model to `sync-3`, and nothing else does.
 *
 * A hard refusal rather than a warning: the API answers
 * `generation_unsupported_model` — "This model is not supported for the
 * selected generation type." — and the fix is to change the model rather than
 * to drop a field.
 */
export function checkImageModel(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const input = params.input;
    if (!Array.isArray(input)) return;
    if (!input.some((item) => item?.type === "image")) return;
    if ((SYNC_IMAGE_MODELS as readonly string[]).includes(params.model)) return;
    ctx.report({
      code: "unsupported_capability",
      path: ["model"],
      model: params.model,
      message:
        `An \`image\` input is supported by ${SYNC_IMAGE_MODELS.map((id) => `"${id}"`).join(", ")} and by no ` +
        `other sync. model; "${params.model}" takes a video. Either switch the model, or pass ` +
        '`{ type: "video", url }` — a still and a clip are different products here, which is why ' +
        "unmodel files them as `avatar` and `lipsync`.",
      meta: { source, allowed: [...SYNC_IMAGE_MODELS] },
    });
  };
}

/**
 * The four model-gated options, reported as warnings because sync. ignores
 * them rather than refusing.
 *
 * The gate is published as a matrix on /models/lipsync ("Unsupported options
 * are ignored if included in a request") and repeated in each field's own
 * description. A caller who set `temperature: 0.9` on `sync-3` got the default
 * expressiveness and no indication; this is the indication.
 */
const GATED_OPTIONS: ReadonlyArray<{
  readonly key: "temperature" | "occlusion_detection_enabled" | "model_mode" | "prompt";
  readonly models: readonly string[];
  readonly why: string;
}> = [
  {
    key: "temperature",
    models: SYNC_TEMPERATURE_MODELS,
    why: "expressiveness is native to sync-3 and absent from lipsync-1.9.0-beta",
  },
  {
    key: "occlusion_detection_enabled",
    models: SYNC_OCCLUSION_MODELS,
    why: "sync-3 detects obstructions automatically and has no switch",
  },
  { key: "model_mode", models: SYNC_REACT_MODELS, why: "only react-1 chooses an edit region" },
  { key: "prompt", models: SYNC_REACT_MODELS, why: "only react-1 performs an emotion" },
];

export function checkModelGatedOptions(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const options = params.options;
    if (options === undefined) return;
    for (const gate of GATED_OPTIONS) {
      if (options[gate.key] === undefined) continue;
      if (gate.models.includes(params.model)) continue;
      ctx.report({
        code: "unknown_param",
        path: ["options", gate.key],
        model: params.model,
        message:
          `\`options.${gate.key}\` only applies to ${gate.models.map((id) => `"${id}"`).join(", ")}, and this ` +
          `request names "${params.model}" — ${gate.why}. sync. ignores an option a model does not take, ` +
          "so the request will succeed and the dial will have done nothing.",
        meta: { source, allowed: [...gate.models] },
      });
    }
  };
}

/**
 * Two options mean nothing to a still, and they mean nothing for different
 * reasons — so they get different severities.
 *
 * `sync_mode` answers "what if the clip and the track are different lengths",
 * which a still cannot be asked; sync. ignores it, so this is a warning.
 * `active_speaker_detection.auto_detect` is documented as NOT SUPPORTED for
 * image inputs, with a prescribed alternative — `coordinates` in the image's
 * native pixel space with `frame_number: 0` — so it is an error that names the
 * alternative.
 *
 * The two doc pages disagree about how far this goes: `GenerationOptions`
 * describes `active_speaker_detection` as a whole as "Not supported for image
 * inputs", while `/models/sync-3` says manual selection IS supported and only
 * auto-detect is not. The per-model page is the narrower, later statement and
 * is what this check follows.
 */
export function checkImageOptions(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const options = params.options;
    if (options === undefined) return;

    if (options.sync_mode !== undefined) {
      ctx.report({
        code: "unknown_param",
        path: ["options", "sync_mode"],
        model: params.model,
        message:
          "`options.sync_mode` decides what to do when the clip and the track are different lengths, " +
          "and an image has no duration to mismatch — sync. ignores it for image inputs. The output's " +
          "length is the audio's.",
        meta: { source },
      });
    }

    if (options.active_speaker_detection?.auto_detect === true) {
      ctx.report({
        code: "unsupported_param",
        path: ["options", "active_speaker_detection", "auto_detect"],
        model: params.model,
        message:
          "`auto_detect: true` is not supported for image inputs. For a still with more than one face, " +
          "point at the one to animate: `coordinates: [x, y]` in the image's NATIVE PIXEL space (not " +
          "normalized) together with `frame_number: 0`.",
        meta: { source },
      });
    }
  };
}

/**
 * `dubParams` forbids the voice inputs the request would otherwise need.
 *
 * The one place where "add the audio" is the wrong advice. A dubbed generation
 * extracts the source audio from the video, translates it and lip-syncs the
 * result, so an `audio` or `text` item is a contradiction rather than an extra
 * — `generation_input_dub_audio_conflict` is its own error code, which is how
 * often it happens.
 */
export function checkDubParams(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.dubParams === undefined) return;
    const input = params.input;
    if (!Array.isArray(input)) return;
    const voices = input.filter((item) => VOICE_TYPES.has(String(item?.type)));
    if (voices.length === 0) return;
    ctx.report({
      code: "invalid_shape",
      path: ["dubParams"],
      model: params.model,
      message:
        `\`dubParams\` dubs the video's OWN audio track into ${
          (params.dubParams as { targetLang?: string } | undefined)?.targetLang === undefined
            ? "the target language"
            : `"${(params.dubParams as { targetLang?: string }).targetLang ?? ""}"`
        }, so the request must carry exactly one video input and no audio or text input; this one ` +
        `has ${voices.length}. Drop the voice input, or drop \`dubParams\` and supply the translated ` +
        "track yourself.",
      meta: { source, voices: voices.length },
    });
  };
}

/**
 * `segments` names its tracks by `refId`, so every track needs one and no two
 * may share.
 *
 * Stated twice in the spec — on `Audio.refId` ("Required when using segments
 * array") and on the `input` description — and invisible in the type, because
 * `refId` is optional on the item where it is conditionally required.
 */
export function checkSegmentRefIds(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const segments = params.segments;
    if (!Array.isArray(segments) || segments.length === 0) return;
    const input = params.input;
    if (!Array.isArray(input)) return;
    const voices = input.filter((item) => VOICE_TYPES.has(String(item?.type)));

    const missing = voices.filter((item) => item?.refId === undefined).length;
    if (missing > 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `\`segments\` is present and ${missing} of the ${voices.length} audio or text inputs carry no ` +
          "`refId`. A segment points at its track by that id, so each one needs a unique `refId` before " +
          "a segment can name it.",
        meta: { source, missing },
      });
    }

    const ids = voices.map((item) => item?.refId).filter((id): id is string => id !== undefined);
    const duplicated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (duplicated.length > 0) {
      ctx.report({
        code: "invalid_shape",
        path: ["input"],
        model: params.model,
        message:
          `${duplicated.map((id) => `"${id}"`).join(", ")} ${duplicated.length === 1 ? "is" : "are"} used as ` +
          "a `refId` by more than one input. The ids have to be unique — a segment naming a duplicated " +
          "one cannot say which track it meant.",
        meta: { source, duplicated },
      });
    }

    // A segment whose `refId` names nothing is the mirror of the above and is
    // just as invisible: `audioInput.refId` is a required STRING, so a typo
    // type-checks.
    const known = new Set(ids);
    segments.forEach((segment, index) => {
      const refId = (segment as { audioInput?: { refId?: string } } | undefined)?.audioInput?.refId;
      if (refId === undefined || known.has(refId)) return;
      ctx.report({
        code: "invalid_shape",
        path: ["segments", index, "audioInput", "refId"],
        model: params.model,
        message:
          `\`segments[${index}]\` names the track "${refId}", which no input carries. The ids in scope are ` +
          `${known.size === 0 ? "none — no input declares a `refId`" : [...known].map((id) => `"${id}"`).join(", ")}.`,
        meta: { source, refId, known: [...known] },
      });
    });
  };
}
