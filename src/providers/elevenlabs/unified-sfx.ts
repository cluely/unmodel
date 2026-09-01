/**
 * `unmodel/sfx` → `elevenlabs.sfx` (POST /v1/sound-generation).
 *
 * The one route in this category whose "no length given" is a BEHAVIOUR rather
 * than a number: the API's own words are "If set to None we will guess the
 * optimal duration using the prompt". Nothing is invented on the caller's
 * behalf, so — unlike Sonilo, Mirelo and Stable Audio — a request without
 * `durationSeconds` compiles here with zero warnings. That asymmetry is the
 * whole argument for the per-model duration row; see
 * `core/unified/vocabulary/sfx.ts`.
 *
 * The 0.5–30 second bounds are deliberately **not** repeated here: they live in
 * `elevenlabs.sfx`'s own schema, and a second copy in the adapter is a second
 * thing to drift. An out-of-range length therefore surfaces the provider's own
 * message remapped onto `durationSeconds`.
 *
 * `outputFormat` is the same composite this provider uses for speech and music
 * — `codec_sampleRate[_bitrate]`, assembled here and *validated there* — with
 * two differences worth knowing: it rides in the query string rather than the
 * body, so `.request.url` is where it shows up; and the enum is NOT music's.
 * There is no 48 kHz MP3 arm on this endpoint, which is why `./sfx-params.ts`
 * declares its own `FORMAT` rather than importing the music one.
 */
import { applyExtras, bitsToKbps, resolveAudioFormat } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  SfxAdapterFor,
  SfxParams as CanonicalSfxParams,
} from "../../core/unified/vocabulary/sfx";
import {
  sfx as validator,
  type ElevenlabsSoundEffectsOutputFormat,
  type SoundEffectsParams,
} from "./sound-effects";
import { ELEVENLABS_SFX_MODEL_PARAMS, FORMAT, MODELS } from "./sfx-params";

/** The wire body this adapter compiles to (`output_format` rides in the query). */
export type ElevenlabsSfxWire = SoundEffectsParams;

/** What a unified call to `elevenlabs/…` returns. */
export type ElevenlabsSfxResult = ReturnType<typeof validator>;

export const sfx = {
  category: "sfx",
  provider: "elevenlabs",
  models: MODELS,
  modelParams: ELEVENLABS_SFX_MODEL_PARAMS,
  compile(
    input: CanonicalSfxParams,
    ctx: CompileContext<CanonicalSfxParams>,
  ): CompiledCall<ElevenlabsSfxWire, ElevenlabsSfxResult> {
    const body: ElevenlabsSfxWire = { text: input.prompt, model_id: ctx.model };
    ctx.from(["text"], "prompt");
    ctx.from(["model_id"], "model");
    ctx.from(["duration_seconds"], "durationSeconds");
    ctx.from(["output_format"], "outputFormat");

    // Nothing to warn about when the length is absent, and that is the point:
    // this route's row declares no `durationDefault` because omitting the field
    // selects a BEHAVIOUR ("we will guess the optimal duration using the
    // prompt") rather than a number. The fal adapter, whose rows do carry
    // numbers, is where the `approximated_param` lives.
    //
    // Bounds live in the provider's schema — see the module note.
    if (input.durationSeconds !== undefined) body.duration_seconds = input.durationSeconds;

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
        body.output_format = composite as ElevenlabsSoundEffectsOutputFormat;
      }
    }

    applyExtras(input, ELEVENLABS_SFX_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SfxAdapterFor<
  typeof ELEVENLABS_SFX_MODEL_PARAMS,
  ElevenlabsSfxWire,
  ElevenlabsSfxResult
>;
