/**
 * `unmodel/speech` → `resemble.speech` (POST https://f.cluster.resemble.ai/synthesize).
 *
 * **There is no model on the wire.** "The synthesis API automatically uses the
 * model associated with your `voice_uuid` … Do not pass it as a `model`
 * field." The ref therefore names the catalog row and nothing else — it is
 * what makes `resemble/resemble-ultra` a legal ref and what the
 * `unknown_model` warning checks against — and the *voice* becomes the field
 * that decides everything, which is why it is effectively required here (the
 * provider's own schema reports a missing `voice_uuid`, remapped onto
 * `voice`).
 *
 * **PCM width is `precision`, not a codec.** Resemble's `output_format` is
 * only `wav` or `mp3`; the sample format lives in a separate field
 * (`PCM_16` / `PCM_24` / `PCM_32` / `MULAW`), so `pcm_s24le` and friends map
 * onto the pair, and a WAV request that names no width simply leaves the field
 * off rather than inventing one.
 */
import {
  resolveAudioFormat,
  resolveVoice,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { AudioFormatCodec } from "../../core/unified/vocabulary/audio";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { SpeechParams } from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  type ResemblePrecision,
  type ResembleSampleRate,
  type SynthesizeBody,
} from "./speech";

/** The one TTS row the catalog carries — the ref union for `resemble/…`. */
const MODELS = ["resemble-ultra"] as const;

const SYNC_DOCS = "https://docs.resemble.ai/voice-generation/text-to-speech/synchronous";

/** The wire body this adapter compiles to. */
export type ResembleSpeechWire = SynthesizeBody;

/** What a unified call to `resemble/…` returns. */
export type ResembleSpeechResult = ReturnType<typeof validator>;

const SAMPLE_RATES = [8000, 16000, 22050, 32000, 44100, 48000] as const;

const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "mp3",
    pcm_s16le: "wav",
    pcm_s24le: "wav",
    pcm_s32le: "wav",
    pcm_mulaw: "wav",
  },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav"],
    pcm_s24le: ["wav"],
    pcm_s32le: ["wav"],
    pcm_mulaw: ["wav"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_s24le: SAMPLE_RATES,
    pcm_s32le: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
  },
  unavailable: ["bitrate"],
  source: SYNC_DOCS,
};

/** Canonical sample format → Resemble's `precision`. WAV output only. */
const PRECISION: Readonly<Partial<Record<AudioFormatCodec, ResemblePrecision>>> = {
  pcm_s16le: "PCM_16",
  pcm_s24le: "PCM_24",
  pcm_s32le: "PCM_32",
  pcm_mulaw: "MULAW",
};

export const speech = {
  category: "speech",
  provider: "resemble",
  models: MODELS,
  unsupported: {
    speed:
      "Resemble's synthesis routes publish no speaking-rate field — pace is a property of the " +
      "voice, or of SSML `<prosody>` inside `data`.",
    language:
      "Resemble's synthesis routes publish no language field — the language comes from the " +
      "voice behind `voice_uuid`, which also selects the model.",
  },
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<ResembleSpeechWire, ResembleSpeechResult> {
    ctx.from(["data"], "text");
    ctx.from(["voice_uuid"], "voice");
    ctx.from(["output_format"], "outputFormat");
    ctx.from(["sample_rate"], "outputFormat");
    ctx.from(["precision"], "outputFormat");

    const body: ResembleSpeechWire = { voice_uuid: "", data: input.text };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          input.voice,
          { accepts: ["id"], source: SYNC_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.voice_uuid = voice.value;
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        body.output_format = format.codec === "mp3" ? "mp3" : "wav";
        if (format.sampleRate !== undefined) {
          body.sample_rate = format.sampleRate as ResembleSampleRate;
        }
        const precision = PRECISION[format.codec];
        if (precision !== undefined) body.precision = precision;
      }
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, ResembleSpeechWire, ResembleSpeechResult>;
