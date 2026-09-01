/**
 * ElevenLabs Sound Effects — POST https://api.elevenlabs.io/v1/sound-generation
 *
 * Wire notes (verified against
 * https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert and
 * the machine-readable https://api.elevenlabs.io/openapi.json on 2026-08-31 —
 * `Body_Sound_Generation_v1_sound_generation_post` plus the `SFXModelId` and
 * `AllowedOutputFormats` components):
 * - `text` is the only REQUIRED field, and unlike `/v1/music`'s `prompt` it
 *   carries no maxLength on the served spec. (fal's resale of the same model
 *   caps it at 450 characters; that is fal's narrowing, not ElevenLabs'.)
 * - `output_format` is a QUERY param, not a body field — the same placement
 *   `/v1/music` uses, and the same trap: sending it in the JSON body is a
 *   silent no-op. It is stripped from the wire body and appended to
 *   `.request.url`. Default `mp3_44100_128`.
 * - The `AllowedOutputFormats` enum here is NOT the music one. It has 21
 *   members against music's 26: no `"auto"`, and no 48 kHz MP3 arm at all
 *   (`mp3_48000_128` and its siblings exist at `/v1/music` and not here). A
 *   single shared list would therefore accept four values this endpoint
 *   rejects, which is why the constant is declared per endpoint.
 * - `duration_seconds` is `anyOf[number, null]`, 0.5–30. **Absent (or explicit
 *   `null`) means the model guesses a length from the prompt** — the API's own
 *   words are "If set to None we will guess the optimal duration using the
 *   prompt" — which is a real behaviour rather than a default value, and is why
 *   the unified adapter warns about nothing when the caller omits it.
 * - `loop` is documented "Only available for the 'eleven_text_to_sound_v2
 *   model'", which is the only model the enum has; the sentence is a forward
 *   statement about future ids, so `checkSfxModelKind` is what enforces it.
 * - `prompt_influence` is 0–1, default 0.3.
 * - `model_id` is a one-member enum (`eleven_text_to_sound_v2`) that also
 *   serves as the server-side default.
 * - The endpoint responds with raw audio bytes (`audio/mpeg`) plus a
 *   `character-cost` response header, not JSON, so there is no response checker
 *   for sound effects.
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
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { models, SFX_MODEL_IDS, type ElevenlabsSfxModelId } from "./models";

export const SOUND_EFFECTS_URL = "https://api.elevenlabs.io/v1/sound-generation";

const SOUND_EFFECTS_DOCS_URL =
  "https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert";

/** The served spec, which is where the enums and the bounds below are read from. */
const SOUND_EFFECTS_OPENAPI_URL =
  "https://api.elevenlabs.io/openapi.json#/paths/~1v1~1sound-generation/post";

/**
 * Server-side default when `model_id` is omitted — `"default":
 * "eleven_text_to_sound_v2"` on the `SFXModelId` component. Model-dependent
 * checks (the `loop` gate, cost) run against this model when none is given.
 */
export const DEFAULT_SFX_MODEL_ID = "eleven_text_to_sound_v2";

/**
 * `output_format` query values ("codec_sample_rate[_bitrate]") — the
 * `AllowedOutputFormats` component.
 *
 * **Not the same list `/v1/music` takes.** There is no `"auto"` here, and no
 * 48 kHz MP3 arm: `mp3_48000_128`, `mp3_48000_192`, `mp3_48000_240` and
 * `mp3_48000_320` are music-only. Some members are plan-gated (192 kbps MP3
 * needs Creator, 44.1 kHz PCM needs Pro); unmodel cannot see your plan, so all
 * documented values pass.
 */
export const SOUND_EFFECTS_OUTPUT_FORMATS = [
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
  "pcm_8000",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_32000",
  "pcm_44100",
  "pcm_48000",
  "ulaw_8000",
  "alaw_8000",
  "opus_48000_32",
  "opus_48000_64",
  "opus_48000_96",
  "opus_48000_128",
  "opus_48000_192",
] as const;
export type ElevenlabsSoundEffectsOutputFormat = (typeof SOUND_EFFECTS_OUTPUT_FORMATS)[number];

/** Documented bounds of `duration_seconds` ("at least 0.5 and at most 30"). */
export const SOUND_EFFECTS_DURATION_SECONDS_MIN = 0.5;
export const SOUND_EFFECTS_DURATION_SECONDS_MAX = 30;
/** Documented bounds of `prompt_influence` ("a value between 0 and 1"). */
export const SOUND_EFFECTS_PROMPT_INFLUENCE_MIN = 0;
export const SOUND_EFFECTS_PROMPT_INFLUENCE_MAX = 1;

// ---------------------------------------------------------------------------
// Wire types — mirror the raw JSON body exactly (snake_case).
// ---------------------------------------------------------------------------

export interface SoundEffectsParams {
  /** The text that will get converted into a sound effect. REQUIRED. */
  text: string;
  /**
   * Generate an effect that loops smoothly. Default false, and documented
   * "Only available for the 'eleven_text_to_sound_v2 model'".
   */
  loop?: boolean;
  /**
   * Length in seconds, 0.5–30. `null` (and absence) means the model guesses a
   * length from the prompt — the wire's own documented behaviour, not a
   * default value.
   */
  duration_seconds?: number | null;
  /**
   * How closely the generation follows the prompt, 0–1, default 0.3. Higher is
   * closer and less varied.
   */
  prompt_influence?: number | null;
  /** Defaults to "eleven_text_to_sound_v2" server-side. */
  model_id?: ElevenlabsSfxModelId | (string & {});
  /**
   * QUERY param — stripped from the wire body and appended to `.request.url`
   * as `?output_format=…`. Default "mp3_44100_128".
   *
   * Closed: SOUND_EFFECTS_OUTPUT_FORMATS is the complete documented list and
   * checkOutputFormat hard-errors (`invalid_enum_value`) on anything else, so
   * there is no `(string & {})` escape to widen it — the same treatment
   * `MusicParams.output_format` already gets.
   */
  output_format?: ElevenlabsSoundEffectsOutputFormat;
}

// ---------------------------------------------------------------------------
// SDK view — @elevenlabs/elevenlabs-js is camelCase:
// client.textToSoundEffects.convert({ text, durationSeconds, ... }), per the
// `x-fern-sdk-group-name: text_to_sound_effects` / `x-fern-sdk-method-name:
// convert` annotations on the served spec.
// ---------------------------------------------------------------------------

export interface SoundEffectsSdkParams {
  text?: string;
  loop?: boolean;
  durationSeconds?: number;
  promptInfluence?: number;
  modelId?: string;
  outputFormat?: ElevenlabsSoundEffectsOutputFormat;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const soundEffectsSchema = z.looseObject({
  text: z.string(),
  loop: z.boolean().optional(),
  duration_seconds: z
    .number()
    .min(
      SOUND_EFFECTS_DURATION_SECONDS_MIN,
      `duration_seconds must be between ${SOUND_EFFECTS_DURATION_SECONDS_MIN} and ${SOUND_EFFECTS_DURATION_SECONDS_MAX}`,
    )
    .max(
      SOUND_EFFECTS_DURATION_SECONDS_MAX,
      `duration_seconds must be between ${SOUND_EFFECTS_DURATION_SECONDS_MIN} and ${SOUND_EFFECTS_DURATION_SECONDS_MAX}`,
    )
    .nullable()
    .optional(),
  prompt_influence: z
    .number()
    .min(
      SOUND_EFFECTS_PROMPT_INFLUENCE_MIN,
      `prompt_influence must be between ${SOUND_EFFECTS_PROMPT_INFLUENCE_MIN} and ${SOUND_EFFECTS_PROMPT_INFLUENCE_MAX}`,
    )
    .max(
      SOUND_EFFECTS_PROMPT_INFLUENCE_MAX,
      `prompt_influence must be between ${SOUND_EFFECTS_PROMPT_INFLUENCE_MIN} and ${SOUND_EFFECTS_PROMPT_INFLUENCE_MAX}`,
    )
    .nullable()
    .optional(),
  model_id: z.string().optional(),
  output_format: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const SFX_MODEL_ID_SET = new Set<string>(SFX_MODEL_IDS);
const OUTPUT_FORMAT_SET = new Set<string>(SOUND_EFFECTS_OUTPUT_FORMATS);

/**
 * The catalog carries every documented ElevenLabs model id, so a music or TTS
 * id would otherwise resolve and pass sound-effects validation unremarked. Ids
 * unknown to the catalog stay a warning (`unknown_model`) — they may be new
 * sound-effects models.
 */
function checkSfxModelKind(
  params: SoundEffectsParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model_id ?? DEFAULT_SFX_MODEL_ID;
  if (info === undefined || SFX_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model_id"],
    model,
    message: `"${model}" is not a sound-effects model; POST /v1/sound-generation accepts ${SFX_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...SFX_MODEL_IDS], source: SOUND_EFFECTS_DOCS_URL },
  });
}

/**
 * `loop` is documented "Only available for the 'eleven_text_to_sound_v2
 * model'". Today's enum has exactly that one member, so this fires only for a
 * model id the catalog does not know — which is the case the sentence is
 * about, and the reason it is checked rather than assumed away.
 *
 * Warning severity: the API states no rejection, so an unknown future id that
 * does support looping must not have its request refused here.
 */
function checkLoopModel(
  params: SoundEffectsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.loop !== true) return;
  const model = params.model_id ?? DEFAULT_SFX_MODEL_ID;
  if (SFX_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["loop"],
    model,
    message: `\`loop\` is documented as available only for "${DEFAULT_SFX_MODEL_ID}"; "${model}" is not a sound-effects model this build knows.`,
    meta: { ignored: true, source: SOUND_EFFECTS_DOCS_URL },
  });
}

function checkOutputFormat(
  params: SoundEffectsParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.output_format;
  if (format === undefined || OUTPUT_FORMAT_SET.has(format)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["output_format"],
    message: `\`output_format\` must be one of ${SOUND_EFFECTS_OUTPUT_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
    meta: {
      allowed: [...SOUND_EFFECTS_OUTPUT_FORMATS],
      value: format,
      source: SOUND_EFFECTS_OPENAPI_URL,
    },
  });
}

// ---------------------------------------------------------------------------
// Estimation — sound effects are billed per minute of GENERATED audio at the
// same $0.12 rate as Voice Changer, and the request states the length only
// when `duration_seconds` is set. Absent (the model guesses) → no estimate,
// because the length is the model's answer rather than the request's question.
// ---------------------------------------------------------------------------

function estimate(params: SoundEffectsParams, info: ModelInfo | undefined, _ctx: PipelineContext) {
  const seconds = params.duration_seconds;
  if (seconds == null) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, minutesFromSeconds(seconds));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (output_format stripped — it lives in the URL)
// + .toSdk("elevenlabs") + .request
// ---------------------------------------------------------------------------

/** Endpoint URL with the documented `output_format` query param appended. */
export function soundEffectsUrl(outputFormat?: ElevenlabsSoundEffectsOutputFormat): string {
  return outputFormat === undefined
    ? SOUND_EFFECTS_URL
    : `${SOUND_EFFECTS_URL}?${new URLSearchParams({ output_format: outputFormat }).toString()}`;
}

/** Wire snake_case → SDK camelCase for top-level body keys. */
const SDK_KEY_MAP: Record<string, string> = {
  text: "text",
  loop: "loop",
  duration_seconds: "durationSeconds",
  prompt_influence: "promptInfluence",
  model_id: "modelId",
};

function buildSdkParams(
  outputFormat: ElevenlabsSoundEffectsOutputFormat | undefined,
  body: object,
): SoundEffectsSdkParams {
  const request: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value == null) continue; // null = provider default → omitted for the SDK
    request[SDK_KEY_MAP[key] ?? key] = value; // unknown params pass through unchanged
  }
  if (outputFormat !== undefined) request.outputFormat = outputFormat;
  return request as SoundEffectsSdkParams;
}

/**
 * SDK targets for `elevenlabs.sfx`. `"elevenlabs"` camelCases the wire body
 * into the request object `@elevenlabs/elevenlabs-js`'s
 * `client.textToSoundEffects.convert(request)` takes. Type alias, not
 * interface: an interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type SoundEffectsSdkTargets = { elevenlabs: () => SoundEffectsSdkParams };

function finalize(params: SoundEffectsParams): unknown {
  const { output_format, ...body } = params;
  return toValidated(
    body,
    {
      url: soundEffectsUrl(output_format),
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { elevenlabs: () => buildSdkParams(output_format, body) } },
  );
}

const validator = createValidator<SoundEffectsParams, unknown>({
  endpoint: "elevenlabs.sfx",
  schema: soundEffectsSchema,
  // model_id is optional on the wire; checks run against the documented
  // server-side default (eleven_text_to_sound_v2).
  modelId: (params) => params.model_id ?? DEFAULT_SFX_MODEL_ID,
  catalog: models,
  checks: [checkSfxModelKind, checkLoopModel, checkOutputFormat],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for ElevenLabs `POST /v1/sound-generation`.
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `output_format` is a query param and lives in `.request.url` instead.
 * `.toSdk("elevenlabs")` returns the camelCased params object for
 * `@elevenlabs/elevenlabs-js`'s `client.textToSoundEffects.convert(request)`.
 * Auth is your job: add an `xi-api-key` header when fetching.
 *
 * Cost is estimated at $0.12 per minute of generated audio whenever the request
 * states a length; with `duration_seconds` absent the model picks the length,
 * so there is nothing to bill against and no estimate is returned.
 *
 * ```ts
 * const params = elevenlabs.sfx({
 *   text: "A heavy oak door creaking open in a stone hall",
 *   duration_seconds: 4,
 *   output_format: "mp3_44100_128",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const audio = await res.arrayBuffer();
 * ```
 */
export const sfx = validator as unknown as {
  <T extends SoundEffectsParams>(
    params: T & ExactKeys<T, SoundEffectsParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "output_format">, SoundEffectsSdkTargets>;
  safe<T extends SoundEffectsParams>(
    params: T & ExactKeys<T, SoundEffectsParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "output_format">, SoundEffectsSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
