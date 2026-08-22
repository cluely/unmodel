/**
 * Inworld publish draft voice —
 * POST https://api.inworld.ai/voices/v1/voices/{voiceId}:publish
 *
 * Wire reference:
 * https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/publish-voice
 * (verified 2026-08-22).
 *
 * - This is phase 2 of voice design: it persists a DRAFT voice from
 *   POST voices:design (the `voiceDesign` validator) into the voice library.
 *   It is deliberately wire-only — no unified `unmodel/voice-design` adapter
 *   compiles to it, because the correlating handle is provider-minted and
 *   differently shaped at every provider.
 * - `voiceId` is a URL path param ("Voice ID of the draft voice to publish.
 *   Expected format: `{workspace}__{voice}`"): it rides in the params object
 *   for ergonomics but is STRIPPED from the wire body and interpolated into
 *   `.request.url`.
 * - The reference marks `displayName`, `description` and `tags` required,
 *   but describes `tags` as "Optional labels for filtering and discovery" —
 *   the prose wins for `tags` (typed optional); the two names stay required.
 * - No model field, no published rate — no catalog gating, no estimate.
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

export const VOICES_PUBLISH_BASE_URL = "https://api.inworld.ai/voices/v1/voices";

/** Endpoint URL for a draft voice id. */
export function voiceDesignPublishUrl(voiceId: string): string {
  return `${VOICES_PUBLISH_BASE_URL}/${encodeURIComponent(voiceId)}:publish`;
}

// ---------------------------------------------------------------------------
// Wire types — mirror the PublishVoiceRequest fields exactly (camelCase).
// ---------------------------------------------------------------------------

export interface VoicesPublishBody {
  /**
   * URL path param — stripped from the wire body; `.request.url` is
   * `${VOICES_PUBLISH_BASE_URL}/{voiceId}:publish`. "Voice ID of the draft
   * voice to publish. Expected format: `{workspace}__{voice}`."
   */
  voiceId: string;
  /** "The name of the voice shown in your voice library." */
  displayName: string;
  /** "Description of the voice." */
  description: string;
  /** "Optional labels for filtering and discovery (e.g., 'demo', 'custom')." */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  voiceId: z.string().min(1, "voiceId must be a draft voice id from POST voices:design"),
  displayName: z.string().min(1, "displayName must be a non-empty voice name"),
  description: z.string().min(1, "description must be a non-empty description"),
  tags: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Finalize — voiceId stripped to the URL path; `.toSdk("inworld")` is the
// identity (no official JS SDK for the voice API).
// ---------------------------------------------------------------------------

type PublishWireBody = Omit<VoicesPublishBody, "voiceId">;

type VoiceDesignPublishSdkTargets<B> = { inworld: () => B };

function finalize(
  params: VoicesPublishBody,
): Validated<PublishWireBody, VoiceDesignPublishSdkTargets<PublishWireBody>> {
  const { voiceId, ...body } = params;
  return toValidated(
    body,
    {
      url: voiceDesignPublishUrl(voiceId),
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { inworld: () => body } },
  );
}

const validator = createValidator<
  VoicesPublishBody,
  Validated<PublishWireBody, VoiceDesignPublishSdkTargets<PublishWireBody>>
>({
  endpoint: "inworld.voiceDesignPublish",
  schema,
  // No model concept on this wire at all — catalog-keyed checks are skipped.
  modelId: () => undefined,
  catalog: models,
  finalize,
});

/**
 * Validates raw wire params for Inworld
 * `POST /voices/v1/voices/{voiceId}:publish` — voice design phase 2, which
 * persists a draft voice from `inworld.voiceDesign` into the voice library
 * and returns the full Voice object.
 *
 * The result's enumerable properties are the exact fetch JSON body —
 * `voiceId` (path param) is stripped and lives in `.request.url` instead.
 * Auth is your job: add an `authorization: Basic <api_key>` header when
 * fetching.
 */
export const voiceDesignPublish = validator as unknown as {
  <T extends VoicesPublishBody>(
    params: T & ExactKeys<T, VoicesPublishBody>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "voiceId">, VoiceDesignPublishSdkTargets<Omit<T, "voiceId">>>;
  safe<T extends VoicesPublishBody>(
    params: T & ExactKeys<T, VoicesPublishBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<Omit<T, "voiceId">, VoiceDesignPublishSdkTargets<Omit<T, "voiceId">>>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};
