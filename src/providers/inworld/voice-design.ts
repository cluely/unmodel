/**
 * Inworld voice design — POST https://api.inworld.ai/voices/v1/voices:design
 *
 * Wire reference:
 * https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/design-voice
 * (verified 2026-08-22). Voice design is flagged a research preview by the
 * docs — the schema may change.
 *
 * - This is phase 1 of a two-phase flow: the response's `previewVoices[]`
 *   are DRAFT voices (`voiceId` + base64 `previewAudio`); persisting one to
 *   the voice library is POST /voices/v1/voices/{voiceId}:publish — the
 *   `voiceDesignPublish` validator in ./voice-design-publish.
 * - `designPrompt` is bounded: "Between 30 and 250 characters. For best
 *   results, include age, gender, accent, pitch, pace, and tone."
 *   `previewText` "must result in audio that is 1-30 seconds. (~50-400
 *   characters in English)" — a duration bound on the AUDIO, so the
 *   character range is guidance and only non-emptiness is enforced.
 * - LANGUAGE, TWICE: as on voices:clone — "Set at most one of `languageCode`
 *   or `langCode`", enforced here.
 * - There is no model field. unmodel addresses the route through the
 *   synthetic catalog id `voice-design` (the route noun).
 * - Auth is an `Authorization: Basic <api_key>` header — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import {
  checkLangCodeEnum,
  checkLanguageExclusivity,
  type InworldLangCode,
} from "./voice-clone";

export const VOICES_DESIGN_URL = "https://api.inworld.ai/voices/v1/voices:design";

const VOICE_DESIGN_DOCS =
  "https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/design-voice";

/**
 * Synthetic catalog id for this route — POST voices:design has no model
 * field, and Inworld documents no model name for it, so the id is the route
 * noun.
 */
export const VOICE_DESIGN_MODEL_ID = "voice-design";

/** "Between 30 and 250 characters." */
export const VOICE_DESIGN_PROMPT_MIN_CHARACTERS = 30;
export const VOICE_DESIGN_PROMPT_MAX_CHARACTERS = 250;
/** "Between 1 and 3. Default is 1 if not provided." */
export const VOICE_DESIGN_SAMPLES_MIN = 1;
export const VOICE_DESIGN_SAMPLES_MAX = 3;

// ---------------------------------------------------------------------------
// Wire types — mirror the DesignVoiceRequest fields exactly (camelCase).
// ---------------------------------------------------------------------------

export interface InworldVoiceDesignConfig {
  /** "Between 1 and 3. Default is 1 if not provided." */
  numberOfSamples?: number;
}

export interface VoicesDesignBody {
  /**
   * The generative description of the voice to invent — "Between 30 and 250
   * characters. For best results, include age, gender, accent, pitch, pace,
   * and tone."
   */
  designPrompt: string;
  /**
   * What the draft candidates speak — "Must result in audio that is 1-30
   * seconds. (~50-400 characters in English)".
   */
  previewText: string;
  /**
   * BCP-47-shaped locale (e.g. `en-US`, `vi`). Set at most one of
   * `languageCode` / `langCode`.
   */
  languageCode?: string;
  /** Legacy language enum; prefer `languageCode`. */
  langCode?: InworldLangCode | (string & {});
  voiceDesignConfig?: InworldVoiceDesignConfig;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  designPrompt: z
    .string()
    .min(
      VOICE_DESIGN_PROMPT_MIN_CHARACTERS,
      `designPrompt must be between ${VOICE_DESIGN_PROMPT_MIN_CHARACTERS} and ${VOICE_DESIGN_PROMPT_MAX_CHARACTERS} characters`,
    )
    .max(
      VOICE_DESIGN_PROMPT_MAX_CHARACTERS,
      `designPrompt must be between ${VOICE_DESIGN_PROMPT_MIN_CHARACTERS} and ${VOICE_DESIGN_PROMPT_MAX_CHARACTERS} characters`,
    ),
  previewText: z.string().min(1, "previewText must not be empty"),
  languageCode: z.string().optional(),
  langCode: z.string().optional(),
  voiceDesignConfig: z
    .looseObject({
      numberOfSamples: z
        .number()
        .int()
        .min(VOICE_DESIGN_SAMPLES_MIN)
        .max(VOICE_DESIGN_SAMPLES_MAX)
        .optional(),
    })
    .optional(),
});

// No estimate: inworld.ai/pricing publishes no rate for voice design (a
// research preview).

// ---------------------------------------------------------------------------
// Finalize — plain JSON body; `.toSdk("inworld")` is the identity (no
// official JS SDK for the voice API).
// ---------------------------------------------------------------------------

type VoiceDesignSdkTargets<B> = { inworld: () => B };

function finalize(
  params: VoicesDesignBody,
): Validated<VoicesDesignBody, VoiceDesignSdkTargets<VoicesDesignBody>> {
  return toValidated(
    params,
    {
      url: VOICES_DESIGN_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { inworld: () => params } },
  );
}

const validator = createValidator<
  VoicesDesignBody,
  Validated<VoicesDesignBody, VoiceDesignSdkTargets<VoicesDesignBody>>
>({
  endpoint: "inworld.voiceDesign",
  schema,
  // No model field on this wire — the synthetic catalog id stands in so
  // catalog-keyed machinery stays coherent (see module JSDoc).
  modelId: () => VOICE_DESIGN_MODEL_ID,
  catalog: models,
  checks: [checkLanguageExclusivity, checkLangCodeEnum],
  finalize,
});

/**
 * Validates raw wire params for Inworld `POST /voices/v1/voices:design` —
 * voice design phase 1, which generates DRAFT preview voices from a text
 * description (a research preview; the schema may change).
 *
 * The result's enumerable properties are the exact fetch JSON body. Each
 * response preview carries a draft `voiceId`; pass one to
 * `inworld.voiceDesignPublish` (POST /voices/v1/voices/{voiceId}:publish) to
 * persist it in the voice library. Auth is your job: add an
 * `authorization: Basic <api_key>` header when fetching.
 */
export const voiceDesign = validator as unknown as {
  <T extends VoicesDesignBody>(
    params: T & ExactKeys<T, VoicesDesignBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, VoiceDesignSdkTargets<T>>;
  safe<T extends VoicesDesignBody>(
    params: T & ExactKeys<T, VoicesDesignBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, VoiceDesignSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
