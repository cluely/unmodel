/**
 * Luma Dream Machine Add Audio —
 * POST https://api.lumalabs.ai/dream-machine/v1/generations/{id}/audio
 *
 * Wire notes (verified against the OpenAPI definition embedded in
 * https://docs.lumalabs.ai/reference/addaudiotogeneration on 2026-08-13):
 * - Generates and attaches an audio track to an existing video generation.
 *   `id` is a URL path param, so it rides in the params object and is
 *   stripped from the JSON body (it lives in `.request.url`).
 * - `prompt` describes the audio to generate; `negative_prompt` describes what
 *   to keep out. Neither is marked required — the spec's request object has no
 *   `required` list at all.
 * - The body carries no `model` or duration: the audio follows the source
 *   generation, so no model-dependent checks apply.
 * - Async job API: poll GET /generations/{id} or use `callback_url`.
 * - Auth is `Authorization: Bearer <LUMAAI_API_KEY>` — unmodel never touches
 *   keys; add the header yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { videoModels } from "./models";
import { DREAM_MACHINE_BASE_URL } from "./shared";

/** `POST /generations/{id}/audio` for a generation id. */
export function addAudioUrl(generationId: string): string {
  return `${DREAM_MACHINE_BASE_URL}/generations/${encodeURIComponent(generationId)}/audio`;
}

export interface AddAudioParams {
  /** The generation to add audio to — a URL path param, not a body field. */
  id: string;
  /** Describes the audio to generate. */
  prompt?: string;
  /** Describes what to keep out of the generated audio. */
  negative_prompt?: string;
  /** POSTed a generation object when the job progresses. */
  callback_url?: string;
  /** Defaults to "add_audio" server-side. */
  generation_type?: "add_audio";
}

const videoAddAudioSchema = z.looseObject({
  id: z.string().min(1, "id must be a non-empty generation id"),
  prompt: z.string().optional(),
  negative_prompt: z.string().optional(),
  callback_url: z.string().optional(),
  generation_type: z.literal("add_audio").optional(),
});

/**
 * The one `.toSdk("luma")` target for this endpoint — the `lumaai` SDK takes
 * wire-shaped params. Derived from the `sdk` literal in `finalize`; it must
 * stay an object type with no index signature, or `toSdk` would accept any
 * string.
 */
type LumaSdkTargets<B> = { luma: () => B };

function finalize(params: AddAudioParams): unknown {
  const { id, ...body } = params;
  return toValidated(body, {
    url: addAudioUrl(id),
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { luma: () => body },
  });
}

const validator = createValidator<AddAudioParams, unknown>({
  endpoint: "luma.videoAddAudio",
  schema: videoAddAudioSchema,
  // No `model` on the wire: the source generation determines the model.
  modelId: () => undefined,
  catalog: videoModels,
  finalize,
});

/**
 * Validates raw wire params for Luma Dream Machine
 * `POST /dream-machine/v1/generations/{id}/audio`.
 *
 * The returned object's enumerable props are the exact fetch JSON body — `id`
 * is stripped and lives in `.request.url`.
 *
 * ```ts
 * const params = luma.videoAddAudio({
 *   id: "123e4567-e89b-12d3-a456-426614174000",
 *   prompt: "distant thunder and rain on pavement",
 *   negative_prompt: "music",
 * });
 * ```
 */
export const videoAddAudio = validator as unknown as {
  <T extends AddAudioParams>(
    params: T & ExactKeys<T, AddAudioParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "id">, LumaSdkTargets<Omit<T, "id">>>;
  safe<T extends AddAudioParams>(
    params: T & ExactKeys<T, AddAudioParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "id">, LumaSdkTargets<Omit<T, "id">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
