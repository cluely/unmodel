/**
 * unmodel/sync — sync.'s v2 lipsync API.
 *
 * `https://api.sync.so/v2`, flat JSON bodies, `x-api-key: <SYNC_API_KEY>`.
 *
 * ## Why the provider id is `sync` and not `sync-so`
 *
 * The vendor is "sync." (Sync Labs); `sync.so` is where it happens to be
 * hosted. unmodel's provider ids are VENDOR names, not domains — `kling` rather
 * than `klingai.com`, `krea` rather than `krea.ai`, `vidu` rather than
 * `vidu.com` — and every one of them is the shortest name the vendor answers
 * to. sync. answers to `sync`: its Python SDK is imported `from sync import
 * Sync`, its TypeScript SDK reads `SYNC_API_KEY`, and its own docs write the
 * product name with a full stop rather than a TLD. So the ref reads
 * `"sync/lipsync-2"` — the vendor and its model — where `"sync-so/lipsync-2"`
 * would read as a hostname. Nothing else in `src/providers/` is called `sync`,
 * and the wire parameter `sync_mode` (a duration-mismatch strategy) is a field
 * name rather than an id, so there is nothing to collide with.
 *
 * ## What is here
 *
 * Both generation shapes on the one route sync. publishes, `POST /v2/generate`:
 *
 * - `lipsync` — a source CLIP plus a voice track, across all five models
 *   (`sync-3`, `lipsync-2`, `lipsync-2-pro`, `lipsync-1.9.0-beta`, `react-1`).
 * - `avatar` — a STILL plus a voice track, on `sync-3`, which is the only model
 *   that reads an image.
 *
 * Two addresses on one URL, because they are two requests: the still route
 * narrows the model to one id and cannot carry `segments` (a still has no
 * timeline to slice) or `dubParams` (a still has no audio to translate). That
 * is a difference in required fields, which is what the library's
 * qualified-address rule is about — and it is the same split `unmodel/lipsync`
 * and `unmodel/avatar` make one layer up.
 *
 * ## What is deliberately NOT here
 *
 * **`POST /v2/tts` and the `/v2/voices` clone surface.** They are an ElevenLabs
 * passthrough — the request's own `provider.name` field has exactly one legal
 * value — and unmodel already carries ElevenLabs natively at
 * `unmodel/elevenlabs`, with the real voice roster, the real model ids and the
 * real format controls rather than a two-field projection of them. A `sync.tts`
 * would be a worse ElevenLabs under another vendor's name. (The `{ type:
 * "text" }` INPUT item is a different thing and IS served: there the synthesis
 * is a stage of the lipsync generation rather than a product of its own, and
 * the finished generation hands back `synthesizedAudioUrl` so the same take can
 * be reused.)
 *
 * **`/v2/assets`, `/v2/projects` and `/v2/batch`.** Assets and projects are
 * storage and organisation rather than generation; they mint the `assetId` an
 * input item may carry, which is typed, and nothing else. Batch is a JSONL
 * envelope around up to 500 copies of the body this provider already validates.
 *
 * ## Three things worth knowing before your first call
 *
 * **`input` is an ARRAY with an arity rule.** Exactly one visual item and one
 * audio-or-text item — passing two clips or forgetting the track both
 * type-check, and both are 422s. `checkInputArity` says so first. Each media
 * item needs a `url` OR an `assetId`, which the spec encodes as an `anyOf` and
 * therefore leaves both fields individually optional.
 *
 * **Four of the six `options` are model-gated, and sync. IGNORES the ones a
 * model does not take** rather than refusing them. `temperature` on `sync-3`
 * and `model_mode` on anything but `react-1` are silent no-ops; unmodel reports
 * them as warnings, because refusing would reject a request the API honours.
 *
 * **The POST answers a JOB, at 201.** Poll `GET /v2/generate/{id}` until
 * `status` is `COMPLETED`, `FAILED` or `REJECTED` — `REJECTED` means it never
 * ran — and branch on `errorCode`, not on the message text. The full catalog is
 * `SYNC_ERROR_CODES`, served live and unauthenticated at `ERRORS_URL`. Note
 * that the webhook payload spells the same field `error_code`; the two shapes
 * are not the same object.
 */

export { lipsync, lipsyncConstraints } from "./lipsync";
export type { SyncLipsyncInputItem, SyncLipsyncParams } from "./lipsync";

export { avatar, avatarConstraints } from "./avatar";
export type { SyncAvatarInputItem, SyncAvatarParams } from "./avatar";

export {
  ANALYZE_COST_URL,
  DOCS_BASE,
  ERRORS_URL,
  GENERATE_URL,
  MODELS_URL,
  OUTPUT_FILE_NAME_MAX_CHARS,
  SYNC_BASE_URL,
  SYNC_DUB_LANGUAGES,
  SYNC_DUB_SOURCE_LANGUAGES,
  SYNC_EMOTIONS,
  SYNC_ERROR_CODES,
  SYNC_GENERATION_STATUSES,
  SYNC_IMAGE_MODELS,
  SYNC_MODELS,
  SYNC_MODEL_MODES,
  SYNC_MODEL_TYPES,
  SYNC_OCCLUSION_MODELS,
  SYNC_RATE_LIMITS,
  SYNC_REACT_MODELS,
  SYNC_SYNC_MODES,
  SYNC_TEMPERATURE_MODELS,
  SYNC_TTS_PROVIDERS,
  WEBHOOK_SECRET_URL,
  generationUrl,
} from "./shared";
export type {
  SyncActiveSpeaker,
  SyncAudioInput,
  SyncAudioLikeInput,
  SyncDubLanguage,
  SyncDubParams,
  SyncDubSourceLanguage,
  SyncEmotion,
  SyncErrorCode,
  SyncGenerationOptions,
  SyncGenerationSegment,
  SyncGenerationStatus,
  SyncImageInput,
  SyncImageModelId,
  SyncMediaRef,
  SyncModelId,
  SyncModelMode,
  SyncModelType,
  SyncSegmentAudioInput,
  SyncSegmentOptionsOverride,
  SyncSyncMode,
  SyncTtsInput,
  SyncTtsProvider,
  SyncTtsProviderConfig,
  SyncVideoInput,
} from "./shared";

export { models, provider } from "./models";
export type { SyncCatalogModelId } from "./models";
