/**
 * `unmodel/stt` → `assemblyai.stt` (POST /v2/transcript).
 *
 * A URL-only route: `audio_url` is the single required field, and bytes reach
 * it through a *separate* upload endpoint (`POST /v2/upload`, whose response
 * `upload_url` is a valid `audio_url`). So `audioInputs` is `["url"]`, and a
 * caller who has a `Blob` is told at the call site rather than after a 400.
 *
 * Two mappings need the reasoning written down:
 *
 * - **The model is a routing *list*.** `speech_models` is a priority-ordered
 *   array — `speech_model` is its deprecated scalar predecessor — so a ref
 *   naming one model compiles to a one-element array, which is how you pin the
 *   routing rather than accept the default `["universal-3-5-pro",
 *   "universal-2"]`.
 * - **`timestamps` is implied, not configurable.** /v2/transcript has no
 *   granularity field at all: word timings arrive in `words[]` on every
 *   response. Rejecting `timestamps: "word"` would be a lie about what the
 *   route does, and quietly accepting `"segment"` would be a lie about what it
 *   returns — so the value that agrees compiles to nothing and the values that
 *   disagree are an `invalid_enum_value` naming what this route reports.
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
  SttAdapterFor,
  SttModelParamTable,
  SttParamsFor,
} from "../../core/unified/vocabulary/stt";
import {
  stt as validator,
  type AssemblyaiDomain,
  type AssemblyaiLanguageDetectionOptions,
  type TranscriptBody,
} from "./stt";

/** The four speech models AssemblyAI routes to — the `assemblyai/…` refs. */
const MODELS = ["universal-3-5-pro", "universal-2", "universal-3-pro", "slam-1"] as const;

const SUBMIT_DOCS = "https://www.assemblyai.com/docs/api-reference/transcripts/submit";

/** The wire body this adapter compiles to. */
export type AssemblyaiSttWire = TranscriptBody;

/** What a unified call to `assemblyai/…` returns. */
export type AssemblyaiSttResult = ReturnType<typeof validator>;

/**
 * AssemblyAI's per-model surface — the largest extras table in the library, and
 * two model-gated blocks that point in opposite directions.
 *
 * ## `timestamps: ["word"]`, with no `"none"`
 *
 * /v2/transcript has no granularity field: `words[]` arrives on every response.
 * So the row states the one thing the route reports, which makes
 * `timestamps: "word"` a request that agrees with reality and compiles to
 * nothing, and `"segment"` / `"character"` compile errors naming what it does
 * report. `"none"` is off the row for the same reason it is off Deepgram's —
 * there is no switch, so asking for none would be a request that says one thing
 * and gets another.
 *
 * ## The two gated blocks
 *
 * "Supported: Universal-3.5 Pro only" covers `temperature` and
 * `remove_audio_tags`; "Supported: Universal-2 only" covers `summarization` and
 * `auto_chapters` (and therefore `summary_model` / `summary_type`, which are
 * that feature's settings). `universal-3-pro` and `slam-1` get neither block —
 * they are the two ids the docs gate *both* features away from, and their row
 * is the shared body alone.
 *
 * ## What is excluded, and why each one is
 *
 * - **`prompt`** — AssemblyAI's is a Universal-3.5-Pro *instruction* field
 *   rather than the acoustic conditioning the canonical word means everywhere
 *   else, and this adapter already declares that gap. An extra of the same name
 *   would be shadowed by the kernel's `unsupported` check before compile even
 *   ran, so the key would be unreachable *and* misleading.
 * - **`speech_model` / `speech_models`, `language_code(s)`, `speaker_labels`,
 *   `speakers_expected`, `speaker_options.{min,max}_speakers_expected`,
 *   `audio_url`** — canonical words' wire spellings.
 * - **`webhook_*`** — transport, and they carry credentials besides; they stay
 *   on `providerOptions.assemblyai`.
 *
 * Several of these have documented dependencies (`redact_pii_audio` needs
 * `redact_pii: true`, `speaker_options` needs `speaker_labels: true`, and
 * `auto_chapters` cannot ride with `summarization`). Those are *combination*
 * rules rather than per-model ones, they are already checked by the provider's
 * own schema, and a per-model row is the wrong shape to hold them — so they
 * stay exactly where they are and surface as refusals, never as drops.
 */
const TRANSCRIPT_EXTRAS = {
  // Formatting
  punctuate: EXTRA as boolean,
  format_text: EXTRA as boolean,
  disfluencies: EXTRA as boolean,
  multichannel: EXTRA as boolean,
  // Which audio, and which words
  audio_start_from: EXTRA as number,
  audio_end_at: EXTRA as number,
  word_boost: EXTRA as string[],
  boost_param: EXTRA as string,
  keyterms_prompt: EXTRA as string[] | null,
  custom_spelling: EXTRA as Array<{ from: string[]; to: string }> | null,
  speech_threshold: EXTRA as number,
  domain: EXTRA as AssemblyaiDomain | null,
  // Language detection — the half of the language decision `language` does not own
  language_detection: EXTRA as boolean,
  language_confidence_threshold: EXTRA as number,
  language_detection_options: EXTRA as AssemblyaiLanguageDetectionOptions | null,
  // → speaker_options.*, beside the counts compiled from `diarization`
  advanced_speaker_segmentation: EXTRA as boolean | null,
  // Redaction and safety
  filter_profanity: EXTRA as boolean,
  redact_pii: EXTRA as boolean,
  redact_pii_audio: EXTRA as boolean,
  redact_pii_audio_quality: EXTRA as "mp3" | "wav" | null,
  redact_pii_audio_options: EXTRA as {
    return_redacted_no_speech_audio?: boolean | null;
    override_audio_redaction_method?: "silence" | null;
  } | null,
  redact_pii_policies: EXTRA as string[] | null,
  redact_pii_sub: EXTRA as "entity_name" | "hash" | null,
  redact_pii_return_unredacted: EXTRA as boolean,
  redact_static_entities: EXTRA as Record<string, string[]> | null,
  content_safety: EXTRA as boolean,
  content_safety_confidence: EXTRA as number,
  // Post-transcription understanding
  entity_detection: EXTRA as boolean,
  sentiment_analysis: EXTRA as boolean,
  iab_categories: EXTRA as boolean,
  auto_highlights: EXTRA as boolean,
  speech_understanding: EXTRA as Record<string, unknown> | null,
} as const;

const TIMESTAMPS = ["word"] as const;
const SHARED_ROW = { timestamps: TIMESTAMPS, extras: TRANSCRIPT_EXTRAS } as const;

const ASSEMBLYAI_STT_MODEL_PARAMS = {
  "universal-3-5-pro": {
    timestamps: TIMESTAMPS,
    extras: {
      ...TRANSCRIPT_EXTRAS,
      temperature: EXTRA as number,
      remove_audio_tags: EXTRA as "all" | "speaker" | null,
    },
  },
  "universal-2": {
    timestamps: TIMESTAMPS,
    extras: {
      ...TRANSCRIPT_EXTRAS,
      summarization: EXTRA as boolean,
      summary_model: EXTRA as "informative" | "catchy" | "conversational" | null,
      summary_type: EXTRA as "gist" | "headline" | "paragraph" | "bullets" | "bullets_verbose" | null,
      auto_chapters: EXTRA as boolean,
    },
  },
  "universal-3-pro": SHARED_ROW,
  "slam-1": SHARED_ROW,
} as const satisfies SttModelParamTable;

/** The one extra that belongs to `speaker_options` rather than the body root. */
const SPEAKER_OPTIONS_NESTING: Readonly<Record<string, readonly string[]>> = {
  advanced_speaker_segmentation: ["speaker_options"],
};

export const stt = {
  category: "stt",
  provider: "assemblyai",
  models: MODELS,
  modelParams: ASSEMBLYAI_STT_MODEL_PARAMS,
  audioInputs: ["url"],
  unsupported: {
    prompt:
      "/v2/transcript's `prompt` is a Universal-3.5-Pro *instruction* field rather than the " +
      "acoustic conditioning this word means everywhere else, and `keyterms_prompt` is a list " +
      "of terms; send either through `providerOptions.assemblyai` so it keeps its own meaning.",
  },
  compile(
    input: SttParamsFor<"url">,
    ctx: CompileContext<SttParamsFor<"url">>,
  ): CompiledCall<AssemblyaiSttWire, AssemblyaiSttResult> {
    const body: AssemblyaiSttWire = { audio_url: "", speech_models: [ctx.model] };
    ctx.from(["audio_url"], "audio");
    ctx.from(["speech_models"], "model");
    ctx.from(["language_code"], "language");
    ctx.from(["language_codes"], "languages");
    ctx.from(["speaker_labels"], "diarization");
    ctx.from(["speakers_expected"], "diarization.speakers");
    ctx.from(["speaker_options", "min_speakers_expected"], "diarization.minSpeakers");
    ctx.from(["speaker_options", "max_speakers_expected"], "diarization.maxSpeakers");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["url"], { path: ["audio"], warn: ctx.warn }, {
        source: SUBMIT_DOCS,
        hint: "Upload local bytes to POST /v2/upload first; its `upload_url` is an `audio_url`.",
      }),
    );
    if (audio?.kind === "url") body.audio_url = audio.url;

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: SUBMIT_DOCS,
        }),
      );
      if (language !== undefined) body.language_code = language;
    }

    if (input.languages !== undefined) body.language_codes = [...input.languages];

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { speakers: true, minSpeakers: true, maxSpeakers: true, source: SUBMIT_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) {
        body.speaker_labels = diarization.enabled;
        if (diarization.speakers !== undefined) body.speakers_expected = diarization.speakers;
        // The bounds live on a nested object, and AssemblyAI rejects it
        // alongside `speakers_expected` — its own rule, surfaced at whichever
        // canonical field the caller wrote.
        if (diarization.minSpeakers !== undefined || diarization.maxSpeakers !== undefined) {
          body.speaker_options = {
            ...(diarization.minSpeakers !== undefined && {
              min_speakers_expected: diarization.minSpeakers,
            }),
            ...(diarization.maxSpeakers !== undefined && {
              max_speakers_expected: diarization.maxSpeakers,
            }),
          };
        }
      }
    }

    // Word timings are unconditional here; see the module note.
    if (input.timestamps !== undefined) {
      ctx.take(
        toTimestampGranularity(input.timestamps, ["word"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: SUBMIT_DOCS }),
      );
    }

    applyExtras(input, ASSEMBLYAI_STT_MODEL_PARAMS, body, ctx, {
      nest: SPEAKER_OPTIONS_NESTING,
    });

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "url",
  typeof ASSEMBLYAI_STT_MODEL_PARAMS,
  AssemblyaiSttWire,
  AssemblyaiSttResult
>;
