/**
 * `unmodel/revana/values` — the **runtime** lists behind this provider's
 * unified surfaces (video, lipsync, avatar, image, image-edit, upscale, tts,
 * music).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids each category addresses, and the per-model narrowing
 * rows (the clip lengths a model lists, the canonical size tiers it can
 * express, its shapes, its voices and languages, and the extras it takes). It
 * is the value half of `unmodel/revana/types`, for the client-side validation
 * and the pickers a type cannot draw.
 *
 * The tables are **the same objects the adapters compile with** — re-exported,
 * never copied — so a picker built from `VIDEO_MODEL_PARAMS` and the request
 * the matching `unmodel/video` builds cannot disagree. They are read from the
 * import-free `*-params` leaves rather than from the adapters, which is what
 * keeps this entry off Revana's validators, its zod schema and its catalogs;
 * `test/values-entries.test.ts` measures that against a real build.
 *
 * The rows are GENERATED from Revana's own keyless catalog
 * (`GET /v1/models`), so a picker rendered from them shows what the catalog
 * listed at the committed snapshot, in the canonical vocabulary.
 *
 * `TTS_DELIVERY` describes where the audio ENDS UP, which at a queue is one
 * poll away — see `./tts-params.ts`. `REVANA_VOICES` is the one list here that
 * is not a narrowing row: `TTS_MODEL_PARAMS` carries voice IDS, and this is
 * the name and description behind each.
 */

export {
  REVANA_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";

export {
  REVANA_LIPSYNC_MODEL_PARAMS as LIPSYNC_MODEL_PARAMS,
  MODELS as LIPSYNC_MODELS,
} from "./lipsync-params";

export {
  REVANA_AVATAR_MODEL_PARAMS as AVATAR_MODEL_PARAMS,
  MODELS as AVATAR_MODELS,
} from "./avatar-params";

export {
  REVANA_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
} from "./image-params";

export {
  REVANA_IMAGE_EDIT_MODEL_PARAMS as IMAGE_EDIT_MODEL_PARAMS,
  MODELS as IMAGE_EDIT_MODELS,
} from "./image-edit-params";

export {
  REVANA_UPSCALE_MODEL_PARAMS as UPSCALE_MODEL_PARAMS,
  MODELS as UPSCALE_MODELS,
} from "./upscale-params";

export {
  REVANA_TTS_DELIVERY as TTS_DELIVERY,
  REVANA_TTS_MODEL_PARAMS as TTS_MODEL_PARAMS,
  MODELS as TTS_MODELS,
} from "./tts-params";

export {
  REVANA_MUSIC_MODEL_PARAMS as MUSIC_MODEL_PARAMS,
  MODELS as MUSIC_MODELS,
} from "./music-params";

export { REVANA_VOICES } from "./gen/voices.gen";
