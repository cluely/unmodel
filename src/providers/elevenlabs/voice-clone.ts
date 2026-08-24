/**
 * ElevenLabs Instant Voice Cloning — POST https://api.elevenlabs.io/v1/voices/add
 *
 * Wire notes (verified against
 * https://elevenlabs.io/docs/api-reference/voices/ivc/create and the
 * Fern-generated types in elevenlabs/elevenlabs-js on 2026-08-22):
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated params (including the `files` Blobs) — do NOT
 *   JSON.stringify them. The raw-fetch path is `.request.url` +
 *   `voiceCloneToFormData(params)` as the body; fetch derives the multipart
 *   content-type (with boundary) from the FormData, which is why
 *   `.request.headers` is empty.
 * - There is no model field on this wire. unmodel addresses the route through
 *   the synthetic catalog id `ivc` — the documented product mode (Instant
 *   Voice Cloning) — which also reserves `pvc` for the separate four-step
 *   Professional Voice Cloning flow (POST /v1/voices/pvc, then /samples,
 *   /verification, /train), which unmodel does not validate.
 * - `labels` is a string→string map whose documented key space is closed:
 *   "Keys can be language, accent, gender, or age." Serialized as one
 *   JSON-string form part, matching the official SDK.
 * - Neither the API reference nor the SDK caps `files` count or byte size, so
 *   unmodel enforces no cap — only that at least one recording is present.
 * - The response is `{ voice_id, requires_verification }` — the created
 *   voice's id, usable as `voice_id` on the text-to-speech endpoints.
 * - Auth is an `xi-api-key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";

export const VOICES_ADD_URL = "https://api.elevenlabs.io/v1/voices/add";

const VOICE_CLONE_DOCS_URL = "https://elevenlabs.io/docs/api-reference/voices/ivc/create";

/**
 * Synthetic catalog id for this route — POST /v1/voices/add has no model
 * field, and the id names the documented mode (Instant Voice Cloning).
 */
export const VOICE_CLONE_MODEL_ID = "ivc";

/**
 * The documented `labels` key space — "Keys can be language, accent, gender,
 * or age." (VOICE_CLONE_DOCS_URL). Closed: the reference enumerates exactly
 * these four.
 */
export const VOICE_CLONE_LABEL_KEYS = ["language", "accent", "gender", "age"] as const;

export type ElevenlabsVoiceCloneLabelKey = (typeof VOICE_CLONE_LABEL_KEYS)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly (snake_case).
// ---------------------------------------------------------------------------

export interface VoicesAddParams {
  /** "The name that identifies this voice." */
  name: string;
  /**
   * The audio recordings to clone from, one form part per file. The docs
   * publish no count or size cap; at least one is required.
   */
  files: Blob[];
  /** "A description of the voice." */
  description?: string | null;
  /**
   * Voice metadata; documented keys are exactly "language", "accent",
   * "gender", "age". Sent as one JSON-string form part (SDK serialization).
   */
  labels?: Partial<Record<ElevenlabsVoiceCloneLabelKey, string>> | null;
  /**
   * "If set will remove background noise for voice samples using our audio
   * isolation model. If the samples do not include background noise, it can
   * make the quality worse."
   */
  remove_background_noise?: boolean;
}

// ---------------------------------------------------------------------------
// SDK view — @elevenlabs/elevenlabs-js's client.voices.ivc.create(request)
// takes the same fields camelCased.
// ---------------------------------------------------------------------------

export interface VoicesAddSdkParams {
  name: string;
  files: Blob[];
  description?: string;
  labels?: Partial<Record<ElevenlabsVoiceCloneLabelKey, string>>;
  removeBackgroundNoise?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const voicesAddSchema = z.looseObject({
  name: z.string().min(1, "name must be a non-empty voice name"),
  files: z
    .array(z.instanceof(Blob))
    .min(1, "at least one audio recording is required to clone a voice"),
  description: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).nullable().optional(),
  remove_background_noise: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const LABEL_KEY_SET = new Set<string>(VOICE_CLONE_LABEL_KEYS);

/**
 * The `labels` key space is a documented closed enumeration (see module
 * JSDoc); the record schema cannot express it because the VALUES are free
 * strings, only the keys are constrained.
 */
function checkLabelKeys(
  params: VoicesAddParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const labels = params.labels;
  if (labels == null) return;
  for (const key of Object.keys(labels)) {
    if (LABEL_KEY_SET.has(key)) continue;
    ctx.report({
      code: "invalid_enum_value",
      path: ["labels", key],
      message: `\`labels\` keys can be ${VOICE_CLONE_LABEL_KEYS.map((k) => JSON.stringify(k)).join(", ")}; got ${JSON.stringify(key)}.`,
      meta: { allowed: [...VOICE_CLONE_LABEL_KEYS], value: key, source: VOICE_CLONE_DOCS_URL },
    });
  }
}

// No estimate: elevenlabs.io/pricing/api publishes no per-request USD rate for
// voice cloning (it is bundled into subscription voice slots).

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/**
 * Builds the multipart/form-data body for `POST /v1/voices/add` from validated
 * params. Encoding matches the official SDK's serialization: each `files`
 * entry is its own `files` part, `labels` becomes one JSON-string part, and
 * booleans are stringified. Null/undefined fields are omitted.
 *
 * ```ts
 * const params = elevenlabs.voiceClone({ name: "Narrator", files: [blob] });
 * await fetch(params.request.url, {
 *   method: "POST",
 *   headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 *   body: elevenlabs.voiceCloneToFormData(params),
 * });
 * ```
 */
export function voiceCloneToFormData(params: VoicesAddParams): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (key === "files") {
      for (const file of value as Blob[]) form.append("files", file);
      continue;
    }
    if (key === "labels" && typeof value === "object") {
      form.append("labels", JSON.stringify(value));
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/** Wire snake_case → SDK camelCase. */
const SDK_KEY_MAP: Record<string, string> = {
  name: "name",
  files: "files",
  description: "description",
  labels: "labels",
  remove_background_noise: "removeBackgroundNoise",
};

function buildSdkParams(params: VoicesAddParams): VoicesAddSdkParams {
  const sdk: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue; // null → omitted for the SDK
    sdk[SDK_KEY_MAP[key] ?? key] = value; // unknown params pass through unchanged
  }
  return sdk as unknown as VoicesAddSdkParams;
}

/**
 * SDK targets for `elevenlabs.voiceClone`. `"elevenlabs"` camelCases the wire
 * fields into the request object `@elevenlabs/elevenlabs-js`'s
 * `client.voices.ivc.create(request)` takes. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type VoiceCloneSdkTargets = { elevenlabs: () => VoicesAddSdkParams };

function finalize(params: VoicesAddParams): unknown {
  return toValidated(
    params,
    {
      url: VOICES_ADD_URL,
      method: "POST",
      // Deliberately NOT application/json: this is a multipart endpoint, and
      // fetch must derive the multipart boundary from the FormData body itself.
      headers: {},
      body: "form",
    },
    { sdk: { elevenlabs: () => buildSdkParams(params) } },
  );
}

const validator = createValidator<VoicesAddParams, unknown>({
  endpoint: "elevenlabs.voiceClone",
  schema: voicesAddSchema,
  // No model field on this wire — the synthetic catalog id stands in so
  // catalog-keyed machinery stays coherent (see module JSDoc).
  modelId: () => VOICE_CLONE_MODEL_ID,
  catalog: models,
  checks: [checkLabelKeys],
  finalize,
});

/**
 * Validates params for ElevenLabs `POST /v1/voices/add` (Instant Voice
 * Cloning — the Professional Voice Cloning flow is a different, four-step API
 * that unmodel does not validate).
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the `files` Blobs), and the raw-fetch path
 * is `.request.url` + `voiceCloneToFormData(validated)` as the body — never
 * `JSON.stringify`. `.toSdk("elevenlabs")` returns the camelCase request
 * object for `@elevenlabs/elevenlabs-js`'s `client.voices.ivc.create(request)`.
 * The response carries the new `voice_id` (plus `requires_verification`).
 */
export const voiceClone = validator as unknown as {
  <T extends VoicesAddParams>(
    params: T & ExactKeys<T, VoicesAddParams>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, VoiceCloneSdkTargets>;
  safe<T extends VoicesAddParams>(
    params: T & ExactKeys<T, VoicesAddParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, VoiceCloneSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
