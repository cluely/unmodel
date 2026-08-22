/**
 * `unmodel/voice-clone` → `elevenlabs.voiceClone` (POST /v1/voices/add).
 *
 * The friendliest clone wire in the pack: multipart files, an uncapped sample
 * list, and every canonical word except three lands on a field of its own.
 * The three:
 *
 * - **`language` is refused, not folded into `labels.language`.** The labels
 *   record is catalog metadata ("Keys can be language, accent, gender, or
 *   age") — the model reads the samples, not the tag — and compiling a
 *   conditioning input into decoration would report an exact mapping for a
 *   field that conditions nothing.
 * - **`visibility` is refused.** IVC voices are private to the account; the
 *   wire has no visibility field to disagree with.
 * - **per-sample `transcript` is refused** — no transcript field; ElevenLabs
 *   runs its own analysis on the recordings.
 *
 * `name` is required by the wire: a missing canonical `name` compiles to `""`
 * and the validator's own non-empty check answers, remapped here — the
 * `voice_id` pattern from ./unified-tts.
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
import { voiceClone as validator, type VoicesAddParams } from "./voice-clone";
import {
  ELEVENLABS_VOICE_CLONE_MODEL_PARAMS,
  MODELS,
  VOICE_CLONE_DOCS,
} from "./voice-clone-params";

/** The wire params this adapter compiles to (the multipart form fields). */
export type ElevenlabsVoiceCloneWire = VoicesAddParams;

/** What a unified call to `elevenlabs/ivc` returns. */
export type ElevenlabsVoiceCloneResult = ReturnType<typeof validator<ElevenlabsVoiceCloneWire>>;

/** Uncapped: neither the API reference nor the SDK caps `files` count. */
const SAMPLE_LIMITS = { min: 1, max: Infinity } as const;

/** The one operation this category serves today; see resolveOperation. */
const CLONE_ONLY = ["clone"] as const;

export const voiceClone = {
  category: "voiceClone",
  provider: "elevenlabs",
  models: MODELS,
  modelParams: ELEVENLABS_VOICE_CLONE_MODEL_PARAMS,
  sampleInputs: ["file"],
  sampleLimits: SAMPLE_LIMITS,
  unsupported: {
    language:
      "POST /v1/voices/add has no language field — the voice speaks whatever the samples " +
      "speak. The `labels` extra can carry a `language` tag, but it is catalog metadata, " +
      "not a conditioning input.",
    visibility:
      "Instant Voice Cloning voices are private to your account; POST /v1/voices/add has " +
      "no visibility field.",
    voiceId:
      "ElevenLabs mints the voice_id in the response; POST /v1/voices/add has no " +
      "caller-chosen id field.",
  },
  compile(
    input: VoiceCloneParamsFor<"file">,
    ctx: CompileContext<VoiceCloneParamsFor<"file">>,
  ): CompiledCall<ElevenlabsVoiceCloneWire, ElevenlabsVoiceCloneResult> {
    // `name` is required on the wire; `""` lets the validator's own non-empty
    // check answer, remapped onto the canonical field.
    const body: ElevenlabsVoiceCloneWire = { name: input.name ?? "", files: [] };
    ctx.from(["name"], "name");
    ctx.from(["files"], "samples");
    ctx.from(["description"], "description");
    ctx.from(["remove_background_noise"], "noiseReduction");

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
          hint: "ElevenLabs analyses the recordings itself",
        },
        { path: ["samples"], warn: ctx.warn },
      ),
    );
    if (samples !== undefined) {
      body.files = samples.flatMap((sample) => (sample.kind === "file" ? [sample.file] : []));
    }

    if (input.description !== undefined) body.description = input.description;
    if (input.noiseReduction !== undefined) body.remove_background_noise = input.noiseReduction;

    applyExtras(input, ELEVENLABS_VOICE_CLONE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceCloneAdapterFor<
  "file",
  typeof ELEVENLABS_VOICE_CLONE_MODEL_PARAMS,
  ElevenlabsVoiceCloneWire,
  ElevenlabsVoiceCloneResult
>;
