/**
 * Cartesia voice cloning — POST https://api.cartesia.ai/voices/clone
 *
 * Wire notes (verified against
 * https://docs.cartesia.ai/api-reference/voices/clone and the
 * `VoiceCloneParams` TypedDict in cartesia-ai/cartesia-python on 2026-08-22):
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated params (including the `clip` Blob) — the
 *   raw-fetch path is `.request.url` + `voiceCloneToFormData(params)` as the
 *   body. `.request.headers` carries ONLY the required `Cartesia-Version`
 *   (fetch derives the multipart boundary from the FormData).
 * - VERSION PIN: the clone route documents `Cartesia-Version: 2026-08-14` —
 *   NEWER than the 2026-03-01 the TTS routes pin. Earlier versions took
 *   `mode` ("similarity"/"stability"), `enhance` and `transcript`; those
 *   fields are GONE in the current schema (the Python SDK confirms) and are
 *   deliberately not typed.
 * - `language` is REQUIRED — the only wave-1 clone route where it is — and
 *   is a closed 44-value ISO 639-1 enum. `accent` takes a catalog accent ID
 *   from GET /accents (e.g. `southern-us`), never a display name; unmodel
 *   cannot see the accent catalog, so the value is typed open.
 * - `access` defaults to "private" (unlike Fish Audio's public default).
 * - The response is `VoiceMetadata`; its `id` is the created voice —
 *   the value `voice.id` takes on POST /tts/bytes.
 * - PRICING: Cartesia bills cloned-voice USAGE in credits (Pro Voice Clone
 *   ~1.5 credits/character, see ./models); no rate is published for the
 *   clone call itself, so there is no estimate.
 * - Auth is an `X-API-Key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";

export const VOICES_CLONE_URL = "https://api.cartesia.ai/voices/clone";

const VOICE_CLONE_DOCS = "https://docs.cartesia.ai/api-reference/voices/clone";

/**
 * REQUIRED static `Cartesia-Version` header value for the voices routes —
 * newer than the TTS routes' pin, and the version whose schema this module
 * mirrors (checked 2026-08-22). Carried in `.request.headers`.
 */
export const VOICE_CLONE_CARTESIA_VERSION = "2026-08-14";

/**
 * Synthetic catalog id for this route — POST /voices/clone has no model
 * field, and Cartesia documents no mode name for it, so the id is the route
 * noun.
 */
export const VOICE_CLONE_MODEL_ID = "voice-clone";

/** "Max 32 characters. A few words describing the voice." */
export const VOICE_CLONE_TAGLINE_MAX_CHARACTERS = 32;

/**
 * The 44 documented `language` values (ISO 639-1) — REQUIRED on this wire.
 */
export const VOICE_CLONE_LANGUAGES = [
  "ar",
  "bg",
  "bn",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fi",
  "fr",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ka",
  "kn",
  "ko",
  "ml",
  "mr",
  "ms",
  "nl",
  "no",
  "or",
  "pa",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sv",
  "ta",
  "te",
  "th",
  "tl",
  "tr",
  "uk",
  "ur",
  "vi",
  "zh",
] as const;

export type CartesiaCloneLanguage = (typeof VOICE_CLONE_LANGUAGES)[number];

/** "Who can use the cloned voice." Default "private". */
export const VOICE_CLONE_ACCESS_VALUES = ["private", "public"] as const;
export type CartesiaVoiceAccess = (typeof VOICE_CLONE_ACCESS_VALUES)[number];

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly (snake_case).
// ---------------------------------------------------------------------------

export interface VoicesCloneParams {
  /**
   * The reference recording — exactly one clip; "flac, mp3, mpeg, mpga, oga,
   * ogg, wav, webm" (~5s recommended by the cloning guide).
   */
  clip: Blob;
  /** "The name of the voice." */
  name: string;
  /** "The language of the voice." REQUIRED; one of the 44 documented codes. */
  language: CartesiaCloneLanguage | (string & {});
  /** "A few words describing the voice." Max 32 characters. */
  tagline?: string;
  /** "A description for the voice, typically longer than the tagline." */
  description?: string;
  /**
   * "Catalog accent id from GET /accents (e.g. `southern-us`). Must be valid
   * for `language`." Display names are rejected by the API; the catalog is
   * per-version, so the value is typed open here.
   */
  accent?: string;
  /** "Optional base voice ID that the cloned voice is derived from." */
  base_voice_id?: string;
  /** "Who can use the cloned voice." Default "private". */
  access?: CartesiaVoiceAccess;
}

// ---------------------------------------------------------------------------
// SDK view — cartesia-js's client.voices.clone(request) takes the same
// fields; `clip` stays a file value and the rest ride through unchanged, so
// the formatter is the identity.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  clip: z.instanceof(Blob),
  name: z.string().min(1, "name must be a non-empty voice name"),
  language: z.string().min(1, "language is required on this wire"),
  tagline: z
    .string()
    .max(
      VOICE_CLONE_TAGLINE_MAX_CHARACTERS,
      `tagline is capped at ${VOICE_CLONE_TAGLINE_MAX_CHARACTERS} characters`,
    )
    .optional(),
  description: z.string().optional(),
  accent: z.string().optional(),
  base_voice_id: z.string().optional(),
  access: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const LANGUAGE_SET = new Set<string>(VOICE_CLONE_LANGUAGES);
const ACCESS_SET = new Set<string>(VOICE_CLONE_ACCESS_VALUES);

function checkLanguage(
  params: VoicesCloneParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const language = params.language;
  if (typeof language !== "string" || LANGUAGE_SET.has(language)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["language"],
    message: `\`language\` must be one of the 44 documented ISO 639-1 codes (${VOICE_CLONE_LANGUAGES.join(", ")}); got ${JSON.stringify(language)}.`,
    meta: { allowed: [...VOICE_CLONE_LANGUAGES], value: language, source: VOICE_CLONE_DOCS },
  });
}

function checkAccess(
  params: VoicesCloneParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const access = params.access;
  if (access === undefined || ACCESS_SET.has(access)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["access"],
    message: `\`access\` must be one of ${VOICE_CLONE_ACCESS_VALUES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(access)}.`,
    meta: { allowed: [...VOICE_CLONE_ACCESS_VALUES], value: access, source: VOICE_CLONE_DOCS },
  });
}

// No estimate: no rate is published for the clone call itself (usage of the
// resulting voice is billed in credits — see ./models).

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/**
 * Builds the multipart/form-data body for `POST /voices/clone` from validated
 * params. `clip` is the file part; everything else is a string part.
 *
 * ```ts
 * const params = cartesia.voiceClone({ clip: blob, name: "Narrator", language: "en" });
 * await fetch(params.request.url, {
 *   method: "POST",
 *   headers: { ...params.request.headers, "X-API-Key": process.env.CARTESIA_API_KEY! },
 *   body: cartesia.voiceCloneToFormData(params),
 * });
 * ```
 */
export function voiceCloneToFormData(params: VoicesCloneParams): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value instanceof Blob) form.append(key, value);
    else form.append(key, String(value));
  }
  return form;
}

/**
 * SDK targets for `cartesia.voiceClone`. `@cartesia/cartesia-js`'s
 * `client.voices.clone(request)` takes the same wire-shaped fields, so the
 * single `"cartesia"` formatter is the identity. Type alias, not interface:
 * an interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type VoiceCloneSdkTargets<B> = { cartesia: () => B };

function finalize(
  params: VoicesCloneParams,
): Validated<VoicesCloneParams, VoiceCloneSdkTargets<VoicesCloneParams>> {
  return toValidated(
    params,
    {
      url: VOICES_CLONE_URL,
      method: "POST",
      // Multipart: no content-type (fetch derives the boundary), but the
      // version header is REQUIRED on this wire.
      headers: { "Cartesia-Version": VOICE_CLONE_CARTESIA_VERSION },
    },
    { sdk: { cartesia: () => params } },
  );
}

const validator = createValidator<
  VoicesCloneParams,
  Validated<VoicesCloneParams, VoiceCloneSdkTargets<VoicesCloneParams>>
>({
  endpoint: "cartesia.voiceClone",
  schema,
  // No model field on this wire — the synthetic catalog id stands in so
  // catalog-keyed machinery stays coherent (see module JSDoc).
  modelId: () => VOICE_CLONE_MODEL_ID,
  catalog: models,
  checks: [checkLanguage, checkAccess],
  finalize,
});

/**
 * Validates params for Cartesia `POST /voices/clone` (instant voice cloning
 * from a single clip).
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the `clip` Blob), and the raw-fetch path is
 * `.request.url` + `voiceCloneToFormData(validated)` with the
 * `Cartesia-Version` header from `.request.headers` — never
 * `JSON.stringify`. The response `VoiceMetadata.id` is the created voice,
 * usable as `voice.id` on POST /tts/bytes. Auth is your job: add an
 * `X-API-Key` header when fetching.
 */
export const voiceClone = validator as unknown as {
  <T extends VoicesCloneParams>(
    params: T & ExactKeys<T, VoicesCloneParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, VoiceCloneSdkTargets<T>>;
  safe<T extends VoicesCloneParams>(
    params: T & ExactKeys<T, VoicesCloneParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, VoiceCloneSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
