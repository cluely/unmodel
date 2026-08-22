/**
 * ElevenLabs create-voice-from-preview — POST https://api.elevenlabs.io/v1/text-to-voice
 *
 * Wire notes (verified against
 * https://elevenlabs.io/docs/api-reference/text-to-voice/create and the
 * Fern-generated types in elevenlabs/elevenlabs-js on 2026-08-22):
 * - This is phase 2 of voice design: it turns a `generated_voice_id` from
 *   POST /v1/text-to-voice/design (the `voiceDesign` validator), from the
 *   remix endpoint, or from the response headers when streaming previews,
 *   into a persisted voice. It is deliberately wire-only — no unified
 *   `unmodel/voice-design` adapter compiles to it, because the correlating
 *   handle is provider-minted and differently shaped at every provider.
 * - No model field, no published USD rate — no catalog gating, no estimate.
 * - `labels` here is open metadata ("Optional, metadata to add to the created
 *   voice") — unlike Instant Voice Cloning's four documented keys, no key
 *   space is published, so none is enforced.
 * - The response is the full Voice object (`voice_id`, `category`,
 *   `settings`, `sharing`, …).
 * - Auth is an `xi-api-key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";

export const TEXT_TO_VOICE_URL = "https://api.elevenlabs.io/v1/text-to-voice";

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

export interface CreateVoiceFromPreviewParams {
  /** "Name to use for the created voice." */
  voice_name: string;
  /** "Description to use for the created voice." */
  voice_description: string;
  /**
   * "The generated_voice_id to create" — from POST /v1/text-to-voice/design,
   * from POST /v1/text-to-voice/{voice_id}/remix, or from the response
   * headers when streaming previews.
   */
  generated_voice_id: string;
  /** "Optional, metadata to add to the created voice." Open key space. */
  labels?: Record<string, string> | null;
  /**
   * "List of voice ids that the user has played but not selected. Used for
   * RLHF."
   */
  played_not_selected_voice_ids?: string[] | null;
}

// ---------------------------------------------------------------------------
// SDK view — @elevenlabs/elevenlabs-js's client.textToVoice.create(request)
// takes the same fields camelCased.
// ---------------------------------------------------------------------------

export interface CreateVoiceFromPreviewSdkParams {
  voiceName: string;
  voiceDescription: string;
  generatedVoiceId: string;
  labels?: Record<string, string>;
  playedNotSelectedVoiceIds?: string[];
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const createVoiceFromPreviewSchema = z.looseObject({
  voice_name: z.string().min(1, "voice_name must be a non-empty voice name"),
  voice_description: z.string().min(1, "voice_description must be a non-empty description"),
  generated_voice_id: z
    .string()
    .min(1, "generated_voice_id must be a preview id from POST /v1/text-to-voice/design"),
  labels: z.record(z.string(), z.string()).nullable().optional(),
  played_not_selected_voice_ids: z.array(z.string()).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Finalize: wire body + .toSdk("elevenlabs") + .request
// ---------------------------------------------------------------------------

/** Wire snake_case → SDK camelCase. */
const SDK_KEY_MAP: Record<string, string> = {
  voice_name: "voiceName",
  voice_description: "voiceDescription",
  generated_voice_id: "generatedVoiceId",
  labels: "labels",
  played_not_selected_voice_ids: "playedNotSelectedVoiceIds",
};

function buildSdkParams(params: CreateVoiceFromPreviewParams): CreateVoiceFromPreviewSdkParams {
  const request: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue; // null → omitted for the SDK
    request[SDK_KEY_MAP[key] ?? key] = value; // unknown params pass through unchanged
  }
  return request as unknown as CreateVoiceFromPreviewSdkParams;
}

/**
 * SDK targets for `elevenlabs.voiceDesignSave`. `"elevenlabs"` camelCases the
 * wire body into the request object `@elevenlabs/elevenlabs-js`'s
 * `client.textToVoice.create(request)` takes. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type VoiceDesignSaveSdkTargets = { elevenlabs: () => CreateVoiceFromPreviewSdkParams };

function finalize(params: CreateVoiceFromPreviewParams): unknown {
  return toValidated(
    params,
    {
      url: TEXT_TO_VOICE_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { elevenlabs: () => buildSdkParams(params) } },
  );
}

const validator = createValidator<CreateVoiceFromPreviewParams, unknown>({
  endpoint: "elevenlabs.voiceDesignSave",
  schema: createVoiceFromPreviewSchema,
  // No model concept on this wire at all — catalog-keyed checks are skipped.
  modelId: () => undefined,
  catalog: models,
  finalize,
});

/**
 * Validates raw wire params for ElevenLabs `POST /v1/text-to-voice` — voice
 * design phase 2, which persists a preview (`generated_voice_id` from
 * `elevenlabs.voiceDesign`) as a real voice and returns the full Voice
 * object.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("elevenlabs")` returns the camelCase request object for
 * `@elevenlabs/elevenlabs-js`'s `client.textToVoice.create(request)`. Auth is
 * your job: add an `xi-api-key` header when fetching.
 */
export const voiceDesignSave = validator as unknown as {
  <T extends CreateVoiceFromPreviewParams>(
    params: T & ExactKeys<T, CreateVoiceFromPreviewParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, VoiceDesignSaveSdkTargets>;
  safe<T extends CreateVoiceFromPreviewParams>(
    params: T & ExactKeys<T, CreateVoiceFromPreviewParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, VoiceDesignSaveSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
