/**
 * `unmodel/transcribe` → `speechmatics.transcribe` (POST /v2/jobs).
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
  resolveAudioInput,
  resolveDiarization,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TranscribeAdapterFor,
  TranscribeParamsFor,
} from "../../core/unified/vocabulary/transcribe";
import { transcribe as validator, type JobConfig } from "./transcribe";

/** The three batch models — the ref union for `speechmatics/…`. */
const MODELS = ["enhanced", "standard", "melia-1"] as const;

const JOBS_DOCS = "https://docs.speechmatics.com/speech-to-text/batch";

/** Speechmatics' documented "detect the language" sentinel. */
const AUTO = "auto";

/** The wire config this adapter compiles to (the multipart `config` part). */
export type SpeechmaticsTranscribeWire = JobConfig;

/** What a unified call to `speechmatics/…` returns. */
export type SpeechmaticsTranscribeResult = ReturnType<typeof validator>;

export const transcribe = {
  category: "transcribe",
  provider: "speechmatics",
  models: MODELS,
  audioInputs: ["url"],
  unsupported: {
    prompt:
      "POST /v2/jobs takes no prompt — `transcription_config.additional_vocab` is a custom " +
      "dictionary of terms with pronunciations, which is a different thing; send it through " +
      "`providerOptions.speechmatics`.",
  },
  compile(
    input: TranscribeParamsFor<"url">,
    ctx: CompileContext<TranscribeParamsFor<"url">>,
  ): CompiledCall<SpeechmaticsTranscribeWire, SpeechmaticsTranscribeResult> {
    const body: SpeechmaticsTranscribeWire = {
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

    return { params: body, validate: validator.safe };
  },
} as const satisfies TranscribeAdapterFor<
  "url",
  SpeechmaticsTranscribeWire,
  SpeechmaticsTranscribeResult
>;
