/**
 * Fish Audio Voice Design — POST https://api.fish.audio/v1/voice-design
 *
 * Wire reference:
 * https://docs.fish.audio/api-reference/endpoint/openapi-v1/voice-design and
 * the OpenAPI schema at github.com/fishaudio/docs `api-reference/openapi.json`
 * (`paths./v1/voice-design.post`), verified 2026-08-22. The OpenAPI resolves
 * a docs conflict: the feature page says `reference_text` takes "up to 300
 * characters", the schema says `maxLength: 150` — the schema wins.
 *
 * - `model` is a REQUIRED HEADER param (const "voice-design-1"). As on
 *   POST /v1/tts it rides in the params object for ergonomics and is
 *   STRIPPED from the wire body; unlike TTS the header is required, so
 *   `.request.headers.model` is always emitted — with the documented value
 *   when the param is omitted.
 * - SINGLE-PHASE AND EPHEMERAL: the response is `candidates[]`, each with
 *   inline base64 audio. Nothing is persisted and there is no save endpoint —
 *   Fish's stored voices come from POST /model (the `voiceClone` validator).
 * - BILLING: "$0.01 / successful API request" (pricing-and-rate-limits),
 *   billed once per request regardless of `n`. `ModelCost` has no
 *   per-request unit, so the catalog row omits `cost` and the estimate
 *   returns the flat documented rate.
 * - Auth is an `Authorization: Bearer <token>` header — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, VOICE_DESIGN_MODEL_IDS, type FishAudioVoiceDesignModelId } from "./models";

export const VOICE_DESIGN_URL = "https://api.fish.audio/v1/voice-design";

const VOICE_DESIGN_DOCS =
  "https://docs.fish.audio/api-reference/endpoint/openapi-v1/voice-design";
const MODELS_DOCS = "https://docs.fish.audio/developer-guide/models-pricing/models-overview";
const PRICING_DOCS =
  "https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits";

/**
 * The documented value of the required `model` header — emitted when the
 * `model` param is omitted (the header itself cannot be omitted).
 */
export const DEFAULT_VOICE_DESIGN_MODEL = "voice-design-1";

/** "$0.01 / successful API request" — PRICING_DOCS, billed once per request. */
export const VOICE_DESIGN_COST_PER_REQUEST_USD = 0.01;

/** "Must contain 1 to 2000 characters." */
export const VOICE_DESIGN_INSTRUCTION_MAX_CHARACTERS = 2000;
/** `maxLength: 150` in the OpenAPI schema (see module JSDoc). */
export const VOICE_DESIGN_REFERENCE_TEXT_MAX_CHARACTERS = 150;
/** "Number of voice candidates to generate" — 1 to 4, default 2. */
export const VOICE_DESIGN_N_MIN = 1;
export const VOICE_DESIGN_N_MAX = 4;
/** "Speaking speed multiplier" — greater than 0, at most 3, default 1. */
export const VOICE_DESIGN_SPEED_MAX = 3;
/** "Number of diffusion steps" — 1 to 128, default 32. */
export const VOICE_DESIGN_NUM_STEP_MIN = 1;
export const VOICE_DESIGN_NUM_STEP_MAX = 128;

// ---------------------------------------------------------------------------
// Wire types — mirror the VoiceDesignRequest schema exactly (snake_case).
// Explicit `null` is the documented default for the nullable fields.
// ---------------------------------------------------------------------------

export interface VoiceDesignBody {
  /**
   * REQUIRED HEADER param — stripped from the wire body and emitted as
   * `.request.headers.model`, with the documented "voice-design-1" when
   * omitted here.
   */
  model?: FishAudioVoiceDesignModelId | (string & {});
  /** "Voice design prompt. Must contain 1 to 2000 characters." */
  instruction: string;
  /**
   * "Optional text used as reference content for the generated voice." Max
   * 150 characters (OpenAPI; the feature page's "300" is stale).
   */
  reference_text?: string | null;
  /** "Optional BCP-47 language hint, such as `en`, `zh`, or `ja`." */
  language?: string | null;
  /** "Number of voice candidates to generate." 1–4, default 2. */
  n?: number;
  /** "Speaking speed multiplier for candidate generation." >0–3, default 1. */
  speed?: number;
  /** "Number of diffusion steps used by the voice-design model." 1–128, default 32. */
  num_step?: number;
  /**
   * "Classifier-free guidance scale. Higher values follow the prompt more
   * strongly." ≥0, default 2.
   */
  guidance_scale?: number;
  /** "Instruction guidance scale for prompt conditioning." ≥0, default 0. */
  instruct_guidance_scale?: number;
  /** "Optional deterministic seed for candidate generation." */
  seed?: number | null;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning — note the wire
// schema itself is additionalProperties: false, so the server rejects what
// unmodel only warns about).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  model: z.string().optional(),
  instruction: z
    .string()
    .min(1, "instruction must contain 1 to 2000 characters")
    .max(
      VOICE_DESIGN_INSTRUCTION_MAX_CHARACTERS,
      `instruction must contain 1 to ${VOICE_DESIGN_INSTRUCTION_MAX_CHARACTERS} characters`,
    ),
  reference_text: z
    .string()
    .max(
      VOICE_DESIGN_REFERENCE_TEXT_MAX_CHARACTERS,
      `reference_text is capped at ${VOICE_DESIGN_REFERENCE_TEXT_MAX_CHARACTERS} characters`,
    )
    .nullable()
    .optional(),
  language: z.string().nullable().optional(),
  n: z.number().int().min(VOICE_DESIGN_N_MIN).max(VOICE_DESIGN_N_MAX).optional(),
  speed: z.number().positive().max(VOICE_DESIGN_SPEED_MAX).optional(),
  num_step: z
    .number()
    .int()
    .min(VOICE_DESIGN_NUM_STEP_MIN)
    .max(VOICE_DESIGN_NUM_STEP_MAX)
    .optional(),
  guidance_scale: z.number().min(0).optional(),
  instruct_guidance_scale: z.number().min(0).optional(),
  seed: z.number().int().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const VOICE_DESIGN_MODEL_ID_SET = new Set<string>(VOICE_DESIGN_MODEL_IDS);

/**
 * The catalog also carries the TTS ids; a TTS id in the voice-design `model`
 * header would fall through to an unrecognized-header behaviour rather than
 * synthesize, so it is rejected here. Ids unknown to the catalog stay a
 * warning — they may be new voice-design models.
 */
function checkModelKind(
  params: VoiceDesignBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model ?? DEFAULT_VOICE_DESIGN_MODEL;
  if (info === undefined || VOICE_DESIGN_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message: `"${model}" is not served by POST /v1/voice-design; the \`model\` header accepts ${VOICE_DESIGN_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...VOICE_DESIGN_MODEL_IDS], source: MODELS_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — "$0.01 / successful API request", once per request, not per
// candidate (PRICING_DOCS). Flat: no catalog unit fits a per-request rate.
// ---------------------------------------------------------------------------

function estimate(
  _params: VoiceDesignBody,
  _info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  return { costUSD: VOICE_DESIGN_COST_PER_REQUEST_USD };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (model stripped — it is a header) + .request
// ---------------------------------------------------------------------------

type VoiceDesignWireBody = Omit<VoiceDesignBody, "model">;

/**
 * SDK targets for `fish-audio.voiceDesign`. `fish-audio-sdk` (JS) takes
 * wire-shaped params, so the single `"fish-audio"` formatter is the identity.
 * Type alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type VoiceDesignSdkTargets<B> = { "fish-audio": () => B };

function finalize(
  params: VoiceDesignBody,
): Validated<VoiceDesignWireBody, VoiceDesignSdkTargets<VoiceDesignWireBody>> {
  const { model, ...body } = params;
  return toValidated(
    body,
    {
      url: VOICE_DESIGN_URL,
      method: "POST",
      // Unlike POST /v1/tts, the `model` header is REQUIRED on this wire, so
      // it is always emitted — with the documented value when omitted here.
      headers: { ...JSON_HEADERS, model: model ?? DEFAULT_VOICE_DESIGN_MODEL },
    },
    { sdk: { "fish-audio": () => body } },
  );
}

const validator = createValidator<
  VoiceDesignBody,
  Validated<VoiceDesignWireBody, VoiceDesignSdkTargets<VoiceDesignWireBody>>
>({
  endpoint: "fish-audio.voiceDesign",
  schema,
  modelId: (params) => params.model ?? DEFAULT_VOICE_DESIGN_MODEL,
  catalog: models,
  checks: [checkModelKind],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Fish Audio `POST /v1/voice-design` — generate
 * voice candidates from a text description.
 *
 * The result's enumerable properties are the exact fetch JSON body; `model`
 * is stripped because it is a required HEADER param and appears on
 * `.request.headers.model` instead. The response's `candidates[]` carry
 * inline base64 audio and are NOT persisted — Fish stores voices only via
 * POST /model (`fishAudio.voiceClone`). Billed $0.01 per successful request,
 * once per request regardless of `n`. Auth is your job: add an
 * `authorization: Bearer …` header.
 */
export const voiceDesign = validator as unknown as {
  <T extends VoiceDesignBody>(
    params: T & ExactKeys<T, VoiceDesignBody>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, VoiceDesignSdkTargets<Omit<T, "model">>>;
  safe<T extends VoiceDesignBody>(
    params: T & ExactKeys<T, VoiceDesignBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, VoiceDesignSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
