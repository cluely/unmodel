/**
 * `unmodel/music` → `mureka.music` (POST /v1/song/generate),
 * `mureka.musicFromPrompt` (POST /v1/song/easy-generate) and
 * `mureka.instrumental` (POST /v1/instrumental/generate).
 *
 * The three-route music adapter. Two questions pick the route, in order:
 *
 * 1. `instrumental: true` — the canonical word that names the difference —
 *    compiles to the instrumental route.
 * 2. Otherwise the `lyrics` extra decides who writes the words. Present, it is
 *    the song route, which REQUIRES them (`lyrics` is a word the canonical
 *    vocabulary deliberately does not have, so it arrives as a per-model
 *    extra). Absent, it is the prompt-to-song route, where Mureka writes the
 *    lyrics from the canonical `prompt` and nothing is fabricated on the way.
 *
 * The per-model rows declare the union of all three routes' extras (a row is
 * keyed by model, and every model serves at least two routes), so the route
 * split is enforced here at compile time, always with the route named: the
 * song-only controls (`lyrics`, `gender`, `reference_id`, `vocal_id`,
 * `melody_id`) fail on the instrumental route, `instrumental_id` fails on both
 * sung routes, and `gender`/`melody_id` fail on the prompt-to-song route,
 * which has neither.
 *
 * PROMPT CAP WART: the effective cap on the canonical `prompt` is
 * route-dependent — 2000 characters on the prompt-to-song route, 1024 on the
 * other two — so the same prompt passes or fails depending on whether a
 * `lyrics` extra rode along with it. Each wire schema carries its own accurate
 * cap; this is written down because it is the one thing about the dispatch a
 * caller cannot see from the canonical params alone.
 *
 * `durationSeconds`, `outputFormat` and `seed` are `unsupported`: no route has
 * a length, format or seed field — a finished choice reports its own
 * `duration` and ships fixed mp3/FLAC/WAV URLs.
 *
 * All three routes are ASYNC: the validated request's response is a task
 * object, polled via `songQueryUrl(id)` (both sung routes share the poller) or
 * `instrumentalQueryUrl(id)` from `unmodel/mureka`.
 */
import { applyExtras } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { MusicAdapterFor, MusicParams } from "../../core/unified/vocabulary/music";
import {
  instrumental as instrumentalValidator,
  music as songValidator,
  type InstrumentalGenerateBody,
  type SongGenerateBody,
} from "./music";
import {
  musicFromPrompt as fromPromptValidator,
  type SongEasyGenerateBody,
} from "./music-from-prompt";
import {
  EASY_GENERATE_DOCS,
  INSTRUMENTAL_DOCS,
  MODELS,
  MUREKA_MUSIC_MODEL_PARAMS,
  SONG_DOCS,
} from "./music-params";

/** The wire body of whichever of the three routes the dispatch selects. */
export type MurekaMusicWire = SongGenerateBody | SongEasyGenerateBody | InstrumentalGenerateBody;

/** What a unified music call to `mureka/…` returns — one route's `Validated`. */
export type MurekaMusicResult =
  | ReturnType<typeof songValidator<SongGenerateBody>>
  | ReturnType<typeof fromPromptValidator<SongEasyGenerateBody>>
  | ReturnType<typeof instrumentalValidator<InstrumentalGenerateBody>>;

/**
 * The `validate` half of a three-route adapter. The cast at each `return` is
 * what a union of wire bodies costs: `validate` is contravariant in its
 * parameter, so a function taking *one* arm is not assignable to one taking
 * the union. The kernel only ever calls it with the body compiled beside it,
 * which is the arm it was chosen for.
 */
type MurekaValidate = CompiledCall<MurekaMusicWire, MurekaMusicResult>["validate"];

/** The song route's controls, for the cross-route guard on the instrumental arm. */
const SONG_ONLY_EXTRAS = ["lyrics", "gender", "reference_id", "vocal_id", "melody_id"] as const;

/**
 * The mirror of {@link SONG_ONLY_EXTRAS} for the prompt-to-song arm: the
 * controls absent from `SongEasyGenerateReq`, each with the route that does
 * take it. `lyrics` is not here because its presence is what routes away.
 */
const NOT_ON_EASY_GENERATE = {
  gender: "the song route (POST /v1/song/generate)",
  melody_id: "the song route (POST /v1/song/generate)",
  instrumental_id: "the instrumental route (POST /v1/instrumental/generate)",
} as const;

function compileSong(
  input: MusicParams,
  ctx: CompileContext<MusicParams>,
): CompiledCall<MurekaMusicWire, MurekaMusicResult> {
  // `lyrics` is REQUIRED on this route; the placeholder is overwritten by the
  // caller's `lyrics` extra and its survival is the missing-lyrics signal.
  const body: SongGenerateBody = { lyrics: "", model: ctx.model, prompt: input.prompt };

  applyExtras(input, MUREKA_MUSIC_MODEL_PARAMS, body, ctx);

  if (body.lyrics === "") {
    ctx.fail({
      code: "invalid_shape",
      path: ["lyrics"],
      message:
        "Mureka's song route (POST /v1/song/generate) is lyrics-to-song and requires non-empty " +
        "`lyrics` (≤5000 characters) — write them, drop the `lyrics` extra entirely to compile " +
        "to POST /v1/song/easy-generate (Mureka's own prompt-to-song route, which writes the " +
        "lyrics from your `prompt`), or set `instrumental: true` for " +
        "POST /v1/instrumental/generate.",
      meta: { source: SONG_DOCS },
    });
  }

  if ("instrumental_id" in body && body.instrumental_id !== undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["instrumental_id"],
      message:
        "`instrumental_id` is the instrumental route's control — POST /v1/song/generate does not " +
        "take it. Set `instrumental: true` (and drop `lyrics`) to compile to " +
        "POST /v1/instrumental/generate.",
      meta: { source: INSTRUMENTAL_DOCS },
    });
    delete (body as Record<string, unknown>).instrumental_id;
  }

  return { params: body, validate: songValidator.safe as MurekaValidate };
}

function compileInstrumental(
  input: MusicParams,
  ctx: CompileContext<MusicParams>,
): CompiledCall<MurekaMusicWire, MurekaMusicResult> {
  const body: InstrumentalGenerateBody = { model: ctx.model, prompt: input.prompt };

  applyExtras(input, MUREKA_MUSIC_MODEL_PARAMS, body, ctx);

  // The rows declare the union of all three routes' extras (see
  // music-params.ts), so the song-only controls are refused here, with the
  // route named.
  const loose = body as unknown as Record<string, unknown>;
  for (const field of SONG_ONLY_EXTRAS) {
    const value = loose[field];
    if (value === undefined) continue;
    ctx.fail({
      code: "unsupported_param",
      path: [field],
      message:
        `\`${field}\` belongs to the song route (POST /v1/song/generate) — ` +
        "POST /v1/instrumental/generate does not take it. Remove it, or drop " +
        "`instrumental: true` to generate a sung track.",
      meta: { value, source: INSTRUMENTAL_DOCS },
    });
    delete loose[field];
  }

  return { params: body, validate: instrumentalValidator.safe as MurekaValidate };
}

function compileFromPrompt(
  input: MusicParams,
  ctx: CompileContext<MusicParams>,
): CompiledCall<MurekaMusicWire, MurekaMusicResult> {
  const body: SongEasyGenerateBody = { model: ctx.model, prompt: input.prompt };

  applyExtras(input, MUREKA_MUSIC_MODEL_PARAMS, body, ctx);

  // The rows declare the union of all three routes' extras (see
  // music-params.ts), so the three controls this body has no field for are
  // refused here, each naming the route that does take it.
  const loose = body as unknown as Record<string, unknown>;
  for (const [field, route] of Object.entries(NOT_ON_EASY_GENERATE)) {
    const value = loose[field];
    if (value === undefined) continue;
    ctx.fail({
      code: "unsupported_param",
      path: [field],
      message:
        `\`${field}\` belongs to ${route} — POST /v1/song/easy-generate does not take it. ` +
        "Remove it, or select the route that does: pass the `lyrics` extra for the song route, " +
        "or `instrumental: true` for the instrumental route.",
      meta: { value, source: EASY_GENERATE_DOCS },
    });
    delete loose[field];
  }

  return { params: body, validate: fromPromptValidator.safe as MurekaValidate };
}

/**
 * Whether the caller supplied the `lyrics` extra — the question that separates
 * the two sung routes. A per-model extra is by definition a key the canonical
 * vocabulary does not name, so it is read off the input rather than typed on
 * it; `applyExtras` is what later copies it onto the body.
 */
function hasLyrics(input: MusicParams): boolean {
  return (input as { lyrics?: unknown }).lyrics !== undefined;
}

export const music = {
  category: "music",
  provider: "mureka",
  models: MODELS,
  modelParams: MUREKA_MUSIC_MODEL_PARAMS,
  unsupported: {
    durationSeconds:
      "No Mureka generate route takes a length — /v1/song/generate, /v1/song/easy-generate and " +
      "/v1/instrumental/generate all let the model decide, and each finished choice reports its " +
      "own `duration` (milliseconds) in the task response.",
    outputFormat:
      "Mureka has no output-format field: every succeeded choice ships fixed URLs — mp3 `url` " +
      "plus lossless `flac_url` and `wav_url`, each valid for 30 days.",
    seed: "No Mureka generate route has a seed field.",
  },
  compile(
    input: MusicParams,
    ctx: CompileContext<MusicParams>,
  ): CompiledCall<MurekaMusicWire, MurekaMusicResult> {
    if (input.instrumental === true) return compileInstrumental(input, ctx);
    return hasLyrics(input) ? compileSong(input, ctx) : compileFromPrompt(input, ctx);
  },
} as const satisfies MusicAdapterFor<
  typeof MUREKA_MUSIC_MODEL_PARAMS,
  MurekaMusicWire,
  MurekaMusicResult
>;
