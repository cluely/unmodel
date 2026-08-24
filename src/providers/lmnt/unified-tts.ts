/**
 * `unmodel/tts` → `lmnt.tts` (POST /v1/ai/speech/bytes).
 *
 * A plain body — `{ text, voice, model, format, sample_rate, language }` — and
 * one real gap: **LMNT publishes no speed control**. Neither
 * `/v1/ai/speech/bytes` nor `/v1/ai/speech` has a rate field, and
 * `temperature` / `top_p` steer expressiveness, not pace, so `speed` is
 * declared unsupported and the kernel rejects it before compile with the same
 * message every other provider's gaps get. Silently ignoring it would produce
 * audio at the wrong pace with nothing in the result to explain why.
 *
 * `format` doubles as the container: `wav` and `pcm_s16le` carry the same
 * samples with and without a header, and `webm` is LMNT's spelling for Opus
 * (its only WebM codec) — which is a container substitution away from the
 * canonical Ogg default, so it warns.
 */
import {
  applyExtras,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { TtsAdapterFor, TtsParams } from "../../core/unified/vocabulary/tts";
import { tts as validator, type LmntFormat, type LmntSampleRate, type SpeechBody } from "./tts";
import {
  FORMAT,
  LMNT_TTS_DELIVERY,
  LMNT_TTS_MODEL_PARAMS,
  MODELS,
  SPEECH_DOCS,
} from "./tts-params";

/** The wire body this adapter compiles to. */
export type LmntTtsWire = SpeechBody;

/** What a unified call to `lmnt/…` returns. */
export type LmntTtsResult = ReturnType<typeof validator>;

export const tts = {
  category: "tts",
  provider: "lmnt",
  models: MODELS,
  modelParams: LMNT_TTS_MODEL_PARAMS,
  delivery: LMNT_TTS_DELIVERY,
  unsupported: {
    speed:
      "LMNT's speech endpoints publish no speaking-rate field — `temperature` and `top_p` steer " +
      "expressiveness and stability, not pace, so there is nothing to map a multiplier onto.",
  },
  compile(
    input: TtsParams,
    ctx: CompileContext<TtsParams>,
  ): CompiledCall<LmntTtsWire, LmntTtsResult> {
    ctx.from(["format"], "outputFormat");
    ctx.from(["sample_rate"], "outputFormat");

    const body: LmntTtsWire = { text: input.text, voice: "", model: ctx.model };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: SPEECH_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voice = voice.value;
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        body.format =
          format.codec === "pcm_s16le" && format.container === "raw"
            ? "pcm_s16le"
            : (format.wire as LmntFormat);
        if (format.sampleRate !== undefined) body.sample_rate = format.sampleRate as LmntSampleRate;
      }
    }

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(
          input.language,
          { path: ["language"], warn: ctx.warn },
          { source: SPEECH_DOCS },
        ),
      );
      if (language !== undefined) body.language = language;
    }

    applyExtras(input, LMNT_TTS_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies TtsAdapterFor<
  typeof LMNT_TTS_MODEL_PARAMS,
  LmntTtsWire,
  LmntTtsResult
>;
