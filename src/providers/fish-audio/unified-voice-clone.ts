/**
 * `unmodel/voice-clone` → `fish-audio.voiceClone` (POST /model).
 *
 * The multi-sample clone wire (1–20 recordings) with per-sample transcripts —
 * but the transcripts ride as a PARALLEL ARRAY (`texts[]` "corresponding to
 * the voices"), which the wire cannot align to a partial set. So: every
 * sample carries a transcript, or none does, and a mix is refused at
 * `samples` naming the rule. ASR runs server-side when `texts` is omitted.
 *
 * `visibility` maps member-for-member (`"unlisted"` → Fish's `unlist`) and is
 * worth setting explicitly: the wire defaults to **public**, and the
 * validator's own omission warning rides through to the canonical path.
 * `cover_image` — required if the model is public — is an extra, so an
 * explicit `visibility: "public"` stays expressible.
 *
 * `type: "tts"` and `train_mode: "fast"` are the wire's required consts; the
 * adapter writes them.
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
  VoiceVisibility,
} from "../../core/unified/vocabulary/voice-clone";
import { voiceClone as validator, type CreateModelParams, type FishAudioVisibility } from "./voice-clone";
import {
  FISH_AUDIO_VOICE_CLONE_MODEL_PARAMS,
  MODELS,
  VOICE_CLONE_DOCS,
} from "./voice-clone-params";

/** The wire params this adapter compiles to (the multipart form fields). */
export type FishAudioVoiceCloneWire = CreateModelParams;

/** What a unified call to `fish-audio/fast` returns. */
export type FishAudioVoiceCloneResult = ReturnType<typeof validator<FishAudioVoiceCloneWire>>;

/** "minItems 1, maxItems 20" on `voices` (the OpenAPI schema). */
const SAMPLE_LIMITS = { min: 1, max: 20 } as const;

/** Canonical → wire visibility; only `"unlisted"` is spelled differently. */
const VISIBILITY: Readonly<Record<VoiceVisibility, FishAudioVisibility>> = {
  private: "private",
  unlisted: "unlist",
  public: "public",
};

/** The one operation this category serves today; see resolveOperation. */
const CLONE_ONLY = ["clone"] as const;

export const voiceClone = {
  category: "voiceClone",
  provider: "fish-audio",
  models: MODELS,
  modelParams: FISH_AUDIO_VOICE_CLONE_MODEL_PARAMS,
  sampleInputs: ["file"],
  sampleLimits: SAMPLE_LIMITS,
  unsupported: {
    language:
      "POST /model has no language field — the voice speaks whatever the samples speak, " +
      "and ASR detects their language when `texts` is omitted.",
    noiseReduction:
      "POST /model has no noise-reduction switch. `enhance_audio_quality` (default true) " +
      "is the nearest knob and rides as an extra; it enhances, it does not isolate.",
    voiceId:
      "Fish Audio mints the model's `_id` in the response; POST /model has no " +
      "caller-chosen id field.",
  },
  compile(
    input: VoiceCloneParamsFor<"file">,
    ctx: CompileContext<VoiceCloneParamsFor<"file">>,
  ): CompiledCall<FishAudioVoiceCloneWire, FishAudioVoiceCloneResult> {
    // `title` is required on the wire; `""` lets the validator's own
    // non-empty check answer, remapped onto the canonical field.
    const body: FishAudioVoiceCloneWire = {
      type: "tts",
      title: input.name ?? "",
      train_mode: "fast",
      voices: [],
    };
    ctx.from(["title"], "name");
    ctx.from(["voices"], "samples");
    ctx.from(["texts"], "samples");
    ctx.from(["visibility"], "visibility");
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
          transcripts: "optional",
          source: VOICE_CLONE_DOCS,
        },
        { path: ["samples"], warn: ctx.warn },
      ),
    );
    if (samples !== undefined) {
      const files = samples.flatMap((sample) => (sample.kind === "file" ? [sample.file] : []));
      const transcripts = samples.flatMap((sample) =>
        sample.transcript === undefined ? [] : [sample.transcript],
      );
      if (transcripts.length > 0 && transcripts.length < samples.length) {
        // `texts` parallels `voices` positionally; a partial set cannot say
        // which recording each transcript belongs to.
        ctx.fail({
          code: "invalid_shape",
          path: ["samples"],
          message:
            `${transcripts.length} of ${samples.length} samples carry a transcript; Fish Audio's ` +
            "`texts` array parallels `voices` positionally, so give every sample a `transcript` " +
            "or none (ASR runs on the recordings when `texts` is omitted).",
          meta: { source: VOICE_CLONE_DOCS },
        });
      } else {
        body.voices = files;
        if (transcripts.length === samples.length && transcripts.length > 0) {
          body.texts = transcripts;
        }
      }
    }

    if (input.visibility !== undefined) body.visibility = VISIBILITY[input.visibility];
    if (input.description !== undefined) body.description = input.description;

    applyExtras(input, FISH_AUDIO_VOICE_CLONE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceCloneAdapterFor<
  "file",
  typeof FISH_AUDIO_VOICE_CLONE_MODEL_PARAMS,
  FishAudioVoiceCloneWire,
  FishAudioVoiceCloneResult
>;
