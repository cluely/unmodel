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
import { applyExtras, EXTRA, resolveAudioFormat, type AudioFormatSpec } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  MusicAdapterFor,
  MusicModelParamTable,
  MusicParams,
} from "../../core/unified/vocabulary/music";
import {
  music as validator,
  type StableAudioOutputFormat,
  type StableAudioTextToAudioParams,
} from "./music";

/**
 * The two Stable Audio 2.x models this route serves.
 *
 * `stable-audio-3` is in the catalog and deliberately absent here: it is served
 * by the async `/v2beta/audio/stable-audio/*` routes, and `stability.music`'s
 * own `checkAudioModel` rejects it — a ref that cannot work should not
 * autocomplete.
 */
const MODELS = ["stable-audio-2", "stable-audio-2.5"] as const;

const API_REFERENCE_URL = "https://api.stability.ai/v2alpha/openapi";

/** The wire params this adapter compiles to (multipart form fields). */
export type StabilityMusicWire = StableAudioTextToAudioParams;

/** What a unified call to `stability/…` returns. */
export type StabilityMusicResult = ReturnType<typeof validator>;

/**
 * `output_format` — a codec, full stop. `wav` is where a canonical
 * `pcm_s16le` lands, since that is the only thing a WAV file of generated
 * audio contains.
 */
const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", pcm_s16le: "wav" },
  containers: { pcm_s16le: ["wav"] },
  unavailable: ["sampleRate", "bitrate"],
  source: API_REFERENCE_URL,
};

/**
 * Both Stable Audio 2.x ids, with the same two-codec row.
 *
 * `output_format` is `"mp3" | "wav"`, which is `mp3` and `pcm_s16le` in
 * canonical spelling — the narrowest codec list in the library, and the reason
 * `outputFormat: "opus"` is a compile error here and fine on
 * `elevenlabs/music_v1`.
 *
 * `steps` and `cfg_scale` are the diffusion knobs the vocabulary has no word
 * for. They are identical keys on both rows because both models take them; what
 * differs is the *range*, which is a run-time fact `checkSteps` already owns
 * and a row deliberately does not duplicate.
 */
const STABILITY_MUSIC_EXTRAS = {
  /** Sampling steps; 30–100 on stable-audio-2, 4–8 on 2.5, and it moves the price. */
  steps: EXTRA as number,
  /** How closely to follow the prompt. */
  cfg_scale: EXTRA as number,
} as const;

const ROW = { codecs: ["mp3", "pcm_s16le"], extras: STABILITY_MUSIC_EXTRAS } as const;

const STABILITY_MUSIC_MODEL_PARAMS = {
  "stable-audio-2": ROW,
  "stable-audio-2.5": ROW,
} as const satisfies MusicModelParamTable;

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
