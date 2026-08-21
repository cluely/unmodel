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
  applyExtras,
  EXTRA,
  resolveAudioFormat,
  resolveVoice,
  toPrimaryLanguage,
  toSpeed,
  type AudioFormatSpec,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  SpeechAdapterFor,
  SpeechModelParamTable,
  SpeechParams,
} from "../../core/unified/vocabulary/speech";
import {
  speech as validator,
  LANGUAGES,
  PRO_ONLY_LANGUAGES,
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
export type SmallestSpeechResult = ReturnType<typeof validator<SmallestSpeechWire>>;

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

/**
 * The two Lightning pools, and the one thing that separates them: eleven
 * languages.
 *
 * Both rows are computed from the provider's own two arrays rather than copied
 * out of them — `LANGUAGES` minus `"auto"` is the Pro pool's 31, and minus
 * `PRO_ONLY_LANGUAGES` as well is the base pool's 20 — so `checkProOnly`'s
 * allow-list and the editor's completion list are derived from the same source
 * and cannot drift. `"auto"` is dropped for LMNT's reason: it is a wire value
 * the canonical BCP-47 `language` cannot spell, and omitting the field is how
 * this vocabulary says "detect it".
 *
 * `number_pronunciation_language` is the endpoint's second language field —
 * "the language used to read numeric content, independent of `language`" — so
 * it is an extra rather than a canonical word, typed with the provider's own
 * 32-member union (including `"auto"`, which *is* legal there because nothing
 * translates it). `checkProOnly` covers it too, so a Pro-only code on the base
 * pool is still refused at run time.
 */
/**
 * The two pools, derived rather than copied — and cast rather than
 * type-guarded, which is the load-bearing detail.
 *
 * `Array.prototype.filter` with a type predicate answers `Exclude<…>` for
 * *both* calls whatever the predicate actually tests, because a predicate is a
 * claim about one element and not about the array. Written the obvious way
 * (`filter((c): c is Exclude<SmallestLanguage, "auto"> => …)`) both pools type
 * as the same 31 codes, the base row silently gains the 11 Pro-only ones, and
 * an editor offers `"ja"` on `lightning_v3.1` — where `checkProOnly` refuses
 * it. Measured. So each `as` names exactly the set its runtime filter produces,
 * and `test/unified/speech-presets.test.ts` proves the runtime half matches by
 * compiling every code the row declares.
 */
type ProOnlyLanguage = (typeof PRO_ONLY_LANGUAGES)[number];

const BASE_LANGUAGES = LANGUAGES.filter(
  (code) => code !== "auto" && !(PRO_ONLY_LANGUAGES as readonly string[]).includes(code),
) as ReadonlyArray<Exclude<SmallestLanguage, "auto" | ProOnlyLanguage>>;

const PRO_LANGUAGES = LANGUAGES.filter((code) => code !== "auto") as ReadonlyArray<
  Exclude<SmallestLanguage, "auto">
>;

const SHARED_EXTRAS = {
  number_pronunciation_language: EXTRA as SmallestLanguage,
  math_notation: EXTRA as boolean,
  pronunciation_dicts: EXTRA as string[],
} as const;

const CODECS = ["mp3", "pcm_s16le", "pcm_mulaw", "pcm_alaw"] as const;

const SMALLEST_SPEECH_MODEL_PARAMS = {
  "lightning_v3.1": { codecs: CODECS, languages: BASE_LANGUAGES, extras: SHARED_EXTRAS },
  "lightning_v3.1_pro": { codecs: CODECS, languages: PRO_LANGUAGES, extras: SHARED_EXTRAS },
} as const satisfies SpeechModelParamTable;

export const speech = {
  category: "speech",
  provider: "smallest-ai",
  models: MODELS,
  modelParams: SMALLEST_SPEECH_MODEL_PARAMS,
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

    applyExtras(input, SMALLEST_SPEECH_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SpeechAdapterFor<
  typeof SMALLEST_SPEECH_MODEL_PARAMS,
  SmallestSpeechWire,
  SmallestSpeechResult
>;
