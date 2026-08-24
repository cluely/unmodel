/**
 * Fish Audio create model (voice cloning) — POST https://api.fish.audio/model
 *
 * Wire reference:
 * https://docs.fish.audio/api-reference/endpoint/model/create-model and the
 * OpenAPI schema at github.com/fishaudio/docs `api-reference/openapi.json`
 * (`paths./model.post`), verified 2026-08-22.
 *
 * - The OpenAPI spec advertises four content types (JSON, urlencoded,
 *   multipart, msgpack) over one schema, but `voices` and `cover_image` are
 *   `format: binary` — multipart/form-data is the transport that can carry
 *   them, and `voiceCloneToFormData` builds it. `.request.headers` is empty
 *   so fetch derives the multipart boundary from the FormData body.
 * - `type` and `train_mode` are REQUIRED consts on the wire (`"tts"`,
 *   `"fast"` — "fast means model instantly available after creation"). They
 *   are spelled out in the params because wire-exact means the body you send
 *   is the body that was validated.
 * - There is no model field. unmodel addresses the route through the
 *   synthetic catalog id `fast` — the documented train mode — so a future
 *   full-training mode is a new id, not a param.
 * - VISIBILITY FOOTGUN: `visibility` defaults to **"public"**, which "will be
 *   shown in the discovery page". An omitted `visibility` is therefore
 *   flagged with a warning naming the default; `"private"` keeps the cloned
 *   voice to the creator. `cover_image` is "required if the model is public".
 * - The response is the created model document; its `_id` is the voice id —
 *   the value `reference_id` takes on POST /v1/tts.
 * - Pricing: docs.fish.audio publishes no rate for model creation, so there
 *   is no cost estimate.
 * - Auth is an `Authorization: Bearer <token>` header — unmodel never
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

export const CREATE_MODEL_URL = "https://api.fish.audio/model";

const CREATE_MODEL_DOCS = "https://docs.fish.audio/api-reference/endpoint/model/create-model";

/**
 * Synthetic catalog id for this route — POST /model has no model field, and
 * the id names the documented (and only) train mode.
 */
export const VOICE_CLONE_MODEL_ID = "fast";

/** "Upload voices files that will be used to tune the model" — 1 to 20. */
export const VOICE_CLONE_MAX_VOICES = 20;
/** `texts` parallels `voices` and shares its cap. */
export const VOICE_CLONE_MAX_TEXTS = 20;

/** Documented `visibility` values; default "public" (see module JSDoc). */
export const VOICE_CLONE_VISIBILITIES = ["public", "unlist", "private"] as const;
export type FishAudioVisibility = (typeof VOICE_CLONE_VISIBILITIES)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the CreateModel form fields exactly (snake_case).
// ---------------------------------------------------------------------------

export interface CreateModelParams {
  /** REQUIRED const — "Model type, tts is for text to speech". */
  type: "tts";
  /** "Model title or name". */
  title: string;
  /**
   * REQUIRED const — "for TTS model, fast means model instantly available
   * after creation".
   */
  train_mode: "fast";
  /**
   * The reference recordings "that will be used to tune the model" — a
   * single file or an array of 1–20. Each is its own `voices` form part.
   */
  voices: Blob | Blob[];
  /**
   * "Texts corresponding to the voices, if unspecified, ASR will be
   * performed on the voices." Single string or array of ≤20.
   */
  texts?: string | string[] | null;
  /**
   * "public will be shown in the discovery page, unlist allows anyone with
   * the link to access, private only be visible to the creator." DEFAULTS TO
   * "public" — omitting it is flagged (see module JSDoc).
   */
  visibility?: FishAudioVisibility;
  /** "Model description". */
  description?: string | null;
  /** "Model cover image, this is required if the model is public." */
  cover_image?: Blob | null;
  /** "Model tags" — single string or array. */
  tags?: string | string[] | null;
  /** "Enhance audio quality". Default true. */
  enhance_audio_quality?: boolean;
  /** "Generate default text" sample. Default false. */
  generate_sample?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  type: z.literal("tts"),
  title: z.string().min(1, "title must be a non-empty model name"),
  train_mode: z.literal("fast"),
  voices: z.union([
    z.instanceof(Blob),
    z
      .array(z.instanceof(Blob))
      .min(1, "at least one voice recording is required")
      .max(VOICE_CLONE_MAX_VOICES, `at most ${VOICE_CLONE_MAX_VOICES} voice recordings are allowed`),
  ]),
  texts: z
    .union([
      z.string(),
      z.array(z.string()).max(VOICE_CLONE_MAX_TEXTS, `at most ${VOICE_CLONE_MAX_TEXTS} texts are allowed`),
    ])
    .nullable()
    .optional(),
  visibility: z.string().optional(),
  description: z.string().nullable().optional(),
  cover_image: z.instanceof(Blob).nullable().optional(),
  tags: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enhance_audio_quality: z.boolean().optional(),
  generate_sample: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const VISIBILITY_SET = new Set<string>(VOICE_CLONE_VISIBILITIES);

function checkVisibilityEnum(
  params: CreateModelParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const visibility = params.visibility;
  if (visibility === undefined || VISIBILITY_SET.has(visibility)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["visibility"],
    message: `\`visibility\` must be one of ${VOICE_CLONE_VISIBILITIES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(visibility)}.`,
    meta: { allowed: [...VOICE_CLONE_VISIBILITIES], value: visibility, source: CREATE_MODEL_DOCS },
  });
}

/**
 * The public-by-default footgun: an omitted `visibility` publishes the cloned
 * voice on the discovery page. The request is fulfilled, so this is a
 * warning; setting any explicit value silences it.
 */
function checkVisibilityOmitted(
  params: CreateModelParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.visibility !== undefined) return;
  ctx.report({
    code: "invalid_shape",
    severity: "warning",
    path: ["visibility"],
    message:
      '`visibility` is omitted and defaults to "public", which lists the cloned voice on the public discovery page (and makes `cover_image` required). Set `"private"` to keep it visible only to you.',
    meta: { default: "public", source: CREATE_MODEL_DOCS },
  });
}

/** "Model cover image, this is required if the model is public." */
function checkCoverImageIfPublic(
  params: CreateModelParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  // Only an EXPLICIT "public" errors here: an omitted `visibility` is implicit
  // public, but it already carries the omission warning above, and erroring a
  // minimal request on a field the schema marks optional would out-strict the
  // wire.
  if (params.visibility !== "public" || params.cover_image != null) return;
  ctx.report({
    code: "invalid_shape",
    path: ["cover_image"],
    message: '`cover_image` is required if the model is public.',
    meta: { source: CREATE_MODEL_DOCS },
  });
}

// No estimate: no rate for model creation is published on
// docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits.

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/** Array-capable fields the form appends item-by-item under the same key. */
const REPEATED_FIELDS = new Set<string>(["voices", "texts", "tags"]);

/**
 * Builds the multipart/form-data body for `POST /model` from validated
 * params. Each `voices` recording is its own `voices` part (a single Blob is
 * one part); `texts` and `tags` likewise repeat per item; `cover_image` is a
 * file part; booleans are stringified. Null/undefined fields are omitted.
 *
 * ```ts
 * const params = fishAudio.voiceClone({
 *   type: "tts", title: "Narrator", train_mode: "fast",
 *   voices: [blob], visibility: "private",
 * });
 * await fetch(params.request.url, {
 *   method: "POST",
 *   headers: { authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY!}` },
 *   body: fishAudio.voiceCloneToFormData(params),
 * });
 * ```
 */
export function voiceCloneToFormData(params: CreateModelParams): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (REPEATED_FIELDS.has(key)) {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        form.append(key, item instanceof Blob ? item : String(item));
      }
      continue;
    }
    if (value instanceof Blob) {
      form.append(key, value);
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/**
 * SDK targets for `fish-audio.voiceClone`. `fish-audio-sdk` (JS) takes
 * wire-shaped params, so the single `"fish-audio"` formatter is the identity.
 * Type alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type VoiceCloneSdkTargets<B> = { "fish-audio": () => B };

function finalize(
  params: CreateModelParams,
): ValidatedForm<CreateModelParams, VoiceCloneSdkTargets<CreateModelParams>> {
  return toValidated(
    params,
    {
      url: CREATE_MODEL_URL,
      method: "POST",
      // Deliberately NOT application/json: this is a multipart endpoint, and
      // fetch must derive the multipart boundary from the FormData body itself.
      headers: {},
      body: "form",
    },
    { sdk: { "fish-audio": () => params } },
  );
}

const validator = createValidator<
  CreateModelParams,
  ValidatedForm<CreateModelParams, VoiceCloneSdkTargets<CreateModelParams>>
>({
  endpoint: "fish-audio.voiceClone",
  schema,
  // No model field on this wire — the synthetic catalog id stands in so
  // catalog-keyed machinery stays coherent (see module JSDoc).
  modelId: () => VOICE_CLONE_MODEL_ID,
  catalog: models,
  checks: [checkVisibilityEnum, checkVisibilityOmitted, checkCoverImageIfPublic],
  finalize,
});

/**
 * Validates params for Fish Audio `POST /model` (voice cloning: create a TTS
 * model from reference recordings).
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the `voices` Blobs), and the raw-fetch path
 * is `.request.url` + `voiceCloneToFormData(validated)` as the body — never
 * `JSON.stringify`. The response document's `_id` is the created voice's id,
 * usable as `reference_id` on POST /v1/tts. Watch `visibility`: it defaults
 * to "public" (see module JSDoc). Auth is your job: add an
 * `authorization: Bearer …` header.
 */
export const voiceClone = validator as unknown as {
  <T extends CreateModelParams>(
    params: T & ExactKeys<T, CreateModelParams>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, VoiceCloneSdkTargets<T>>;
  safe<T extends CreateModelParams>(
    params: T & ExactKeys<T, CreateModelParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, VoiceCloneSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
