/**
 * Speechify voice cloning — POST https://api.speechify.ai/v1/voices
 *
 * Wire reference: https://docs.speechify.ai/build/api-reference/v1/voices/post
 * and https://docs.speechify.ai/tts/text-to-speech/features/voice-cloning
 * (verified 2026-08-22).
 *
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated params (including the two Blobs) — the raw-fetch
 *   path is `.request.url` + `voiceCloneToFormData(params)` as the body;
 *   `.request.headers` is empty (fetch derives the multipart boundary).
 * - CONSENT IS ON THE WIRE, as a challenge/response ceremony: create a
 *   challenge first (`speechify.voiceConsentChallenge` in
 *   ./voice-consent-challenge), have the SPEAKER record themself reading the
 *   returned phrase, and send `consent_challenge_id` + that
 *   `consent_recording` here. The server transcribes the recording, checks
 *   it against the phrase, and verifies the speaker matches `sample` — a
 *   mismatch is a 422 and the single-use challenge is spent. The legacy
 *   declarative `consent` JSON (`{fullName, email}`) is deprecated ("removed
 *   after sunset window for callers pinned before
 *   `Speechify-Version: 2026-09-13`") and typed as such.
 * - `sample` is "10-30 seconds of clean speech" and the cloning guide caps
 *   it "Under 5MB"; `consent_recording` is "5-30 seconds, at most 25 MB, in
 *   any common audio container". Both byte caps are checked (Blob.size);
 *   durations cannot be read from bytes and are not.
 * - An `Idempotency-Key` header (≤255 chars) makes the POST safe to retry —
 *   a transport concern, added by you, not a form field.
 * - There is no model field. unmodel addresses the route through the
 *   synthetic catalog id `voice-clone`; the response's `models[]` lists
 *   which speech models serve the new voice.
 * - Auth is an `Authorization: Bearer <api key>` header — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";

export const VOICES_URL = "https://api.speechify.ai/v1/voices";

const VOICE_CLONE_DOCS = "https://docs.speechify.ai/build/api-reference/v1/voices/post";
const VOICE_CLONING_GUIDE =
  "https://docs.speechify.ai/tts/text-to-speech/features/voice-cloning";

/**
 * Synthetic catalog id for this route — POST /v1/voices has no model field,
 * and Speechify documents no mode name for it, so the id is the route noun.
 */
export const VOICE_CLONE_MODEL_ID = "voice-clone";

/** "Under 5MB" — the cloning guide's cap on `sample`. */
export const VOICE_CLONE_MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
/** "at most 25 MB" — the reference's cap on `consent_recording`. */
export const VOICE_CLONE_MAX_CONSENT_BYTES = 25 * 1024 * 1024;

/** Documented `gender` values — a REQUIRED field with a closed enum. */
export const VOICE_CLONE_GENDERS = ["male", "female", "not_specified"] as const;
export type SpeechifyVoiceGender = (typeof VOICE_CLONE_GENDERS)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly (snake_case).
// ---------------------------------------------------------------------------

export interface CreateVoiceParams {
  /** "Name of the personal voice." */
  name: string;
  /** REQUIRED, closed enum: "male", "female", "not_specified". */
  gender: SpeechifyVoiceGender | (string & {});
  /** The reference recording — "10-30 seconds of clean speech", under 5MB. */
  sample: Blob;
  /**
   * The single-use challenge id from
   * `POST /v1/voices/consent-challenges` (`speechify.voiceConsentChallenge`).
   */
  consent_challenge_id: string;
  /**
   * The speaker reading the challenge phrase — "5-30 seconds, at most 25 MB,
   * in any common audio container". Must be the same person as `sample`;
   * retained with the voice.
   */
  consent_recording: Blob;
  /** Native language locale (e.g. "en-US", "es-ES"). Default "en-US". */
  locale?: string;
  /** Avatar image file. */
  avatar?: Blob;
  /**
   * @deprecated The pre-challenge declarative consent — a JSON string
   * `{"fullName": …, "email": …}` — "removed after sunset window for callers
   * pinned before `Speechify-Version: 2026-09-13`". Use the
   * challenge/response pair instead.
   */
  consent?: string;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  name: z.string().min(1, "name must be a non-empty voice name"),
  gender: z.string(),
  sample: z.instanceof(Blob),
  consent_challenge_id: z
    .string()
    .min(1, "consent_challenge_id must come from POST /v1/voices/consent-challenges"),
  consent_recording: z.instanceof(Blob),
  locale: z.string().optional(),
  avatar: z.instanceof(Blob).optional(),
  consent: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const GENDER_SET = new Set<string>(VOICE_CLONE_GENDERS);

function checkGender(
  params: CreateVoiceParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const gender = params.gender;
  if (typeof gender !== "string" || GENDER_SET.has(gender)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["gender"],
    message: `\`gender\` must be one of ${VOICE_CLONE_GENDERS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(gender)}.`,
    meta: { allowed: [...VOICE_CLONE_GENDERS], value: gender, source: VOICE_CLONE_DOCS },
  });
}

function checkUploadSizes(
  params: CreateVoiceParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.sample instanceof Blob && params.sample.size > VOICE_CLONE_MAX_SAMPLE_BYTES) {
    ctx.report({
      code: "media_too_large",
      path: ["sample"],
      message: `\`sample\` is ${params.sample.size} bytes; the cloning guide caps the sample at ${VOICE_CLONE_MAX_SAMPLE_BYTES} bytes (5MB).`,
      meta: {
        bytes: params.sample.size,
        limit: VOICE_CLONE_MAX_SAMPLE_BYTES,
        source: VOICE_CLONING_GUIDE,
      },
    });
  }
  if (
    params.consent_recording instanceof Blob &&
    params.consent_recording.size > VOICE_CLONE_MAX_CONSENT_BYTES
  ) {
    ctx.report({
      code: "media_too_large",
      path: ["consent_recording"],
      message: `\`consent_recording\` is ${params.consent_recording.size} bytes; Speechify caps it at ${VOICE_CLONE_MAX_CONSENT_BYTES} bytes (25 MB).`,
      meta: {
        bytes: params.consent_recording.size,
        limit: VOICE_CLONE_MAX_CONSENT_BYTES,
        source: VOICE_CLONE_DOCS,
      },
    });
  }
}

/** The deprecated declarative consent — a warning naming its replacement. */
function checkDeprecatedConsent(
  params: CreateVoiceParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.consent === undefined) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["consent"],
    message:
      "`consent` (the declarative JSON string) is deprecated and scheduled for removal; use the `consent_challenge_id` + `consent_recording` challenge/response pair instead.",
    meta: { source: VOICE_CLONE_DOCS },
  });
}

// No estimate: docs.speechify.ai publishes no per-request rate for voice
// creation.

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/**
 * Builds the multipart/form-data body for `POST /v1/voices` from validated
 * params. The Blobs (`sample`, `consent_recording`, `avatar`) are file
 * parts; the rest are string parts.
 *
 * ```ts
 * const params = speechify.voiceClone({
 *   name: "My Voice", gender: "female", sample,
 *   consent_challenge_id: challenge.id, consent_recording: recording,
 * });
 * await fetch(params.request.url, {
 *   method: "POST",
 *   headers: { authorization: `Bearer ${process.env.SPEECHIFY_API_KEY!}` },
 *   body: speechify.voiceCloneToFormData(params),
 * });
 * ```
 */
export function voiceCloneToFormData(params: CreateVoiceParams): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value instanceof Blob) form.append(key, value);
    else form.append(key, String(value));
  }
  return form;
}

/**
 * SDK targets for `speechify.voiceClone`. `@speechify/api`'s
 * `client.tts.voices.create(request)` takes the same wire-shaped fields, so
 * the single `"speechify"` formatter is the identity. Type alias, not
 * interface: an interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type VoiceCloneSdkTargets<B> = { speechify: () => B };

function finalize(
  params: CreateVoiceParams,
): ValidatedForm<CreateVoiceParams, VoiceCloneSdkTargets<CreateVoiceParams>> {
  return toValidated(
    params,
    {
      url: VOICES_URL,
      method: "POST",
      // Deliberately NOT application/json: this is a multipart endpoint, and
      // fetch must derive the multipart boundary from the FormData body itself.
      headers: {},
      body: "form",
    },
    { sdk: { speechify: () => params } },
  );
}

const validator = createValidator<
  CreateVoiceParams,
  ValidatedForm<CreateVoiceParams, VoiceCloneSdkTargets<CreateVoiceParams>>
>({
  endpoint: "speechify.voiceClone",
  schema,
  // No model field on this wire — the synthetic catalog id stands in so
  // catalog-keyed machinery stays coherent (see module JSDoc).
  modelId: () => VOICE_CLONE_MODEL_ID,
  catalog: models,
  checks: [checkGender, checkUploadSizes, checkDeprecatedConsent],
  finalize,
});

/**
 * Validates params for Speechify `POST /v1/voices` (personal voice cloning
 * with the challenge/response consent ceremony).
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the `sample` and `consent_recording`
 * Blobs), and the raw-fetch path is `.request.url` +
 * `voiceCloneToFormData(validated)` — never `JSON.stringify`. A consent
 * mismatch is a 422 and spends the single-use challenge; start over with a
 * fresh `speechify.voiceConsentChallenge`. Auth is your job: add an
 * `authorization: Bearer …` header (and optionally an `Idempotency-Key`)
 * when fetching.
 */
export const voiceClone = validator as unknown as {
  <T extends CreateVoiceParams>(
    params: T & ExactKeys<T, CreateVoiceParams>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, VoiceCloneSdkTargets<T>>;
  safe<T extends CreateVoiceParams>(
    params: T & ExactKeys<T, CreateVoiceParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, VoiceCloneSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
