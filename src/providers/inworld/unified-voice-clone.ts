/**
 * `unmodel/voice-clone` → `inworld.voiceClone` (POST /voices/v1/voices:clone).
 *
 * The one clone wire whose samples ride as JSON — base64 in
 * `voiceSamples[].audioData` — so `sampleInputs` is `["data"]`: a `Blob`
 * cannot be read synchronously (`compile` is synchronous by design), and the
 * refusal names the shape this route does take. Per-sample `transcription` is
 * a field of its own, so canonical `transcript`s map one-for-one — no
 * parallel-array rule here, unlike Fish.
 *
 * `language` → `languageCode` verbatim: the wire documents a "canonical
 * BCP-47-shaped locale string" with case/separator-insensitive matching, so a
 * full tag is exact and no primary-subtag reduction is invented. The legacy
 * `langCode` enum stays an extra; the validator refuses the pair together.
 */
import {
  applyExtras,
  resolveOperation,
  resolveVoiceSamples,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VoiceCloneAdapterFor,
  VoiceCloneParamsFor,
} from "../../core/unified/vocabulary/voice-clone";
import {
  voiceClone as validator,
  type InworldVoiceSample,
  type VoicesCloneBody,
} from "./voice-clone";
import {
  INWORLD_VOICE_CLONE_MODEL_PARAMS,
  MODELS,
  VOICE_CLONE_DOCS,
} from "./voice-clone-params";

/** The wire params this adapter compiles to. */
export type InworldVoiceCloneWire = VoicesCloneBody;

/** What a unified call to `inworld/voice-clone` returns. */
export type InworldVoiceCloneResult = ReturnType<typeof validator<InworldVoiceCloneWire>>;

/** At least one sample; the docs cap bytes (4MB) and seconds (30), not count. */
const SAMPLE_LIMITS = { min: 1, max: Infinity } as const;

/** The one operation this category serves today; see resolveOperation. */
const CLONE_ONLY = ["clone"] as const;

export const voiceClone = {
  category: "voiceClone",
  provider: "inworld",
  models: MODELS,
  modelParams: INWORLD_VOICE_CLONE_MODEL_PARAMS,
  sampleInputs: ["data"],
  sampleLimits: SAMPLE_LIMITS,
  unsupported: {
    visibility:
      "Inworld voices are private to the workspace; POST voices:clone has no visibility " +
      "field.",
    voiceId:
      "Inworld mints `voice.voiceId` in the response; POST voices:clone has no " +
      "caller-chosen id field.",
  },
  compile(
    input: VoiceCloneParamsFor<"data">,
    ctx: CompileContext<VoiceCloneParamsFor<"data">>,
  ): CompiledCall<InworldVoiceCloneWire, InworldVoiceCloneResult> {
    // `displayName` is required on the wire; `""` lets the validator's own
    // non-empty check answer, remapped onto the canonical field.
    const body: InworldVoiceCloneWire = { displayName: input.name ?? "", voiceSamples: [] };
    ctx.from(["displayName"], "name");
    ctx.from(["voiceSamples"], "samples");
    ctx.from(["languageCode"], "language");
    ctx.from(["description"], "description");
    ctx.from(["audioProcessingConfig", "removeBackgroundNoise"], "noiseReduction");

    ctx.take(
      resolveOperation(input.operation, CLONE_ONLY, { path: ["operation"], warn: ctx.warn }),
    );

    const samples = ctx.take(
      resolveVoiceSamples(
        input.samples,
        {
          accepts: ["data"],
          limits: SAMPLE_LIMITS,
          transcripts: "optional",
          source: VOICE_CLONE_DOCS,
        },
        { path: ["samples"], warn: ctx.warn },
      ),
    );
    if (samples !== undefined) {
      body.voiceSamples = samples.flatMap<InworldVoiceSample>((sample) =>
        sample.kind === "data"
          ? [
              {
                audioData: sample.data,
                ...(sample.transcript !== undefined && { transcription: sample.transcript }),
              },
            ]
          : [],
      );
    }

    if (input.language !== undefined) body.languageCode = input.language;
    if (input.description !== undefined) body.description = input.description;
    if (input.noiseReduction !== undefined) {
      body.audioProcessingConfig = { removeBackgroundNoise: input.noiseReduction };
    }

    applyExtras(input, INWORLD_VOICE_CLONE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceCloneAdapterFor<
  "data",
  typeof INWORLD_VOICE_CLONE_MODEL_PARAMS,
  InworldVoiceCloneWire,
  InworldVoiceCloneResult
>;
