/**
 * MiniMax Voice Design — POST https://api.minimax.io/v1/voice_design
 *
 * Wire reference:
 * https://platform.minimax.io/docs/api-reference/voice-design-design
 * (verified 2026-08-22). This is the INTERNATIONAL platform, matching ./tts.
 *
 * - SINGLE-PHASE: the response's `voice_id` is immediately usable for speech
 *   synthesis — there is no separate save step (unlike ElevenLabs and
 *   Inworld, whose design routes return previews that a second call
 *   persists). `trial_audio` is the preview, hex-encoded.
 * - `voice_id` is an OPTIONAL caller-chosen handle here ("If not provided, a
 *   unique voice_id will be automatically created") — the reference
 *   publishes no grammar for it, so none is enforced.
 * - BILLING: "Generating preview audio incurs a fee of $30 per 1M
 *   characters" — priced on `preview_text` through the synthetic catalog
 *   row's `perMillionCharacters`.
 * - There is no model field. unmodel addresses the route through the
 *   synthetic catalog id `voice-design` (the route noun).
 * - Auth is an `Authorization: Bearer <api key>` header — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeCharacterCostUSD } from "../../core/cost";
import { models as mediaModels } from "./models";

export const VOICE_DESIGN_URL = "https://api.minimax.io/v1/voice_design";

/**
 * Synthetic catalog id for this route — POST /v1/voice_design has no model
 * field, and MiniMax documents no model name for it, so the id is the route
 * noun. Its catalog row carries the documented $30/1M-character preview rate.
 */
export const VOICE_DESIGN_MODEL_ID = "voice-design";

/** "The text used for generating a preview audio sample" — max 500 characters. */
export const VOICE_DESIGN_PREVIEW_TEXT_MAX_CHARACTERS = 500;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

export interface VoiceDesignParams {
  /** The generative description of the voice to invent. No published bounds. */
  prompt: string;
  /** What the preview speaks (≤500 chars); billed at $30/1M characters. */
  preview_text: string;
  /**
   * "Custom voice ID for the generated voice. If not provided, a unique
   * voice_id will be automatically created."
   */
  voice_id?: string;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  prompt: z.string().min(1, "prompt must be a non-empty voice description"),
  preview_text: z
    .string()
    .min(1, "preview_text must not be empty")
    .max(
      VOICE_DESIGN_PREVIEW_TEXT_MAX_CHARACTERS,
      `preview_text is capped at ${VOICE_DESIGN_PREVIEW_TEXT_MAX_CHARACTERS} characters`,
    ),
  voice_id: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Estimation — "$30 per 1M characters" on the preview text, carried by the
// synthetic catalog row's perMillionCharacters.
// ---------------------------------------------------------------------------

function estimate(
  params: VoiceDesignParams,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const costUSD = computeCharacterCostUSD(info?.cost, params.preview_text.length);
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize — plain JSON body; `.toSdk("minimax")` is the identity (no
// official JS SDK). Type alias, not interface — see ./tts.
// ---------------------------------------------------------------------------

type VoiceDesignSdkTargets<B> = { minimax: () => B };

function finalize(
  params: VoiceDesignParams,
): Validated<VoiceDesignParams, VoiceDesignSdkTargets<VoiceDesignParams>> {
  return toValidated(
    params,
    { url: VOICE_DESIGN_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { minimax: () => params } },
  );
}

const validator = createValidator<
  VoiceDesignParams,
  Validated<VoiceDesignParams, VoiceDesignSdkTargets<VoiceDesignParams>>
>({
  endpoint: "minimax.voiceDesign",
  schema,
  // No model field on this wire — the synthetic catalog id stands in so
  // catalog-keyed machinery (including the preview rate) stays coherent.
  modelId: () => VOICE_DESIGN_MODEL_ID,
  catalog: mediaModels,
  estimate,
  finalize,
});

/**
 * Validates raw wire params for MiniMax `POST /v1/voice_design` — generate a
 * voice from a text description.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * Single-phase: the response's `voice_id` is immediately usable for speech
 * synthesis (no save step), with a hex-encoded `trial_audio` preview billed
 * at $30 per 1M `preview_text` characters. `.toSdk("minimax")` returns the
 * body unchanged (no official JS SDK). Auth is your job: add
 * `authorization: Bearer <MINIMAX_API_KEY>` when fetching.
 */
export const voiceDesign = validator as unknown as {
  <T extends VoiceDesignParams>(
    params: T & ExactKeys<T, VoiceDesignParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, VoiceDesignSdkTargets<T>>;
  safe<T extends VoiceDesignParams>(
    params: T & ExactKeys<T, VoiceDesignParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, VoiceDesignSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
