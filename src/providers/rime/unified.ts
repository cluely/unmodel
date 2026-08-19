/**
 * `unmodel/speech` → `rime.speech` (POST /v1/rime-tts).
 *
 * Two provider-specific facts drive everything here.
 *
 * **The container is an `Accept` header, not a body field.** Over HTTP, Rime
 * picks the encoding with `accept: audio/mpeg` and friends; the body carries
 * only `samplingRate`. `accept` rides in the params object and the provider
 * validator moves it onto `.request.headers`, so the adapter writes it like
 * any other param and the provenance rule points both it and `samplingRate` at
 * `outputFormat`.
 *
 * **Speed is a TIME scale, and which field it goes in depends on the model.**
 * Coda and Mist v3 take `timeScaleFactor`; Mist v2 and Mist v1 take
 * `speedAlpha`. Both run backwards from the canonical multiplier — below 1.0
 * is *faster* — so both are `1 / speed`, which is exact and therefore silent.
 * Neither is bounds-checked here: Rime clamps `timeScaleFactor` outside
 * 0.4–2.5 without erroring, and its own validator reports that clamp as a
 * warning. Turning a warning into an adapter-side error would fail a request
 * the API fulfils.
 */
import {
  invertSpeed,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { AudioContainer, AudioFormatCodec } from "../../core/unified/vocabulary/audio";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { SpeechParams } from "../../core/unified/vocabulary/speech";
import { speech as validator, type RimeAccept, type RimeLanguage, type RimeTtsParams } from "./speech";

/** Every model id the catalog carries — the ref union for `rime/…`. */
const MODELS = ["coda", "mistv3", "mistv2", "mist", "arcanav3", "arcanav2", "arcana"] as const;

const CODA_DOCS = "https://docs.rime.ai/api-reference/coda/http";
const SPEED_DOCS = "https://docs.rime.ai/docs/speed";

/** The wire params this adapter compiles to (`accept` becomes a header). */
export type RimeSpeechWire = RimeTtsParams;

/** What a unified call to `rime/…` returns. */
export type RimeSpeechResult = ReturnType<typeof validator>;

/**
 * The Mist generation whose speed field is `speedAlpha`. Everything else —
 * Coda, Mist v3, the Arcana line — uses `timeScaleFactor`.
 */
const SPEED_ALPHA_MODELS: ReadonlySet<string> = new Set(["mistv2", "mist"]);

const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "audio/mpeg",
    pcm_s16le: "audio/wav",
    pcm_mulaw: "audio/PCMU",
    opus: "audio/ogg;codecs=opus",
  },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["raw"],
    opus: ["ogg", "webm"],
  },
  // `samplingRate` is an open range (per-model, 4000–96000), checked by the
  // provider; there is no bitrate field at all.
  unavailable: ["bitrate"],
  source: CODA_DOCS,
};

/** Codec + container → the RFC media type Rime spells it with. */
function acceptFor(codec: AudioFormatCodec, container: AudioContainer | undefined): RimeAccept {
  if (codec === "pcm_s16le") return container === "raw" ? "audio/L16" : "audio/wav";
  if (codec === "opus") return container === "webm" ? "audio/webm;codecs=opus" : "audio/ogg;codecs=opus";
  return codec === "mp3" ? "audio/mpeg" : "audio/PCMU";
}

export const speech = {
  category: "speech",
  provider: "rime",
  models: MODELS,
  compile(
    input: SpeechParams,
    ctx: CompileContext<SpeechParams>,
  ): CompiledCall<RimeSpeechWire, RimeSpeechResult> {
    ctx.from(["speaker"], "voice");
    ctx.from(["modelId"], "model");
    ctx.from(["accept"], "outputFormat");
    ctx.from(["samplingRate"], "outputFormat");
    ctx.from(["lang"], "language");
    ctx.from(["timeScaleFactor"], "speed");
    ctx.from(["speedAlpha"], "speed");

    const body: RimeSpeechWire = { text: input.text, speaker: "", modelId: ctx.model };

    if (input.voice !== undefined) {
      const voice = ctx.take(
        resolveVoice(
          // Rime's `speaker` is a catalog NAME ("astra", "celeste"), not an
          // opaque id, so `{ id }` has nothing to look up here.
          input.voice,
          { accepts: ["name"], source: CODA_DOCS },
          { path: ["voice"], warn: ctx.warn },
        ),
      );
      if (voice !== undefined) body.speaker = voice.value;
    }

    if (input.outputFormat !== undefined) {
      const format = ctx.take(
        resolveAudioFormat(input.outputFormat, FORMAT, { path: ["outputFormat"], warn: ctx.warn }),
      );
      if (format !== undefined) {
        body.accept = acceptFor(format.codec, format.container);
        if (format.sampleRate !== undefined) body.samplingRate = format.sampleRate;
      }
    }

    if (input.speed !== undefined) {
      const inverted = ctx.take(
        invertSpeed(input.speed, { source: SPEED_DOCS }, { path: ["speed"], warn: ctx.warn }),
      );
      if (inverted !== undefined) {
        if (SPEED_ALPHA_MODELS.has(ctx.model)) body.speedAlpha = inverted;
        else body.timeScaleFactor = inverted;
      }
    }

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, { source: CODA_DOCS }),
      );
      // Rime publishes both the 639-1 and the 639-2 spelling of its eight
      // languages and gates them per model; its own enum is the authority.
      if (language !== undefined) body.lang = language as RimeLanguage;
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<SpeechParams, RimeSpeechWire, RimeSpeechResult>;
