/**
 * `unmodel/revana` — Revana (https://revana.si), a router: one key and one
 * prepaid balance over image, video, speech, music and language models from
 * two dozen makers, each served by the cheapest of several routes.
 *
 * Three routes, thirteen addresses:
 *
 * | address | route | models |
 * |---|---|---|
 * | `revana.video` | `POST /v1/generations` | every `kind: "video"` model |
 * | `revana.lipsync` | 〃 | the clip-and-sound video models (a view) |
 * | `revana.avatar` | 〃 | the still-and-sound video models (a view) |
 * | `revana.image` | 〃 | every `kind: "image"` model |
 * | `revana.imageEdit` | 〃 | the image models that edit (a view) |
 * | `revana.upscale` | 〃 | the upscalers (a view) |
 * | `revana.tts` | 〃 | the speech models |
 * | `revana.music` | 〃 | the music models |
 * | `revana.videoQueue` | `POST /v1/queue/revana/{model_id}` | every `kind: "video"` model |
 * | `revana.imageQueue` | 〃 | every `kind: "image"` model |
 * | `revana.ttsQueue` | 〃 | the speech models |
 * | `revana.musicQueue` | 〃 | the music models |
 * | `revana.chat` | `POST /v1/chat/completions` | every `kind: "text"` model |
 *
 * The eight media addresses post ONE body — `{ model, input }` — to ONE url,
 * and `model` is a real, required field that picks the model. They are
 * separate addresses because what a caller is doing differs, not because the
 * wire does (`docs/decisions.md` §2 and §4); they share one check battery, and
 * the four marked "a view" refuse nothing their wide neighbour accepts except
 * what is not theirs.
 *
 * The four `*Queue` addresses reach the same media models by Revana's second
 * route, which follows fal's HTTP convention: the model is the URL path, the
 * body is the input with no wrapper, and `fal_webhook` has Revana POST the
 * outcome instead of being polled for it. Same battery, same tables.
 *
 * What comes back: `checkGeneration` and `checkQueueStatus` report a job the
 * way every provider's checker does, and `verifyWebhook` is the receiving end
 * of `fal_webhook` — it checks a delivery's signature and returns it typed.
 *
 * Revana resells weights unmodel already reaches natively — `veo-3.1` is also
 * `google.video`, `seedance-2.5` also `bytedance.video`, `elevenlabs-v3` also
 * `elevenlabs.tts` — through a different body each time, and unmodel keeps
 * them apart on purpose (§1).
 *
 * Everything per-model here is generated from Revana's own keyless catalog by
 * `scripts/codegen-revana.ts`. Auth is `Authorization: Bearer
 * <REVANA_API_KEY>`; unmodel never touches keys.
 */

export { video } from "./video";
export { lipsync } from "./lipsync";
export { avatar } from "./avatar";
export { image } from "./image";
export { imageEdit } from "./image-edit";
export { upscale } from "./upscale";
export { tts } from "./tts";
export { music } from "./music";
export { videoQueue } from "./video-queue";
export { imageQueue } from "./image-queue";
export { ttsQueue } from "./tts-queue";
export { musicQueue } from "./music-queue";
export {
  chat,
  checkChat,
  estimateChatTokens,
  CHAT_COMPLETIONS_URL,
  REVANA_CHAT_SOURCE,
} from "./chat";

export type { GenerationValidator, RequestFor } from "./generation";
export type { QueueBodyFor, QueueRequestFor, QueueValidator } from "./queue";

export { checkGeneration, checkQueueStatus } from "./check";
export type { GenerationLike, QueueEnvelopeLike, QueueOutcome, RevanaGenerationStatus } from "./check";

export {
  REVANA_SIGNATURE_HEADER,
  REVANA_WEBHOOK_ID_HEADER,
  REVANA_WEBHOOK_TOLERANCE_SECONDS,
  verifyWebhook,
} from "./webhook";
export type { VerifyWebhookInput, WebhookForgeryReason, WebhookHeaders, WebhookVerification } from "./webhook";

export type {
  QueueAudioResult,
  QueueBody,
  QueueDuration,
  QueueEnvelope,
  QueueErrorBody,
  QueueExtensions,
  QueueFailed,
  QueueFile,
  QueueImageResult,
  QueueInput,
  QueuePending,
  QueueRequest,
  QueueResult,
  QueueStatus,
  QueueSucceeded,
  QueueVideoResult,
  QueueWebhookDelivery,
  QueueWebhookFailure,
  QueueWebhookSuccess,
  WebhookSecret,
} from "./queue-wire";

export type {
  FailedGeneration,
  Generation,
  GenerationError,
  GenerationErrorCode,
  GenerationOutput,
  GenerationProgress,
  GenerationRequest,
  GenerationStatus,
  GenerationTask,
  ImageModelInput,
  InputFor,
  ModelInput,
  MusicModelInput,
  NemesisInput,
  NemesisRole,
  PendingGeneration,
  Quote,
  RevanaErrorBody,
  RevanaErrorCode,
  RevanaMediaModelId,
  RevanaMediaUrl,
  SeedanceInput,
  SpeechDialogueLine,
  SpeechModelInput,
  SucceededGeneration,
  UnknownModelRequest,
  VideoModelInput,
} from "./generation-wire";

export {
  BALANCE_URL,
  GENERATIONS_QUOTE_URL,
  GENERATIONS_URL,
  MODELS_URL,
  QUEUE_BASE_URL,
  REVANA_BASE_URL,
  UPLOADS_URL,
  WEBHOOKS_SECRET_URL,
  generationContentUrl,
  generationUrl,
  queueResultUrl,
  queueStatusUrl,
  queueUrl,
} from "./urls";

export { REVANA_API_SOURCE, REVANA_MODELS_SOURCE, REVANA_QUEUE_SOURCE } from "./checks";

export { REVANA_PRICING_CAVEAT, REVANA_PRICING_SOURCE, revanaCostUSD } from "./pricing";

export { REVANA_MUSIC_SHAPES } from "./gen/shapes-music.gen";
export { REVANA_TTS_SHAPES } from "./gen/shapes-tts.gen";
export { REVANA_IMAGE_SHAPES } from "./gen/shapes-image.gen";
export { REVANA_VIDEO_SHAPES } from "./gen/shapes-video.gen";
export { REVANA_MUSIC_PRICES } from "./gen/prices-music.gen";
export { REVANA_TTS_PRICES } from "./gen/prices-tts.gen";
export { REVANA_IMAGE_PRICES } from "./gen/prices-image.gen";
export { REVANA_VIDEO_PRICES } from "./gen/prices-video.gen";
export { REVANA_VOICES } from "./gen/voices.gen";
export {
  REVANA_AVATAR_MODELS,
  REVANA_CHAT_MODELS,
  REVANA_IMAGE_EDIT_MODELS,
  REVANA_IMAGE_MODELS,
  REVANA_LIPSYNC_MODELS,
  REVANA_MUSIC_MODELS,
  REVANA_TTS_MODELS,
  REVANA_UPSCALE_MODELS,
  REVANA_VIDEO_MODELS,
} from "./gen/ids.gen";
export type {
  RevanaAvatarModelId,
  RevanaChatModelId,
  RevanaImageEditModelId,
  RevanaImageModelId,
  RevanaLipsyncModelId,
  RevanaMusicModelId,
  RevanaTtsModelId,
  RevanaUpscaleModelId,
  RevanaVideoModelId,
} from "./gen/ids.gen";

export type {
  RevanaDurationRange,
  RevanaListedPrice,
  RevanaMediaField,
  RevanaModelShape,
  RevanaRate,
  RevanaSpeechField,
  RevanaTask,
} from "./shape-types";

export { models, provider } from "./models";
export type { RevanaModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
