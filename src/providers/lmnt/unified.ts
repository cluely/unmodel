/**
 * `unmodel/speech` → `lmnt.speech` (POST /v1/ai/speech/bytes).
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
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { SpeechParams } from "../../core/unified/vocabulary/speech";
import { speech as validator, type LmntFormat, type LmntSampleRate, type SpeechBody } from "./speech";

/** LMNT's one documented model — the ref union for `lmnt/…`. */
const MODELS = ["blizzard"] as const;

const SPEECH_DOCS = "https://docs.lmnt.com/api/speech/generate";

/** The wire body this adapter compiles to. */
export type LmntSpeechWire = SpeechBody;

/** What a unified call to `lmnt/…` returns. */
export type LmntSpeechResult = ReturnType<typeof validator>;

const SAMPLE_RATES = [8000, 16000, 24000] as const;

const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "mp3",
    aac: "aac",
    pcm_mulaw: "ulaw",
    pcm_s16le: "wav",
    pcm_f32le: "pcm_f32le",
    opus: "webm",
  },
  containers: {
    mp3: ["mp3"],
    aac: ["aac"],
    pcm_mulaw: ["raw"],
    pcm_s16le: ["wav", "raw"],
    pcm_f32le: ["raw"],
    opus: ["webm"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    aac: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_f32le: SAMPLE_RATES,
    opus: SAMPLE_RATES,
  },
  unavailable: ["bitrate"],
  source: SPEECH_DOCS,
};

export const speech = {
  category: "speech",
  provider: "lmnt",
  models: MODELS,
  unsupported: {
    speed:
      "LMNT's speech endpoints publish no speaking-rate field — `temperature` and `top_p` steer " +
      "expressiveness and stability, not pace, so there is nothing to map a multiplier onto.",
  },
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<LmntSpeechWire, LmntSpeechResult> {
    ctx.from(["format"], "outputFormat");
    ctx.from(["sample_rate"], "outputFormat");

    const body: LmntSpeechWire = { text: input.text, voice: "", model: ctx.model };

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

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, LmntSpeechWire, LmntSpeechResult>;
