/**
 * `unmodel/stt` → `inworld.stt` (POST /stt/v1/transcribe).
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
 * `unmodel/inworld`'s `stt` validator exists and works perfectly well —
 * it is the canonical vocabulary that cannot express its input. Every other
 * cell in the table below is mapped and tested, so the day the vocabulary
 * grows an inline-bytes shape, this file is one line from working.
 */
import {
  applyExtras,
  EXTRA,
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
  type InworldGroqConfig,
  type InworldSttAudioEncoding,
  type InworldSttV1Config,
  type InworldVoiceProfileConfig,
  type TranscribeBody,
} from "./stt";

/**
 * The two ids POST /stt/v1/transcribe serves. The rest of Inworld's STT
 * catalog is the streaming router's, and its own `checkTranscribeConfig`
 * rejects those here — so they are not refs.
 */
const MODELS = ["inworld/inworld-stt-1", "groq/whisper-large-v3"] as const;

const TRANSCRIBE_DOCS =
  "https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe";

/** The wire body this adapter compiles to. */
export type InworldSttWire = TranscribeBody;

/** What a unified call to `inworld/…` returns. */
export type InworldSttResult = ReturnType<typeof validator>;

/**
 * The per-model table, declared in full even though no request can currently
 * reach it — for the reason the module header gives about the adapter itself:
 * every cell here is mapped and correct, so the day the vocabulary grows an
 * inline-bytes shape this file is one line from working, and the table would be
 * the wrong thing to have left blank in the meantime.
 *
 * ## `timestamps`
 *
 * `inworld/inworld-stt-1` gets `["none"]`. "Word timestamps & diarization:
 * Available for AssemblyAI, Soniox, Deepgram; **not yet for Inworld**" — and
 * the field is "accepted but no per-word data comes back", which is the
 * accepted-and-ignored case, so `timestamps: "word"` is refused by name there.
 * Groq is named on neither side of that sentence, so `groq/whisper-large-v3`
 * keeps `["none", "word"]`, exactly as the provider's own check does.
 *
 * ## The vendor blocks
 *
 * `transcribeConfig` carries at most one provider block and it must match the
 * model's vendor — `inworldSttV1Config` for `inworld/…`, `groqConfig` for
 * `groq/…` — so each row declares its own and refuses the other by name.
 * `voiceProfileConfig` goes the same way: "Voice Profile … is only produced by
 * `inworld/inworld-stt-1`". All three are whole typed objects rather than
 * flattened members, because `voiceProfileConfig.enableVoiceProfile` is
 * *required* when the object is present and the two turn-taking blocks share
 * member names (`minEndOfTurnSilenceWhenConfident`, `vadThreshold`) with the
 * streaming surface's AssemblyAI block.
 *
 * Everything nests under `transcribeConfig` ({@link CONFIG_NESTING}), which is
 * where the whole request lives.
 */
const SHARED_EXTRAS = {
  /** The adapter defaults it to `AUTO_DETECT`; this is how a caller pins it. */
  audioEncoding: EXTRA as InworldSttAudioEncoding,
  sampleRateHertz: EXTRA as number,
  numberOfChannels: EXTRA as number,
  inactivityTimeoutSeconds: EXTRA as number,
  endOfTurnConfidenceThreshold: EXTRA as number,
} as const;

const INWORLD_STT_MODEL_PARAMS = {
  "inworld/inworld-stt-1": {
    timestamps: ["none"],
    extras: {
      ...SHARED_EXTRAS,
      voiceProfileConfig: EXTRA as InworldVoiceProfileConfig,
      inworldSttV1Config: EXTRA as InworldSttV1Config,
    },
  },
  "groq/whisper-large-v3": {
    timestamps: ["none", "word"],
    extras: { ...SHARED_EXTRAS, groqConfig: EXTRA as InworldGroqConfig },
  },
} as const satisfies SttModelParamTable;

/** Every extra is a `transcribeConfig` field; the body root holds only `audioData`. */
const CONFIG_NESTING: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  [
    ...Object.keys(SHARED_EXTRAS),
    "voiceProfileConfig",
    "inworldSttV1Config",
    "groqConfig",
  ].map((key) => [key, ["transcribeConfig"]]),
);

export const stt = {
  category: "stt",
  provider: "inworld",
  models: MODELS,
  modelParams: INWORLD_STT_MODEL_PARAMS,
  audioInputs: [],
  unsupported: {
    audio:
      "POST /stt/v1/transcribe carries its audio as base64 in `audioData.content` — there is no " +
      "URL field, no multipart part and no file API — and a Blob cannot be base64-encoded " +
      "without awaiting, which a synchronous compile step cannot do. Encode the bytes yourself " +
      "and call `stt` from `unmodel/inworld` directly.",
    languages:
      "POST /stt/v1/transcribe takes one `transcribeConfig.language`; the candidate-set field " +
      "(`sonioxConfig.languageHints`) exists only on the streaming surface.",
  },
  compile(
    input: SttParamsFor<never>,
    ctx: CompileContext<SttParamsFor<never>>,
  ): CompiledCall<InworldSttWire, InworldSttResult> {
    // Reached only when `audio` was absent, which the kernel has already
    // refused: `audioData.content` is required and there is nothing to put in
    // it, so the empty string is what the provider's own "must not be empty"
    // rule then reports.
    const body: InworldSttWire = {
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

    applyExtras(input, INWORLD_STT_MODEL_PARAMS, body, ctx, { nest: CONFIG_NESTING });

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  never,
  typeof INWORLD_STT_MODEL_PARAMS,
  InworldSttWire,
  InworldSttResult
>;
