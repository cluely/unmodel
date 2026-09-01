/**
 * Mureka prompt-to-song — POST https://api.mureka.ai/v1/song/easy-generate
 * ("Prompt to song": "Generate song based on the input prompt and styles").
 *
 * Wire notes (transcribed from the OpenAPI document embedded in the docs
 * bundle behind https://platform.mureka.ai/docs/assets/chunks/theme.C4szLtM5.js
 * — the `operations/*.html` pages are client-rendered from it —
 * `SongEasyGenerateReq` on 2026-08-31):
 *
 * - This is the route that writes the lyrics for you. `POST /v1/song/generate`
 *   REQUIRES hand-written `lyrics`; here you describe the song and Mureka
 *   sings words of its own.
 * - `SongEasyGenerateReq` declares **no `required` array at all** — every
 *   field, `model` included, is optional. The schema below mirrors that: it
 *   refuses nothing the API accepts, so an empty body validates.
 * - `styles` is an ARRAY of a closed thirteen-value enum ("Select one or more
 *   styles from the enum") — see STYLES in ./models. It exists on no other
 *   Mureka route.
 * - PROMPT CAP WART: `prompt` is capped at **2000** characters here and at
 *   1024 on `/v1/song/generate` and `/v1/instrumental/generate`. One wire word,
 *   two limits, chosen by the route — so through the unified adapter the same
 *   `prompt` can pass or fail depending on whether a `lyrics` extra is present
 *   (see ./unified.ts). Each schema carries its own cap; neither is a default.
 * - `model` shares the song route's six-value enum, and the description
 *   narrows to "The mureka-o2 model does not support vocal_id input" — no
 *   `melody_id` clause, because this route has no `melody_id`.
 * - `lyrics`, `gender` and `melody_id` are ABSENT from this body. So is the
 *   `stream` field's "when the model is mureka-o1" carve-out that the two
 *   generate routes carry — this route's `stream` text states no model gate.
 * - The documented combination rules of `/v1/song/generate` do NOT reappear
 *   here: no field on `SongEasyGenerateReq` says it excludes another, so
 *   nothing is refused for combining `prompt`, `styles`, `reference_id` and
 *   `vocal_id`.
 * - ASYNC submit, exactly like the song route: the 200 is a `SongTask`, polled
 *   with the SAME `GET /v1/song/query/{task_id}` — {@link songQueryUrl}.
 * - `n` and the billing note are the song route's: "Defaults to 2, maximum 3 …
 *   you will be charged based on the number of songs."
 * - NO cost estimate: no scrapable USD rate list (the PRICING note in
 *   ./models.ts has the full search trail), so `maxCostUSD` never fires here.
 * - Auth is `Authorization: Bearer <MUREKA_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 *
 * `.toSdk("mureka")` is the identity: Mureka publishes no first-party SDK.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, STYLES, type MurekaSongModelId, type MurekaStyle } from "./models";
import { N_MAX } from "./music";

// Declared in `./models` — an import-free leaf — so `unmodel/mureka/values`
// can read the enum without this validator, its zod schema and its catalog.
export { STYLES } from "./models";
export type { MurekaStyle } from "./models";

export const SONG_EASY_GENERATE_URL = "https://api.mureka.ai/v1/song/easy-generate";

const EASY_GENERATE_DOCS =
  "https://platform.mureka.ai/docs/api/operations/post-v1-song-easy-generate.html";

/**
 * "Control music generation by inputting a prompt, maximum 2000 characters."
 * Twice the cap the two generate routes state for the same field name — see
 * the PROMPT CAP WART in this module's header.
 */
export const EASY_GENERATE_PROMPT_MAX_CHARACTERS = 2000;

// ---------------------------------------------------------------------------
// Wire type — mirrors the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

/** `POST /v1/song/easy-generate` — `SongEasyGenerateReq` on the spec. */
export interface SongEasyGenerateBody {
  /** OPTIONAL here, unlike both generate routes. `auto` = latest regular model. */
  model?: MurekaSongModelId | (string & {});
  /** Songs per request: default 2, max 3 — each one is billed. */
  n?: number;
  /** "Select one or more styles from the enum." */
  styles?: readonly MurekaStyle[];
  /** What the song should be, ≤2000 chars — Mureka writes the lyrics from it. */
  prompt?: string;
  /** Reference track: files/upload id (purpose "reference"). */
  reference_id?: string;
  /** Voice to sing with: song/vocal-clone id. Not supported by `mureka-o2`. */
  vocal_id?: string;
  /** Adds a `streaming` task phase during which choices carry a `stream_url`. */
  stream?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning). Every field is
// optional because the spec declares no `required` array.
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  model: z.string().min(1, "model must not be empty — omit it, or use \"auto\".").optional(),
  n: z
    .number()
    .int()
    .min(1, "n must be between 1 and 3 (the API's own default is 2).")
    .max(
      N_MAX,
      `n must be at most ${N_MAX} ("Defaults to 2, maximum 3") — and every generated track is billed.`,
    )
    .optional(),
  styles: z.array(z.enum(STYLES)).optional(),
  prompt: z
    .string()
    .max(
      EASY_GENERATE_PROMPT_MAX_CHARACTERS,
      `prompt is capped at ${EASY_GENERATE_PROMPT_MAX_CHARACTERS} characters on POST /v1/song/easy-generate (the two generate routes cap the same field at 1024).`,
    )
    .optional(),
  reference_id: z.string().min(1).optional(),
  vocal_id: z.string().min(1).optional(),
  stream: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Constraints — the one per-model gate this operation states.
// ---------------------------------------------------------------------------

export const musicFromPromptConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "mureka-o2": {
    deny: {
      vocal_id: {
        reason: '"The mureka-o2 model does not support vocal_id input"',
        source: EASY_GENERATE_DOCS,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK target for `mureka.musicFromPrompt`. Mureka ships no first-party SDK, so
 * the single self-named `"mureka"` target returns the wire body unchanged.
 * Type alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type MurekaSdkTargets<B> = { mureka: () => B };

function finalize(params: SongEasyGenerateBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: SONG_EASY_GENERATE_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { mureka: () => body } },
  );
}

const validator = createValidator<SongEasyGenerateBody, unknown>({
  endpoint: "mureka.musicFromPrompt",
  schema,
  // Optional on the wire, so this may be `undefined` — the catalog lookup and
  // every model-dependent check are skipped, which is the correct reading of a
  // request that lets the server pick.
  modelId: (params) => params.model,
  catalog: models,
  constraints: musicFromPromptConstraints,
  finalize,
});

/**
 * Validates raw wire params for Mureka `POST /v1/song/easy-generate` ("Prompt
 * to song") — the route that writes its own lyrics, in contrast to
 * {@link import("./music").music}, which requires yours.
 *
 * The returned object's enumerable props are the exact fetch JSON body;
 * `.toSdk("mureka")` returns it unchanged (no first-party SDK exists). The
 * call is asynchronous: the response is a task object whose `id` you poll with
 * `songQueryUrl(id)` — the same poller the song route uses — until `status` is
 * `"succeeded"`, then download the `choices[]` URLs (mp3 `url`, lossless
 * `flac_url`/`wav_url`, each valid for 30 days). Auth is your job: add
 * `authorization: Bearer <MUREKA_API_KEY>`.
 *
 * Every field is optional (the spec declares no `required` array), `prompt` is
 * capped at 2000 characters here rather than 1024, and `styles` takes one or
 * more of the thirteen values in `STYLES`.
 *
 * ```ts
 * const params = mureka.musicFromPrompt({
 *   model: "auto",
 *   styles: ["pop", "rock"],
 *   prompt: "A bright summer love song with a catchy chorus",
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
export const musicFromPrompt = validator as unknown as {
  <T extends SongEasyGenerateBody>(
    params: T & ExactKeys<T, SongEasyGenerateBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, MurekaSdkTargets<T>>;
  safe<T extends SongEasyGenerateBody>(
    params: T & ExactKeys<T, SongEasyGenerateBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, MurekaSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
