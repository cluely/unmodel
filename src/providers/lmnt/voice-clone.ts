/**
 * LMNT voice cloning — POST https://api.lmnt.com/v1/ai/voice
 *
 * Wire reference: https://docs.lmnt.com/api-reference/voice/create-voice
 * (verified 2026-08-22, `lmnt-version: 1.2`).
 *
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated params (including the `file` Blob) — the
 *   raw-fetch path is `.request.url` + `voiceCloneToFormData(params)` as the
 *   body. `.request.headers` carries ONLY the static `lmnt-version` header
 *   (fetch derives the multipart boundary from the FormData).
 * - CURRENT SHAPE ONLY: the pre-1.2 API took a `files[]` list plus a
 *   `metadata` JSON blob with `enhance` and `type: instant|professional`.
 *   None of that survives in 1.2 — the form is flat, takes exactly one
 *   `file`, and `type` is response-only. The old shape is deliberately not
 *   typed.
 * - `gender` is "a tag describing the gender of this voice. Has no effect on
 *   voice creation" — free-form metadata, no enum.
 * - There is no model field. unmodel addresses the route through the
 *   synthetic catalog id `voice-clone` (the route noun); the voice is later
 *   used with the `blizzard` speech model via the `voice` field.
 * - The response carries the created voice's `id` (plus `state`,
 *   `preview_url`, and the response-only `type`).
 * - Auth is an `X-API-Key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";

export const AI_VOICE_URL = "https://api.lmnt.com/v1/ai/voice";

/**
 * REQUIRED static `lmnt-version` header value — the version whose schema
 * this module mirrors. Carried in `.request.headers`.
 */
export const VOICE_CLONE_LMNT_VERSION = "1.2";

/**
 * Synthetic catalog id for this route — POST /v1/ai/voice has no model
 * field, and LMNT documents no mode name in 1.2 (`type` is response-only),
 * so the id is the route noun.
 */
export const VOICE_CLONE_MODEL_ID = "voice-clone";

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly.
// ---------------------------------------------------------------------------

export interface AiVoiceParams {
  /**
   * "The input audio file to train the voice with, as a binary `wav`,
   * `mp3`, `mp4`, `m4a`, or `webm` attachment." Exactly one.
   */
  file: Blob;
  /** "The display name for this voice." */
  name: string;
  /** "A text description of this voice." */
  description?: string;
  /**
   * "A tag describing the gender of this voice. Has no effect on voice
   * creation." Free-form — no enum is documented.
   */
  gender?: string;
  /** "A list of tags to attach to this voice." */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  file: z.instanceof(Blob),
  name: z.string().min(1, "name must be a non-empty voice name"),
  description: z.string().optional(),
  gender: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// No estimate: lmnt.com publishes no rate for voice creation (usage of the
// resulting voice is billed per character through ./tts).

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/**
 * Builds the multipart/form-data body for `POST /v1/ai/voice` from validated
 * params. `file` is the file part, `tags` repeats per item, the rest are
 * string parts.
 *
 * ```ts
 * const params = lmnt.voiceClone({ file: blob, name: "Narrator" });
 * await fetch(params.request.url, {
 *   method: "POST",
 *   headers: { ...params.request.headers, "X-API-Key": process.env.LMNT_API_KEY! },
 *   body: lmnt.voiceCloneToFormData(params),
 * });
 * ```
 */
export function voiceCloneToFormData(params: AiVoiceParams): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value instanceof Blob) {
      form.append(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/**
 * SDK targets for `lmnt.voiceClone`. The `lmnt` SDK's
 * `client.voices.create(request)` takes the same wire-shaped fields, so the
 * single `"lmnt"` formatter is the identity. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type VoiceCloneSdkTargets<B> = { lmnt: () => B };

function finalize(
  params: AiVoiceParams,
): Validated<AiVoiceParams, VoiceCloneSdkTargets<AiVoiceParams>> {
  return toValidated(
    params,
    {
      url: AI_VOICE_URL,
      method: "POST",
      // Multipart: no content-type (fetch derives the boundary), but the
      // static version header rides along.
      headers: { "lmnt-version": VOICE_CLONE_LMNT_VERSION },
    },
    { sdk: { lmnt: () => params } },
  );
}

const validator = createValidator<
  AiVoiceParams,
  Validated<AiVoiceParams, VoiceCloneSdkTargets<AiVoiceParams>>
>({
  endpoint: "lmnt.voiceClone",
  schema,
  // No model field on this wire — the synthetic catalog id stands in so
  // catalog-keyed machinery stays coherent (see module JSDoc).
  modelId: () => VOICE_CLONE_MODEL_ID,
  catalog: models,
  finalize,
});

/**
 * Validates params for LMNT `POST /v1/ai/voice` (voice cloning from a single
 * recording).
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the `file` Blob), and the raw-fetch path is
 * `.request.url` + `voiceCloneToFormData(validated)` with the `lmnt-version`
 * header from `.request.headers` — never `JSON.stringify`. The response
 * carries the created voice's `id`, usable as `voice` on the speech
 * endpoints. Auth is your job: add an `X-API-Key` header when fetching.
 */
export const voiceClone = validator as unknown as {
  <T extends AiVoiceParams>(
    params: T & ExactKeys<T, AiVoiceParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, VoiceCloneSdkTargets<T>>;
  safe<T extends AiVoiceParams>(
    params: T & ExactKeys<T, AiVoiceParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, VoiceCloneSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
