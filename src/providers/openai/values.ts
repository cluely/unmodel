/**
 * `unmodel/openai/values` — the **runtime** lists behind this provider's
 * unified surfaces (image, image-edit, video, tts, stt).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed sizes, ratios,
 * durations, resolutions, voices, codecs, languages, timestamp granularities)
 * and the provider's own published enums. It is the value half of
 * `unmodel/openai/types`, for the client-side validation and the pickers
 * a type cannot draw.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `*_MODEL_PARAMS` and the
 * request the matching `unmodel/image` builds cannot disagree. They are read from
 * import-free `*-params` leaves rather than from the adapters, which is what
 * keeps one import off this provider's validator, zod schema and catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 */

export { OPENAI_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS, IMAGE_MODELS } from "./image-params";

export {
  OPENAI_IMAGE_EDIT_MODEL_PARAMS as IMAGE_EDIT_MODEL_PARAMS,
  IMAGE_EDIT_MODELS,
} from "./image-params";

export {
  OPENAI_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";

export {
  OPENAI_TTS_MODEL_PARAMS as TTS_MODEL_PARAMS,
  MODELS as TTS_MODELS,
  FORMAT as TTS_FORMAT_SPEC,
  OPENAI_TTS_DELIVERY as TTS_DELIVERY,
} from "./tts-params";

export { OPENAI_STT_MODEL_PARAMS as STT_MODEL_PARAMS, MODELS as STT_MODELS } from "./stt-params";

export {
  SPEECH_RESPONSE_FORMATS,
  SPEECH_VOICES,
  TRANSCRIPTION_FILE_FORMATS,
  TRANSCRIPTION_RESPONSE_FORMATS,
  TTS_1_VOICES,
} from "./constraints";

export {
  DALL_E_2_SIZE_VALUES,
  DALL_E_3_SIZE_VALUES,
  GPT_IMAGE_1_SIZE_VALUES,
  GPT_IMAGE_2_SIZES,
} from "./images-shared";
