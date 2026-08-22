/**
 * `unmodel/elevenlabs/values` — the **runtime** lists behind this provider's
 * unified surfaces (tts, stt, music).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed sizes, ratios,
 * durations, resolutions, voices, codecs, languages, timestamp granularities)
 * and the provider's own published enums. It is the value half of
 * `unmodel/elevenlabs/types`, for the client-side validation and the pickers
 * a type cannot draw.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `*_MODEL_PARAMS` and the
 * request the matching `unmodel/tts` builds cannot disagree. They are read from
 * import-free `*-params` leaves rather than from the adapters, which is what
 * keeps one import off this provider's validator, zod schema and catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 */

export {
  ELEVENLABS_TTS_MODEL_PARAMS as TTS_MODEL_PARAMS,
  MODELS as TTS_MODELS,
  FORMAT as TTS_FORMAT_SPEC,
} from "./tts-params";

export {
  ELEVENLABS_STT_MODEL_PARAMS as STT_MODEL_PARAMS,
  MODELS as STT_MODELS,
} from "./stt-params";

export {
  ELEVENLABS_MUSIC_MODEL_PARAMS as MUSIC_MODEL_PARAMS,
  MODELS as MUSIC_MODELS,
  FORMAT as MUSIC_FORMAT_SPEC,
} from "./music-params";
