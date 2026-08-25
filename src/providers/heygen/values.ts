/**
 * `unmodel/heygen/values` — the **runtime** lists behind this provider's
 * unified surface (lipsync and avatar).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids per category, the per-model narrowing rows, and
 * HeyGen's own published enums — three resolutions, six aspect ratios, two
 * output formats, three expressiveness levels, three engines, two lipsync
 * modes, two status enums that are NOT the same, and the voice-engine
 * vocabularies behind `voice_settings`.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `AVATAR_MODEL_PARAMS` and
 * the request the matching `unmodel/avatar` builds cannot disagree. They are
 * read from the import-free `./lipsync-params.ts` and `./avatar-params.ts`
 * leaves rather than from the adapters, which is what keeps this entry off this
 * provider's validators, its zod schemas and its catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 *
 * Three exports here are worth knowing about specifically:
 *
 * - `HEYGEN_VIDEO_STATUSES` and `HEYGEN_LIPSYNC_STATUSES` are DIFFERENT lists.
 *   The video route says `processing` where the lipsync route says `running`.
 *   One vendor, two lifecycles — a shared `switch` over them falls through.
 * - `HEYGEN_ENGINES` plus `HEYGEN_EXPRESSIVENESS_ENGINES` /
 *   `HEYGEN_MOTION_PROMPT_ENGINES` / `HEYGEN_IMAGE_ENGINES` are the engine gate
 *   as data, so a form can grey out `expressiveness` the moment Avatar V is
 *   selected rather than letting HeyGen answer 400.
 * - `HEYGEN_LIPSYNC_MODE_BY_MODEL` is the id → wire-value map. The two model
 *   ids in this catalog are not a wire field; `mode` is.
 */

export {
  HEYGEN_LIPSYNC_MODEL_PARAMS as LIPSYNC_MODEL_PARAMS,
  MODELS as LIPSYNC_MODELS,
} from "./lipsync-params";

export {
  HEYGEN_AVATAR_MODEL_PARAMS as AVATAR_MODEL_PARAMS,
  MODELS as AVATAR_MODELS,
} from "./avatar-params";

export {
  HEYGEN_ASPECT_RATIOS,
  HEYGEN_BACKGROUND_TYPES,
  HEYGEN_CAPTION_FILE_FORMATS,
  HEYGEN_CAPTION_STYLES,
  HEYGEN_DEFAULT_ENGINE,
  HEYGEN_ELEVENLABS_MODELS,
  HEYGEN_ENGINES,
  HEYGEN_EXPRESSIVENESS,
  HEYGEN_EXPRESSIVENESS_ENGINES,
  HEYGEN_FISH_MODELS,
  HEYGEN_FITS,
  HEYGEN_FPS_MODES,
  HEYGEN_IDEMPOTENCY_HEADER,
  HEYGEN_IDEMPOTENCY_KEY_PATTERN,
  HEYGEN_IMAGE_ENGINES,
  HEYGEN_LIPSYNC_MODELS,
  HEYGEN_LIPSYNC_MODES,
  HEYGEN_LIPSYNC_MODE_BY_MODEL,
  HEYGEN_LIPSYNC_MODEL_BY_MODE,
  HEYGEN_LIPSYNC_STATUSES,
  HEYGEN_MAX_CONCURRENT_JOBS,
  HEYGEN_MOTION_PROMPT_ENGINES,
  HEYGEN_OUTPUT_FORMATS,
  HEYGEN_RESOLUTIONS,
  HEYGEN_V1_V2_SUNSET,
  HEYGEN_VIDEO_STATUSES,
  HEYGEN_VIDEO_TYPES,
  HEYGEN_VOICE_ENGINES,
  HEYGEN_WATERMARK_POSITIONS,
} from "./shared";
