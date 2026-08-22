/**
 * `unmodel/voice-design` → `fish-audio.voiceDesign` (POST /v1/voice-design).
 *
 * The single-phase, ephemeral design route: the response's candidates carry
 * inline base64 audio, nothing is persisted, and there is no save endpoint —
 * a chosen candidate becomes a stored voice only by cloning its audio through
 * POST /model. Two mappings worth stating:
 *
 * - **`previewText` is refused.** The candidates speak model-chosen content;
 *   Fish's `reference_text` (≤150 chars) is reference *content* for the
 *   generated voice, not a script, and rides as an extra under its own name.
 * - **`language` passes through as-is** — the wire documents "BCP-47 language
 *   hint, such as `en`, `zh`, or `ja`", so a full tag is legal and no primary
 *   subtag reduction is invented.
 *
 * `model` becomes the required `model` HEADER (the validator strips it from
 * the body), and `n` (1–4), `seed` and `guidance` → `guidance_scale` land on
 * fields of their own — the bounds live in the validator's schema and surface
 * at the canonical paths.
 */
import {
  applyExtras,
  resolveOperation,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VoiceDesignAdapterFor,
  VoiceDesignParams,
} from "../../core/unified/vocabulary/voice-design";
import { voiceDesign as validator, type VoiceDesignBody } from "./voice-design";
import { FISH_AUDIO_VOICE_DESIGN_MODEL_PARAMS, MODELS } from "./voice-design-params";

/** The wire params this adapter compiles to (the `model` header included). */
export type FishAudioVoiceDesignWire = VoiceDesignBody;

/** What a unified call to `fish-audio/voice-design-1` returns. */
export type FishAudioVoiceDesignResult = ReturnType<
  typeof validator<FishAudioVoiceDesignWire>
>;

/** The one operation this category serves today; see resolveOperation. */
const DESIGN_ONLY = ["design"] as const;

export const voiceDesign = {
  category: "voiceDesign",
  provider: "fish-audio",
  models: MODELS,
  modelParams: FISH_AUDIO_VOICE_DESIGN_MODEL_PARAMS,
  unsupported: {
    previewText:
      "POST /v1/voice-design has no preview-script field — candidates speak model-chosen " +
      "content. `reference_text` (reference content, ≤150 characters) rides as an extra.",
  },
  compile(
    input: VoiceDesignParams,
    ctx: CompileContext<VoiceDesignParams>,
  ): CompiledCall<FishAudioVoiceDesignWire, FishAudioVoiceDesignResult> {
    const body: FishAudioVoiceDesignWire = {
      model: ctx.model,
      instruction: input.prompt,
    };
    ctx.from(["model"], "model");
    ctx.from(["instruction"], "prompt");
    ctx.from(["n"], "n");
    ctx.from(["seed"], "seed");
    ctx.from(["guidance_scale"], "guidance");
    ctx.from(["language"], "language");

    ctx.take(
      resolveOperation(input.operation, DESIGN_ONLY, { path: ["operation"], warn: ctx.warn }),
    );

    if (input.n !== undefined) body.n = input.n;
    if (input.seed !== undefined) body.seed = input.seed;
    if (input.guidance !== undefined) body.guidance_scale = input.guidance;
    if (input.language !== undefined) body.language = input.language;

    applyExtras(input, FISH_AUDIO_VOICE_DESIGN_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceDesignAdapterFor<
  typeof FISH_AUDIO_VOICE_DESIGN_MODEL_PARAMS,
  FishAudioVoiceDesignWire,
  FishAudioVoiceDesignResult
>;
