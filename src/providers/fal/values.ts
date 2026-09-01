/**
 * `unmodel/fal/values` — the **runtime** lists behind this provider's unified
 * surfaces (image, image-edit, video, lipsync, avatar, upscale, 3d, tts, stt,
 * music, sfx).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the endpoint ids, and the per-endpoint narrowing rows (that
 * endpoint's own `image_size` presets, its `aspect_ratio` vocabulary, the
 * resolution tiers it can express, the clip lengths it offers, the image roles
 * its route serves, the source shape it takes, the voices and languages it
 * publishes, the codecs it can emit, and the extras it takes). It is the value
 * half of `unmodel/fal/types`, for the client-side validation and the pickers
 * a type cannot draw.
 *
 * `TTS_DELIVERY` is the one export here that is not a request-side list: it
 * describes where the audio ENDS UP, which at a queue provider is two hops
 * away. See `./tts-params.ts` for why the path is relative to the result
 * document rather than to the submit response.
 *
 * The tables are **the same objects the adapters compile with** — re-exported,
 * never copied — so a picker built from `*_MODEL_PARAMS` and the request the
 * matching `unmodel/image` builds cannot disagree. They are read from the
 * import-free `*-params` leaves rather than from the adapters, which is what
 * keeps this entry off fal's validators, its zod schemas and its catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 *
 * One thing is worth knowing that is not true of the hand-written providers:
 * these rows are GENERATED from fal's own published OpenAPI documents. A
 * picker rendered from them is showing the endpoint's own declared vocabulary,
 * refreshed weekly, rather than a transcription of it.
 */

export {
  FAL_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
} from "./image-params";

export {
  FAL_IMAGE_EDIT_MODEL_PARAMS as IMAGE_EDIT_MODEL_PARAMS,
  MODELS as IMAGE_EDIT_MODELS,
} from "./image-edit-params";

export {
  FAL_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";

export {
  FAL_LIPSYNC_MODEL_PARAMS as LIPSYNC_MODEL_PARAMS,
  MODELS as LIPSYNC_MODELS,
} from "./lipsync-params";

export {
  FAL_AVATAR_MODEL_PARAMS as AVATAR_MODEL_PARAMS,
  MODELS as AVATAR_MODELS,
} from "./avatar-params";

export {
  FAL_UPSCALE_MODEL_PARAMS as UPSCALE_MODEL_PARAMS,
  MODELS as UPSCALE_MODELS,
} from "./upscale-params";

// The one category whose uniform alias is not its id upper-cased: the category
// is `3d`, and `3D_MODEL_PARAMS` is not an identifier. `THREE_D` is the same
// spelling the verb, the generated constants and the file names use.
export {
  FAL_THREE_D_MODEL_PARAMS as THREE_D_MODEL_PARAMS,
  MODELS as THREE_D_MODELS,
} from "./three-d-params";

export {
  FAL_TTS_DELIVERY as TTS_DELIVERY,
  FAL_TTS_MODEL_PARAMS as TTS_MODEL_PARAMS,
  MODELS as TTS_MODELS,
} from "./tts-params";

export {
  FAL_STT_MODEL_PARAMS as STT_MODEL_PARAMS,
  MODELS as STT_MODELS,
} from "./stt-params";

export {
  FAL_MUSIC_MODEL_PARAMS as MUSIC_MODEL_PARAMS,
  MODELS as MUSIC_MODELS,
} from "./music-params";

export {
  FAL_SFX_MODEL_PARAMS as SFX_MODEL_PARAMS,
  MODELS as SFX_MODELS,
} from "./sfx-params";
