/**
 * ElevenLabs Voice Design — POST https://api.elevenlabs.io/v1/text-to-voice/design
 *
 * Wire notes (verified against
 * https://elevenlabs.io/docs/api-reference/text-to-voice/design and the
 * Fern-generated types in elevenlabs/elevenlabs-js on 2026-08-22):
 * - This is phase 1 of a two-phase flow: it generates preview candidates
 *   (`previews[]`, each with base64 audio and a `generated_voice_id`) but
 *   persists nothing. Saving a preview as a real voice is
 *   POST /v1/text-to-voice — the `voiceDesignSave` validator in
 *   ./voice-design-save.
 * - `model_id` defaults to "eleven_multilingual_ttv_v2" server-side.
 *   `reference_audio_base64` and `prompt_strength` are "only supported when
 *   using the eleven_ttv_v3 model" — enforced here, against the default when
 *   `model_id` is omitted.
 * - `text` is what the previews speak; when given, "text length has to be
 *   between 100 and 1000". The docs do not state what happens when both
 *   `text` and `auto_generate_text` are set, or neither — so unmodel checks
 *   only the documented length bound and stays silent on the pairing.
 * - `output_format` is a QUERY param: stripped from the JSON body and appended
 *   to `.request.url`. Its value space differs from text-to-speech's — no
 *   `wav_*` spellings here. Some values are plan-gated (44.1kHz PCM needs
 *   Pro+); unmodel cannot see your plan, so all documented values pass.
 * - No USD rate for voice design is published on elevenlabs.io/pricing/api,
 *   so there is no cost estimate.
 * - Auth is an `xi-api-key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, VOICE_DESIGN_MODEL_IDS, type ElevenlabsVoiceDesignModelId } from "./models";

export const TEXT_TO_VOICE_DESIGN_URL = "https://api.elevenlabs.io/v1/text-to-voice/design";

const VOICE_DESIGN_DOCS_URL = "https://elevenlabs.io/docs/api-reference/text-to-voice/design";
const MODELS_DOCS_URL = "https://elevenlabs.io/docs/models";

/**
 * Server-side default when `model_id` is omitted — VOICE_DESIGN_DOCS_URL
 * ("Defaults to eleven_multilingual_ttv_v2"). Model-dependent checks (the
 * ttv_v3-only field gate) run against this model when none is given.
 */
export const DEFAULT_VOICE_DESIGN_MODEL_ID = "eleven_multilingual_ttv_v2";

/** Documented bounds of `text` — "text length has to be between 100 and 1000". */
export const VOICE_DESIGN_TEXT_MIN_CHARACTERS = 100;
export const VOICE_DESIGN_TEXT_MAX_CHARACTERS = 1000;

/**
 * `output_format` query param values ("codec_sample_rate_bitrate") —
 * VOICE_DESIGN_DOCS_URL. A distinct space from text-to-speech's: the design
 * endpoint documents no `wav_*` values.
 */
export const VOICE_DESIGN_OUTPUT_FORMATS = [
  "alaw_8000",
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_128",
  "mp3_44100_192",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "opus_48000_128",
  "opus_48000_192",
  "opus_48000_32",
  "opus_48000_64",
  "opus_48000_96",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_32000",
  "pcm_44100",
  "pcm_48000",
  "pcm_8000",
  "ulaw_8000",
] as const;

export type ElevenlabsVoiceDesignOutputFormat = (typeof VOICE_DESIGN_OUTPUT_FORMATS)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case). Explicit `null`
// means "use the provider default" on nullable fields.
// ---------------------------------------------------------------------------

export interface TextToVoiceDesignParams {
  /** The generative description of the voice to invent. */
  voice_description: string;
  /** Defaults to "eleven_multilingual_ttv_v2" server-side. */
  model_id?: ElevenlabsVoiceDesignModelId | (string & {});
  /**
   * What the preview candidates speak; "text length has to be between 100
   * and 1000" characters.
   */
  text?: string | null;
  /**
   * "Whether to automatically generate a text suitable for the voice
   * description." Default false.
   */
  auto_generate_text?: boolean;
  /** Output volume; −1 to 1, default 0.5 (0 ≈ −24 LUFS). */
  loudness?: number | null;
  /**
   * "Higher quality results in better voice output but less variety." No
   * documented numeric bounds.
   */
  quality?: number | null;
  /** Best-effort deterministic sampling. */
  seed?: number | null;
  /**
   * How closely the model follows the description; default 5. No documented
   * numeric bounds.
   */
  guidance_scale?: number | null;
  /**
   * If true the response carries only ids and the preview audio streams via
   * GET /v1/text-to-voice/{generated_voice_id}/stream. Default false.
   */
  stream_previews?: boolean;
  /**
   * AI-expand `voice_description` before generating (this enhances the
   * PROMPT, not the audio). Default false.
   */
  should_enhance?: boolean;
  /** Remix-session correlation handle. */
  remixing_session_id?: string | null;
  /** Iteration within a remix session. */
  remixing_session_iteration_id?: string | null;
  /**
   * Inline base64 reference audio to steer the design — "only supported when
   * using the eleven_ttv_v3 model".
   */
  reference_audio_base64?: string | null;
  /**
   * Balance between the text description and the reference audio; 0–1,
   * eleven_ttv_v3 only.
   */
  prompt_strength?: number | null;
  /**
   * QUERY param — stripped from the wire body and appended to `.request.url`
   * as `?output_format=…`.
   */
  output_format?: ElevenlabsVoiceDesignOutputFormat;
}

// ---------------------------------------------------------------------------
// SDK view — @elevenlabs/elevenlabs-js's client.textToVoice.design(request)
// takes the same fields camelCased, with outputFormat inside the request.
// ---------------------------------------------------------------------------

export interface TextToVoiceDesignSdkParams {
  voiceDescription: string;
  modelId?: string;
  text?: string;
  autoGenerateText?: boolean;
  loudness?: number;
  quality?: number;
  seed?: number;
  guidanceScale?: number;
  streamPreviews?: boolean;
  shouldEnhance?: boolean;
  remixingSessionId?: string;
  remixingSessionIterationId?: string;
  referenceAudioBase64?: string;
  promptStrength?: number;
  outputFormat?: ElevenlabsVoiceDesignOutputFormat;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const textToVoiceDesignSchema = z.looseObject({
  voice_description: z.string().min(1, "voice_description must be a non-empty description"),
  model_id: z.string().optional(),
  text: z.string().nullable().optional(),
  auto_generate_text: z.boolean().optional(),
  // "-1 to 1, default 0.5" — the only body field with documented bounds the
  // schema can carry.
  loudness: z.number().min(-1).max(1).nullable().optional(),
  quality: z.number().nullable().optional(),
  seed: z.number().int().nullable().optional(),
  guidance_scale: z.number().nullable().optional(),
  stream_previews: z.boolean().optional(),
  should_enhance: z.boolean().optional(),
  remixing_session_id: z.string().nullable().optional(),
  remixing_session_iteration_id: z.string().nullable().optional(),
  reference_audio_base64: z.string().nullable().optional(),
  // "0–1" — documented range.
  prompt_strength: z.number().min(0).max(1).nullable().optional(),
  output_format: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const OUTPUT_FORMAT_SET = new Set<string>(VOICE_DESIGN_OUTPUT_FORMATS);
const VOICE_DESIGN_MODEL_ID_SET = new Set<string>(VOICE_DESIGN_MODEL_IDS);

/**
 * The catalog carries every documented ElevenLabs model id, including ones
 * served by other APIs (TTS, STT, music, speech-to-speech). Those ids resolve
 * in the catalog, so without this gate they would pass voice-design validation
 * unremarked; the endpoint rejects them. Ids unknown to the catalog stay a
 * warning (`unknown_model`) — they may be new text-to-voice models.
 */
function checkVoiceDesignModelKind(
  params: TextToVoiceDesignParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model_id ?? DEFAULT_VOICE_DESIGN_MODEL_ID;
  if (info === undefined || VOICE_DESIGN_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model_id"],
    model,
    message: `"${model}" is not a text-to-voice model; POST /v1/text-to-voice/design accepts ${VOICE_DESIGN_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...VOICE_DESIGN_MODEL_IDS], source: MODELS_DOCS_URL },
  });
}

/** "text length has to be between 100 and 1000" (VOICE_DESIGN_DOCS_URL). */
function checkTextLength(
  params: TextToVoiceDesignParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const text = params.text;
  if (typeof text !== "string") return;
  const actual = text.length;
  if (actual >= VOICE_DESIGN_TEXT_MIN_CHARACTERS && actual <= VOICE_DESIGN_TEXT_MAX_CHARACTERS) {
    return;
  }
  ctx.report({
    code: "invalid_shape",
    path: ["text"],
    message: `\`text\` is ${actual} characters; ElevenLabs documents a length of ${VOICE_DESIGN_TEXT_MIN_CHARACTERS}–${VOICE_DESIGN_TEXT_MAX_CHARACTERS}.`,
    meta: {
      min: VOICE_DESIGN_TEXT_MIN_CHARACTERS,
      max: VOICE_DESIGN_TEXT_MAX_CHARACTERS,
      actual,
      source: VOICE_DESIGN_DOCS_URL,
    },
  });
}

/**
 * `reference_audio_base64` and `prompt_strength` are "only supported when
 * using the eleven_ttv_v3 model" — checked against the documented server-side
 * default when `model_id` is omitted.
 */
function checkV3OnlyFields(
  params: TextToVoiceDesignParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model_id ?? DEFAULT_VOICE_DESIGN_MODEL_ID;
  if (model === "eleven_ttv_v3") return;
  for (const field of ["reference_audio_base64", "prompt_strength"] as const) {
    if (params[field] == null) continue;
    ctx.report({
      code: "unsupported_param",
      path: [field],
      model,
      message: `\`${field}\` is only supported when using the eleven_ttv_v3 model; "${model}" does not accept it.`,
      meta: { source: VOICE_DESIGN_DOCS_URL },
    });
  }
}

function checkOutputFormat(
  params: TextToVoiceDesignParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.output_format;
  if (format === undefined || OUTPUT_FORMAT_SET.has(format)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["output_format"],
    message: `\`output_format\` must be one of ${VOICE_DESIGN_OUTPUT_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
    meta: { allowed: [...VOICE_DESIGN_OUTPUT_FORMATS], value: format, source: VOICE_DESIGN_DOCS_URL },
  });
}

// No estimate: elevenlabs.io/pricing/api publishes no USD rate for voice
// design.

// ---------------------------------------------------------------------------
// Finalize: wire body (output_format stripped — it lives in the URL) +
// .toSdk("elevenlabs") + .request
// ---------------------------------------------------------------------------

/** The documented query params of POST /v1/text-to-voice/design. */
export interface TextToVoiceDesignQuery {
  output_format?: ElevenlabsVoiceDesignOutputFormat;
}

/** Endpoint URL with the documented query param appended. */
export function textToVoiceDesignUrl(query: TextToVoiceDesignQuery = {}): string {
  return query.output_format === undefined
    ? TEXT_TO_VOICE_DESIGN_URL
    : `${TEXT_TO_VOICE_DESIGN_URL}?output_format=${query.output_format}`;
}

/** Wire snake_case → SDK camelCase for top-level body keys. */
const SDK_KEY_MAP: Record<string, string> = {
  voice_description: "voiceDescription",
  model_id: "modelId",
  text: "text",
  auto_generate_text: "autoGenerateText",
  loudness: "loudness",
  quality: "quality",
  seed: "seed",
  guidance_scale: "guidanceScale",
  stream_previews: "streamPreviews",
  should_enhance: "shouldEnhance",
  remixing_session_id: "remixingSessionId",
  remixing_session_iteration_id: "remixingSessionIterationId",
  reference_audio_base64: "referenceAudioBase64",
  prompt_strength: "promptStrength",
};

type TextToVoiceDesignBody = Omit<TextToVoiceDesignParams, "output_format">;

function buildSdkParams(
  query: TextToVoiceDesignQuery,
  body: TextToVoiceDesignBody,
): TextToVoiceDesignSdkParams {
  const request: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value == null) continue; // null = provider default → omitted for the SDK
    request[SDK_KEY_MAP[key] ?? key] = value; // unknown params pass through unchanged
  }
  // The SDK takes the query param inside the same request object.
  if (query.output_format !== undefined) request.outputFormat = query.output_format;
  return request as unknown as TextToVoiceDesignSdkParams;
}

/**
 * SDK targets for `elevenlabs.voiceDesign`. `"elevenlabs"` camelCases the wire
 * body into the request object `@elevenlabs/elevenlabs-js`'s
 * `client.textToVoice.design(request)` takes. Type alias, not interface: an
 * interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type VoiceDesignSdkTargets = { elevenlabs: () => TextToVoiceDesignSdkParams };

function finalize(params: TextToVoiceDesignParams): unknown {
  const { output_format, ...body } = params;
  const query: TextToVoiceDesignQuery = {
    ...(output_format !== undefined && { output_format }),
  };
  return toValidated(
    body,
    {
      url: textToVoiceDesignUrl(query),
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { elevenlabs: () => buildSdkParams(query, body) } },
  );
}

const validator = createValidator<TextToVoiceDesignParams, unknown>({
  endpoint: "elevenlabs.voiceDesign",
  schema: textToVoiceDesignSchema,
  // model_id is optional on the wire; checks run against the documented
  // server-side default so the ttv_v3-only gate applies when omitted.
  modelId: (params) => params.model_id ?? DEFAULT_VOICE_DESIGN_MODEL_ID,
  catalog: models,
  checks: [checkVoiceDesignModelKind, checkTextLength, checkV3OnlyFields, checkOutputFormat],
  finalize,
});

/**
 * Validates raw wire params for ElevenLabs
 * `POST /v1/text-to-voice/design` — voice design phase 1, which generates
 * preview candidates and persists nothing.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `output_format` (query param) is stripped and lives in `.request.url`
 * instead. `.toSdk("elevenlabs")` returns the camelCase request object for
 * `@elevenlabs/elevenlabs-js`'s `client.textToVoice.design(request)`. Each
 * response preview carries a `generated_voice_id`; pass one to
 * `elevenlabs.voiceDesignSave` (POST /v1/text-to-voice) to persist it as a
 * real voice. Auth is your job: add an `xi-api-key` header when fetching.
 */
export const voiceDesign = validator as unknown as {
  <T extends TextToVoiceDesignParams>(
    params: T & ExactKeys<T, TextToVoiceDesignParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "output_format">, VoiceDesignSdkTargets>;
  safe<T extends TextToVoiceDesignParams>(
    params: T & ExactKeys<T, TextToVoiceDesignParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "output_format">, VoiceDesignSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
