/**
 * `unmodel/sync/values` — the **runtime** lists behind this provider's unified
 * surface (lipsync and avatar).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids per category, the per-model narrowing rows (which
 * extras each model takes), and sync.'s own published enums — the five
 * duration-mismatch strategies, the three `react-1` edit regions, the six
 * emotions, the five generation states, the 93 dubbing languages. It is the
 * value half of `unmodel/sync/types`, for the client-side validation and the
 * pickers a type cannot draw.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `LIPSYNC_MODEL_PARAMS` and
 * the request the matching `unmodel/lipsync` builds cannot disagree. They are
 * read from the import-free `./lipsync-params.ts` and `./avatar-params.ts`
 * leaves rather than from the adapters, which is what keeps this entry off this
 * provider's validators, its zod schemas and its catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 *
 * Two exports here are not request-side vocabularies and are the most useful
 * ones for a form:
 *
 * - `SYNC_ERROR_CODES` — every `errorCode` sync. can answer with, so a client
 *   can branch on a code rather than on a message. Refresh it from the
 *   unauthenticated `GET https://api.sync.so/v2/errors`, which also carries a
 *   message and a suggested fix per code.
 * - `SYNC_TEMPERATURE_MODELS` / `SYNC_OCCLUSION_MODELS` / `SYNC_REACT_MODELS` —
 *   the option gate as data, so a form can grey out `temperature` when `sync-3`
 *   is selected rather than letting a user set a dial sync. will ignore.
 */

export {
  SYNC_LIPSYNC_MODEL_PARAMS as LIPSYNC_MODEL_PARAMS,
  MODELS as LIPSYNC_MODELS,
} from "./lipsync-params";

export {
  SYNC_AVATAR_MODEL_PARAMS as AVATAR_MODEL_PARAMS,
  MODELS as AVATAR_MODELS,
} from "./avatar-params";

export {
  OUTPUT_FILE_NAME_MAX_CHARS,
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
} from "./shared";
