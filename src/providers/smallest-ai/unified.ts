/**
 * `unmodel/speech` → `smallest-ai.speech` (POST /waves/v1/tts).
 *
 * The flattest body of the fourteen: `text`, `voice_id`, `model`, `speed`,
 * `language`, `output_format` and `sample_rate` are all top-level, so the
 * adapter is a rename table plus two derivations.
 *
 * `output_format` names the container and the codec together (`pcm` is the
 * bare stream, `wav` the same samples with a header, `ulaw`/`alaw` the
 * telephony codecs) and there is no bitrate field anywhere, so a canonical
 * bitrate is an error rather than a value dropped.
 *
 * Note the endpoint's 250-character cap and its `accept: audio/wav` header:
 * both are the provider validator's business, and a unified call gets them for
 * free because it ends in that same validator.
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
  type SmallestLanguage,
  type SmallestOutputFormat,
  type SmallestSampleRate,
  type TtsParams,
} from "./speech";

/** The two Lightning pools — the ref union for `smallest-ai/…`. */
const MODELS = ["lightning_v3.1", "lightning_v3.1_pro"] as const;

const SYNTHESIZE_DOCS =
  "https://docs.smallest.ai/models/api-reference/text-to-speech/synthesize-speech";

/** The wire params this adapter compiles to. */
export type SmallestSpeechWire = TtsParams;

/** What a unified call to `smallest-ai/…` returns. */
export type SmallestSpeechResult = ReturnType<typeof validator>;

const SAMPLE_RATES = [8000, 16000, 24000, 44100] as const;

const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", pcm_s16le: "wav", pcm_mulaw: "ulaw", pcm_alaw: "alaw" },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["raw"],
    pcm_alaw: ["raw"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
    pcm_alaw: SAMPLE_RATES,
  },
  unavailable: ["bitrate"],
  source: SYNTHESIZE_DOCS,
};

export const speech = {
  category: "speech",
  provider: "smallest-ai",
  models: MODELS,
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<SmallestSpeechWire, SmallestSpeechResult> {
    ctx.from(["voice_id"], "voice");
    ctx.from(["output_format"], "outputFormat");
    ctx.from(["sample_rate"], "outputFormat");

    const body: SmallestSpeechWire = { text: input.text, voice_id: "", model: ctx.model };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: SYNTHESIZE_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voice_id = voice.value;
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        body.output_format =
          format.codec === "pcm_s16le" && format.container === "raw"
            ? "pcm"
            : (format.wire as SmallestOutputFormat);
        if (format.sampleRate !== undefined) {
          body.sample_rate = format.sampleRate as SmallestSampleRate;
        }
      }
    }

    if (input.speed !== undefined) {
      const speed = ctx.take(
        toSpeed(
          input.speed,
          { min: 0.5, max: 2, source: SYNTHESIZE_DOCS },
          { path: ["speed"], warn: ctx.warn },
        ),
      );
      if (speed !== undefined) body.speed = speed;
    }

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(
          input.language,
          { path: ["language"], warn: ctx.warn },
          { source: SYNTHESIZE_DOCS },
        ),
      );
      // The 32-code enum (and the 11 codes that are Pro-only) is the provider
      // validator's business — it knows which pool the ref selected.
      if (language !== undefined) body.language = language as SmallestLanguage;
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, SmallestSpeechWire, SmallestSpeechResult>;
