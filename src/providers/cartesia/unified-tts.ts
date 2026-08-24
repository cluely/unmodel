/**
 * `unmodel/tts` → `cartesia.tts` (POST /tts/bytes).
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
  applyExtras,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import {
  tts as validator,
  CARTESIA_TTS_LANGUAGES,
  type CartesiaEncoding,
  type CartesiaMp3BitRate,
  type CartesiaOutputFormat,
  type CartesiaSampleRate,
  type CartesiaTtsLanguage,
  type TtsBytesBody,
} from "./tts";
import {
  CARTESIA_TTS_DELIVERY,
  CARTESIA_TTS_MODEL_PARAMS,
  FORMAT,
  MODELS,
  TTS_BYTES_DOCS,
} from "./tts-params";

/** The wire body this adapter compiles to. */
export type CartesiaTtsWire = TtsBytesBody;

/** What a unified call to `cartesia/…` returns. */
export type CartesiaTtsResult = ReturnType<typeof validator>;

const TTS_LANGUAGE_SET = new Set<string>(CARTESIA_TTS_LANGUAGES);

/**
 * Membership in the wire's closed 42-code `language` enum, tested against the
 * same array {@link ROW} publishes for completions — one list, no second copy.
 *
 * `toPrimaryLanguage` returns a bare `string`: it normalizes BCP-47 to a primary
 * subtag ("pt-BR" → "pt") but knows no provider's list, so `"xx-YY"` arrives as
 * `"xx"`. Closing `TtsBytesBody.language` is what made that gap visible at this
 * adapter's own compile step.
 */
function isTtsLanguage(language: string): language is CartesiaTtsLanguage {
  return TTS_LANGUAGE_SET.has(language);
}

/** The two attribute controls that live under `generation_config`. */
const GENERATION_CONFIG_NESTING: Readonly<Record<string, readonly string[]>> = {
  volume: ["generation_config"],
  emotion: ["generation_config"],
};

export const tts = {
  category: "tts",
  provider: "cartesia",
  models: MODELS,
  modelParams: CARTESIA_TTS_MODEL_PARAMS,
  delivery: CARTESIA_TTS_DELIVERY,
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<CartesiaTtsWire, CartesiaTtsResult> {
    ctx.from(["transcript"], "text");
    ctx.from(["model_id"], "model");
    ctx.from(["output_format"], "outputFormat");
    ctx.from(["generation_config", "speed"], "speed");

    const body = {
      model_id: ctx.model,
      transcript: input.text,
    } as CartesiaTtsWire;

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
      if (language !== undefined) {
        // Narrowed for every code the wire accepts. The `else` deliberately
        // reinstates one layer inward the looseness the wire type just shed —
        // an off-enum primary subtag rides through to `checkEnums`, which
        // refuses it at *error* severity with the allow-list and the doc link.
        // Dropping it instead would silently send a request in a language the
        // caller did not ask for, and re-checking the enum here would be the
        // second copy of the list that the row exists to avoid.
        body.language = isTtsLanguage(language) ? language : (language as CartesiaTtsLanguage);
      }
    }

    applyExtras(input, CARTESIA_TTS_MODEL_PARAMS, body, ctx, {
      nest: GENERATION_CONFIG_NESTING,
    });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof CARTESIA_TTS_MODEL_PARAMS,
  CartesiaTtsWire,
  CartesiaTtsResult
>;
