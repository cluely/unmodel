/**
 * `unmodel/voice-design` → `minimax.voiceDesign` (POST /v1/voice_design).
 *
 * The single-phase design route: the response's `voice_id` is immediately
 * usable for synthesis — no save step. Two words map, the rest is refused:
 * `prompt` → `prompt` and `previewText` → `preview_text` (REQUIRED on this
 * wire, ≤500 chars and billed at $30/1M characters — a missing canonical one
 * compiles to `""` and the validator's non-empty check answers at the
 * canonical path). The optional caller-chosen `voice_id` rides as an extra —
 * on the design side only this provider takes a handle at all.
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
import { voiceDesign as validator, type VoiceDesignParams as MinimaxVoiceDesignParams } from "./voice-design";
import { MINIMAX_VOICE_DESIGN_MODEL_PARAMS, MODELS } from "./voice-design-params";

/** The wire params this adapter compiles to. */
export type MinimaxVoiceDesignWire = MinimaxVoiceDesignParams;

/** What a unified call to `minimax/voice-design` returns. */
export type MinimaxVoiceDesignResult = ReturnType<typeof validator<MinimaxVoiceDesignWire>>;

/** The one operation this category serves today; see resolveOperation. */
const DESIGN_ONLY = ["design"] as const;

export const voiceDesign = {
  category: "voiceDesign",
  provider: "minimax",
  models: MODELS,
  modelParams: MINIMAX_VOICE_DESIGN_MODEL_PARAMS,
  unsupported: {
    n: "POST /v1/voice_design generates one voice per request; there is no count field.",
    seed: "POST /v1/voice_design has no seed field.",
    guidance: "POST /v1/voice_design has no guidance field.",
    language:
      "POST /v1/voice_design has no language field — write the description and " +
      "`previewText` in the language the voice should speak.",
  },
  compile(
    input: VoiceDesignParams,
    ctx: CompileContext<VoiceDesignParams>,
  ): CompiledCall<MinimaxVoiceDesignWire, MinimaxVoiceDesignResult> {
    // `preview_text` is required on the wire; `""` lets the validator's own
    // non-empty check answer, remapped onto the canonical field.
    const body: MinimaxVoiceDesignWire = {
      prompt: input.prompt,
      preview_text: input.previewText ?? "",
    };
    ctx.from(["prompt"], "prompt");
    ctx.from(["preview_text"], "previewText");

    ctx.take(
      resolveOperation(input.operation, DESIGN_ONLY, { path: ["operation"], warn: ctx.warn }),
    );

    applyExtras(input, MINIMAX_VOICE_DESIGN_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VoiceDesignAdapterFor<
  typeof MINIMAX_VOICE_DESIGN_MODEL_PARAMS,
  MinimaxVoiceDesignWire,
  MinimaxVoiceDesignResult
>;
