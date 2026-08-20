/**
 * `unmodel/transcribe` → `gladia.transcribe` (POST /v2/pre-recorded).
 *
 * URL-only, like AssemblyAI: `audio_url` is the one required field and bytes
 * go through `POST /v2/upload` first (`toUploadFormData` builds that body).
 *
 * The two things this adapter has to get right:
 *
 * - **One array, two canonical words.** `language_config.languages` is *both*
 *   the pin (one entry) and the candidate set (several), so `language` and
 *   `languages` compile to the same field. A request carrying both has not
 *   decided which meaning it wants, and the wire cannot hold both — so it is an
 *   `invalid_shape` naming the collision rather than a last-writer-wins.
 * - **Every config object needs its toggle.** Gladia drops a `*_config` whose
 *   boolean is not `true` (its own `checkToggles` warns about exactly that), so
 *   `diarization_config` is only ever emitted with `diarization: true`
 *   alongside it.
 *
 * `timestamps` maps to `sentences`: the response always carries word timings,
 * and `sentences` is the one switch that changes the grouping — so `"segment"`
 * turns it on and `"word"` turns it off, which keeps the granularity *stated*
 * rather than inherited from a default the caller cannot see.
 */
import {
  applyExtras,
  EXTRA,
  resolveAudioInput,
  resolveDiarization,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TranscribeAdapterFor,
  TranscribeModelParamTable,
  TranscribeParamsFor,
} from "../../core/unified/vocabulary/transcribe";
import {
  transcribe as validator,
  type GladiaAudioToLlmConfig,
  type GladiaCustomSpellingConfig,
  type GladiaCustomVocabularyConfig,
  type GladiaPiiRedactionConfig,
  type GladiaSubtitlesConfig,
  type GladiaSummarizationConfig,
  type GladiaTranslationConfig,
  type PreRecordedBody,
} from "./transcribe";
import { SOLARIA_3_LANGUAGES } from "./models";

/** The two Solaria models — the ref union for `gladia/…`. */
const MODELS = ["solaria-3", "solaria-1"] as const;

const INIT_DOCS = "https://docs.gladia.io/api-reference/v2/pre-recorded/init";

/** The wire body this adapter compiles to. */
export type GladiaTranscribeWire = PreRecordedBody;

/** What a unified call to `gladia/…` returns. */
export type GladiaTranscribeResult = ReturnType<typeof validator>;

/**
 * Gladia's two models, and the one that is single-language.
 *
 * `solaria-3` is "Async (pre-recorded) only … Single language only" and covers
 * "English, French, German, Spanish, Italian" — the same
 * {@link SOLARIA_3_LANGUAGES} array `checkModelLanguages` refuses against, by
 * reference. `solaria-1` covers "100+" languages with no published enum, so its
 * row carries no list rather than a guess.
 *
 * `code_switching` follows the same line: it is the multi-language switch, and
 * "solaria-3 does not support code switching", so it is on `solaria-1`'s row
 * alone. It nests under `language_config` ({@link LANGUAGE_CONFIG_NESTING}),
 * beside the `languages` array compiled from the canonical `language` /
 * `languages` — `applyExtras` merges into that object rather than replacing it.
 *
 * `timestamps` is `["word", "segment"]` on both, and carries no `"none"`: the
 * response always includes word timings and `sentences` only changes the
 * grouping, so there is nothing for `"none"` to mean.
 *
 * Everything else is Gladia's feature-plus-config pattern, and both halves of
 * each pair are declared: the API *drops* a `*_config` whose boolean is not
 * `true` (its own `checkToggles` warns about exactly that), so a caller needs
 * to be able to send `summarization: true` and `summarization_config` together
 * — offering only one of the two would guarantee the silent drop.
 *
 * Excluded: `audio_url`, `model`, `language_config.languages`, `diarization`,
 * `diarization_config` and `sentences` are canonical words' wire spellings, and
 * `callback` / `callback_url` / `callback_config` / `custom_metadata` are
 * transport.
 */
const PRE_RECORDED_EXTRAS = {
  custom_vocabulary: EXTRA as boolean,
  custom_vocabulary_config: EXTRA as GladiaCustomVocabularyConfig,
  custom_spelling: EXTRA as boolean,
  custom_spelling_config: EXTRA as GladiaCustomSpellingConfig,
  punctuation_enhanced: EXTRA as boolean,
  pii_redaction: EXTRA as boolean,
  pii_redaction_config: EXTRA as GladiaPiiRedactionConfig,
  subtitles: EXTRA as boolean,
  subtitles_config: EXTRA as GladiaSubtitlesConfig,
  translation: EXTRA as boolean,
  translation_config: EXTRA as GladiaTranslationConfig,
  summarization: EXTRA as boolean,
  summarization_config: EXTRA as GladiaSummarizationConfig,
  named_entity_recognition: EXTRA as boolean,
  sentiment_analysis: EXTRA as boolean,
  audio_to_llm: EXTRA as boolean,
  audio_to_llm_config: EXTRA as GladiaAudioToLlmConfig,
} as const;

const TIMESTAMPS = ["word", "segment"] as const;

const GLADIA_TRANSCRIBE_MODEL_PARAMS = {
  "solaria-3": {
    timestamps: TIMESTAMPS,
    languages: SOLARIA_3_LANGUAGES,
    extras: PRE_RECORDED_EXTRAS,
  },
  "solaria-1": {
    timestamps: TIMESTAMPS,
    extras: { ...PRE_RECORDED_EXTRAS, code_switching: EXTRA as boolean },
  },
} as const satisfies TranscribeModelParamTable;

/** The one extra that belongs to `language_config`. */
const LANGUAGE_CONFIG_NESTING: Readonly<Record<string, readonly string[]>> = {
  code_switching: ["language_config"],
};

export const transcribe = {
  category: "transcribe",
  provider: "gladia",
  models: MODELS,
  modelParams: GLADIA_TRANSCRIBE_MODEL_PARAMS,
  audioInputs: ["url"],
  unsupported: {
    prompt:
      "/v2/pre-recorded takes no acoustic prompt — `custom_vocabulary_config` is a weighted term " +
      "list and `audio_to_llm_config.prompts` runs an LLM *after* transcription, so neither is " +
      "this word; send them through `providerOptions.gladia`.",
  },
  compile(
    input: TranscribeParamsFor<"url">,
    ctx: CompileContext<TranscribeParamsFor<"url">>,
  ): CompiledCall<GladiaTranscribeWire, GladiaTranscribeResult> {
    const body: GladiaTranscribeWire = { audio_url: "", model: ctx.model };
    ctx.from(["audio_url"], "audio");
    ctx.from(["diarization"], "diarization");
    ctx.from(["diarization_config", "number_of_speakers"], "diarization.speakers");
    ctx.from(["diarization_config", "min_speakers"], "diarization.minSpeakers");
    ctx.from(["diarization_config", "max_speakers"], "diarization.maxSpeakers");
    ctx.from(["sentences"], "timestamps");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["url"], { path: ["audio"], warn: ctx.warn }, {
        source: INIT_DOCS,
        hint: "Upload local bytes to POST /v2/upload first; its `audio_url` is what goes here.",
      }),
    );
    if (audio?.kind === "url") body.audio_url = audio.url;

    if (input.language !== undefined && input.languages !== undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["languages"],
        message:
          "`language` and `languages` both compile to `language_config.languages` at Gladia — one " +
          "entry pins the language, several are the candidate set — so a request that sets both " +
          "has not said which it means. Send one.",
        meta: { source: INIT_DOCS },
      });
    } else if (input.language !== undefined) {
      // Declared inside the branch, and for the *element* as well as the array:
      // `checkModelLanguages` reports solaria-3's five-language limit at
      // `language_config.languages.0`, and a rule declared only for the array
      // would leave that path unmapped — sending a caller who wrote `language`
      // to look for a wire field they have never seen.
      ctx.from(["language_config", "languages"], "language");
      ctx.from(["language_config", "languages", 0], "language");
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: INIT_DOCS,
        }),
      );
      if (language !== undefined) body.language_config = { languages: [language] };
    } else if (input.languages !== undefined) {
      // The plural word owns the same field when it is the one that was sent.
      ctx.from(["language_config", "languages"], "languages");
      body.language_config = { languages: [...input.languages] };
    }

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { speakers: true, minSpeakers: true, maxSpeakers: true, source: INIT_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) {
        body.diarization = diarization.enabled;
        const config = {
          ...(diarization.speakers !== undefined && { number_of_speakers: diarization.speakers }),
          ...(diarization.minSpeakers !== undefined && { min_speakers: diarization.minSpeakers }),
          ...(diarization.maxSpeakers !== undefined && { max_speakers: diarization.maxSpeakers }),
        };
        if (Object.keys(config).length > 0) body.diarization_config = config;
      }
    }

    if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word", "segment"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: INIT_DOCS }),
      );
      if (granularity !== undefined) body.sentences = granularity === "segment";
    }

    applyExtras(input, GLADIA_TRANSCRIBE_MODEL_PARAMS, body, ctx, {
      nest: LANGUAGE_CONFIG_NESTING,
    });

    return { params: body, validate: validator.safe };
  },
} as const satisfies TranscribeAdapterFor<
  "url",
  typeof GLADIA_TRANSCRIBE_MODEL_PARAMS,
  GladiaTranscribeWire,
  GladiaTranscribeResult
>;
