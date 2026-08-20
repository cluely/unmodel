/**
 * `unmodel/speech` → `cartesia.speech` (POST /tts/bytes).
 *
 * The object-format provider: `output_format` is a discriminated union on
 * `container`, and which of `encoding` / `sample_rate` / `bit_rate` are
 * required depends on which arm you land in.
 *
 * - **`wav`** — `encoding` and `sample_rate` are optional (documented defaults
 *   `pcm_s16le` / 44100). This adapter sends what the caller asked for and
 *   omits what they did not, because omitting an optional field invents
 *   nothing.
 * - **`raw`** — both are REQUIRED by the schema's own union arm.
 * - **`mp3`** — `sample_rate` and `bit_rate` are both in the arm's `required`
 *   list. Cartesia documents a default for `bit_rate` (128000) and none for
 *   `sample_rate`, so the first is filled with a warning and the second is an
 *   error: there is nothing honest to invent, and a 422 that says
 *   "sample_rate is required" is worse than a message that says so here.
 *
 * `output_format` is also the one **required** encoding field in the category:
 * POST /tts/bytes documents no default for it, so a request that omits
 * `outputFormat` is refused — by Cartesia's own schema, whose finding is
 * remapped onto `outputFormat`. That leaves `providerOptions.cartesia` as a
 * working escape hatch (it is merged before validation), which an adapter-side
 * check would have closed.
 *
 * `speed` is `generation_config.speed` (0.6–1.5). The deprecated top-level
 * `speed: "slow" | "normal" | "fast"` is deliberately never emitted — it is a
 * three-way enum that cannot express a multiplier, and Cartesia's own docs
 * point at the nested field instead.
 */
import {
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { SpeechParams } from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  type CartesiaEncoding,
  type CartesiaMp3BitRate,
  type CartesiaOutputFormat,
  type CartesiaSampleRate,
  type TtsBytesBody,
} from "./speech";

/** The sonic ids the `model_id` enum publishes — the ref union for `cartesia/…`. */
const MODELS = ["sonic-3.5", "sonic-3", "sonic-preview", "sonic-latest"] as const;

const TTS_BYTES_DOCS = "https://docs.cartesia.ai/api-reference/tts/bytes";

/** The wire body this adapter compiles to. */
export type CartesiaSpeechWire = TtsBytesBody;

/** What a unified call to `cartesia/…` returns. */
export type CartesiaSpeechResult = ReturnType<typeof validator>;

const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000] as const;

const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "mp3",
    pcm_s16le: "pcm_s16le",
    pcm_f32le: "pcm_f32le",
    pcm_mulaw: "pcm_mulaw",
    pcm_alaw: "pcm_alaw",
  },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav", "raw"],
    pcm_f32le: ["wav", "raw"],
    pcm_mulaw: ["wav", "raw"],
    pcm_alaw: ["wav", "raw"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_f32le: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
    pcm_alaw: SAMPLE_RATES,
  },
  bitrates: { mp3: [32000, 64000, 96000, 128000, 192000] },
  // Only the mp3 arm has a `bit_rate` field at all.
  unavailable: {
    pcm_s16le: ["bitrate"],
    pcm_f32le: ["bitrate"],
    pcm_mulaw: ["bitrate"],
    pcm_alaw: ["bitrate"],
  },
  defaults: { bitrate: 128000 },
  source: TTS_BYTES_DOCS,
};

export const speech = {
  category: "speech",
  provider: "cartesia",
  models: MODELS,
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<CartesiaSpeechWire, CartesiaSpeechResult> {
    ctx.from(["transcript"], "text");
    ctx.from(["model_id"], "model");
    ctx.from(["output_format"], "outputFormat");
    ctx.from(["generation_config", "speed"], "speed");

    const body = {
      model_id: ctx.model,
      transcript: input.text,
    } as CartesiaSpeechWire;

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: TTS_BYTES_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      // "The only documented voice mode is `id`" — the object wrapper is the
      // wire shape, not a canonical distinction.
      if (voice !== undefined) body.voice = { mode: "id", id: voice.value };
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        const rate = format.sampleRate as CartesiaSampleRate | undefined;
        if (format.codec === "mp3") {
          if (rate === undefined) {
            ctx.fail({
              code: "invalid_shape",
              path: ["outputFormat"],
              message:
                "`outputFormat.sampleRate` is required for mp3 on this model and Cartesia " +
                "documents no default for it (the mp3 arm lists both `sample_rate` and " +
                "`bit_rate` as required). Set it explicitly — 44100 is the usual choice.",
              meta: { field: "sampleRate", codec: "mp3", source: TTS_BYTES_DOCS },
            });
          } else {
            body.output_format = {
              container: "mp3",
              sample_rate: rate,
              bit_rate: format.bitrate as CartesiaMp3BitRate,
            };
          }
        } else if (format.container === "wav") {
          body.output_format = {
            container: "wav",
            encoding: format.wire as CartesiaEncoding,
            ...(rate !== undefined && { sample_rate: rate }),
          };
        } else if (rate === undefined) {
          ctx.fail({
            code: "invalid_shape",
            path: ["outputFormat"],
            message:
              "`outputFormat.sampleRate` is required for a raw (container-less) stream on this " +
              "model — the `raw` arm has no default sample rate to fall back on.",
            meta: { field: "sampleRate", codec: format.codec, source: TTS_BYTES_DOCS },
          });
        } else {
          body.output_format = {
            container: "raw",
            encoding: format.wire as CartesiaEncoding,
            sample_rate: rate,
          } satisfies CartesiaOutputFormat;
        }
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.6, max: 1.5, source: TTS_BYTES_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) body.generation_config = { speed };
    }

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(
          input.language,
          { path: ["language"], warn: ctx.warn },
          { source: TTS_BYTES_DOCS },
        ),
      );
      if (language !== undefined) body.language = language;
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, CartesiaSpeechWire, CartesiaSpeechResult>;
