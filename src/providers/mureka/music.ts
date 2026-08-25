/**
 * Mureka music generation — POST https://api.mureka.ai/v1/song/generate
 * ("Lyrics to song") and POST https://api.mureka.ai/v1/instrumental/generate
 * ("Generate instrumental").
 *
 * Wire notes (transcribed from the OpenAPI document embedded in the docs
 * bundle behind https://platform.mureka.ai/docs/api/operations/
 * post-v1-song-generate.html and post-v1-instrumental-generate.html —
 * `SongGenerateReq` / `InstrumentalGenerateReq` — on 2026-08-24):
 *
 * - ASYNC submit, both routes: the 200 response is a task object
 *   (`{id, created_at, model, status, …}`), not audio. Poll
 *   `GET /v1/song/query/{task_id}` (songQueryUrl) or
 *   `GET /v1/instrumental/query/{task_id}` (instrumentalQueryUrl) until
 *   `status` is `"succeeded"`; the finished tracks then sit in `choices[]` as
 *   URLs — mp3 `url` plus lossless `flac_url`/`wav_url`, each "valid for 30
 *   days". With `stream: true` the task passes through a `"streaming"` status
 *   during which each choice carries a playable `stream_url`.
 * - `model` is REQUIRED on both routes and each has its own closed enum:
 *   song takes `auto | mureka-7.6 | mureka-o2 | mureka-8 | mureka-9 |
 *   mureka-9.5`, instrumental the same minus `mureka-o2`
 *   (checkInstrumentalModel). "Use auto to select the latest version of the
 *   regular model."
 * - `n` — "Defaults to 2, maximum 3. How many songs to generate for each
 *   request. Note that you will be charged based on the number of songs." So
 *   the DEFAULT request bills two songs; send `n: 1` if you want one.
 * - Song control options and their documented combinations: `prompt` (≤1024
 *   chars) combines with `vocal_id`; `reference_id` (files/upload, purpose
 *   "reference") combines with `vocal_id`; `vocal_id` (song/vocal-clone)
 *   combines with either; `melody_id` (files/upload, purpose "melody") "does
 *   not support combination with other control options" — an error here
 *   (checkSongControlCombos). `prompt` + `reference_id` is not on any
 *   documented-combinations list, so it warns rather than fails.
 * - "The mureka-o2 model does not support vocal_id or melody_id inputs" —
 *   a constraints row, so `constraintsFor("mureka-o2")` exposes it.
 * - "When the model is mureka-o1, this mode is not supported" is the `stream`
 *   field's own text and the one place the LEGACY o1 id survives in the
 *   current spec (`mureka-o1` is absent from both model enums); kept as a
 *   constraints row for callers still pinning the retired id.
 * - Instrumental control options: `prompt` (≤1024 chars) and
 *   `instrumental_id` (files/upload, purpose "instrumental") each state
 *   "this option does not support combination with other control options",
 *   so sending both is an error (checkInstrumentalControlCombos).
 * - NO cost estimate: Mureka bills per generated song but publishes no
 *   scrapable USD rate list — see the PRICING note in ./models.ts for the
 *   full search trail (the platform banner's "$0.15/song" covers only the
 *   V9.5 early-access promo). `maxCostUSD` never fires on these endpoints.
 * - Auth is `Authorization: Bearer <MUREKA_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 *
 * NOT VALIDATED HERE (catalog/doc note only): the surrounding music routes —
 * `POST /v1/song/easy-generate` (prompt/styles instead of lyrics, 2000-char
 * prompt), `/v1/lyrics/generate`, `/v1/lyrics/extend`, `/v1/song/extend`
 * (lyrics + `extend_at`, models mureka-7.6/8 only), `/v1/song/stem`
 * (audio-separation-1/2/3), `/v1/song/remix`, `/v1/song/region-edit`,
 * `/v1/track/generate`, `/v1/soundtrack/generate` and the vocal-clone/upload
 * plumbing. Each takes a different body with its own control surface, so none
 * is "trivially similar" enough to ride these validators.
 *
 * `.toSdk("mureka")` is the identity: Mureka publishes no first-party SDK —
 * the docs' only code samples are cURL against the raw JSON body.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  GENDERS,
  MUREKA_INSTRUMENTAL_MODEL_IDS,
  MUREKA_SONG_MODEL_IDS,
  models,
  type MurekaGender,
  type MurekaInstrumentalModelId,
  type MurekaSongModelId,
  type MurekaTaskStatus,
} from "./models";

// Declared in `./models` — an import-free leaf — so `unmodel/mureka/values`
// can read these without this validator, its zod schema and its catalog.
// Re-exported here so wire callers find them beside the validators.
export { GENDERS, TASK_STATUSES } from "./models";
export type { MurekaGender, MurekaTaskStatus } from "./models";

export const SONG_GENERATE_URL = "https://api.mureka.ai/v1/song/generate";
/** Polling endpoint for a submitted song task (`/{task_id}` appended). */
export const SONG_QUERY_URL = "https://api.mureka.ai/v1/song/query";
export const INSTRUMENTAL_GENERATE_URL = "https://api.mureka.ai/v1/instrumental/generate";
/** Polling endpoint for a submitted instrumental task (`/{task_id}` appended). */
export const INSTRUMENTAL_QUERY_URL = "https://api.mureka.ai/v1/instrumental/query";

const SONG_DOCS = "https://platform.mureka.ai/docs/api/operations/post-v1-song-generate.html";
const INSTRUMENTAL_DOCS =
  "https://platform.mureka.ai/docs/api/operations/post-v1-instrumental-generate.html";

/** Polling URL for a submitted song generation task id. */
export function songQueryUrl(taskId: string): string {
  return `${SONG_QUERY_URL}/${encodeURIComponent(taskId)}`;
}

/** Polling URL for a submitted instrumental generation task id. */
export function instrumentalQueryUrl(taskId: string): string {
  return `${INSTRUMENTAL_QUERY_URL}/${encodeURIComponent(taskId)}`;
}

/** "Lyrics for generated song, maximum 5000 characters." */
export const LYRICS_MAX_CHARACTERS = 5000;
/** "Control … generation by inputting a prompt, maximum 1024 characters" — both routes. */
export const PROMPT_MAX_CHARACTERS = 1024;
/** "Defaults to 2, maximum 3" — and each generated song is billed. */
export const N_MAX = 3;
export const DEFAULT_N = 2;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON bodies exactly (snake_case).
// ---------------------------------------------------------------------------

/** `POST /v1/song/generate` — `SongGenerateReq` on the spec. */
export interface SongGenerateBody {
  /** Lyrics to sing; REQUIRED, maximum 5000 characters. */
  lyrics: string;
  /** REQUIRED. `auto` = latest regular model. o2 rejects vocal_id/melody_id. */
  model: MurekaSongModelId | (string & {});
  /** Songs per request: default 2, max 3 — each one is billed. */
  n?: number;
  /** Style/mood/instrumentation prompt, ≤1024 chars. Combines with `vocal_id` only. */
  prompt?: string;
  /** Preferred vocal gender; uploaded-audio vocal characteristics take precedence. */
  gender?: MurekaGender;
  /** Reference track: files/upload id (purpose "reference"). Combines with `vocal_id` only. */
  reference_id?: string;
  /** Voice to sing with: song/vocal-clone id. Combines with `reference_id` or `prompt`. */
  vocal_id?: string;
  /** Melody idea: files/upload id (purpose "melody"). Combines with NOTHING else. */
  melody_id?: string;
  /** Adds a `streaming` task phase during which choices carry a `stream_url`. */
  stream?: boolean;
}

/** `POST /v1/instrumental/generate` — `InstrumentalGenerateReq` on the spec. */
export interface InstrumentalGenerateBody {
  /** REQUIRED. The song enum minus `mureka-o2`. `auto` = latest regular model. */
  model: MurekaInstrumentalModelId | (string & {});
  /** Instrumentals per request: default 2, max 3 — each one is billed. */
  n?: number;
  /** Style prompt, ≤1024 chars. Combines with NOTHING else. */
  prompt?: string;
  /** Reference: files/upload id (purpose "instrumental"). Combines with NOTHING else. */
  instrumental_id?: string;
  /** Adds a `streaming` task phase during which choices carry a `stream_url`. */
  stream?: boolean;
}

// ---------------------------------------------------------------------------
// Task response types — what the generate routes return and the query routes
// re-serve (`SongTask` / `InstrumentalTask` / `Song` / `Instrumental` /
// `LyricsSection` on the spec). Exported for callers writing poll loops; not
// validated (unmodel validates requests, not responses).
// ---------------------------------------------------------------------------

export interface MurekaWordTiming {
  start?: number;
  end?: number;
  text?: string;
}

export interface MurekaLyricsLine {
  start?: number;
  end?: number;
  text?: string;
  words?: MurekaWordTiming[];
}

/** One timed section of the generated song's lyrics. */
export interface MurekaLyricsSection {
  section_type?: "intro" | "verse" | "pre-chorus" | "chorus" | "bridge" | "break" | "outro";
  /** Milliseconds. */
  start?: number;
  /** Milliseconds. */
  end?: number;
  lines?: MurekaLyricsLine[];
}

/** One generated song in `choices[]`. Every URL is "valid for 30 days". */
export interface MurekaSong {
  index?: number;
  id?: string;
  /** mp3. */
  url?: string;
  /** Lossless FLAC. */
  flac_url?: string;
  /** Lossless WAV. */
  wav_url?: string;
  /** Playable during the `streaming` phase when the request set `stream: true`. */
  stream_url?: string;
  /** Milliseconds. */
  duration?: number;
  lyrics_sections?: MurekaLyricsSection[];
}

/** One generated instrumental in `choices[]` — a song without lyric timings. */
export type MurekaInstrumental = Omit<MurekaSong, "lyrics_sections">;

export interface MurekaSongTask {
  /** Task id — feed it to {@link songQueryUrl}. */
  id?: string;
  /** Unix seconds. */
  created_at?: number;
  /** Unix seconds. */
  finished_at?: number;
  model?: string;
  status?: MurekaTaskStatus;
  failed_reason?: string;
  /** Populated "when the status is succeeded". */
  choices?: MurekaSong[];
}

export interface MurekaInstrumentalTask extends Omit<MurekaSongTask, "choices"> {
  choices?: MurekaInstrumental[];
}

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const nSchema = z
  .number()
  .int()
  .min(1, "n must be between 1 and 3 (the API's own default is 2).")
  .max(
    N_MAX,
    `n must be at most ${N_MAX} ("Defaults to 2, maximum 3") — and every generated track is billed.`,
  )
  .optional();

const promptSchema = z
  .string()
  .max(PROMPT_MAX_CHARACTERS, `prompt is capped at ${PROMPT_MAX_CHARACTERS} characters.`)
  .optional();

const songSchema = z.looseObject({
  lyrics: z
    .string()
    .min(1, "lyrics must not be empty — POST /v1/song/generate is the lyrics-to-song route.")
    .max(LYRICS_MAX_CHARACTERS, `lyrics is capped at ${LYRICS_MAX_CHARACTERS} characters.`),
  model: z.string().min(1, "model is required — use \"auto\" for the latest regular model."),
  n: nSchema,
  prompt: promptSchema,
  gender: z.enum(GENDERS).optional(),
  reference_id: z.string().min(1).optional(),
  vocal_id: z.string().min(1).optional(),
  melody_id: z.string().min(1).optional(),
  stream: z.boolean().optional(),
});

const instrumentalSchema = z.looseObject({
  model: z.string().min(1, "model is required — use \"auto\" for the latest regular model."),
  n: nSchema,
  prompt: promptSchema,
  instrumental_id: z.string().min(1).optional(),
  stream: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Constraints — per-model gates the operation docs state.
// ---------------------------------------------------------------------------

export const songConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "mureka-o2": {
    deny: {
      vocal_id: {
        reason: '"The mureka-o2 model does not support vocal_id or melody_id inputs"',
        source: SONG_DOCS,
      },
      melody_id: {
        reason: '"The mureka-o2 model does not support vocal_id or melody_id inputs"',
        source: SONG_DOCS,
      },
    },
  },
  // LEGACY: `mureka-o1` is absent from the current model enum (it also draws
  // an `unknown_model` warning), but the spec's `stream` description still
  // singles it out — kept for callers pinning the retired id.
  "mureka-o1": {
    deny: {
      stream: {
        reason: '"When the model is mureka-o1, this mode is not supported"',
        source: SONG_DOCS,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const INSTRUMENTAL_MODEL_SET = new Set<string>(MUREKA_INSTRUMENTAL_MODEL_IDS);

/**
 * The four song control options and their documented pairings. `melody_id`
 * "does not support combination with other control options" — an error. The
 * docs enumerate exactly two supported pairs (`prompt + vocal_id`,
 * `reference_id + vocal_id`); `prompt + reference_id` is on neither list and
 * no rejection is stated, so it stays a warning rather than failing a request
 * the API may fulfil.
 */
function checkSongControlCombos(
  params: SongGenerateBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const others = (["prompt", "reference_id", "vocal_id"] as const).filter(
    (field) => params[field] !== undefined,
  );
  if (params.melody_id !== undefined && others.length > 0) {
    ctx.report({
      code: "unsupported_param",
      path: ["melody_id"],
      model: params.model,
      message: `\`melody_id\` "does not support combination with other control options" — remove ${others.map((f) => `\`${f}\``).join(", ")} or drop the melody reference.`,
      meta: { conflicts: others, source: SONG_DOCS },
    });
    return;
  }
  if (params.prompt !== undefined && params.reference_id !== undefined) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["reference_id"],
      model: params.model,
      message:
        "`prompt` + `reference_id` is not a documented combination — the docs list only `prompt + vocal_id` and `reference_id + vocal_id`; one of the two may be ignored.",
      meta: { source: SONG_DOCS },
    });
  }
}

/**
 * The instrumental route's model enum is the song enum minus `mureka-o2`,
 * which the shared catalog cannot see — `mureka-o2` resolves to a perfectly
 * good catalog row and would pass unremarked. Ids unknown to the catalog stay
 * an `unknown_model` warning (they may be new models).
 */
function checkInstrumentalModel(
  params: InstrumentalGenerateBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || INSTRUMENTAL_MODEL_SET.has(params.model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model: params.model,
    message: `"${params.model}" is not on POST /v1/instrumental/generate's model enum — it accepts ${MUREKA_INSTRUMENTAL_MODEL_IDS.map((id) => `"${id}"`).join(", ")} (the song enum minus "mureka-o2").`,
    meta: { allowed: [...MUREKA_INSTRUMENTAL_MODEL_IDS], source: INSTRUMENTAL_DOCS },
  });
}

/**
 * `prompt` and `instrumental_id` EACH state "this option does not support
 * combination with other control options", so sending both is an error.
 */
function checkInstrumentalControlCombos(
  params: InstrumentalGenerateBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.prompt === undefined || params.instrumental_id === undefined) return;
  ctx.report({
    code: "unsupported_param",
    path: ["instrumental_id"],
    model: params.model,
    message:
      "`prompt` and `instrumental_id` are mutually exclusive controls — each is documented as not supporting combination with other control options; send one or the other.",
    meta: { source: INSTRUMENTAL_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * SDK targets for `mureka.music` / `mureka.instrumental`. Mureka ships no
 * first-party SDK (the docs' code samples are cURL), so the single self-named
 * `"mureka"` target returns the wire body unchanged. Type alias, not
 * interface: an interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type MurekaSdkTargets<B> = { mureka: () => B };

function finalizeSong(params: SongGenerateBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: SONG_GENERATE_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { mureka: () => body } },
  );
}

function finalizeInstrumental(params: InstrumentalGenerateBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: INSTRUMENTAL_GENERATE_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { mureka: () => body } },
  );
}

const songValidator = createValidator<SongGenerateBody, unknown>({
  endpoint: "mureka.music",
  schema: songSchema,
  // `model` is required on the wire; there is no server-side default to fall
  // back to, and the schema has already rejected its absence.
  modelId: (params) => params.model,
  catalog: models,
  constraints: songConstraints,
  checks: [checkSongControlCombos],
  finalize: finalizeSong,
});

const instrumentalValidator = createValidator<InstrumentalGenerateBody, unknown>({
  endpoint: "mureka.instrumental",
  schema: instrumentalSchema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [checkInstrumentalModel, checkInstrumentalControlCombos],
  finalize: finalizeInstrumental,
});

/**
 * Validates raw wire params for Mureka `POST /v1/song/generate` ("Lyrics to
 * song").
 *
 * The returned object's enumerable props are the exact fetch JSON body;
 * `.toSdk("mureka")` returns it unchanged (no first-party SDK exists). The
 * call is asynchronous: the response is a task object whose `id` you poll
 * with `songQueryUrl(id)` until `status` is `"succeeded"`, then download the
 * `choices[]` URLs (mp3 `url`, lossless `flac_url`/`wav_url` — each valid for
 * 30 days). Auth is your job: add `authorization: Bearer <MUREKA_API_KEY>`.
 *
 * No cost estimate is produced (no published USD rate — see ./models.ts), but
 * remember `n` defaults to 2 and every generated song is billed.
 *
 * ```ts
 * const params = mureka.music({
 *   lyrics: "[Verse]\nIn the stormy night, I wander alone…",
 *   model: "auto",
 *   prompt: "r&b, slow, passionate, male vocal",
 *   n: 1,
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     authorization: `Bearer ${process.env.MUREKA_API_KEY}`,
 *   },
 *   body: JSON.stringify(params),
 * });
 * const task = await res.json(); // poll songQueryUrl(task.id)
 * ```
 */
export const music = songValidator as unknown as {
  <T extends SongGenerateBody>(
    params: T & ExactKeys<T, SongGenerateBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, MurekaSdkTargets<T>>;
  safe<T extends SongGenerateBody>(
    params: T & ExactKeys<T, SongGenerateBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, MurekaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/**
 * Validates raw wire params for Mureka `POST /v1/instrumental/generate`.
 *
 * Same async contract as {@link music}, polled with
 * `instrumentalQueryUrl(id)`. `mureka-o2` is song-only and is rejected here;
 * `prompt` and `instrumental_id` are mutually exclusive controls.
 */
export const instrumental = instrumentalValidator as unknown as {
  <T extends InstrumentalGenerateBody>(
    params: T & ExactKeys<T, InstrumentalGenerateBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, MurekaSdkTargets<T>>;
  safe<T extends InstrumentalGenerateBody>(
    params: T & ExactKeys<T, InstrumentalGenerateBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, MurekaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
