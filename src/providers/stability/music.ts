/**
 * Stability AI Stable Audio 2 —
 * POST https://api.stability.ai/v2beta/audio/stable-audio-2/{text-to-audio,audio-to-audio,inpaint}
 *
 * Wire notes (transcribed from the machine-readable v2beta spec at
 * https://api.stability.ai/v2alpha/openapi — despite the /v2alpha path it
 * serves the v2beta REST spec and IS the definition the rendered reference at
 * https://platform.stability.ai/docs/api-reference loads — on 2026-08-13):
 * - MULTIPART form endpoints, like the stable-image routes: the validated
 *   output's enumerable props are the exact form fields (including the `audio`
 *   Blob) — do NOT `JSON.stringify` them. Send `.request.url` +
 *   `toFormData(validated)` (re-exported from ./generate) as the body; fetch
 *   derives the multipart content-type with its boundary from the FormData,
 *   which is why `.request.headers` is empty.
 * - Accept header: `audio/*` (the server default) returns raw audio bytes;
 *   `application/json` returns the audio base64-encoded in JSON. Your choice,
 *   added alongside your `authorization: Bearer <key>` header — unmodel never
 *   touches keys.
 * - One endpoint fn per route (mirroring Stability's own resources): the three
 *   routes take different field surfaces, and the inpaint route has no `model`
 *   field at all — it is Stable Audio 2.5.
 * - `steps` bounds are MODEL-dependent (30–100 for stable-audio-2, 4–8 for
 *   stable-audio-2.5) and `steps` also drives the price on stable-audio-2, so
 *   both are checked per model rather than in the schema.
 * - Billing is flat credits per successful generation (1 credit = $0.01);
 *   failed generations are not charged. See ./models for why the credits live
 *   here instead of on `ModelCost`.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, STABLE_AUDIO_2_MODEL_IDS, type StabilityAudioModelId } from "./models";

const AUDIO_BASE_URL = "https://api.stability.ai/v2beta/audio/stable-audio-2";

export const STABLE_AUDIO_TEXT_TO_AUDIO_URL = `${AUDIO_BASE_URL}/text-to-audio`;
export const STABLE_AUDIO_AUDIO_TO_AUDIO_URL = `${AUDIO_BASE_URL}/audio-to-audio`;
export const STABLE_AUDIO_INPAINT_URL = `${AUDIO_BASE_URL}/inpaint`;

const API_REFERENCE_URL = "https://api.stability.ai/v2alpha/openapi";

/** 1 credit = $0.01 — https://platform.stability.ai/pricing */
export const STABILITY_USD_PER_CREDIT = 0.01;

/**
 * Server-side default when a route's `model` field is omitted — "model …
 * default: stable-audio-2".
 */
export const DEFAULT_STABLE_AUDIO_MODEL_ID = "stable-audio-2";

/** The inpaint route has no `model` field: it is Stable Audio 2.5. */
export const INPAINT_MODEL_ID = "stable-audio-2.5";

/** `output_format` values every Stable Audio route accepts. Default "mp3". */
export const STABLE_AUDIO_OUTPUT_FORMATS = ["mp3", "wav"] as const;
export type StableAudioOutputFormat = (typeof STABLE_AUDIO_OUTPUT_FORMATS)[number];

/** Documented `duration` bounds, in seconds (default 190 — three minutes). */
export const STABLE_AUDIO_DURATION_MIN = 1;
export const STABLE_AUDIO_DURATION_MAX = 190;

/** Per-model `steps` bounds and defaults, straight from the spec's `steps` text. */
export const STABLE_AUDIO_STEPS: Readonly<
  Record<string, { min: number; max: number; default: number }>
> = {
  "stable-audio-2": { min: 30, max: 100, default: 50 },
  "stable-audio-2.5": { min: 4, max: 8, default: 8 },
};

/**
 * "Minimum value for `stable-audio-2.5` is 0.01" — the audio-to-audio
 * `strength` floor; stable-audio-2 accepts the full 0–1 range.
 */
export const STABLE_AUDIO_2_5_STRENGTH_MIN = 0.01;

/**
 * Credits a successful generation costs:
 * - stable-audio-2: `credits = 17 + 0.06 * steps` (50 steps → 20 credits).
 * - stable-audio-2.5: flat 20 credits.
 * - stable-audio-3 (the async /v2beta/audio/stable-audio/* routes): flat 26.
 * Unknown models return undefined rather than guessing.
 */
export function stableAudioCredits(model: string, steps?: number): number | undefined {
  if (model === "stable-audio-2") {
    return 17 + 0.06 * (steps ?? STABLE_AUDIO_STEPS["stable-audio-2"]!.default);
  }
  if (model === "stable-audio-2.5") return 20;
  if (model === "stable-audio-3") return 26;
  return undefined;
}

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly.
// ---------------------------------------------------------------------------

/** Fields shared by all three Stable Audio routes. */
interface StableAudioCommonParams {
  /** What you wish the output audio to be; up to 10,000 characters. */
  prompt: string;
  /** Duration of the generated audio in seconds, 1–190. Default 190. */
  duration?: number;
  /** 0–4294967294; omit or 0 for a random seed. */
  seed?: number;
  /** Sampling steps; bounds and default depend on the model. */
  steps?: number;
  /** Dictates the content-type of the generated audio. Default "mp3". */
  output_format?: StableAudioOutputFormat;
}

/** POST /v2beta/audio/stable-audio-2/text-to-audio. */
export interface StableAudioTextToAudioParams extends StableAudioCommonParams {
  /** Prompt adherence, 1–25. Defaults to 7 (2.0) / 1 (2.5). */
  cfg_scale?: number;
  /** Defaults to "stable-audio-2". */
  model?: StabilityAudioModelId | (string & {});
}

/** POST /v2beta/audio/stable-audio-2/audio-to-audio. */
export interface StableAudioAudioToAudioParams extends StableAudioCommonParams {
  /** Starting-point audio (mp3/wav bytes, 6–190 seconds). Required. */
  audio: Blob;
  /** Prompt adherence, 1–25. Defaults to 7 (2.0) / 1 (2.5). */
  cfg_scale?: number;
  /** Defaults to "stable-audio-2". */
  model?: StabilityAudioModelId | (string & {});
  /**
   * Denoising 0–1: how much influence `audio` has. 0 returns the input, 1 is
   * as if no audio were passed. Default 1; stable-audio-2.5 floors it at 0.01.
   */
  strength?: number;
}

/** POST /v2beta/audio/stable-audio-2/inpaint (Stable Audio 2.5; no `model` field). */
export interface StableAudioInpaintParams extends StableAudioCommonParams {
  /** Audio to inpaint (mp3/wav bytes, 6–190 seconds). Required. */
  audio: Blob;
  /** Start of the inpainted segment, in seconds (0–190). Default 30. */
  mask_start?: number;
  /** End of the inpainted segment, in seconds (0–190). Default 190. */
  mask_end?: number;
}

// ---------------------------------------------------------------------------
// Schemas (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const promptSchema = z
  .string()
  .min(1, "prompt must be 1–10000 characters")
  .max(10000, "prompt must be 1–10000 characters");
const durationSchema = z
  .number()
  .min(STABLE_AUDIO_DURATION_MIN, "duration must be between 1 and 190 seconds")
  .max(STABLE_AUDIO_DURATION_MAX, "duration must be between 1 and 190 seconds")
  .optional();
const seedSchema = z.number().min(0).max(4294967294).optional();
const cfgScaleSchema = z.number().min(1).max(25).optional();
const maskSchema = z.number().min(0).max(190).optional();

const textToAudioSchema = z.looseObject({
  prompt: promptSchema,
  duration: durationSchema,
  seed: seedSchema,
  steps: z.number().int().optional(),
  cfg_scale: cfgScaleSchema,
  model: z.string().optional(),
  output_format: z.enum(STABLE_AUDIO_OUTPUT_FORMATS).optional(),
});

const audioToAudioSchema = z.looseObject({
  prompt: promptSchema,
  audio: z.instanceof(Blob),
  duration: durationSchema,
  seed: seedSchema,
  steps: z.number().int().optional(),
  cfg_scale: cfgScaleSchema,
  model: z.string().optional(),
  output_format: z.enum(STABLE_AUDIO_OUTPUT_FORMATS).optional(),
  strength: z.number().min(0).max(1).optional(),
});

const inpaintSchema = z.looseObject({
  prompt: promptSchema,
  audio: z.instanceof(Blob),
  duration: durationSchema,
  seed: seedSchema,
  steps: z.number().int().optional(),
  output_format: z.enum(STABLE_AUDIO_OUTPUT_FORMATS).optional(),
  mask_start: maskSchema,
  mask_end: maskSchema,
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const MODEL_SET = new Set<string>(STABLE_AUDIO_2_MODEL_IDS);

/**
 * The `model` enum of the two routes that have one. stable-audio-3 resolves in
 * the shared Stability catalog (it is a real model), so without this gate it
 * would pass here — but it is served by the separate async
 * /v2beta/audio/stable-audio/* routes.
 */
function checkAudioModel(
  params: { model?: string },
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if (model === undefined || MODEL_SET.has(model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["model"],
    model,
    message: `\`model\` must be one of ${STABLE_AUDIO_2_MODEL_IDS.map((v) => JSON.stringify(v)).join(", ")} on the stable-audio-2 routes; got ${JSON.stringify(model)}.`,
    meta: { allowed: [...STABLE_AUDIO_2_MODEL_IDS], value: model, source: API_REFERENCE_URL },
  });
}

/** Per-model `steps` bounds: 30–100 for stable-audio-2, 4–8 for 2.5. */
function checkSteps(model: string, steps: number | undefined, ctx: PipelineContext): void {
  if (steps === undefined) return;
  const bounds = STABLE_AUDIO_STEPS[model];
  if (bounds === undefined) return;
  if (steps < bounds.min || steps > bounds.max) {
    ctx.report({
      code: "invalid_shape",
      path: ["steps"],
      model,
      message: `\`steps\` is ${steps}; "${model}" accepts steps between ${bounds.min} and ${bounds.max} (defaults to ${bounds.default}).`,
      meta: { min: bounds.min, max: bounds.max, value: steps, source: API_REFERENCE_URL },
    });
  }
}

function checkTextToAudio(
  params: StableAudioTextToAudioParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkSteps(params.model ?? DEFAULT_STABLE_AUDIO_MODEL_ID, params.steps, ctx);
}

function checkAudioToAudio(
  params: StableAudioAudioToAudioParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model ?? DEFAULT_STABLE_AUDIO_MODEL_ID;
  checkSteps(model, params.steps, ctx);
  if (
    model === "stable-audio-2.5" &&
    params.strength !== undefined &&
    params.strength < STABLE_AUDIO_2_5_STRENGTH_MIN
  ) {
    ctx.report({
      code: "invalid_shape",
      path: ["strength"],
      model,
      message: `\`strength\` is ${params.strength}; the minimum for "stable-audio-2.5" is ${STABLE_AUDIO_2_5_STRENGTH_MIN}.`,
      meta: {
        min: STABLE_AUDIO_2_5_STRENGTH_MIN,
        value: params.strength,
        source: API_REFERENCE_URL,
      },
    });
  }
}

function checkInpaint(
  params: StableAudioInpaintParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkSteps(INPAINT_MODEL_ID, params.steps, ctx);
}

// ---------------------------------------------------------------------------
// Estimation — flat credits per successful generation, 1 credit = $0.01.
// ---------------------------------------------------------------------------

function creditEstimate(model: string, steps: number | undefined) {
  const credits = stableAudioCredits(model, steps);
  return credits === undefined ? {} : { costUSD: credits * STABILITY_USD_PER_CREDIT };
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

/**
 * The one `.toSdk("stability")` target for this endpoint — Stability ships
 * no official JS SDK, so this is the multipart source. Derived from the
 * `sdk` literal in `finalize`; it must stay an object type with no index
 * signature, or `toSdk` would accept any string.
 */
type StabilitySdkTargets<B> = { stability: () => B };

function finalizeTo(url: string) {
  return (params: object): unknown => {
    const body = { ...params };
    return toValidated(body, {
      url,
      method: "POST",
      // Deliberately empty: multipart endpoint — fetch must derive the
      // boundary from the FormData body. Add your own accept header
      // (audio/* or application/json) and auth.
      headers: {},
    }, {
      sdk: { stability: () => body },
    });
  };
}

const textToAudioValidator = createValidator<StableAudioTextToAudioParams, unknown>({
  endpoint: "stability.music",
  schema: textToAudioSchema,
  modelId: (params) => params.model ?? DEFAULT_STABLE_AUDIO_MODEL_ID,
  catalog: models,
  checks: [checkAudioModel, checkTextToAudio],
  estimate: (params) => creditEstimate(params.model ?? DEFAULT_STABLE_AUDIO_MODEL_ID, params.steps),
  finalize: finalizeTo(STABLE_AUDIO_TEXT_TO_AUDIO_URL),
});

const audioToAudioValidator = createValidator<StableAudioAudioToAudioParams, unknown>({
  endpoint: "stability.musicFromAudio",
  schema: audioToAudioSchema,
  modelId: (params) => params.model ?? DEFAULT_STABLE_AUDIO_MODEL_ID,
  catalog: models,
  checks: [checkAudioModel, checkAudioToAudio],
  estimate: (params) => creditEstimate(params.model ?? DEFAULT_STABLE_AUDIO_MODEL_ID, params.steps),
  finalize: finalizeTo(STABLE_AUDIO_AUDIO_TO_AUDIO_URL),
});

const inpaintValidator = createValidator<StableAudioInpaintParams, unknown>({
  endpoint: "stability.musicInpaint",
  schema: inpaintSchema,
  // The inpaint route has no model wire field — it is Stable Audio 2.5.
  modelId: () => INPAINT_MODEL_ID,
  catalog: models,
  checks: [checkInpaint],
  estimate: (params) => creditEstimate(INPAINT_MODEL_ID, params.steps),
  finalize: finalizeTo(STABLE_AUDIO_INPAINT_URL),
});

interface StableAudioValidator<P> {
  <T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions<T>,
  ): Validated<T, StabilitySdkTargets<T>>;
  safe<T extends P>(
    params: T & ExactKeys<T, P>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, StabilitySdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * Validates params for `POST /v2beta/audio/stable-audio-2/text-to-audio`
 * (music and sound effects up to 190 seconds at 44.1kHz stereo; 20 credits ≈
 * $0.20 per successful generation at the default step counts).
 *
 * Multipart endpoint: the validated output's enumerable props are the exact
 * form fields — send `.request.url` + `toFormData(validated)` as the body,
 * never `JSON.stringify`. Add your own `authorization` and accept header
 * (`audio/*` for raw bytes — the server default — or `application/json` for
 * base64 JSON). Stability has no official JS SDK, so `.toSdk("stability")` returns the
 * fields unchanged.
 *
 * ```ts
 * const params = stability.music({
 *   prompt: "A cheerful acoustic guitar loop in 3/4",
 *   duration: 20,
 *   model: "stable-audio-2.5",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
 *     accept: "audio/*",
 *   },
 *   body: stability.toFormData(params),
 * });
 * ```
 */
export const music = textToAudioValidator as unknown as StableAudioValidator<
  StableAudioTextToAudioParams
>;

/**
 * Validates params for `POST /v2beta/audio/stable-audio-2/audio-to-audio`
 * (transform an existing 6–190 second mp3/wav sample with a text prompt).
 *
 * `strength` controls how much of the input survives (0 = identical input,
 * 1 = as if no audio were sent); stable-audio-2.5 floors it at 0.01.
 * Multipart endpoint — see `music` for the fetch recipe.
 */
export const musicFromAudio = audioToAudioValidator as unknown as StableAudioValidator<
  StableAudioAudioToAudioParams
>;

/**
 * Validates params for `POST /v2beta/audio/stable-audio-2/inpaint`
 * (regenerate the `mask_start`–`mask_end` window of an existing track with
 * Stable Audio 2.5; flat 20 credits ≈ $0.20).
 *
 * This route has no `model` field — Stable Audio 2.5 is the only model, so its
 * 4–8 `steps` bounds apply. Multipart endpoint — see
 * `music` for the fetch recipe.
 */
export const musicInpaint = inpaintValidator as unknown as StableAudioValidator<
  StableAudioInpaintParams
>;
