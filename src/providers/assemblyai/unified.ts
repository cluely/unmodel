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
  resolveAudioInput,
  resolveDiarization,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { SttAdapterFor, SttParamsFor } from "../../core/unified/vocabulary/stt";
import { stt as validator, type TranscriptBody } from "./stt";
import { ASSEMBLYAI_STT_MODEL_PARAMS, MODELS } from "./stt-params";

const SUBMIT_DOCS = "https://www.assemblyai.com/docs/api-reference/transcripts/submit";

/** The wire body this adapter compiles to. */
export type AssemblyaiSttWire = TranscriptBody;

/** What a unified call to `assemblyai/…` returns. */
export type AssemblyaiSttResult = ReturnType<typeof validator>;

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
