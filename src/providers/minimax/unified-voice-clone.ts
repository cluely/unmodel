/**
 * `unmodel/voice-clone` → `minimax.voiceClone` (POST /v1/voice_clone).
 *
 * The indirection wire: the recording is NOT in this request. Upload it first
 * (POST /v1/files/upload, `purpose: "voice_clone"` — `toVoiceUploadFormData`
 * in ./voice-clone builds that body) and pass the returned id as the
 * canonical `{ fileId }`, so `sampleInputs` is `["fileId"]` and exactly one
 * sample. Three mappings worth stating:
 *
 * - **`voiceId` is REQUIRED here** — the one wire where the caller mints the
 *   id (8–256 chars, letter first; the validator's grammar check answers at
 *   the canonical path). `name` is refused instead: there is no display-name
 *   field, the id is the handle.
 * - **`fileId` is numeric on this wire.** MiniMax file ids are int64s; a
 *   non-numeric canonical `fileId` is refused by name rather than sent as a
 *   string the API would 400.
 * - **`samples[0].transcript` → `text_validation`** — "expected transcript of
 *   the cloning sample audio", ASR-checked against `accuracy`. An exact
 *   mapping, not an approximation.
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
import { voiceClone as validator, type VoiceCloneParams as MinimaxVoiceCloneParams } from "./voice-clone";
import {
  MINIMAX_VOICE_CLONE_MODEL_PARAMS,
  MODELS,
  VOICE_CLONE_DOCS,
} from "./voice-clone-params";

/** The wire params this adapter compiles to. */
export type MinimaxVoiceCloneWire = MinimaxVoiceCloneParams;

/** What a unified call to `minimax/voice-clone` returns. */
export type MinimaxVoiceCloneResult = ReturnType<typeof validator<MinimaxVoiceCloneWire>>;

/** Exactly one uploaded recording per clone request. */
const SAMPLE_LIMITS = { min: 1, max: 1 } as const;

/** The one operation this category serves today; see resolveOperation. */
const CLONE_ONLY = ["clone"] as const;

export const voiceClone = {
  category: "voiceClone",
  provider: "minimax",
  models: MODELS,
  modelParams: MINIMAX_VOICE_CLONE_MODEL_PARAMS,
  sampleInputs: ["fileId"],
  sampleLimits: SAMPLE_LIMITS,
  unsupported: {
    name:
      "POST /v1/voice_clone has no display-name field; the caller-chosen `voiceId` is the " +
      "voice's handle.",
    description: "POST /v1/voice_clone has no description field.",
    language:
      "POST /v1/voice_clone has no voice-language field — the voice speaks whatever the " +
      "sample speaks. `language_boost` (an extra) hints the PREVIEW synthesis only.",
    visibility:
      "MiniMax cloned voices are private to the account; POST /v1/voice_clone has no " +
      "visibility field.",
  },
  compile(
    input: VoiceCloneParamsFor<"fileId">,
    ctx: CompileContext<VoiceCloneParamsFor<"fileId">>,
  ): CompiledCall<MinimaxVoiceCloneWire, MinimaxVoiceCloneResult> {
    // `voice_id` is required on the wire; `""` lets the validator's own
    // grammar check answer, remapped onto the canonical field.
    const body: MinimaxVoiceCloneWire = { file_id: 0, voice_id: input.voiceId ?? "" };
    ctx.from(["voice_id"], "voiceId");
    ctx.from(["file_id"], "samples");
    ctx.from(["text_validation"], "samples");
    ctx.from(["need_noise_reduction"], "noiseReduction");

    ctx.take(
      resolveOperation(input.operation, CLONE_ONLY, { path: ["operation"], warn: ctx.warn }),
    );

    const samples = ctx.take(
      resolveVoiceSamples(
        input.samples,
        {
          accepts: ["fileId"],
          limits: SAMPLE_LIMITS,
          transcripts: "optional",
          source: VOICE_CLONE_DOCS,
        },
        { path: ["samples"], warn: ctx.warn },
      ),
    );
    const sample = samples?.[0];
    if (sample !== undefined && sample.kind === "fileId") {
      // MiniMax file ids are int64s ("Audio file ID from File Upload API");
      // the canonical `fileId` is a string, so the digits are required here.
      if (/^\d+$/.test(sample.fileId)) {
        body.file_id = Number(sample.fileId);
      } else {
        ctx.fail({
          code: "invalid_shape",
          path: ["samples", 0, "audio", "fileId"],
          message:
            `MiniMax file ids are numeric (the \`file.file_id\` POST /v1/files/upload returns); ` +
            `got ${JSON.stringify(sample.fileId)}.`,
          meta: { source: VOICE_CLONE_DOCS },
        });
      }
      if (sample.transcript !== undefined) body.text_validation = sample.transcript;
    }

    if (input.noiseReduction !== undefined) body.need_noise_reduction = input.noiseReduction;

    applyExtras(input, MINIMAX_VOICE_CLONE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceCloneAdapterFor<
  "fileId",
  typeof MINIMAX_VOICE_CLONE_MODEL_PARAMS,
  MinimaxVoiceCloneWire,
  MinimaxVoiceCloneResult
>;
