/**
 * `unmodel/transcribe` → `inworld.transcribe` (POST /stt/v1/transcribe).
 *
 * ## The adapter that says no, and why it still ships
 *
 * Inworld takes its audio as **base64 inside the JSON body**
 * (`audioData.content`). There is no URL field, no multipart part and no file
 * API — the module header says as much — so of the three canonical shapes:
 *
 * - `{ url }` and `{ fileId }` have no wire field to compile *to*;
 * - `{ file }` has one in principle, and cannot reach it in practice: a `Blob`
 *   is read asynchronously (`arrayBuffer()`, `text()`, `FileReader` — all
 *   promises) and `compile` is synchronous, by design, because a validator that
 *   returned a promise would make every unified call `await`-shaped for the
 *   sake of one provider.
 *
 * So `audio` is **declared unsupported** and `audioInputs` is empty. Both
 * halves of the narrowing then say the same thing: `audio` types as `never` at
 * a `inworld/…` ref, so the call does not compile, and the kernel's uniform
 * `unsupported_param` explains why at runtime for everyone the type cannot
 * reach. That is the honest answer — the alternative was to invent an
 * inline-bytes arm in a vocabulary five other adapters share, or to pretend a
 * base64 payload is a "file id".
 *
 * The adapter is here rather than absent because absence would say something
 * *false*. A missing adapter produces "inworld is not a transcribe provider in
 * this build", which sends a reader looking for a packaging mistake;
 * `unmodel/inworld`'s `transcribe` validator exists and works perfectly well —
 * it is the canonical vocabulary that cannot express its input. Every other
 * cell in the table below is mapped and tested, so the day the vocabulary
 * grows an inline-bytes shape, this file is one line from working.
 */
import { resolveDiarization, toTimestampGranularity } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  TranscribeAdapterFor,
  TranscribeParamsFor,
} from "../../core/unified/vocabulary/transcribe";
import { transcribe as validator, type TranscribeBody } from "./transcribe";

/**
 * The two ids POST /stt/v1/transcribe serves. The rest of Inworld's STT
 * catalog is the streaming router's, and its own `checkTranscribeConfig`
 * rejects those here — so they are not refs.
 */
const MODELS = ["inworld/inworld-stt-1", "groq/whisper-large-v3"] as const;

const TRANSCRIBE_DOCS =
  "https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe";

/** The wire body this adapter compiles to. */
export type InworldTranscribeWire = TranscribeBody;

/** What a unified call to `inworld/…` returns. */
export type InworldTranscribeResult = ReturnType<typeof validator>;

export const transcribe = {
  category: "transcribe",
  provider: "inworld",
  models: MODELS,
  audioInputs: [],
  unsupported: {
    audio:
      "POST /stt/v1/transcribe carries its audio as base64 in `audioData.content` — there is no " +
      "URL field, no multipart part and no file API — and a Blob cannot be base64-encoded " +
      "without awaiting, which a synchronous compile step cannot do. Encode the bytes yourself " +
      "and call `transcribe` from `unmodel/inworld` directly.",
    languages:
      "POST /stt/v1/transcribe takes one `transcribeConfig.language`; the candidate-set field " +
      "(`sonioxConfig.languageHints`) exists only on the streaming surface.",
  },
  compile(
    input: TranscribeParamsFor<never>,
    ctx: CompileContext<TranscribeParamsFor<never>>,
  ): CompiledCall<InworldTranscribeWire, InworldTranscribeResult> {
    // Reached only when `audio` was absent, which the kernel has already
    // refused: `audioData.content` is required and there is nothing to put in
    // it, so the empty string is what the provider's own "must not be empty"
    // rule then reports.
    const body: InworldTranscribeWire = {
      transcribeConfig: { modelId: ctx.model, audioEncoding: "AUTO_DETECT" },
      audioData: { content: "" },
    };
    ctx.from(["audioData", "content"], "audio");
    ctx.from(["transcribeConfig", "modelId"], "model");
    ctx.from(["transcribeConfig", "language"], "language");
    ctx.from(["transcribeConfig", "enableSpeakerDiarization"], "diarization");
    ctx.from(["transcribeConfig", "includeWordTimestamps"], "timestamps");
    ctx.from(["transcribeConfig", "prompts"], "prompt");

    // BCP-47 verbatim: Inworld's own pattern accepts `en` and `en-US` alike.
    if (input.language !== undefined) body.transcribeConfig.language = input.language;

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { source: TRANSCRIBE_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) {
        body.transcribeConfig.enableSpeakerDiarization = diarization.enabled;
      }
    }

    if (input.timestamps !== undefined) {
      // A plain boolean, so `"none"` is expressible rather than an omission.
      const granularity = ctx.take(
        toTimestampGranularity(input.timestamps, ["word"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: TRANSCRIBE_DOCS }),
      );
      if (input.timestamps === "none" || granularity !== undefined) {
        body.transcribeConfig.includeWordTimestamps = granularity === "word";
      }
    }

    if (input.prompt !== undefined) body.transcribeConfig.prompts = [input.prompt];

    return { params: body, validate: validator.safe };
  },
} as const satisfies TranscribeAdapterFor<never, InworldTranscribeWire, InworldTranscribeResult>;
