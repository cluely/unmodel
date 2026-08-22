/**
 * `unmodel/google/values` — the **runtime** lists behind this provider's
 * unified surfaces (image, video, tts, stt).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed sizes, ratios,
 * durations, resolutions, voices, codecs, languages, timestamp granularities)
 * and the provider's own published enums. It is the value half of
 * `unmodel/google/types`, for the client-side validation and the pickers
 * a type cannot draw.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `*_MODEL_PARAMS` and the
 * request the matching `unmodel/image` builds cannot disagree. They are read from
 * import-free `*-params` leaves rather than from the adapters, which is what
 * keeps one import off this provider's validator, zod schema and catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 */

export {
  GOOGLE_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
} from "./image-params";

export {
  GOOGLE_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";

export {
  GOOGLE_TTS_MODEL_PARAMS as TTS_MODEL_PARAMS,
  MODELS as TTS_MODELS,
  FORMAT as TTS_FORMAT_SPEC,
} from "./tts-params";

export { GOOGLE_STT_MODEL_PARAMS as STT_MODEL_PARAMS, MODELS as STT_MODELS } from "./stt-params";

export {
  GEMINI_IMAGE_ASPECT_RATIOS,
  GEMINI_IMAGE_SIZES,
  IMAGEN_ASPECT_RATIOS,
  IMAGEN_IMAGE_SIZES,
  IMAGEN_PERSON_GENERATION,
  IMAGEN_SAMPLE_COUNTS,
} from "./image-constraints";

export {
  GEMINI_AUDIO_FORMATS,
  GEMINI_AUDIO_MIME_TYPES,
  GEMINI_STT_MODEL_IDS,
} from "./audio-constraints";

export {
  GEMINI_AUDIO_DELIVERY_MODES,
  GEMINI_COMPRESSED_AUDIO_ENUM_NAMES,
  GEMINI_TTS_LANGUAGE_CODES,
  GEMINI_TTS_MODEL_IDS,
  GEMINI_TTS_STREAMING_MODEL_IDS,
} from "./tts-constraints";

export { GEMINI_TTS_VOICES } from "./wire";
