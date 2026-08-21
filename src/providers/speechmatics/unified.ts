/**
 * `unmodel/stt` → `speechmatics.stt` (POST /v2/jobs).
 *
 * What unmodel validates here is the **job config** — the JSON that rides in
 * the multipart `config` part — so the compiled body is a `JobConfig` and the
 * audio is `fetch_data.url`, the server-side fetch. The other way to feed this
 * route is the multipart `data_file` part, which is not a `JobConfig` field at
 * all and therefore has nothing for a canonical `{ file }` to compile to;
 * `audioInputs` is `["url"]` and says so at the call site.
 *
 * Three shapes are peculiar to Speechmatics and all three are load-bearing:
 *
 * - **`language` is required.** The canonical `language` is optional and means
 *   "let the model detect"; Speechmatics spells that `"auto"`. Omitting it
 *   therefore compiles to `language: "auto"` exactly — a documented value for a
 *   documented meaning, not an invented default, so it warns about nothing.
 * - **`languages` is a real candidate set.** `language_identification_config.
 *   expected_languages` is one of only two such fields in the category. It is
 *   only consulted while the language is `"auto"`, so pinning a language *and*
 *   listing candidates is an `invalid_shape` rather than a list the API drops.
 * - **Diarization is an enum, not a boolean.** `"speaker"` on, `"none"` off —
 *   and there is no speaker-count field anywhere on this endpoint, so all three
 *   canonical counts are refused by name.
 */
import {
  applyExtras,
  EXTRA,
  resolveAudioInput,
  resolveDiarization,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  SttAdapterFor,
  SttModelParamTable,
  SttParamsFor,
} from "../../core/unified/vocabulary/stt";
import {
  stt as validator,
  type JobConfig,
  type SpeechmaticsAdditionalVocabEntry,
  type SpeechmaticsAudioEventsConfig,
  type SpeechmaticsAudioFilteringConfig,
  type SpeechmaticsLanguageIdentificationConfig,
  type SpeechmaticsOutputConfig,
  type SpeechmaticsPunctuationOverrides,
  type SpeechmaticsSpeakerDiarizationConfig,
  type SpeechmaticsSummarizationConfig,
  type SpeechmaticsTopicDetectionConfig,
  type SpeechmaticsTranscriptFilteringConfig,
  type SpeechmaticsTranslationConfig,
} from "./stt";

/** The three batch models — the ref union for `speechmatics/…`. */
const MODELS = ["enhanced", "standard", "melia-1"] as const;

const JOBS_DOCS = "https://docs.speechmatics.com/speech-to-text/batch";

/** Speechmatics' documented "detect the language" sentinel. */
const AUTO = "auto";

/** The wire config this adapter compiles to (the multipart `config` part). */
export type SpeechmaticsSttWire = JobConfig;

/** What a unified call to `speechmatics/…` returns. */
export type SpeechmaticsSttResult = ReturnType<typeof validator>;

/**
 * Speechmatics' per-model surface: the job config's own fields, and the ten
 * things Melia 1 "does not yet support".
 *
 * ## Whole config objects, not flattened members
 *
 * Every extra below that ends in `_config` or `_overrides` is declared as one
 * typed **object**, rather than as its members promoted to top-level keys. That
 * is a deliberate departure from the flattening the other adapters do, and the
 * reason is this endpoint's shape: its knobs live three levels deep in eight
 * different config objects, and flattening them would put `topics`, `types`,
 * `speakers`, `replacements` and `sensitivity` on the unified request as
 * top-level words — names so generic that they would read as canonical
 * vocabulary rather than as Speechmatics' own. One object per feature keeps the
 * provider's structure visible, keeps the types exact (each is an interface
 * `./stt.ts` already exports), and keeps the extras list short enough to
 * read. Same call MiniMax's `voice_modify` makes, for the same reason.
 *
 * ## `timestamps: ["word"]`
 *
 * There is no granularity field: word timings ride on every transcript. So
 * `"word"` agrees and compiles to nothing, and `"segment"` / `"character"` /
 * `"none"` are refused by name.
 *
 * ## Melia 1
 *
 * Its row is the shared one minus `MELIA_UNSUPPORTED`: no custom dictionary
 * (`additional_vocab`), no find-and-replace (`transcript_filtering_config`), no
 * entity detection, no audio filtering, and none of the five
 * speech-intelligence add-ons. And it "requires `language: "multi"`", which is
 * the whole of its `languages` list — the shortest in the library, and one an
 * editor can now complete.
 *
 * `domain` is Enhanced's alone: `domain: "medical"` "selects the Enhanced
 * Medical model and requires `model: "enhanced"`".
 *
 * Excluded: `fetch_data`, `transcription_config.{language,model,diarization}`
 * and `language_identification_config.expected_languages` are canonical words'
 * wire spellings (the last of those is why the config object still merges
 * rather than replaces), `operating_point` is deprecated in favour of `model`,
 * and `notification_config` / `tracking` are transport.
 */
const TRANSCRIPTION_CONFIG_EXTRAS = {
  output_locale: EXTRA as string,
  punctuation_overrides: EXTRA as SpeechmaticsPunctuationOverrides,
  channel_diarization_labels: EXTRA as string[],
  max_delay_mode: EXTRA as "fixed" | "flexible",
  speaker_diarization_config: EXTRA as SpeechmaticsSpeakerDiarizationConfig,
  language_hints: EXTRA as string[],
} as const;

const ROOT_EXTRAS = {
  language_identification_config: EXTRA as SpeechmaticsLanguageIdentificationConfig,
  output_config: EXTRA as SpeechmaticsOutputConfig,
} as const;

/** The shared block plus the ten features `MELIA_UNSUPPORTED` names. */
const FULL_EXTRAS = {
  ...TRANSCRIPTION_CONFIG_EXTRAS,
  ...ROOT_EXTRAS,
  additional_vocab: EXTRA as SpeechmaticsAdditionalVocabEntry[],
  enable_entities: EXTRA as boolean,
  audio_filtering_config: EXTRA as SpeechmaticsAudioFilteringConfig,
  transcript_filtering_config: EXTRA as SpeechmaticsTranscriptFilteringConfig,
  translation_config: EXTRA as SpeechmaticsTranslationConfig,
  summarization_config: EXTRA as SpeechmaticsSummarizationConfig,
  topic_detection_config: EXTRA as SpeechmaticsTopicDetectionConfig,
  audio_events_config: EXTRA as SpeechmaticsAudioEventsConfig,
  sentiment_analysis_config: EXTRA as Record<string, unknown>,
  auto_chapters_config: EXTRA as Record<string, unknown>,
} as const;

const TIMESTAMPS = ["word"] as const;

const SPEECHMATICS_STT_MODEL_PARAMS = {
  enhanced: {
    timestamps: TIMESTAMPS,
    extras: { ...FULL_EXTRAS, domain: EXTRA as string },
  },
  standard: { timestamps: TIMESTAMPS, extras: FULL_EXTRAS },
  "melia-1": {
    timestamps: TIMESTAMPS,
    languages: ["multi"],
    extras: { ...TRANSCRIPTION_CONFIG_EXTRAS, ...ROOT_EXTRAS },
  },
} as const satisfies SttModelParamTable;

/** Which extras belong to `transcription_config`; the rest are job-config roots. */
const CONFIG_NESTING: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  [...Object.keys(TRANSCRIPTION_CONFIG_EXTRAS), "additional_vocab", "enable_entities",
   "audio_filtering_config", "transcript_filtering_config", "domain"].map((key) => [
    key,
    ["transcription_config"],
  ]),
);

export const stt = {
  category: "stt",
  provider: "speechmatics",
  models: MODELS,
  modelParams: SPEECHMATICS_STT_MODEL_PARAMS,
  audioInputs: ["url"],
  unsupported: {
    prompt:
      "POST /v2/jobs takes no prompt — `transcription_config.additional_vocab` is a custom " +
      "dictionary of terms with pronunciations, which is a different thing; send it through " +
      "`providerOptions.speechmatics`.",
  },
  compile(
    input: SttParamsFor<"url">,
    ctx: CompileContext<SttParamsFor<"url">>,
  ): CompiledCall<SpeechmaticsSttWire, SpeechmaticsSttResult> {
    const body: SpeechmaticsSttWire = {
      type: "transcription",
      transcription_config: { language: AUTO, model: ctx.model },
    };
    ctx.from(["fetch_data", "url"], "audio");
    ctx.from(["transcription_config", "model"], "model");
    ctx.from(["transcription_config", "language"], "language");
    ctx.from(["language_identification_config", "expected_languages"], "languages");
    ctx.from(["transcription_config", "diarization"], "diarization");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["url"], { path: ["audio"], warn: ctx.warn }, {
        source: JOBS_DOCS,
        hint:
          "For local bytes, put them in the multipart `data_file` part yourself — it is not a " +
          "field of the job config unmodel validates.",
      }),
    );
    if (audio?.kind === "url") body.fetch_data = { url: audio.url };

    // BCP-47 verbatim: Speechmatics documents regional codes (`en-US` via
    // `output_locale`, `pt` and friends here), so there is no subtag to drop.
    if (input.language !== undefined) body.transcription_config.language = input.language;

    if (input.languages !== undefined) {
      if (input.language !== undefined && input.language !== AUTO) {
        ctx.fail({
          code: "invalid_shape",
          path: ["languages"],
          message:
            `\`languages\` is Speechmatics' \`expected_languages\`, which the API consults only ` +
            `while \`language\` is "${AUTO}" — with \`language: ${JSON.stringify(input.language)}\` ` +
            "pinned it would be accepted and ignored. Send one or the other.",
          meta: { source: JOBS_DOCS },
        });
      } else {
        body.language_identification_config = { expected_languages: [...input.languages] };
      }
    }

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { source: JOBS_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) {
        body.transcription_config.diarization = diarization.enabled ? "speaker" : "none";
      }
    }

    // Word timings are unconditional on this endpoint — there is no
    // granularity field to compile to, so the value that agrees costs nothing
    // and the ones that do not are refused by name.
    if (input.timestamps !== undefined) {
      ctx.take(
        toTimestampGranularity(input.timestamps, ["word"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: JOBS_DOCS }),
      );
    }

    applyExtras(input, SPEECHMATICS_STT_MODEL_PARAMS, body, ctx, { nest: CONFIG_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "url",
  typeof SPEECHMATICS_STT_MODEL_PARAMS,
  SpeechmaticsSttWire,
  SpeechmaticsSttResult
>;
