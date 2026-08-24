/**
 * `unmodel/tts` → `minimax.tts` (POST /v1/t2a_v2).
 *
 * A three-field audio object (`audio_setting.{format,sample_rate,bitrate}`)
 * and a voice/prosody object (`voice_setting.{voice_id,speed}`), so this
 * adapter is mostly nesting — with one genuine translation.
 *
 * **`language_boost` is spelled in English words**, not language codes:
 * `"Portuguese"`, `"Chinese,Yue"`, `"auto"`. The canonical `language` is
 * BCP-47, so the table below is the mapping, and a tag MiniMax has no word for
 * is an `invalid_enum_value` naming the ones it does — never a dropped hint,
 * because a request that silently loses its language hint comes back in the
 * wrong accent with nothing to point at.
 *
 * `bitrate` exists for mp3 only ("it is ignored for other formats" — the
 * provider validator warns), so it is declared unavailable for every other
 * codec here and the error arrives before the request is sent.
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
  type MinimaxAudioFormat,
  type MinimaxLanguageBoost,
  type T2aParams,
} from "./tts";
import {
  FORMAT,
  LANGUAGE_BOOSTS,
  MINIMAX_TTS_DELIVERY,
  MINIMAX_TTS_MODEL_PARAMS,
  MODELS,
  SAMPLE_RATES,
  T2A_DOCS,
} from "./tts-params";

/** The wire body this adapter compiles to. */
export type MinimaxTtsWire = T2aParams;

/** What a unified call to `minimax/…` returns. */
export type MinimaxTtsResult = ReturnType<typeof validator>;

/** Where each extra lands; everything not named here is a body-root field. */
const TTS_NESTING: Readonly<Record<string, readonly string[]>> = {
  emotion: ["voice_setting"],
  vol: ["voice_setting"],
  pitch: ["voice_setting"],
  text_normalization: ["voice_setting"],
  latex_read: ["voice_setting"],
  tone: ["pronunciation_dict"],
};

export const tts = {
  category: "tts",
  provider: "minimax",
  models: MODELS,
  modelParams: MINIMAX_TTS_MODEL_PARAMS,
  delivery: MINIMAX_TTS_DELIVERY,
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<MinimaxTtsWire, MinimaxTtsResult> {
    ctx.from(["voice_setting", "voice_id"], "voice");
    ctx.from(["voice_setting", "speed"], "speed");
    ctx.from(["audio_setting"], "outputFormat");
    ctx.from(["language_boost"], "language");

    const body: MinimaxTtsWire = { model: ctx.model, text: input.text };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: T2A_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voice_setting = { voice_id: voice.value };
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.5, max: 2, source: T2A_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) body.voice_setting = { ...body.voice_setting, speed };
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        // `pcm`/`pcmu_raw` are bare streams; the WAV-wrapped spellings are
        // separate enum members rather than a container field.
        const wire: MinimaxAudioFormat =
          format.container === "wav" && format.codec === "pcm_s16le"
            ? "wav"
            : format.container === "wav" && format.codec === "pcm_mulaw"
              ? "pcmu_wav"
              : (format.wire as MinimaxAudioFormat);
        body.audio_setting = {
          format: wire,
          ...(format.sampleRate !== undefined && {
            sample_rate: format.sampleRate as (typeof SAMPLE_RATES)[number],
          }),
          ...(format.bitrate !== undefined && {
            bitrate: format.bitrate as 32000 | 64000 | 128000 | 256000,
          }),
        };
      }
    }

    if (input.language !== undefined) {
      const primary = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, { source: T2A_DOCS }),
      );
      if (primary !== undefined) {
        // The widening cast is the cost of keeping `LANGUAGE_BOOSTS` literal
        // for the rows above: a run-time subtag is a `string`, and a table with
        // 42 named keys has no index signature to look one up with.
        const boost = (LANGUAGE_BOOSTS as Readonly<Record<string, MinimaxLanguageBoost | undefined>>)[
          primary
        ];
        if (boost === undefined) {
          ctx.fail({
            code: "invalid_enum_value",
            path: ["language"],
            message:
              `\`language\` ${JSON.stringify(input.language)} has no \`language_boost\` on this ` +
              `model — MiniMax names languages in English words, and covers ` +
              `${Object.keys(LANGUAGE_BOOSTS).join(", ")}.`,
            meta: {
              allowed: Object.keys(LANGUAGE_BOOSTS),
              value: input.language,
              source: T2A_DOCS,
            },
          });
        } else {
          body.language_boost = boost;
        }
      }
    }

    applyExtras(input, MINIMAX_TTS_MODEL_PARAMS, body, ctx, { nest: TTS_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof MINIMAX_TTS_MODEL_PARAMS,
  MinimaxTtsWire,
  MinimaxTtsResult
>;
