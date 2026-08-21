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
  EXTRA,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TtsAdapterFor,
  TtsModelParamTable,
  TtsParams,
} from "../../core/unified/vocabulary/tts";
import { tts as validator, type LmntFormat, type LmntSampleRate, type SpeechBody } from "./tts";

/** LMNT's one documented model — the ref union for `lmnt/…`. */
const MODELS = ["blizzard"] as const;

const SPEECH_DOCS = "https://docs.lmnt.com/api/speech/generate";

/** The wire body this adapter compiles to. */
export type LmntTtsWire = SpeechBody;

/** What a unified call to `lmnt/…` returns. */
export type LmntTtsResult = ReturnType<typeof validator>;

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

/**
 * LMNT's one model, and therefore one row.
 *
 * `languages` is {@link SPEECH_LANGUAGES} **minus `"auto"`**, which is the one
 * place this table cannot simply point at the provider's array. `"auto"` is a
 * legal wire value (it is the default) but not a legal *canonical* one: the
 * vocabulary's `language` is a BCP-47 tag, `toPrimaryLanguage` refuses a
 * four-letter word before the request is built, and "let the model detect" is
 * spelled by omitting the field. Completing a value that cannot be sent would
 * be the worst kind of suggestion.
 *
 * `temperature` and `top_p` are LMNT's expressiveness controls — and they are
 * why `speed` is declared unsupported rather than mapped onto one of them: they
 * steer variation and stability, not pace. `debug` saves the clip to the
 * account's library; it changes what the request *does* rather than only how
 * the answer is framed, so it is an extra rather than transport.
 */
const LMNT_TTS_MODEL_PARAMS = {
  blizzard: {
    codecs: ["mp3", "aac", "opus", "pcm_s16le", "pcm_f32le", "pcm_mulaw"],
    languages: [
      "ar", "as", "bn", "cs", "da", "de", "en", "es", "fi", "fr",
      "hi", "id", "it", "ja", "ko", "ml", "mr", "nl", "pl", "pt",
      "ru", "sk", "sv", "ta", "te", "th", "tr", "uk", "ur", "vi",
      "zh",
    ],
    extras: {
      temperature: EXTRA as number,
      top_p: EXTRA as number,
      debug: EXTRA as boolean,
    },
  },
} as const satisfies TtsModelParamTable;

export const tts = {
  category: "tts",
  provider: "lmnt",
  models: MODELS,
  modelParams: LMNT_TTS_MODEL_PARAMS,
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
