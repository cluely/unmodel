/**
 * `unmodel/music` → `mureka.music` (POST /v1/song/generate) and
 * `mureka.instrumental` (POST /v1/instrumental/generate).
 *
 * The two-route music adapter, dispatched by the canonical word that names the
 * difference: `instrumental: true` compiles to the instrumental route, and
 * anything else to the song route — which REQUIRES `lyrics`, a word the
 * canonical vocabulary deliberately does not have, so lyrics arrive as a
 * per-model extra and their absence on the song route is a compile error that
 * names both ways out (pass `lyrics`, or set `instrumental: true`).
 *
 * The per-model rows declare the union of both routes' extras (a row is keyed
 * by model, and every model except `mureka-o2` serves both routes), so the
 * route split is enforced here at compile time: a song-only control
 * (`reference_id`, `vocal_id`, `melody_id`, `gender`, `lyrics`) on the
 * instrumental route fails with a message naming the route it belongs to, and
 * `instrumental_id` fails the same way on the song route.
 *
 * `durationSeconds`, `outputFormat` and `seed` are `unsupported`: neither
 * route has a length, format or seed field — a finished choice reports its
 * own `duration` and ships fixed mp3/FLAC/WAV URLs.
 *
 * Both routes are ASYNC: the validated request's response is a task object,
 * polled via `songQueryUrl(id)` / `instrumentalQueryUrl(id)` from
 * `unmodel/mureka`.
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
import { INSTRUMENTAL_DOCS, MODELS, MUREKA_MUSIC_MODEL_PARAMS, SONG_DOCS } from "./music-params";

/** The wire body of whichever route the `instrumental` flag selects. */
export type MurekaMusicWire = SongGenerateBody | InstrumentalGenerateBody;

/** What a unified music call to `mureka/…` returns — one route's `Validated`. */
export type MurekaMusicResult =
  | ReturnType<typeof songValidator<SongGenerateBody>>
  | ReturnType<typeof instrumentalValidator<InstrumentalGenerateBody>>;

/**
 * The `validate` half of a two-route adapter. The cast at each `return` is
 * what a union of wire bodies costs: `validate` is contravariant in its
 * parameter, so a function taking *one* arm is not assignable to one taking
 * the union. The kernel only ever calls it with the body compiled beside it,
 * which is the arm it was chosen for.
 */
type MurekaValidate = CompiledCall<MurekaMusicWire, MurekaMusicResult>["validate"];

/** The song route's controls, for the cross-route guard on the instrumental arm. */
const SONG_ONLY_EXTRAS = ["lyrics", "gender", "reference_id", "vocal_id", "melody_id"] as const;

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
        "Mureka's song route (POST /v1/song/generate) is lyrics-to-song and requires `lyrics` " +
        "(≤5000 characters) — pass the per-model `lyrics` extra, or set `instrumental: true` to " +
        "compile to POST /v1/instrumental/generate instead.",
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

  // The rows declare the union of both routes' extras (see music-params.ts),
  // so the song-only controls are refused here, with the route named.
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

export const music = {
  category: "music",
  provider: "mureka",
  models: MODELS,
  modelParams: MUREKA_MUSIC_MODEL_PARAMS,
  unsupported: {
    durationSeconds:
      "Neither POST /v1/song/generate nor /v1/instrumental/generate takes a length — the model " +
      "decides, and each finished choice reports its own `duration` (milliseconds) in the task " +
      "response.",
    outputFormat:
      "Mureka has no output-format field: every succeeded choice ships fixed URLs — mp3 `url` " +
      "plus lossless `flac_url` and `wav_url`, each valid for 30 days.",
    seed: "Neither Mureka generate route has a seed field.",
  },
  compile(
    input: MusicParams,
    ctx: CompileContext<MusicParams>,
  ): CompiledCall<MurekaMusicWire, MurekaMusicResult> {
    return input.instrumental === true ? compileInstrumental(input, ctx) : compileSong(input, ctx);
  },
} as const satisfies MusicAdapterFor<
  typeof MUREKA_MUSIC_MODEL_PARAMS,
  MurekaMusicWire,
  MurekaMusicResult
>;
