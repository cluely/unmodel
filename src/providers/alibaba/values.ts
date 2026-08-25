/**
 * `unmodel/alibaba/values` — the **runtime** lists behind this provider's
 * unified surfaces (video, tts).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed durations,
 * resolutions, ratios, voices, languages) and the provider's own published
 * enums. It is the value half of `unmodel/alibaba/types`, for the
 * client-side validation and the pickers a type cannot draw.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `*_MODEL_PARAMS` and the
 * request the matching `unmodel/video` builds cannot disagree. They are read
 * from import-free `*-params` leaves rather than from the adapters, which is
 * what keeps one import off this provider's validator, its zod schema and its
 * catalog; `test/values-entries.test.ts` measures that against a real build.
 */

export {
  ALIBABA_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
  WAN_RATIOS,
  HAPPYHORSE_RATIOS,
} from "./video-params";

export {
  ALIBABA_TTS_MODEL_PARAMS as TTS_MODEL_PARAMS,
  MODELS as TTS_MODELS,
  ALIBABA_TTS_DELIVERY as TTS_DELIVERY,
  LANGUAGE_TYPES,
  LANGUAGE_TYPE_BY_SUBTAG,
  TTS_LANGUAGES,
  QWEN3_TTS_FLASH_VOICES,
  QWEN3_TTS_FLASH_2025_09_18_VOICES,
  QWEN3_TTS_INSTRUCT_FLASH_VOICES,
  VOICES_BY_MODEL,
} from "./tts-params";
