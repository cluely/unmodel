/**
 * `unmodel/voice-design` → `inworld.voiceDesign` (POST /voices/v1/voices:design).
 *
 * A research preview, and the strictest prompt window in the pack:
 * `designPrompt` is bounded 30–250 characters (English), enforced by the
 * validator's schema and surfacing at the canonical `prompt`. `previewText`
 * is REQUIRED on this wire — a missing canonical one compiles to `""` and the
 * validator's non-empty check answers at the canonical path — and `n` maps to
 * `voiceDesignConfig.numberOfSamples` (1–3).
 *
 * Phase 1 only: the response's previews are DRAFT voices, persisted by
 * `inworld.voiceDesignPublish` (POST voices/{voiceId}:publish), wire-only by
 * design — see the entry's docs.
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
import { voiceDesign as validator, type VoicesDesignBody } from "./voice-design";
import { INWORLD_VOICE_DESIGN_MODEL_PARAMS, MODELS } from "./voice-design-params";

/** The wire params this adapter compiles to. */
export type InworldVoiceDesignWire = VoicesDesignBody;

/** What a unified call to `inworld/voice-design` returns. */
export type InworldVoiceDesignResult = ReturnType<typeof validator<InworldVoiceDesignWire>>;

/** The one operation this category serves today; see resolveOperation. */
const DESIGN_ONLY = ["design"] as const;

export const voiceDesign = {
  category: "voiceDesign",
  provider: "inworld",
  models: MODELS,
  modelParams: INWORLD_VOICE_DESIGN_MODEL_PARAMS,
  unsupported: {
    seed: "POST voices:design has no seed field; candidate generation is not seedable.",
    guidance: "POST voices:design has no guidance field.",
  },
  compile(
    input: VoiceDesignParams,
    ctx: CompileContext<VoiceDesignParams>,
  ): CompiledCall<InworldVoiceDesignWire, InworldVoiceDesignResult> {
    // `previewText` is required on the wire; `""` lets the validator's own
    // non-empty check answer, remapped onto the canonical field.
    const body: InworldVoiceDesignWire = {
      designPrompt: input.prompt,
      previewText: input.previewText ?? "",
    };
    ctx.from(["designPrompt"], "prompt");
    ctx.from(["previewText"], "previewText");
    ctx.from(["voiceDesignConfig", "numberOfSamples"], "n");
    ctx.from(["languageCode"], "language");

    ctx.take(
      resolveOperation(input.operation, DESIGN_ONLY, { path: ["operation"], warn: ctx.warn }),
    );

    if (input.n !== undefined) body.voiceDesignConfig = { numberOfSamples: input.n };
    // BCP-47 verbatim — the wire's own spelling; see ./unified-voice-clone.
    if (input.language !== undefined) body.languageCode = input.language;

    applyExtras(input, INWORLD_VOICE_DESIGN_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceDesignAdapterFor<
  typeof INWORLD_VOICE_DESIGN_MODEL_PARAMS,
  InworldVoiceDesignWire,
  InworldVoiceDesignResult
>;
