/**
 * `unmodel/stt` → `openai.stt` (POST /v1/audio/transcriptions).
 *
 * The multipart end of the category: the audio is a `Blob` posted as form
 * data, so `audioInputs` is `["file"]` and a request pointed here with
 * `{ url }` does not compile. OpenAI documents no URL field and no file-id
 * field on this route — `/v1/files` handles the Assistants surface, not this
 * one — so the narrowing is the wire, not an opinion.
 *
 * Three mappings are worth reading:
 *
 * - **`timestamps` is whisper-1's alone.** The API pairs
 *   `timestamp_granularities` with `response_format: "verbose_json"`, and
 *   `openai.stt`'s constraint table already denies the array on every
 *   other model. So this adapter emits the array unconditionally — one table,
 *   in the provider, not a second copy here — and adds `verbose_json` only
 *   where the array is legal, which keeps a gpt-4o request to *one* finding
 *   instead of two about the same mistake.
 * - **`diarization` is a model, not a switch.** Speaker annotations come from
 *   `gpt-4o-transcribe-diarize` plus `response_format: "diarized_json"`, and
 *   `known_speaker_names` labels speakers rather than turning the feature on.
 *   A canonical `diarization` therefore has nothing to compile to, and saying
 *   so is the only honest answer.
 * - **`languages` is a shortlist, not a detection flag.** `gpt-transcribe`
 *   takes `languages[]` as candidates; the constraint table denies it
 *   elsewhere, so the adapter maps and lets the provider gate.
 */
import {
  applyExtras,
  EXTRA,
  resolveAudioInput,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  SttAdapterFor,
  SttModelParamTable,
  SttParamsFor,
} from "../../core/unified/vocabulary/stt";
import { stt as validator, type TranscriptionChunkingStrategy } from "./stt";

/** Every transcription model the hand catalog carries — the `openai/…` refs. */
const MODELS = [
  "gpt-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "gpt-4o-mini-transcribe-2025-12-15",
  "gpt-4o-transcribe-diarize",
  "whisper-1",
] as const;

/** Ids whose `timestamp_granularities` behaviour this adapter knows. */
const KNOWN = new Set<string>(MODELS);

const TRANSCRIPTION_DOCS =
  "https://developers.openai.com/api/docs/api-reference/audio/createTranscription";

/** The wire body this adapter compiles to — the loose arm of `TranscriptionBody`. */
export interface OpenaiSttWire {
  model: string;
  file: Blob;
  language?: string;
  languages?: string[];
  prompt?: string;
  response_format?: string;
  timestamp_granularities?: Array<"word" | "segment">;
  [key: string]: unknown;
}

/** What a unified call to `openai/…` returns: `openai.stt`'s `Validated`. */
export type OpenaiSttResult = ReturnType<typeof validator>;

/**
 * OpenAI's per-model transcription surface — the category's sharpest
 * `timestamps` split, and four crossing extras tables.
 *
 * ## `timestamps`
 *
 * "The `timestamp_granularities[]` parameter is only supported for
 * `whisper-1`", and `transcriptionConstraints` denies it on all five other ids.
 * So `whisper-1` completes `word` and `segment` and every other model completes
 * `"none"` and nothing else — which is the deny rule moved to the call site,
 * where the fix (change the ref) is still cheap.
 *
 * `"none"` is on every row because it is genuinely expressible here: these
 * routes return no timings unless asked, so asking for none is what omitting
 * the field already does and the value is honest rather than a no-op.
 *
 * ## Extras, one row at a time
 *
 * `temperature` and `chunking_strategy` are on all six — the sampling
 * temperature and the server-VAD segmentation config, neither of which the
 * canonical vocabulary has a word for. The rest is the deny table read
 * backwards: `keywords` is "supported by `gpt-transcribe`"; `include:
 * ["logprobs"]` is the three `gpt-4o(-mini)-transcribe` ids'; and the two
 * `known_speaker_*` arrays belong to `gpt-4o-transcribe-diarize`, which is also
 * the only model that can use them (speaker labels are what it produces).
 *
 * **`response_format` is deliberately not an extra**, though the wire has one
 * and it differs per model. It is the single wire key this adapter writes
 * *itself*, from a canonical word: `timestamps` on `whisper-1` compiles to
 * `response_format: "verbose_json"`, because the granularity array is only
 * legal alongside it. An extra of the same name would be copied on after that
 * and would silently defeat the canonical param — the one failure this
 * mechanism must not make possible. It stays on `providerOptions.openai`, which
 * is merged later still and is *documented* to win.
 */
const SHARED_EXTRAS = {
  temperature: EXTRA as number,
  chunking_strategy: EXTRA as TranscriptionChunkingStrategy,
} as const;

/** The three ids whose `include` accepts `["logprobs"]`. */
const LOGPROBS_ROW = {
  timestamps: ["none"],
  extras: { ...SHARED_EXTRAS, include: EXTRA as Array<"logprobs"> },
} as const;

const OPENAI_STT_MODEL_PARAMS = {
  "gpt-transcribe": {
    timestamps: ["none"],
    extras: { ...SHARED_EXTRAS, keywords: EXTRA as string[] },
  },
  "gpt-4o-transcribe": LOGPROBS_ROW,
  "gpt-4o-mini-transcribe": LOGPROBS_ROW,
  "gpt-4o-mini-transcribe-2025-12-15": LOGPROBS_ROW,
  "gpt-4o-transcribe-diarize": {
    timestamps: ["none"],
    extras: {
      ...SHARED_EXTRAS,
      known_speaker_names: EXTRA as string[],
      known_speaker_references: EXTRA as string[],
    },
  },
  "whisper-1": { timestamps: ["none", "word", "segment"], extras: SHARED_EXTRAS },
} as const satisfies SttModelParamTable;

export const stt = {
  category: "stt",
  provider: "openai",
  models: MODELS,
  modelParams: OPENAI_STT_MODEL_PARAMS,
  audioInputs: ["file"],
  unsupported: {
    diarization:
      "POST /v1/audio/transcriptions has no diarization switch — speaker annotations are what " +
      '`gpt-4o-transcribe-diarize` produces with `response_format: "diarized_json"`, so point ' +
      "the ref at that model and set the format via `providerOptions.openai`.",
  },
  compile(
    input: SttParamsFor<"file">,
    ctx: CompileContext<SttParamsFor<"file">>,
  ): CompiledCall<OpenaiSttWire, OpenaiSttResult> {
    const body: OpenaiSttWire = { model: ctx.model, file: new Blob([]) };
    ctx.from(["file"], "audio");
    ctx.from(["timestamp_granularities"], "timestamps");
    ctx.from(["response_format"], "timestamps");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["file"], { path: ["audio"], warn: ctx.warn }, {
        source: TRANSCRIPTION_DOCS,
        hint: "POST /v1/audio/transcriptions reads the bytes from a multipart `file` part.",
      }),
    );
    if (audio?.kind === "file") body.file = audio.file;

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: TRANSCRIPTION_DOCS,
        }),
      );
      if (language !== undefined) body.language = language;
    }

    if (input.languages !== undefined) {
      const languages: string[] = [];
      input.languages.forEach((candidate, index) => {
        const language = ctx.take(
          toPrimaryLanguage(candidate, { path: ["languages", index], warn: ctx.warn }, {
            source: TRANSCRIPTION_DOCS,
          }),
        );
        if (language !== undefined) languages.push(language);
      });
      body.languages = languages;
    }

    if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word", "segment"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: TRANSCRIPTION_DOCS }),
      );
      if (granularity !== undefined) {
        body.timestamp_granularities = [granularity];
        // Only where the array is legal: on the models that deny it, the
        // provider's own rule is the finding, and a second one about a format
        // the caller never named would bury it.
        if (ctx.model === "whisper-1" || !KNOWN.has(ctx.model)) {
          body.response_format = "verbose_json";
        }
      }
    }

    if (input.prompt !== undefined) body.prompt = input.prompt;

    applyExtras(input, OPENAI_STT_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "file",
  typeof OPENAI_STT_MODEL_PARAMS,
  OpenaiSttWire,
  OpenaiSttResult
>;
