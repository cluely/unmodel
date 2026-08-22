/**
 * `unmodel/music` → `stability.music` (POST /v2beta/audio/stable-audio-2/text-to-audio).
 *
 * The seconds provider, and the other half of the category's only real
 * disagreement: `duration` counts whole and fractional seconds where ElevenLabs
 * counts milliseconds, which is exactly why the canonical word is
 * `durationSeconds` and not `duration`.
 *
 * Stability's two audio-conditioned routes — `musicFromAudio` (POST
 * .../audio-to-audio) and `musicInpaint` (POST .../inpaint) — are **not**
 * unified in v1. Both require an `audio` Blob plus route-specific controls
 * (`strength`, `mask_start`/`mask_end`) that no other music provider has, so a
 * canonical vocabulary for them would be a vocabulary of one. They stay
 * wire-only on `unmodel/stability`, where those params keep their own names and
 * their own meanings.
 *
 * `output_format` is a codec and nothing else — `mp3` or `wav`, a form field
 * rather than a query param — so a request naming a sample rate or a bitrate is
 * an error rather than a value quietly dropped. `steps` and `cfg_scale` have no
 * canonical word; they arrive as per-model extras and go on the wire verbatim,
 * with their per-model bounds still checked by `stability.music`'s own
 * `checkSteps` (30–100 on stable-audio-2, 4–8 on 2.5 — and on the first of
 * those `steps` moves the price, which is another reason not to invent one).
 */
import { applyExtras, resolveAudioFormat } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { MusicAdapterFor, MusicParams } from "../../core/unified/vocabulary/music";
import {
  music as validator,
  type StableAudioOutputFormat,
  type StableAudioTextToAudioParams,
} from "./music";
import { FORMAT, MODELS, STABILITY_MUSIC_MODEL_PARAMS } from "./music-params";

/** The wire params this adapter compiles to (multipart form fields). */
export type StabilityMusicWire = StableAudioTextToAudioParams;

/** What a unified call to `stability/…` returns. */
export type StabilityMusicResult = ReturnType<typeof validator>;

export const music = {
  category: "music",
  provider: "stability",
  models: MODELS,
  modelParams: STABILITY_MUSIC_MODEL_PARAMS,
  unsupported: {
    instrumental:
      "Stable Audio has no vocals switch — it is an instrumental-and-sound model, and the way to " +
      "steer it away from vocals is the prompt itself.",
  },
  compile(
    input: MusicParams,
    ctx: CompileContext<MusicParams>,
  ): CompiledCall<StabilityMusicWire, StabilityMusicResult> {
    const body: StabilityMusicWire = { prompt: input.prompt, model: ctx.model };
    ctx.from(["duration"], "durationSeconds");
    ctx.from(["output_format"], "outputFormat");

    // A rename, and nothing more: the canonical unit and the wire unit are both
    // seconds, and fractions are legal here. The documented 1–190 s range lives
    // in `stability.music`'s own schema, so an out-of-range length surfaces that
    // message remapped onto `durationSeconds` rather than a second copy of the
    // bounds going stale in this file.
    if (input.durationSeconds !== undefined) body.duration = input.durationSeconds;

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) body.output_format = format.wire as StableAudioOutputFormat;
    }

    if (input.seed !== undefined) body.seed = input.seed;

    applyExtras(input, STABILITY_MUSIC_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies MusicAdapterFor<
  typeof STABILITY_MUSIC_MODEL_PARAMS,
  StabilityMusicWire,
  StabilityMusicResult
>;
