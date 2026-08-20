/**
 * `unmodel/transcribe` → `revai.transcribe` (POST /speechtotext/v1/jobs).
 *
 * The inverted one. Rev AI turns diarization **off** with `skip_diarization`,
 * so `{ enabled: true }` compiles to `skip_diarization: false` — the only
 * adapter in the category where the canonical boolean and the wire boolean
 * disagree about which way is which, and therefore the one place a mistake
 * would be invisible in a diff and expensive in a bill.
 *
 * Two more asymmetries worth naming:
 *
 * - **There is no `model` field.** `transcriber` selects the engine
 *   (`machine`, `low_cost`, `fusion`, `human`), so the ref compiles to it, and
 *   Rev AI's own `checkTranscriberScope` is what rejects the machine-only
 *   options on a human job.
 * - **The audio URL is nested.** `source_config.url` is the current field;
 *   the flat `media_url` is deprecated, so this adapter writes the nested one
 *   and declares provenance for it, which is what makes "must be an http(s)
 *   URL" arrive at `audio`.
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
  type JobsBody,
  type RevaiCustomVocabulary,
  type RevaiSegment,
  type RevaiSpeakerName,
  type RevaiSummarizationConfig,
  type RevaiTranslationConfig,
} from "./transcribe";

/** The four transcribers — the ref union for `revai/…`. */
const MODELS = ["machine", "low_cost", "fusion", "human"] as const;

const REFERENCE_DOCS = "https://docs.rev.ai/api/asynchronous/reference";

/** The wire body this adapter compiles to. */
export type RevaiTranscribeWire = JobsBody;

/** What a unified call to `revai/…` returns. */
export type RevaiTranscribeResult = ReturnType<typeof validator>;

/**
 * Rev AI's per-model surface, which is really per-**transcriber** — and this is
 * the provider where the ref genuinely changes what the body may contain, in
 * both directions at once.
 *
 * Three overlapping rules from `./transcribe.ts`, transcribed into four rows:
 *
 * - **`HUMAN_ONLY`** — `rush`, `segments_to_transcribe` and `speaker_names` are
 *   "only available for `transcriber: "human"`". They are on the `human` row
 *   and nowhere else. *(The research pass had these on `machine` as well;
 *   `checkTranscriberScope` is the authority and it says otherwise.)*
 * - **`MACHINE_ONLY`** — `remove_disfluencies`, `remove_atmospherics`,
 *   `speaker_channels_count`, `diarization_type`, `summarization_config` and
 *   `translation_config` are "not available for human transcription jobs", so
 *   they are on the three machine rows.
 * - **low cost** — `diarization_type` and `forced_alignment` are "not available
 *   in the low-cost environment", which is what separates `low_cost` from
 *   `machine` and `fusion`.
 *
 * `timestamps: ["word"]` on every row: word timings ride on every Rev AI
 * transcript and there is no switch. `forced_alignment` is on the rows that
 * have it as an **extra** rather than as a granularity, because it is a quality
 * upgrade with its own price — not the thing that turns timing on.
 *
 * Excluded: `source_config` / `media_url`, `transcriber`, `language`,
 * `skip_diarization` and `speakers_count` are canonical words' wire spellings —
 * and `skip_diarization` is the inverted one, which makes it the last field
 * that should be settable twice. `test_mode` mocks a job without transcribing,
 * `metadata` / `notification_config` / `callback_url` / `delete_after_seconds`
 * are transport; all stay on `providerOptions.revai`.
 */
const SHARED_EXTRAS = {
  verbatim: EXTRA as boolean,
  skip_postprocessing: EXTRA as boolean,
  skip_punctuation: EXTRA as boolean,
  filter_profanity: EXTRA as boolean,
  custom_vocabulary_id: EXTRA as string,
  custom_vocabularies: EXTRA as RevaiCustomVocabulary[],
  strict_custom_vocabulary: EXTRA as boolean,
  enable_multilingual: EXTRA as boolean,
} as const;

/** `MACHINE_ONLY` minus the two fields the low-cost environment drops. */
const MACHINE_EXTRAS = {
  ...SHARED_EXTRAS,
  remove_disfluencies: EXTRA as boolean,
  remove_atmospherics: EXTRA as boolean,
  speaker_channels_count: EXTRA as number,
  summarization_config: EXTRA as RevaiSummarizationConfig,
  translation_config: EXTRA as RevaiTranslationConfig,
} as const;

const FULL_MACHINE_EXTRAS = {
  ...MACHINE_EXTRAS,
  diarization_type: EXTRA as "standard" | "premium",
  forced_alignment: EXTRA as boolean,
} as const;

const TIMESTAMPS = ["word"] as const;
const MACHINE_ROW = { timestamps: TIMESTAMPS, extras: FULL_MACHINE_EXTRAS } as const;

const REVAI_TRANSCRIBE_MODEL_PARAMS = {
  machine: MACHINE_ROW,
  low_cost: { timestamps: TIMESTAMPS, extras: MACHINE_EXTRAS },
  fusion: MACHINE_ROW,
  human: {
    timestamps: TIMESTAMPS,
    extras: {
      ...SHARED_EXTRAS,
      rush: EXTRA as boolean,
      segments_to_transcribe: EXTRA as RevaiSegment[],
      speaker_names: EXTRA as RevaiSpeakerName[],
      forced_alignment: EXTRA as boolean,
    },
  },
} as const satisfies TranscribeModelParamTable;

export const transcribe = {
  category: "transcribe",
  provider: "revai",
  models: MODELS,
  modelParams: REVAI_TRANSCRIBE_MODEL_PARAMS,
  audioInputs: ["url"],
  unsupported: {
    languages:
      "Rev AI has no candidate-language list — detection is `language: \"auto\"` plus " +
      "`enable_multilingual`, which is a switch rather than a shortlist. Send `language: \"auto\"` " +
      "and set `enable_multilingual` through `providerOptions.revai`.",
    prompt:
      "POST /speechtotext/v1/jobs takes no prompt — `custom_vocabularies` is a phrase list with " +
      "its own limits, so send it through `providerOptions.revai`.",
  },
  compile(
    input: TranscribeParamsFor<"url">,
    ctx: CompileContext<TranscribeParamsFor<"url">>,
  ): CompiledCall<RevaiTranscribeWire, RevaiTranscribeResult> {
    const body: RevaiTranscribeWire = { transcriber: ctx.model, source_config: { url: "" } };
    ctx.from(["source_config", "url"], "audio");
    ctx.from(["transcriber"], "model");
    ctx.from(["skip_diarization"], "diarization");
    ctx.from(["speakers_count"], "diarization.speakers");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["url"], { path: ["audio"], warn: ctx.warn }, {
        source: REFERENCE_DOCS,
        hint:
          "For local bytes, post the multipart form `toFormData({ media, options })` from " +
          "`unmodel/revai` instead — the `media` part is not a field of the JSON job.",
      }),
    );
    if (audio?.kind === "url") body.source_config = { url: audio.url };

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: REFERENCE_DOCS,
        }),
      );
      if (language !== undefined) body.language = language;
    }

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { speakers: true, source: REFERENCE_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) {
        // Inverted on purpose — see the module note.
        body.skip_diarization = !diarization.enabled;
        if (diarization.speakers !== undefined) body.speakers_count = diarization.speakers;
      }
    }

    // Word timings ride on every Rev AI transcript; `forced_alignment` is a
    // *quality* upgrade with its own price and its own model restrictions, not
    // the switch that turns timing on, so it stays in `providerOptions`.
    if (input.timestamps !== undefined) {
      ctx.take(
        toTimestampGranularity(input.timestamps, ["word"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: REFERENCE_DOCS }),
      );
    }

    applyExtras(input, REVAI_TRANSCRIBE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies TranscribeAdapterFor<
  "url",
  typeof REVAI_TRANSCRIBE_MODEL_PARAMS,
  RevaiTranscribeWire,
  RevaiTranscribeResult
>;
