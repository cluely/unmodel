/**
 * `unmodel/music` → `elevenlabs.music` (POST /v1/music).
 *
 * The millisecond provider. `music_length_ms` is exactly what its name says,
 * so a canonical `durationSeconds: 90` compiles to `90000` — silently, because
 * a unit conversion is not an approximation and warning about it would spend
 * the warning channel on arithmetic that loses nothing. A length that lands
 * between two milliseconds is an error instead of a rounded value; see
 * `toMilliseconds`.
 *
 * The 3 000–600 000 ms bounds are deliberately **not** repeated here: they live
 * in `elevenlabs.music`'s own schema, and a second copy in the adapter is a
 * second thing to drift. An out-of-range length therefore surfaces the
 * provider's own message remapped onto `durationSeconds`.
 *
 * `outputFormat` is the same composite this provider uses for speech —
 * `codec_sampleRate[_bitrate]`, assembled here and *validated there* — with one
 * difference worth knowing: it rides in the query string, not the body, so
 * `.request.url` is where it shows up.
 */
import {
  applyExtras,
  bitsToKbps,
  resolveAudioFormat,
  toMilliseconds,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  MusicAdapterFor,
  MusicParams as CanonicalMusicParams,
} from "../../core/unified/vocabulary/music";
import { music as validator, type ElevenlabsMusicOutputFormat, type MusicParams } from "./music";
import { ELEVENLABS_MUSIC_MODEL_PARAMS, FORMAT, MODELS } from "./music-params";

/** The wire body this adapter compiles to (`output_format` rides in the query). */
export type ElevenlabsMusicWire = MusicParams;

/** What a unified call to `elevenlabs/…` returns. */
export type ElevenlabsMusicResult = ReturnType<typeof validator>;

export const music = {
  category: "music",
  provider: "elevenlabs",
  models: MODELS,
  modelParams: ELEVENLABS_MUSIC_MODEL_PARAMS,
  compile(
    input: CanonicalMusicParams,
    ctx: CompileContext<CanonicalMusicParams>,
  ): CompiledCall<ElevenlabsMusicWire, ElevenlabsMusicResult> {
    const body: ElevenlabsMusicWire = { prompt: input.prompt, model_id: ctx.model };
    ctx.from(["model_id"], "model");
    ctx.from(["music_length_ms"], "durationSeconds");
    ctx.from(["force_instrumental"], "instrumental");
    ctx.from(["output_format"], "outputFormat");

    if (input.durationSeconds !== undefined) {
      // Bounds live in the provider's schema — see the module note.
      const ms = ctx.take(
        toMilliseconds(input.durationSeconds, { path: ["durationSeconds"], warn: ctx.warn }),
      );
      if (ms !== undefined) body.music_length_ms = ms;
    }

    if (input.instrumental !== undefined) body.force_instrumental = input.instrumental;

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined && format.sampleRate !== undefined) {
        let composite = `${format.wire}_${format.sampleRate}`;
        if (format.bitrate !== undefined) {
          const kbps = ctx.take(
            bitsToKbps(format.bitrate, { path: ["outputFormat"], warn: ctx.warn }),
          );
          if (kbps === undefined) return { params: body, validate: validator.safe };
          composite = `${composite}_${kbps}`;
        }
        body.output_format = composite as ElevenlabsMusicOutputFormat;
      }
    }

    // Documented as ignored when a `prompt` is present, which every unified
    // call has — `elevenlabs.music`'s own `checkIgnoredParams` says so, and its
    // warning arrives here at `seed` rather than being pre-empted.
    if (input.seed !== undefined) body.seed = input.seed;

    applyExtras(input, ELEVENLABS_MUSIC_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies MusicAdapterFor<
  typeof ELEVENLABS_MUSIC_MODEL_PARAMS,
  ElevenlabsMusicWire,
  ElevenlabsMusicResult
>;
