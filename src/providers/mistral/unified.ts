/**
 * `unmodel/transcribe` → `mistral.transcribe` (POST /v1/audio/transcriptions).
 *
 * The only route in the category that accepts **all three** canonical audio
 * shapes — `file` (multipart Blob), `file_url` and `file_id` (from
 * `POST /v1/files`) — so `audioInputs` is the full set and nothing narrows.
 * Mistral's own schema enforces "exactly one", which is the same rule
 * `resolveAudioInput` applies to the canonical object, one layer earlier and
 * in the caller's vocabulary.
 *
 * The pairing worth knowing about is not this adapter's: Voxtral documents
 * that `timestamp_granularities` "is not compatible with `language`". So a
 * request that pins a language *and* asks for word timings is rejected by
 * `mistral.transcribe`'s own `checkTimestampLanguage`, and the provenance
 * declared below is what makes that finding arrive at `timestamps` rather than
 * at a wire field the caller never wrote.
 */
import {
  resolveAudioInput,
  resolveDiarization,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TranscribeAdapterFor,
  TranscribeParamsFor,
} from "../../core/unified/vocabulary/transcribe";
import { transcribe as validator, type TranscriptionBody } from "./transcribe";

/** The five Voxtral batch models — the ref union for `mistral/…`. */
const MODELS = [
  "voxtral-mini-latest",
  "voxtral-mini-2602",
  "voxtral-mini-2507",
  "voxtral-small-latest",
  "voxtral-small-2507",
] as const;

const TRANSCRIPTION_DOCS =
  "https://docs.mistral.ai/studio/audio/speech_to_text/offline_transcription";

/** The wire params this adapter compiles to (multipart form fields). */
export type MistralTranscribeWire = TranscriptionBody;

/** What a unified call to `mistral/…` returns. */
export type MistralTranscribeResult = ReturnType<typeof validator>;

export const transcribe = {
  category: "transcribe",
  provider: "mistral",
  models: MODELS,
  audioInputs: ["file", "url", "fileId"],
  unsupported: {
    languages:
      "POST /v1/audio/transcriptions takes one two-letter `language` and has no candidate-set " +
      "field; omit `language` to let Voxtral detect.",
    prompt:
      "Voxtral takes no prose prompt — `context_bias` is a list of terms that may contain " +
      "neither commas nor whitespace, so a sentence cannot be one; send it through " +
      "`providerOptions.mistral`.",
  },
  compile(
    input: TranscribeParamsFor<"file" | "url" | "fileId">,
    ctx: CompileContext<TranscribeParamsFor<"file" | "url" | "fileId">>,
  ): CompiledCall<MistralTranscribeWire, MistralTranscribeResult> {
    const body: MistralTranscribeWire = { model: ctx.model };
    ctx.from(["file"], "audio");
    ctx.from(["file_url"], "audio");
    ctx.from(["file_id"], "audio");
    ctx.from(["diarize"], "diarization");
    ctx.from(["timestamp_granularities"], "timestamps");

    const audio = ctx.take(
      resolveAudioInput(
        input.audio,
        ["file", "url", "fileId"],
        { path: ["audio"], warn: ctx.warn },
        { source: TRANSCRIPTION_DOCS },
      ),
    );
    if (audio?.kind === "file") body.file = audio.file;
    if (audio?.kind === "url") body.file_url = audio.url;
    if (audio?.kind === "fileId") body.file_id = audio.fileId;

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: TRANSCRIPTION_DOCS,
        }),
      );
      if (language !== undefined) body.language = language;
    }

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { source: TRANSCRIPTION_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) body.diarize = diarization.enabled;
    }

    if (input.timestamps !== undefined) {
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word", "segment"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: TRANSCRIPTION_DOCS }),
      );
      if (granularity !== undefined) body.timestamp_granularities = [granularity];
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies TranscribeAdapterFor<
  "file" | "url" | "fileId",
  MistralTranscribeWire,
  MistralTranscribeResult
>;
