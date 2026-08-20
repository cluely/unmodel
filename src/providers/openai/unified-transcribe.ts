/**
 * `unmodel/transcribe` → `openai.transcribe` (POST /v1/audio/transcriptions).
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
 *   `openai.transcribe`'s constraint table already denies the array on every
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
  resolveAudioInput,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TranscribeAdapterFor,
  TranscribeParamsFor,
} from "../../core/unified/vocabulary/transcribe";
import { transcribe as validator } from "./transcribe";

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
export interface OpenaiTranscribeWire {
  model: string;
  file: Blob;
  language?: string;
  languages?: string[];
  prompt?: string;
  response_format?: string;
  timestamp_granularities?: Array<"word" | "segment">;
  [key: string]: unknown;
}

/** What a unified call to `openai/…` returns: `openai.transcribe`'s `Validated`. */
export type OpenaiTranscribeResult = ReturnType<typeof validator>;

export const transcribe = {
  category: "transcribe",
  provider: "openai",
  models: MODELS,
  audioInputs: ["file"],
  unsupported: {
    diarization:
      "POST /v1/audio/transcriptions has no diarization switch — speaker annotations are what " +
      '`gpt-4o-transcribe-diarize` produces with `response_format: "diarized_json"`, so point ' +
      "the ref at that model and set the format via `providerOptions.openai`.",
  },
  compile(
    input: TranscribeParamsFor<"file">,
    ctx: CompileContext<TranscribeParamsFor<"file">>,
  ): CompiledCall<OpenaiTranscribeWire, OpenaiTranscribeResult> {
    const body: OpenaiTranscribeWire = { model: ctx.model, file: new Blob([]) };
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

    return { params: body, validate: validator.safe };
  },
} as const satisfies TranscribeAdapterFor<"file", OpenaiTranscribeWire, OpenaiTranscribeResult>;
