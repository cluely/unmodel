/**
 * Hume Octave voice conversion —
 * POST https://api.hume.ai/v0/tts/voice_conversion/file
 *
 * Wire reference: https://dev.hume.ai/reference/text-to-speech-tts/convert-voice-file
 * and https://dev.hume.ai/docs/text-to-speech-tts/voice-conversion, cross-checked
 * against the `hume` npm package 0.16.1 (`tts.convertVoiceFile`) — all three
 * fetched 2026-08-31.
 *
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated form fields (including the `audio` Blob) — do NOT
 *   JSON.stringify them. The raw-fetch path is `.request.url` +
 *   `stsToFormData(params)` as the body; fetch derives the multipart
 *   content-type (with boundary) from the FormData, which is why
 *   `.request.headers` is empty. That also makes `hume.sts` library-only and
 *   CLI-unreachable (`MULTIPART_ONLY`).
 * - NO `model` FIELD, and unlike `hume.tts` there is no `version` either: the
 *   whole Octave-selection mechanism is absent from this route. unmodel
 *   addresses it through the synthetic catalog id
 *   {@link STS_MODEL_ID} — the route noun, per `src/providers/HAND_CATALOGS.md`.
 * - SIX FIELDS, and that is the complete list: `audio`, `voice`, `format`,
 *   `context`, `strip_headers`, `include_timestamp_types`. There is no
 *   `instant_mode`, no `split_utterances`, no `num_generations`, no
 *   `temperature` and no `version` — every one of which `POST /v0/tts` does
 *   have. The absence is checked, not assumed: the SDK's `convertVoiceFile`
 *   appends exactly these six parts and no others.
 * - `audio` is REQUIRED here and OPTIONAL on the `/json` sibling. Docs and SDK
 *   agree, so it is treated as the wire contract rather than smoothed over.
 * - MULTIPART ENCODING: `voice`, `context` and `format` are objects, and Hume
 *   documents TWO accepted encodings for them. The reference's cURL uses
 *   bracket parts (`voice[name]=…`, `voice[provider]=…`) and the reference text
 *   says `include_timestamp_types` takes indexed brackets; the official SDK
 *   instead sends one JSON-string part per object and one repeated part per
 *   list element. {@link stsToFormData} emits the **SDK's** encoding, for two
 *   reasons: it is one uniform rule rather than a mix (a nested `context` has
 *   no readable bracket spelling), and it is the encoding every user of Hume's
 *   own client provably sends. It is also this repo's stated convention —
 *   `elevenlabs.stt` and `elevenlabs.voiceClone` both say "encoding matches the
 *   official SDK's serialization" for the same reason. `voice[name]` is the
 *   documented alternative if you prefer to build the form yourself.
 * - INPUT AUDIO (docs, verbatim): "Format: Supported formats include `MP3`,
 *   `WAV`, `M4A`, and `OGG`"; "Duration: Audio files should be at least 12
 *   seconds long and less than 3 minutes in duration"; "Sample rate: 44.1kHz is
 *   recommended". Guidance rather than a schema bound, and unmodel cannot read
 *   a duration or a codec out of a `Blob`, so none of it becomes a check.
 * - The `/v0/tts/voice_conversion/json` sibling is deliberately not a second
 *   address: it takes the same six fields and differs only in the response
 *   (a newline-delimited stream of base64 snippets instead of a file
 *   download). {@link VOICE_CONVERSION_JSON_URL} names it; POST the same body.
 * - PRICING: none published. https://www.hume.ai/pricing carries voice
 *   conversion as a feature-availability row across all seven plans with no
 *   rate attached — no per-character, per-minute or per-second figure anywhere
 *   — and the page's only character rates are TTS rates for a route that takes
 *   no text. So `cost` is omitted on the catalog row and there is no estimate:
 *   "Unverifiable → caveat, never catalog". (Do not read the pricing page's
 *   separate "Speech-to-speech" row as this route — it is flagged `eviToggle`
 *   and belongs to EVI, the realtime product.)
 * - The response is a binary file download; the reference documents no
 *   Content-Type, and there is no JSON envelope, so there is no response
 *   checker.
 * - Auth is an `X-Hume-Api-Key` header — unmodel never touches keys; add it
 *   yourself when fetching.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import type { HumeContext, HumeFormat, HumeTimestampType, HumeVoiceRef } from "./tts";

export const VOICE_CONVERSION_URL = "https://api.hume.ai/v0/tts/voice_conversion/file";
/** Same six fields; the response is a stream of base64 snippets rather than a file. */
export const VOICE_CONVERSION_JSON_URL = "https://api.hume.ai/v0/tts/voice_conversion/json";

const VOICE_CONVERSION_DOCS =
  "https://dev.hume.ai/reference/text-to-speech-tts/convert-voice-file";

/**
 * Synthetic catalog id for this route — it has no `model` field and no
 * `version` field, and Hume documents no mode name for it, so the id is the
 * route noun (the `cartesia.voiceClone` arrangement).
 */
export const STS_MODEL_ID = "voice-conversion";

// ---------------------------------------------------------------------------
// Wire types — mirror the multipart form fields exactly (snake_case). The three
// object fields keep the shapes ./tts already declares for them.
// ---------------------------------------------------------------------------

export interface VoiceConversionBody {
  /**
   * "Audio file containing speech to be converted to the target voice.
   * Supported formats include `MP3`, `WAV`, `M4A`, and `OGG`." Required on
   * this route (optional on the `/json` sibling).
   */
  audio: Blob;
  /**
   * The target voice, by `id` or by `name`, with the optional `provider`
   * saying which catalog to look in. "If no provider is explicitly set, the
   * default provider is `CUSTOM_VOICE`. When using voices from Hume's Voice
   * Library, you must explicitly set the provider to `HUME_AI`."
   */
  voice?: HumeVoiceRef | null;
  /** "Specifies the output audio file format." */
  format?: HumeFormat;
  /**
   * "Utterances to use as context for generating consistent speech style and
   * prosody across multiple requests. These will not be converted to speech
   * output."
   */
  context?: HumeContext | null;
  /**
   * "If enabled, the audio for all the chunks of a generation, once
   * concatenated together, will constitute a single audio file."
   */
  strip_headers?: boolean;
  /**
   * "The set of timestamp types to include in the response. … Only supported
   * for Octave 2 requests." This route has no version field to say so with, so
   * unmodel passes it through unremarked.
   */
  include_timestamp_types?: HumeTimestampType[];
}

// ---------------------------------------------------------------------------
// SDK view — the `hume` package's client.tts.convertVoiceFile(request) takes
// the same fields camelCased, with the objects still objects (the client does
// the JSON encoding itself).
// ---------------------------------------------------------------------------

export interface VoiceConversionSdkParams {
  audio: Blob;
  voice?: HumeVoiceRef;
  format?: HumeFormat;
  context?: HumeContext;
  stripHeaders?: boolean;
  includeTimestampTypes?: HumeTimestampType[];
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const voiceSchema = z.union([
  z.looseObject({
    id: z.string().min(1, "voice.id must not be empty."),
    provider: z.enum(["HUME_AI", "CUSTOM_VOICE"]).optional(),
  }),
  z.looseObject({
    name: z.string().min(1, "voice.name must not be empty."),
    provider: z.enum(["HUME_AI", "CUSTOM_VOICE"]).optional(),
  }),
]);

const utteranceSchema = z.looseObject({
  text: z.string(),
  description: z.string().nullable().optional(),
  speed: z.number().min(0.5).max(2).optional(),
  trailing_silence: z.number().min(0).max(5).optional(),
  voice: voiceSchema.nullable().optional(),
});

const voiceConversionSchema = z.looseObject({
  audio: z.instanceof(Blob, { message: "audio must be a Blob or File" }),
  voice: voiceSchema.nullable().optional(),
  format: z.looseObject({ type: z.enum(["mp3", "pcm", "wav"]) }).optional(),
  context: z
    .union([
      z.looseObject({ generation_id: z.string().min(1) }),
      z.looseObject({ utterances: z.array(utteranceSchema) }),
    ])
    .nullable()
    .optional(),
  strip_headers: z.boolean().optional(),
  include_timestamp_types: z.array(z.enum(["word", "phoneme"])).optional(),
});

// No checks: every documented constraint on this route is either in the schema
// above or a fact about the audio bytes (format, 12s–3min duration, sample
// rate) that unmodel cannot read out of a `Blob`. See the module JSDoc.
//
// No estimate either: hume.ai/pricing publishes no rate for voice conversion.

// ---------------------------------------------------------------------------
// FormData helper + finalize
// ---------------------------------------------------------------------------

/** Object fields the official SDK JSON-stringifies into one form part each. */
const JSON_FIELDS = new Set<string>(["voice", "format", "context"]);

/**
 * Builds the multipart/form-data body for
 * `POST /v0/tts/voice_conversion/file` from validated params. Encoding matches
 * the official SDK's serialization: `audio` is the file part, `voice` /
 * `format` / `context` become one JSON-string part each,
 * `include_timestamp_types` is appended item by item under the same key, and
 * booleans are stringified. Null/undefined fields are omitted. See the module
 * JSDoc for the documented bracket-notation alternative.
 *
 * ```ts
 * const params = hume.sts({ audio: blob, voice: { name: "Inspiring Man", provider: "HUME_AI" } });
 * await fetch(params.request.url, {
 *   method: "POST",
 *   headers: { "X-Hume-Api-Key": process.env.HUME_API_KEY! },
 *   body: hume.stsToFormData(params),
 * });
 * ```
 */
export function stsToFormData(params: VoiceConversionBody): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (key === "audio") {
      form.append("audio", value as Blob);
      continue;
    }
    if (JSON_FIELDS.has(key) && typeof value === "object") {
      form.append(key, JSON.stringify(value));
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/** Wire snake_case → SDK camelCase. */
const SDK_KEY_MAP: Record<string, string> = {
  audio: "audio",
  voice: "voice",
  format: "format",
  context: "context",
  strip_headers: "stripHeaders",
  include_timestamp_types: "includeTimestampTypes",
};

function buildSdkParams(params: VoiceConversionBody): VoiceConversionSdkParams {
  const sdk: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue; // null → omitted for the SDK
    sdk[SDK_KEY_MAP[key] ?? key] = value; // unknown params pass through unchanged
  }
  return sdk as unknown as VoiceConversionSdkParams;
}

/**
 * SDK targets for `hume.sts`. `"hume"` camelCases the wire fields into the
 * request object the `hume` package's `client.tts.convertVoiceFile(request)`
 * takes. Type alias, not interface: an interface has no implicit index
 * signature and cannot satisfy `SdkFormatters`.
 */
type VoiceConversionSdkTargets = { hume: () => VoiceConversionSdkParams };

function finalize(params: VoiceConversionBody): unknown {
  return toValidated(
    params,
    {
      url: VOICE_CONVERSION_URL,
      method: "POST",
      // Deliberately NOT application/json: this is a multipart endpoint, and
      // fetch must derive the multipart boundary from the FormData body itself.
      headers: {},
      body: "form",
    },
    { sdk: { hume: () => buildSdkParams(params) } },
  );
}

const validator = createValidator<VoiceConversionBody, unknown>({
  endpoint: "hume.sts",
  schema: voiceConversionSchema,
  // No model field and no version field on this wire — the synthetic catalog
  // id stands in so catalog-keyed machinery stays coherent (see module JSDoc).
  modelId: () => STS_MODEL_ID,
  catalog: models,
  finalize,
});

/**
 * Validates params for Hume `POST /v0/tts/voice_conversion/file` — convert a
 * recording so it sounds like a different voice, keeping the original timing
 * and delivery.
 *
 * This is a multipart endpoint: the validated output's enumerable props are the
 * validated form fields (including the `audio` Blob), and the raw-fetch path is
 * `.request.url` + `stsToFormData(validated)` as the body — never
 * `JSON.stringify`. `.toSdk("hume")` returns the camelCase request object for
 * the `hume` package's `client.tts.convertVoiceFile(request)`.
 *
 * There is no cost estimate: Hume publishes no rate for this route
 * ({@link VOICE_CONVERSION_DOCS} and the module JSDoc record the search).
 */
export const sts = validator as unknown as {
  <T extends VoiceConversionBody>(
    params: T & ExactKeys<T, VoiceConversionBody>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, VoiceConversionSdkTargets>;
  safe<T extends VoiceConversionBody>(
    params: T & ExactKeys<T, VoiceConversionBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, VoiceConversionSdkTargets>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
