/**
 * `unmodel/veed/values` — the **runtime** lists behind this provider's unified
 * surface (lipsync and avatar).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids per category, the per-model narrowing rows, VEED's own
 * published enums — the two Fabric resolutions, the four job states, the eight
 * HTTP error codes, the seven render-failure codes, the five key-status reasons
 * — and the rate table. It is the value half of `unmodel/veed/types`, for the
 * client-side validation and the pickers a type cannot draw.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `AVATAR_MODEL_PARAMS` and
 * the request the matching `unmodel/avatar` builds cannot disagree. They are
 * read from the import-free `./lipsync-params.ts` and `./avatar-params.ts`
 * leaves rather than from the adapters, which is what keeps this entry off this
 * provider's validators, its zod schemas and its catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 *
 * Three exports here are the most useful ones for a form, and none of them is a
 * request-side vocabulary:
 *
 * - `VEED_PRICING` — the published per-second rates, including the 2×
 *   difference between Fabric's two resolutions. Show it beside the
 *   `resolution` control, which is the moment the choice is made.
 * - `VEED_JOB_ERROR_CODES` — why an ACCEPTED job later failed. A disjoint
 *   vocabulary from `VEED_ERROR_CODES`, which is why a submit was rejected, and
 *   the pair is the thing to branch on rather than on message text.
 * - `VEED_ERROR_REASONS` — four ways an API key can be unusable, all of which
 *   arrive as the same `unauthenticated` code with the same 401.
 */

export {
  VEED_LIPSYNC_MODEL_PARAMS as LIPSYNC_MODEL_PARAMS,
  MODELS as LIPSYNC_MODELS,
} from "./lipsync-params";

export {
  VEED_AVATAR_MODEL_PARAMS as AVATAR_MODEL_PARAMS,
  MODELS as AVATAR_MODELS,
} from "./avatar-params";

export {
  MEDIA_URL_MAX_CHARS,
  MEDIA_URL_MIN_CHARS,
  MEDIA_URL_PATTERN,
  VEED_ERROR_CODES,
  VEED_ERROR_REASONS,
  VEED_JOB_ERROR_CODES,
  VEED_JOB_STATUSES,
  VEED_MEDIA_EXPIRATION_DEFAULT_SECONDS,
  VEED_MODELS,
  VEED_POLL_INTERVAL_SECONDS,
  VEED_PRICING,
  VEED_RATE_LIMIT_CLASSES,
  VEED_REQUEST_HEADERS,
  VEED_RESOLUTIONS,
  VEED_TERMINAL_STATUSES,
} from "./shared";
