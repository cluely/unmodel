/**
 * `unmodel/voice-design` → `elevenlabs.voiceDesign` (POST /v1/text-to-voice/design).
 *
 * The one design adapter with real model ids (`eleven_multilingual_ttv_v2`
 * and `eleven_ttv_v3`, whose extras diverge — see ./voice-design-params).
 * Three wire facts shape the mapping:
 *
 * - **An omitted `previewText` compiles to `auto_generate_text: true`** — the
 *   wire's exact spelling of "none given", not an invented default: the docs
 *   bound `text` at 100–1000 characters, so leaving both out asks the API to
 *   speak something it has no script for. When `previewText` IS given, it
 *   becomes `text` and the validator's own 100–1000 check answers at the
 *   canonical path.
 * - **`n` is refused.** The endpoint returns its own preview set; there is no
 *   count field.
 * - **This is phase 1 only.** Each response preview carries a
 *   `generated_voice_id`; persisting one is `elevenlabs.voiceDesignSave`
 *   (POST /v1/text-to-voice), wire-only by design — see the entry's docs.
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
import { voiceDesign as validator, type TextToVoiceDesignParams } from "./voice-design";
import { ELEVENLABS_VOICE_DESIGN_MODEL_PARAMS, MODELS } from "./voice-design-params";

/** The wire params this adapter compiles to (output_format included). */
export type ElevenlabsVoiceDesignWire = TextToVoiceDesignParams;

/** What a unified call to `elevenlabs/eleven_ttv_v3` (or v2) returns. */
export type ElevenlabsVoiceDesignResult = ReturnType<
  typeof validator<ElevenlabsVoiceDesignWire>
>;

/** The one operation this category serves today; see resolveOperation. */
const DESIGN_ONLY = ["design"] as const;

export const voiceDesign = {
  category: "voiceDesign",
  provider: "elevenlabs",
  models: MODELS,
  modelParams: ELEVENLABS_VOICE_DESIGN_MODEL_PARAMS,
  unsupported: {
    n:
      "POST /v1/text-to-voice/design returns its own preview set; there is no " +
      "candidate-count field.",
    language:
      "POST /v1/text-to-voice/design has no language field — describe the accent and " +
      "language in `prompt` instead.",
  },
  compile(
    input: VoiceDesignParams,
    ctx: CompileContext<VoiceDesignParams>,
  ): CompiledCall<ElevenlabsVoiceDesignWire, ElevenlabsVoiceDesignResult> {
    const body: ElevenlabsVoiceDesignWire = {
      voice_description: input.prompt,
      model_id: ctx.model,
    };
    ctx.from(["model_id"], "model");
    ctx.from(["voice_description"], "prompt");
    ctx.from(["text"], "previewText");
    ctx.from(["auto_generate_text"], "previewText");
    ctx.from(["seed"], "seed");
    ctx.from(["guidance_scale"], "guidance");

    ctx.take(
      resolveOperation(input.operation, DESIGN_ONLY, { path: ["operation"], warn: ctx.warn }),
    );

    if (input.previewText !== undefined) {
      body.text = input.previewText;
    } else {
      // The wire's spelling of "no script given" — see the module note.
      body.auto_generate_text = true;
    }

    if (input.seed !== undefined) body.seed = input.seed;
    if (input.guidance !== undefined) body.guidance_scale = input.guidance;

    applyExtras(input, ELEVENLABS_VOICE_DESIGN_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceDesignAdapterFor<
  typeof ELEVENLABS_VOICE_DESIGN_MODEL_PARAMS,
  ElevenlabsVoiceDesignWire,
  ElevenlabsVoiceDesignResult
>;
