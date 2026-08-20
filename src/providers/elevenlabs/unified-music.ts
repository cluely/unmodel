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
  EXTRA,
  resolveAudioFormat,
  toMilliseconds,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  MusicAdapterFor,
  MusicModelParamTable,
  MusicParams as CanonicalMusicParams,
} from "../../core/unified/vocabulary/music";
import { music as validator, type ElevenlabsMusicOutputFormat, type MusicParams } from "./music";

/** The two music models — the ref union for `elevenlabs/…`. */
const MODELS = ["music_v2", "music_v1"] as const;

const MUSIC_DOCS = "https://elevenlabs.io/docs/api-reference/music/compose";

/** The wire body this adapter compiles to (`output_format` rides in the query). */
export type ElevenlabsMusicWire = MusicParams;

/** What a unified call to `elevenlabs/…` returns. */
export type ElevenlabsMusicResult = ReturnType<typeof validator>;

/**
 * The composite behind `output_format`, enumerated from the same
 * `MUSIC_OUTPUT_FORMATS` list the provider validator checks against.
 *
 * PCM, μ-law and A-law are uncompressed, so the composite has no bitrate slot
 * for them; μ-law and A-law are bare telephony streams at 8 kHz with no
 * container of their own, which is what `"raw"` says.
 */
const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", opus: "opus", pcm_s16le: "pcm", pcm_mulaw: "ulaw", pcm_alaw: "alaw" },
  containers: {
    mp3: ["mp3"],
    opus: ["ogg"],
    pcm_s16le: ["raw"],
    pcm_mulaw: ["raw"],
    pcm_alaw: ["raw"],
  },
  sampleRates: {
    mp3: [22050, 24000, 44100, 48000],
    opus: [48000],
    pcm_s16le: [8000, 16000, 22050, 24000, 32000, 44100, 48000],
    pcm_mulaw: [8000],
    pcm_alaw: [8000],
  },
  bitrates: {
    mp3: [32000, 48000, 64000, 96000, 128000, 192000, 240000, 320000],
    opus: [32000, 64000, 96000, 128000, 192000],
  },
  unavailable: { pcm_s16le: ["bitrate"], pcm_mulaw: ["bitrate"], pcm_alaw: ["bitrate"] },
  defaults: { sampleRate: 44100, bitrate: 128000 },
  defaultsByCodec: {
    opus: { sampleRate: 48000 },
    pcm_mulaw: { sampleRate: 8000 },
    pcm_alaw: { sampleRate: 8000 },
  },
  source: MUSIC_DOCS,
};

/**
 * The two music ids, which are wire-identical, and one shared row says so.
 *
 * `POST /v1/music` has no per-model constraint table at all: both ids go
 * through one validator, one `MUSIC_OUTPUT_FORMATS` enum and one schema. What
 * differs between them is the *shape* of `composition_plan` (`sections` on v1,
 * `chunks` on v2) and the `"auto"` output-format default — neither of which is
 * a value-space difference a row can carry, and `composition_plan` is excluded
 * for the first of those reasons: one key whose type depends on the model id is
 * a discriminated union the extras mechanism has no way to express, and it is
 * an alternative to `prompt` rather than an addition to it.
 *
 * `codecs` is `FORMAT.codecs`' key set. `aac`, `flac` and `pcm_f32le` have no
 * composite spelling here and are compile errors rather than 422s.
 *
 * The five extras are the body's own generation knobs: a fine-tune and its
 * strength, phonetic name handling, C2PA signing, and whether the result is
 * retained so it can be inpainted later. `music_length_ms`,
 * `force_instrumental`, `output_format` and `seed` are canonical words' wire
 * spellings and are therefore not extras.
 */
const MUSIC_EXTRAS = {
  finetune_id: EXTRA as string | null,
  finetune_strength: EXTRA as number,
  use_phonetic_names: EXTRA as boolean,
  sign_with_c2pa: EXTRA as boolean,
  store_for_inpainting: EXTRA as boolean,
} as const;

const ROW = {
  codecs: ["mp3", "opus", "pcm_s16le", "pcm_mulaw", "pcm_alaw"],
  extras: MUSIC_EXTRAS,
} as const;

const ELEVENLABS_MUSIC_MODEL_PARAMS = {
  music_v2: ROW,
  music_v1: ROW,
} as const satisfies MusicModelParamTable;

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
