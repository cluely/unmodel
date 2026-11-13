/**
 * Inworld voice cloning — POST https://api.inworld.ai/voices/v1/voices:clone
 *
 * Wire reference:
 * https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/clone-voice and
 * https://docs.inworld.ai/tts/instant-voice-cloning (verified 2026-11-12).
 *
 * - JSON with INLINE BASE64 audio: each `voiceSamples[].audioData` carries the
 *   recording's bytes base64-encoded, so — unlike the multipart clone routes
 *   at other providers — a plain JSON document expresses the whole request.
 * - Sample limits: "Accepted formats: wav, mp3, webm. Maximum file size is
 *   12MB." (the cloning guide and the CLI's "max 12MB"; the API reference
 *   prints no byte cap), "as little as 3 seconds" useful, and a "30-second
 *   limit" after which audio is trimmed. The 12MB cap is checked from the
 *   base64 length; duration cannot be read from bytes and is not checked.
 * - LANGUAGE, TWICE: `languageCode` is the canonical BCP-47-shaped spelling,
 *   `langCode` the legacy enum — "Set at most one of `languageCode` or
 *   `langCode`", enforced here. `gender`/`ageGroup` "cannot be set at
 *   clone time" (UpdateVoice only), so they are deliberately absent.
 * - There is no model field. unmodel addresses the route through the
 *   synthetic catalog id `voice-clone` (the route noun — Inworld documents no
 *   mode name for it).
 * - The response's `voice.voiceId` is the created voice's id — the value
 *   `voiceId` takes on POST /tts/v1/voice — plus per-sample validation
 *   results in `audioSamplesValidated`.
 * - Auth is an `Authorization: Basic <api_key>` header — unmodel never
 *   touches keys; add it yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS, toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import { decodedBase64Bytes } from "./audio-bytes";

export const VOICES_CLONE_URL = "https://api.inworld.ai/voices/v1/voices:clone";

const VOICE_CLONE_DOCS =
  "https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/clone-voice";
const VOICE_CLONING_GUIDE = "https://docs.inworld.ai/tts/instant-voice-cloning";

/**
 * Synthetic catalog id for this route — POST voices:clone has no model
 * field, and Inworld documents no mode name, so the id is the route noun.
 */
export const VOICE_CLONE_MODEL_ID = "voice-clone";

/** "Maximum file size is 12MB." per sample file (VOICE_CLONING_GUIDE, 2026-11-12). */
export const VOICE_CLONE_MAX_SAMPLE_BYTES = 12 * 1024 * 1024;

/**
 * The 16 `langCode` values the reference lists. Not the whole enum: "The full
 * accepted set is much larger than the values listed here: every supported
 * locale has an enum name (the locale with `-` replaced by `_`, uppercased —
 * `en-GB` becomes `EN_GB`)" (VOICE_CLONE_DOCS, 2026-11-12). New call sites
 * should prefer the BCP-47 `languageCode` spelling.
 */
export const INWORLD_LANG_CODES = [
  "AUTO",
  "AR_SA",
  "DE_DE",
  "EN_US",
  "ES_ES",
  "FR_FR",
  "HE_IL",
  "HI_IN",
  "IT_IT",
  "JA_JP",
  "KO_KR",
  "NL_NL",
  "PL_PL",
  "PT_BR",
  "RU_RU",
  "ZH_CN",
] as const;

export type InworldLangCode = (typeof INWORLD_LANG_CODES)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the CloneVoiceRequest fields exactly (camelCase, as
// Inworld's APIs are).
// ---------------------------------------------------------------------------

export interface InworldVoiceSample {
  /**
   * "Binary audio data for the sample (base64-encoded in JSON). Supports WAV
   * and MP3 formats." (The guide also lists webm.) ≤12MB decoded; ≤30s used.
   */
  audioData: string;
  /**
   * "Optional user-provided transcription of the audio sample. If one is not
   * provided, the transcription will be generated automatically."
   */
  transcription?: string;
}

export interface InworldAudioProcessingConfig {
  /**
   * "Whether to remove background noise from the samples. If true, an audio
   * isolation model will be used to clean the samples." Can degrade quality
   * if samples are already clean.
   */
  removeBackgroundNoise?: boolean;
}

export interface VoicesCloneBody {
  /**
   * "The human-readable name shown anywhere the voice is listed or
   * selected."
   */
  displayName: string;
  /** The reference recordings; at least one. */
  voiceSamples: InworldVoiceSample[];
  /**
   * "The voice's language as a canonical BCP-47-shaped locale string (e.g.
   * `en-US`, `en-GB`, `vi`)." Omit for auto-detection. Set at most one of
   * `languageCode` / `langCode`.
   */
  languageCode?: string;
  /** Legacy language enum; prefer `languageCode`. */
  langCode?: InworldLangCode | (string & {});
  /**
   * "Longer blurb that explains the voice's tone, accent, use cases, or
   * other relevant attributes."
   */
  description?: string;
  /** "Free-form labels for filtering, grouping, and discovery." */
  tags?: string[];
  audioProcessingConfig?: InworldAudioProcessingConfig;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const voiceSampleSchema = z.looseObject({
  audioData: z.string().min(1, "audioData must carry the sample's base64-encoded bytes"),
  transcription: z.string().optional(),
});

const schema = z.looseObject({
  displayName: z.string().min(1, "displayName must be a non-empty voice name"),
  voiceSamples: z
    .array(voiceSampleSchema)
    .min(1, "at least one voice sample is required to clone a voice"),
  languageCode: z.string().optional(),
  langCode: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  audioProcessingConfig: z
    .looseObject({ removeBackgroundNoise: z.boolean().optional() })
    .optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const LANG_CODE_SET = new Set<string>(INWORLD_LANG_CODES);

/** "Set at most one of `languageCode` or `langCode`." */
export function checkLanguageExclusivity(
  params: { languageCode?: string; langCode?: string },
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.languageCode === undefined || params.langCode === undefined) return;
  ctx.report({
    code: "invalid_shape",
    path: ["langCode"],
    message:
      "set at most one of `languageCode` or `langCode`; both are present. Prefer the BCP-47 `languageCode` — `langCode` is the legacy enum.",
    meta: { source: VOICE_CLONE_DOCS },
  });
}

/**
 * An enum name as the reference derives it: "the locale with `-` replaced by
 * `_`, uppercased" — `EN_GB`, `VI`, `ES_419` — or `AUTO`.
 */
const LANG_CODE_NAME_PATTERN = /^[A-Z]{2,3}(_[A-Z0-9]{2,8})*$/;

/**
 * The legacy enum is OPEN — "every supported locale has an enum name" — so a
 * value outside {@link INWORLD_LANG_CODES} is not refused. What is refused is
 * a value that cannot be an enum name at all, such as a BCP-47 tag
 * (`"en-US"`), which belongs in `languageCode`.
 */
export function checkLangCodeEnum(
  params: { langCode?: string },
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const code = params.langCode;
  if (code === undefined || LANG_CODE_SET.has(code) || LANG_CODE_NAME_PATTERN.test(code)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["langCode"],
    message: `\`langCode\` takes an enum name — the locale with \`-\` replaced by \`_\`, uppercased ("EN_GB" for en-GB), or "AUTO"; got ${JSON.stringify(code)}. Send a BCP-47 tag as \`languageCode\` instead.`,
    meta: { allowed: [...INWORLD_LANG_CODES], value: code, source: VOICE_CLONE_DOCS },
  });
}

/** "Maximum file size is 12MB" per sample, checked from the base64 payload's decoded length. */
function checkSampleSizes(
  params: VoicesCloneBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  params.voiceSamples.forEach((sample, index) => {
    if (typeof sample?.audioData !== "string") return;
    const bytes = decodedBase64Bytes(sample.audioData);
    if (bytes === undefined || bytes <= VOICE_CLONE_MAX_SAMPLE_BYTES) return;
    ctx.report({
      code: "media_too_large",
      path: ["voiceSamples", index, "audioData"],
      message: `voice sample ${index} decodes to ${bytes} bytes; Inworld caps cloning samples at ${VOICE_CLONE_MAX_SAMPLE_BYTES} bytes (12MB) — trim it to the 3–30 seconds cloning uses.`,
      meta: { bytes, limit: VOICE_CLONE_MAX_SAMPLE_BYTES, source: VOICE_CLONING_GUIDE },
    });
  });
}

// No estimate: inworld.ai/pricing publishes no per-request rate for voice
// cloning (storage is subscription-gated).

// ---------------------------------------------------------------------------
// Finalize — plain JSON body; `.toSdk("inworld")` is the identity (Inworld's
// voice API has no official JS SDK; the docs drive it with raw fetch).
// ---------------------------------------------------------------------------

type VoiceCloneSdkTargets<B> = { inworld: () => B };

function finalize(
  params: VoicesCloneBody,
): Validated<VoicesCloneBody, VoiceCloneSdkTargets<VoicesCloneBody>> {
  return toValidated(
    params,
    {
      url: VOICES_CLONE_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { inworld: () => params } },
  );
}

const validator = createValidator<
  VoicesCloneBody,
  Validated<VoicesCloneBody, VoiceCloneSdkTargets<VoicesCloneBody>>
>({
  endpoint: "inworld.voiceClone",
  schema,
  // No model field on this wire — the synthetic catalog id stands in so
  // catalog-keyed machinery stays coherent (see module JSDoc).
  modelId: () => VOICE_CLONE_MODEL_ID,
  catalog: models,
  checks: [checkLanguageExclusivity, checkLangCodeEnum, checkSampleSizes],
  finalize,
});

/**
 * Validates raw wire params for Inworld `POST /voices/v1/voices:clone`
 * (instant voice cloning from base64 audio samples).
 *
 * The result's enumerable properties are the exact fetch JSON body — the
 * samples ride inline as base64, so no FormData is involved. The response's
 * `voice.voiceId` is the created voice, usable as `voiceId` on
 * POST /tts/v1/voice. Auth is your job: add an
 * `authorization: Basic <api_key>` header when fetching.
 */
export const voiceClone = validator as unknown as {
  <T extends VoicesCloneBody>(
    params: T & ExactKeys<T, VoicesCloneBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, VoiceCloneSdkTargets<T>>;
  safe<T extends VoicesCloneBody>(
    params: T & ExactKeys<T, VoicesCloneBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, VoiceCloneSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
