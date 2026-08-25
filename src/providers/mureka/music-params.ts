/**
 * The music adapter's **data**: the model list and the per-model narrowing
 * table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/mureka/values` publishes these arrays for client-side pickers and
 * the adapter imports this provider's validators, their zod schemas and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 *
 * NO FORMAT SPEC: neither generate route has an output-format, sample-rate or
 * bitrate field. A finished track arrives as fixed URLs — mp3 `url` plus
 * lossless `flac_url`/`wav_url` on every succeeded choice — so `outputFormat`
 * is in the adapter's `unsupported` map rather than narrowed per model, and no
 * row declares `codecs`.
 */

import { EXTRA } from "../../core/unified/derive";
import type { MusicModelParamTable } from "../../core/unified/vocabulary/music";
import type { MurekaGender } from "./models";

/** The six wire model ids — the ref union for `mureka/…`. `auto` = latest regular model. */
export const MODELS = [
  "auto",
  "mureka-9.5",
  "mureka-9",
  "mureka-8",
  "mureka-7.6",
  "mureka-o2",
] as const;

export const SONG_DOCS =
  "https://platform.mureka.ai/docs/api/operations/post-v1-song-generate.html";
export const INSTRUMENTAL_DOCS =
  "https://platform.mureka.ai/docs/api/operations/post-v1-instrumental-generate.html";

/**
 * Extras shared by every id, on whichever route the `instrumental` flag
 * selects: the words the canonical music vocabulary has no spelling for.
 *
 * - `lyrics` — REQUIRED by the song route (it is "Lyrics to song"); the
 *   adapter fails compilation without it unless `instrumental: true`.
 * - `n` — tracks per request, default 2, max 3 — every one is billed.
 * - `stream` — opts the task into a `streaming` phase with a `stream_url`.
 */
const SHARED_EXTRAS = {
  lyrics: EXTRA as string,
  n: EXTRA as number,
  stream: EXTRA as boolean,
} as const;

/**
 * The regular models' full control surface. The reference ids are
 * route-specific — `reference_id`/`vocal_id`/`melody_id`/`gender` belong to
 * `POST /v1/song/generate` and `instrumental_id` to
 * `POST /v1/instrumental/generate` — a fact a per-MODEL row cannot carry, so
 * the adapter enforces it at compile time (see `unified.ts`) and the row
 * declares the union of both routes' extras.
 */
export const REGULAR_EXTRAS = {
  ...SHARED_EXTRAS,
  gender: EXTRA as MurekaGender,
  reference_id: EXTRA as string,
  vocal_id: EXTRA as string,
  melody_id: EXTRA as string,
  instrumental_id: EXTRA as string,
} as const;

/**
 * `mureka-o2` is narrower twice over: it is song-only (absent from the
 * instrumental route's model enum, so no `instrumental_id`) and "does not
 * support vocal_id or melody_id inputs" — both facts the row encodes so an
 * editor never offers what `mureka.music`'s constraints would then reject.
 */
export const O2_EXTRAS = {
  ...SHARED_EXTRAS,
  gender: EXTRA as MurekaGender,
  reference_id: EXTRA as string,
} as const;

const REGULAR_ROW = { extras: REGULAR_EXTRAS } as const;

export const MUREKA_MUSIC_MODEL_PARAMS = {
  auto: REGULAR_ROW,
  "mureka-9.5": REGULAR_ROW,
  "mureka-9": REGULAR_ROW,
  "mureka-8": REGULAR_ROW,
  "mureka-7.6": REGULAR_ROW,
  "mureka-o2": { extras: O2_EXTRAS },
} as const satisfies MusicModelParamTable;
