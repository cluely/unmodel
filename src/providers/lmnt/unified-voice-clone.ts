/**
 * `unmodel/voice-clone` → `lmnt.voiceClone` (POST /v1/ai/voice).
 *
 * The smallest clone wire in the pack — one `file`, a `name`, and metadata.
 * Version 1.2 flattened the old `files[]` + `metadata` JSON shape and dropped
 * `enhance` and `type: instant|professional` with it, so `noiseReduction` is
 * refused by name rather than mapped to a field that no longer exists. No
 * transcript, language, visibility or caller-id field either; the created
 * voice's `id` arrives in the response and feeds ./tts's `voice`.
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
import { voiceClone as validator, type AiVoiceParams } from "./voice-clone";
import { LMNT_VOICE_CLONE_MODEL_PARAMS, MODELS, VOICE_CLONE_DOCS } from "./voice-clone-params";

/** The wire params this adapter compiles to (the multipart form fields). */
export type LmntVoiceCloneWire = AiVoiceParams;

/** What a unified call to `lmnt/voice-clone` returns. */
export type LmntVoiceCloneResult = ReturnType<typeof validator<LmntVoiceCloneWire>>;

/** "The input audio file" is singular: exactly one recording. */
const SAMPLE_LIMITS = { min: 1, max: 1 } as const;

/** The one operation this category serves today; see resolveOperation. */
const CLONE_ONLY = ["clone"] as const;

export const voiceClone = {
  category: "voiceClone",
  provider: "lmnt",
  models: MODELS,
  modelParams: LMNT_VOICE_CLONE_MODEL_PARAMS,
  sampleInputs: ["file"],
  sampleLimits: SAMPLE_LIMITS,
  unsupported: {
    language:
      "POST /v1/ai/voice has no language field — the voice speaks whatever the recording " +
      "speaks (Blizzard is multilingual at synthesis time).",
    noiseReduction:
      "POST /v1/ai/voice (lmnt-version 1.2) has no enhancement field — the pre-1.2 " +
      "`enhance` was removed; clean the recording before uploading.",
    visibility:
      "LMNT voices are private to the account; POST /v1/ai/voice has no visibility field.",
    voiceId:
      "LMNT mints the voice's `id` in the response; POST /v1/ai/voice has no " +
      "caller-chosen id field.",
  },
  compile(
    input: VoiceCloneParamsFor<"file">,
    ctx: CompileContext<VoiceCloneParamsFor<"file">>,
  ): CompiledCall<LmntVoiceCloneWire, LmntVoiceCloneResult> {
    // `name` is required on the wire; `""` lets the validator's own
    // non-empty check answer, remapped onto the canonical field.
    const body: LmntVoiceCloneWire = { file: new Blob([]), name: input.name ?? "" };
    ctx.from(["file"], "samples");
    ctx.from(["name"], "name");
    ctx.from(["description"], "description");

    ctx.take(
      resolveOperation(input.operation, CLONE_ONLY, { path: ["operation"], warn: ctx.warn }),
    );

    const samples = ctx.take(
      resolveVoiceSamples(
        input.samples,
        {
          accepts: ["file"],
          limits: SAMPLE_LIMITS,
          transcripts: "unsupported",
          source: VOICE_CLONE_DOCS,
        },
        { path: ["samples"], warn: ctx.warn },
      ),
    );
    const sample = samples?.[0];
    if (sample !== undefined && sample.kind === "file") body.file = sample.file;

    if (input.description !== undefined) body.description = input.description;

    applyExtras(input, LMNT_VOICE_CLONE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceCloneAdapterFor<
  "file",
  typeof LMNT_VOICE_CLONE_MODEL_PARAMS,
  LmntVoiceCloneWire,
  LmntVoiceCloneResult
>;
