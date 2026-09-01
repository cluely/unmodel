// Hand-maintained — Mureka is not in models.dev; refresh from
// https://platform.mureka.ai/docs/api/operations/post-v1-song-generate.html,
// https://platform.mureka.ai/docs/api/operations/post-v1-song-easy-generate.html,
// https://platform.mureka.ai/docs/api/operations/post-v1-instrumental-generate.html,
// https://platform.mureka.ai/docs/en/changelog.html and
// https://platform.mureka.ai/pricing (last checked 2026-08-31).
//
// MODEL IDS: the OpenAPI document embedded in the docs bundle (the source of
// every field on the operation pages above) gives `POST /v1/song/generate` a
// closed `model` enum of exactly six values — `auto`, `mureka-7.6`,
// `mureka-o2`, `mureka-8`, `mureka-9`, `mureka-9.5` —
// `POST /v1/song/easy-generate` the same six, and
// `POST /v1/instrumental/generate` the same enum minus `mureka-o2`. "Use auto
// to select the latest version of the regular model" (both operations), so
// `auto` is a real wire value that aliases the newest non-o release rather
// than a pool of its own; it is catalogued because requests legitimately name
// it. Retired ids (`mureka-6`, `mureka-7`, `mureka-7.5`, `mureka-o1`) appear
// only in the changelog's history and are NOT catalogued — with one wrinkle:
// the CURRENT spec's `stream` description still says "When the model is
// mureka-o1, this mode is not supported", which is the one place the legacy o1
// id survives. That sentence is encoded as a constraints row in ./music.ts,
// not as a catalog row here.
//
// PRICING: omitted rather than guessed, after this search (2026-08-24):
// https://platform.mureka.ai/pricing is a client-rendered app whose price
// table is fetched from an authenticated backend — the static bundle
// (static/js/components-*.js) ships only the table headers ("Model",
// "Price"). The docs (FAQ, changelog, quickstart) publish no USD rates
// either. The ONLY first-party USD figure in the public bundles is the
// platform homepage's V9.5 early-access banner: standard price "$0.15/song",
// beta price "$0.045/song", "Beta Exclusive until Aug 28, 2026". That is a
// per-generated-song rate for one model during a promo window, and `ModelCost`
// has no per-song unit to carry it (perMillionCharacters / perAudioMinute /
// perImage / perVideoSecond are all the wrong denominator), so no `cost` is
// encoded and no request produces a `costUSD` estimate — a `maxCostUSD` budget
// therefore never fires on this provider. Billing fact worth knowing anyway:
// both generate routes are billed PER SONG and `n` defaults to 2 ("Defaults
// to 2, maximum 3. Note that you will be charged based on the number of
// songs"), so a request that omits `n` bills two songs, not one.
//
// LIMITS: `limit.context: 0` disables token-window checks — these are not
// token models. The documented input caps are per-field, not per-request, and
// one of them is per-ROUTE as well (`prompt` ≤ 1024 characters on the two
// generate routes, ≤ 2000 on `/v1/song/easy-generate`; `lyrics` ≤ 5000), so
// they live in each validator's own schema — ./music.ts and
// ./music-from-prompt.ts — rather than on `limit.characters`.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "mureka",
  name: "Mureka",
  env: ["MUREKA_API_KEY"],
  doc: "https://platform.mureka.ai/docs",
} as const satisfies ProviderInfo;

/** Shared shape of every Mureka music row — text in, finished audio URLs out. */
const MUSIC_ROW = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text"], output: ["audio"] },
  limit: { context: 0 },
} as const;

export const models = {
  // "Use auto to select the latest version of the regular model" — an alias
  // for the newest non-o release (mureka-9.5 as of 2026-08-24), accepted by
  // both generate routes.
  auto: {
    id: "auto",
    name: "Auto (latest regular model)",
    family: "mureka",
    ...MUSIC_ROW,
  },
  // "Released mureka-7.6 and mureka-o2 models, enhancing the effect of music
  // generation" — changelog 2025.12.9. Oldest id still on the enum; the only
  // song model whose `extend_at` range the song-extend docs pin ([8000,420000]).
  "mureka-7.6": {
    id: "mureka-7.6",
    name: "Mureka V7.6",
    family: "mureka",
    releaseDate: "2025-12-09",
    ...MUSIC_ROW,
  },
  // The o-series model. Song generation only (absent from the instrumental
  // enum), and "the mureka-o2 model does not support vocal_id or melody_id
  // inputs" — encoded as a constraints row in ./music.ts.
  "mureka-o2": {
    id: "mureka-o2",
    name: "Mureka O2",
    family: "mureka-o",
    releaseDate: "2025-12-09",
    ...MUSIC_ROW,
  },
  "mureka-8": {
    id: "mureka-8",
    name: "Mureka V8",
    family: "mureka",
    ...MUSIC_ROW,
  },
  "mureka-9": {
    id: "mureka-9",
    name: "Mureka V9",
    family: "mureka",
    ...MUSIC_ROW,
  },
  // Early access per the platform banner ("V9.5 Model — Early Access Now
  // Available", beta pricing until 2026-08-28); already on the stable enum of
  // both generate routes, so no `status` flag is claimed.
  "mureka-9.5": {
    id: "mureka-9.5",
    name: "Mureka V9.5",
    family: "mureka",
    ...MUSIC_ROW,
  },
} as const satisfies Record<string, ModelInfo>;

export type MurekaModelId = keyof typeof models;

/** The `model` enum of `POST /v1/song/generate`, verbatim from the spec. */
export const MUREKA_SONG_MODEL_IDS = [
  "auto",
  "mureka-7.6",
  "mureka-o2",
  "mureka-8",
  "mureka-9",
  "mureka-9.5",
] as const satisfies readonly MurekaModelId[];

export type MurekaSongModelId = (typeof MUREKA_SONG_MODEL_IDS)[number];

/**
 * The `model` enum of `POST /v1/instrumental/generate` — the song enum minus
 * `mureka-o2`, verbatim from the spec.
 */
export const MUREKA_INSTRUMENTAL_MODEL_IDS = [
  "auto",
  "mureka-7.6",
  "mureka-8",
  "mureka-9",
  "mureka-9.5",
] as const satisfies readonly MurekaModelId[];

export type MurekaInstrumentalModelId = (typeof MUREKA_INSTRUMENTAL_MODEL_IDS)[number];

/**
 * `gender` on the song route: "Specifies the preferred vocal gender for the
 * generated song; the vocal characteristics of the uploaded audio take
 * precedence."
 */
export const GENDERS = ["female", "male"] as const;
export type MurekaGender = (typeof GENDERS)[number];

/**
 * `styles` on the prompt-to-song route: "Control music generation by inputting
 * styles. Select one or more styles from the enum." A closed thirteen-value
 * list, verbatim from the spec — `r&b` really is spelled with the ampersand,
 * and `k-pop`/`j-pop`/`lo-fi` really are hyphenated. It is the one control
 * `POST /v1/song/easy-generate` has that neither generate route does, and no
 * other music provider in the roster has any style/genre field, so it stays a
 * per-model extra rather than canonical vocabulary (decisions.md §8).
 */
export const STYLES = [
  "pop",
  "rock",
  "jazz",
  "r&b",
  "edm",
  "ambient",
  "folk",
  "latin",
  "k-pop",
  "j-pop",
  "house",
  "gospel",
  "lo-fi",
] as const;
export type MurekaStyle = (typeof STYLES)[number];

/**
 * Task lifecycle of both query routes (`GET /v1/song/query/{task_id}`,
 * `GET /v1/instrumental/query/{task_id}`), verbatim from the spec. `streaming`
 * appears only when the generate request set `stream: true`; `choices` is
 * populated "when the status is succeeded".
 */
export const TASK_STATUSES = [
  "preparing",
  "queued",
  "running",
  "streaming",
  "succeeded",
  "failed",
  "timeouted",
  "cancelled",
] as const;
export type MurekaTaskStatus = (typeof TASK_STATUSES)[number];
