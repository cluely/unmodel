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
  applyExtras,
  EXTRA,
  invertSpeed,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { AudioContainer, AudioFormatCodec } from "../../core/unified/vocabulary/audio";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  SpeechAdapterFor,
  SpeechModelParamTable,
  SpeechParams,
} from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  LANGUAGES,
  MIST_LANGUAGES,
  type RimeAccept,
  type RimeLanguage,
  type RimeTtsParams,
} from "./speech";

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

/**
 * Rime's per-model surface, which splits three ways — and every split is one
 * the wire already enforces.
 *
 * | | codecs | languages | extras |
 * |---|---|---|---|
 * | `coda`, `arcana*` | mp3, PCM, μ-law, **Opus** | all 16 spellings | *none* |
 * | `mistv3` | mp3, PCM, μ-law, **Opus** | the Mist 8 | inline speed, bracket pauses |
 * | `mistv2`, `mist` | mp3, PCM, μ-law | the Mist 8 | those two, plus phonemes and normalization |
 *
 * **Codecs.** "Opus and WAV arrived with Coda and Mist v3" — `checkAccept`
 * refuses anything outside `MIST_V2_ACCEPT_VALUES` on the two legacy ids, so
 * `opus` is off their row. `pcm_s16le` stays on it because the L16 spelling is
 * documented for them; it is reachable there as a *raw* stream only
 * (`audio/wav` is not), which is a container fact the codec list does not
 * claim to carry and `resolveAudioFormat` reports at run time.
 *
 * **Languages** are the provider's own two arrays by reference —
 * {@link LANGUAGES} (both the 639-1 and the 639-2/3 spelling of eight
 * languages) and {@link MIST_LANGUAGES} — so `checkLanguage`'s allow-list and
 * the editor's completion list are literally the same value. The Mist
 * *generation* is what narrows, which is why `mistv3` has the eight while
 * carrying the newer codecs: the two facts split the catalog differently, and a
 * per-model row is the only shape that can say so.
 *
 * **Extras** are `speechConstraints` read backwards. Coda denies all four
 * ("per-word speed adjustment is a Mist-family feature — Coda does not support
 * it"), so its row declares none and an editor refuses `inlineSpeedAlpha` on it
 * by name. `speedAlpha` and `timeScaleFactor` are absent from every row: they
 * are the canonical `speed`'s wire spellings, and offering a second way to set
 * the same thing is how two values end up disagreeing.
 */
const MIST_EXTRAS = {
  /** Comma-separated per-word multipliers for `[bracketed]` words. */
  inlineSpeedAlpha: EXTRA as string,
  /** Honour `<200>`-style angle-bracket pauses. */
  pauseBetweenBrackets: EXTRA as boolean,
} as const;

const LEGACY_MIST_EXTRAS = {
  ...MIST_EXTRAS,
  /** Read phonemes written in `{curly}` brackets. */
  phonemizeBetweenBrackets: EXTRA as boolean,
  /** Skip text normalization. "mist/mistv2 only." */
  noTextNormalization: EXTRA as boolean,
} as const;

const MODERN_CODECS = ["mp3", "pcm_s16le", "pcm_mulaw", "opus"] as const;
const LEGACY_CODECS = ["mp3", "pcm_s16le", "pcm_mulaw"] as const;

const ARCANA_ROW = { codecs: MODERN_CODECS, languages: LANGUAGES } as const;
const LEGACY_MIST_ROW = {
  codecs: LEGACY_CODECS,
  languages: MIST_LANGUAGES,
  extras: LEGACY_MIST_EXTRAS,
} as const;

const RIME_SPEECH_MODEL_PARAMS = {
  coda: { codecs: MODERN_CODECS, languages: LANGUAGES },
  mistv3: { codecs: MODERN_CODECS, languages: MIST_LANGUAGES, extras: MIST_EXTRAS },
  mistv2: LEGACY_MIST_ROW,
  mist: LEGACY_MIST_ROW,
  arcanav3: { ...ARCANA_ROW, extras: MIST_EXTRAS },
  arcanav2: { ...ARCANA_ROW, extras: MIST_EXTRAS },
  arcana: { ...ARCANA_ROW, extras: MIST_EXTRAS },
} as const satisfies SpeechModelParamTable;

export const speech = {
  category: "speech",
  provider: "rime",
  models: MODELS,
  modelParams: RIME_SPEECH_MODEL_PARAMS,
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

    applyExtras(input, RIME_SPEECH_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SpeechAdapterFor<
  typeof RIME_SPEECH_MODEL_PARAMS,
  RimeSpeechWire,
  RimeSpeechResult
>;
