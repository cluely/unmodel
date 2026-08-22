/**
 * Speechify consent challenge — POST https://api.speechify.ai/v1/voices/consent-challenges
 *
 * Wire reference:
 * https://docs.speechify.ai/tts/text-to-speech/features/voice-cloning
 * (verified 2026-08-22).
 *
 * - This is the prerequisite of the voice-cloning consent ceremony: it
 *   returns `{ id, phrase, expires_at }`, the speaker records themself
 *   reading `phrase`, and `POST /v1/voices` (the `voiceClone` validator in
 *   ./voice-clone) takes the challenge `id` plus that recording.
 * - "The challenge is single use and short-lived, so create it when your
 *   speaker is ready to record rather than the start of your flow" — and "if
 *   an attempt is refused, that challenge is gone, so the retry begins with
 *   a new one."
 * - No model field, no published rate — no catalog gating, no estimate.
 * - Auth is an `Authorization: Bearer <api key>` header — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";

export const VOICES_CONSENT_CHALLENGES_URL =
  "https://api.speechify.ai/v1/voices/consent-challenges";

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

export interface ConsentChallengeParams {
  /** The speaker's legal name, matched against the consent recording. */
  full_name: string;
}

const schema = z.looseObject({
  full_name: z.string().min(1, "full_name must be the speaker's name"),
});

// ---------------------------------------------------------------------------
// Finalize — plain JSON body; `.toSdk("speechify")` is the identity
// (@speechify/api takes wire-shaped params).
// ---------------------------------------------------------------------------

type ConsentChallengeSdkTargets<B> = { speechify: () => B };

function finalize(
  params: ConsentChallengeParams,
): Validated<ConsentChallengeParams, ConsentChallengeSdkTargets<ConsentChallengeParams>> {
  return toValidated(
    params,
    { url: VOICES_CONSENT_CHALLENGES_URL, method: "POST", headers: JSON_HEADERS },
    { sdk: { speechify: () => params } },
  );
}

const validator = createValidator<
  ConsentChallengeParams,
  Validated<ConsentChallengeParams, ConsentChallengeSdkTargets<ConsentChallengeParams>>
>({
  endpoint: "speechify.voiceConsentChallenge",
  schema,
  // No model concept on this wire at all — catalog-keyed checks are skipped.
  modelId: () => undefined,
  catalog: models,
  finalize,
});

/**
 * Validates raw wire params for Speechify
 * `POST /v1/voices/consent-challenges` — the single-use, short-lived consent
 * challenge whose `id` and recorded `phrase` feed `speechify.voiceClone`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * Auth is your job: add an `authorization: Bearer …` header when fetching.
 */
export const voiceConsentChallenge = validator as unknown as {
  <T extends ConsentChallengeParams>(
    params: T & ExactKeys<T, ConsentChallengeParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, ConsentChallengeSdkTargets<T>>;
  safe<T extends ConsentChallengeParams>(
    params: T & ExactKeys<T, ConsentChallengeParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, ConsentChallengeSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
