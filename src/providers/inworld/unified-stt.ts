/**
 * `unmodel/stt` → `inworld.stt` (POST /stt/v1/transcribe).
 *
 * ## One input shape, and it is the base64 one
 *
 * Inworld takes its audio as **base64 inside the JSON body**
 * (`audioData.content`). There is no URL field, no multipart part and no file
 * API, so of the four canonical shapes only `{ data }` has somewhere to go:
 *
 * - `{ url }` and `{ fileId }` have no wire field to compile *to*;
 * - `{ file }` has one in principle, and cannot reach it in practice: a `Blob`
 *   is read asynchronously (`arrayBuffer()`, `text()`, `FileReader` — all
 *   promises) and `compile` is synchronous, by design, because a validator that
 *   returned a promise would make every unified call `await`-shaped for the
 *   sake of one provider. Encode the bytes yourself and pass `{ data }`.
 *
 * `audioInputs: ["data"]` is therefore the whole story, and both halves of the
 * narrowing tell it: `audio` types as `{ data, mimeType? }` at an `inworld/…`
 * ref, and `resolveAudioInput` reports an `unsupported_param` naming `{ data }`
 * for the three shapes this route has no field for.
 *
 * This adapter used to declare `audio` **unsupported** with an empty
 * `audioInputs` — a provider registered in the pack that no canonical request
 * could reach. That was an honest answer to the wrong question: the vocabulary
 * was missing the inline-bytes shape three sibling categories already had, not
 * Inworld missing an endpoint. Adding `"data"` retired the gap.
 */
import {
  applyExtras,
  resolveAudioInput,
  resolveDiarization,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { SttAdapterFor, SttParamsFor } from "../../core/unified/vocabulary/stt";
import { stt as validator, type TranscribeBody } from "./stt";
import { INWORLD_STT_MODEL_PARAMS, MODELS, SHARED_EXTRAS } from "./stt-params";

const TRANSCRIBE_DOCS =
  "https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe";

/** The wire body this adapter compiles to. */
export type InworldSttWire = TranscribeBody;

/** What a unified call to `inworld/…` returns. */
export type InworldSttResult = ReturnType<typeof validator>;

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
  audioInputs: ["data"] as const,
  unsupported: {
    languages:
      "POST /stt/v1/transcribe takes one `transcribeConfig.language`; the candidate-set field " +
      "(`sonioxConfig.languageHints`) exists only on the streaming surface.",
  },
  compile(
    input: SttParamsFor<"data">,
    ctx: CompileContext<SttParamsFor<"data">>,
  ): CompiledCall<InworldSttWire, InworldSttResult> {
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

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["data"], { path: ["audio"], warn: ctx.warn }, {
        source: TRANSCRIBE_DOCS,
        hint:
          "POST /stt/v1/transcribe has no URL field, no multipart part and no file API — " +
          "`audioData.content` is base64 bytes.",
      }),
    );
    // `audioEncoding` stays `AUTO_DETECT`: the payload carries its own container
    // header, and a caller who knows better pins it through the extra of the
    // same name.
    if (audio?.kind === "data") body.audioData.content = audio.data;

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
  "data",
  typeof INWORLD_STT_MODEL_PARAMS,
  InworldSttWire,
  InworldSttResult
>;
