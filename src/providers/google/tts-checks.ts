/**
 * The Gemini TTS check battery — shared, verbatim, by BOTH surfaces that can
 * reach a TTS request.
 *
 * `google.chat` keeps serving the TTS ids (generateContent genuinely serves
 * them, and a validator that refuses a request the API fulfils is the one
 * forbidden failure), while `google.tts` is a narrower Tier-A view of the same
 * route. Two copies of "is this voice name real" would be two answers within a
 * release, so the checks live here once and both validators call them.
 *
 * Every function below takes STRUCTURAL parameters — the speech config, a
 * path, the model id — rather than a body type, because the two callers do not
 * share a body type: `GenerateContentBody` allows nine part kinds and an
 * optional `generationConfig`, `GoogleTtsBody` allows one part kind and
 * requires it. The shared thing is the RULE, not the shape it is read out of.
 *
 * Runtime imports are `./tts-constraints` (import-free) and `./wire` (for the
 * 30 preset voices, which are declared there because `voiceName` is typed from
 * them). Deliberately NOT `./constraints`: that module reads the generated
 * catalog, and `unmodel/tts`'s bundle budget asserts zero catalogs.
 */

import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import {
  GEMINI_AUDIO_OUTPUT_MIME_TYPES,
  GEMINI_COMPRESSED_AUDIO_MIME_TYPES,
  GEMINI_SPEECH_NATIVE_SAMPLE_RATE,
  GEMINI_SPEECH_SAMPLE_RATE_RANGE,
  GEMINI_TTS_DOCS_URL,
  GEMINI_TTS_LANGUAGE_CODES,
  GEMINI_TTS_MAX_SPEAKERS,
  GEMINI_TTS_MODEL_IDS,
} from "./tts-constraints";
import { GEMINI_TTS_VOICES } from "./wire";

/** The REST reference backing the shape rules (SpeechConfig, AudioResponseFormat). */
const API_DOCS_URL = "https://ai.google.dev/api/generate-content";

// ---------------------------------------------------------------------------
// Structural views of the two wire objects the checks read. Both surfaces'
// concrete types are assignable to these; neither is imported here.
// ---------------------------------------------------------------------------

/** `VoiceConfig` as the checks read it — `voiceName` is `string`, on purpose. */
export interface VoiceConfigLike {
  prebuiltVoiceConfig?: { voiceName?: string } | undefined;
}

/** `SpeechConfig` as the checks read it. */
export interface SpeechConfigLike {
  voiceConfig?: VoiceConfigLike | undefined;
  multiSpeakerVoiceConfig?:
    | { speakerVoiceConfigs?: ReadonlyArray<{ speaker?: string; voiceConfig?: VoiceConfigLike }> }
    | undefined;
  languageCode?: string | undefined;
}

/** `AudioResponseFormat` as the checks read it. */
export interface AudioResponseFormatLike {
  mimeType?: string | undefined;
  delivery?: string | undefined;
  sampleRate?: number | undefined;
  bitRate?: number | undefined;
}

/** The `generationConfig` keys the shared capability triple reads. */
export interface TtsCapabilityConfigLike {
  temperature?: number | undefined;
  thinkingConfig?: unknown;
  maxOutputTokens?: number | undefined;
}

// ---------------------------------------------------------------------------
// Model identification
// ---------------------------------------------------------------------------

/**
 * Gemini TTS models. The docs name exactly three ids; the `-tts` suffix test
 * keeps newer snapshots of the same line covered instead of silently
 * unvalidated.
 */
export function isGeminiTtsModel(id: string): boolean {
  return (
    GEMINI_TTS_MODEL_IDS.includes(id as (typeof GEMINI_TTS_MODEL_IDS)[number]) ||
    /(^|[-.])tts([-.]|$)/.test(id)
  );
}

// ---------------------------------------------------------------------------
// S2/S3 — voice names and the speechConfig oneof
// ---------------------------------------------------------------------------

/**
 * S2 — `voiceName` must be one of the 30 presets.
 *
 * `enforceVoices` exists because `google.chat` reaches this for every model
 * that carries a `speechConfig`, including the Live-API ids whose voice
 * vocabulary is a different list. `google.tts` passes `true` unconditionally:
 * its model union is the TTS ids.
 */
export function checkVoiceName(
  voiceConfig: VoiceConfigLike | undefined,
  path: Array<string | number>,
  model: string,
  enforceVoices: boolean,
  ctx: PipelineContext,
): void {
  // Typed `string`, not GeminiTtsVoiceName: the wire type closes this field to
  // the 30 presets, but a JS caller (or a body parsed from JSON) still reaches
  // here with anything, and that is the whole point of the check below.
  const voiceName: string | undefined = voiceConfig?.prebuiltVoiceConfig?.voiceName;
  if (voiceName === undefined || !enforceVoices) return;
  if (GEMINI_TTS_VOICES.includes(voiceName as (typeof GEMINI_TTS_VOICES)[number])) return;
  ctx.report({
    code: "invalid_enum_value",
    path: [...path, "prebuiltVoiceConfig", "voiceName"],
    model,
    message: `\`voiceName\` must be one of the 30 prebuilt Gemini TTS voices; got ${JSON.stringify(voiceName)}.`,
    meta: { value: voiceName, allowed: [...GEMINI_TTS_VOICES], source: GEMINI_TTS_DOCS_URL },
  });
}

/**
 * S3–S5 + S11 — every rule that reads `generationConfig.speechConfig`:
 * the voiceConfig/multiSpeakerVoiceConfig oneof, the ≤2 speaker bound, each
 * speaker's voice name, and the language code.
 *
 * `basePath` is where the caller's `speechConfig` lives, so both surfaces
 * report at their own real coordinates.
 */
export function checkSpeechConfig(
  speechConfig: SpeechConfigLike | undefined,
  basePath: Array<string | number>,
  model: string,
  enforceVoices: boolean,
  ctx: PipelineContext,
): void {
  if (speechConfig == null) return;

  const multi = speechConfig.multiSpeakerVoiceConfig;
  // "It is mutually exclusive with the voiceConfig field."
  if (speechConfig.voiceConfig != null && multi != null) {
    ctx.report({
      code: "invalid_shape",
      path: [...basePath],
      model,
      message:
        "`speechConfig.voiceConfig` and `speechConfig.multiSpeakerVoiceConfig` are mutually exclusive; set exactly one.",
      meta: { source: API_DOCS_URL },
    });
  }

  checkVoiceName(speechConfig.voiceConfig, [...basePath, "voiceConfig"], model, enforceVoices, ctx);
  checkLanguageCode(speechConfig.languageCode, [...basePath, "languageCode"], model, ctx);

  if (multi == null) return;
  const speakers = multi.speakerVoiceConfigs ?? [];
  if (speakers.length > GEMINI_TTS_MAX_SPEAKERS) {
    ctx.report({
      code: "invalid_shape",
      path: [...basePath, "multiSpeakerVoiceConfig", "speakerVoiceConfigs"],
      model,
      message: `multi-speaker TTS supports up to ${GEMINI_TTS_MAX_SPEAKERS} speakers; got ${speakers.length}.`,
      meta: { limit: GEMINI_TTS_MAX_SPEAKERS, value: speakers.length, source: GEMINI_TTS_DOCS_URL },
    });
  }
  speakers.forEach((entry, i) => {
    checkVoiceName(
      entry?.voiceConfig,
      [...basePath, "multiSpeakerVoiceConfig", "speakerVoiceConfigs", i, "voiceConfig"],
      model,
      enforceVoices,
      ctx,
    );
  });
}

/**
 * S11 — `languageCode`'s primary subtag against the guide's table. A WARNING,
 * not an error, and the message says so: the table states which languages the
 * models *speak*, not which strings the field *rejects*, and the REST
 * reference's own example ("en-US") is a full BCP-47 tag the table does not
 * carry. So the check compares primary subtags only, and never fails a request
 * the API may well fulfil.
 */
export function checkLanguageCode(
  languageCode: string | undefined,
  path: Array<string | number>,
  model: string,
  ctx: PipelineContext,
): void {
  if (languageCode === undefined || languageCode === "") return;
  const primary = languageCode.split(/[-_]/)[0]?.toLowerCase() ?? "";
  if (GEMINI_TTS_LANGUAGE_CODES.includes(primary as (typeof GEMINI_TTS_LANGUAGE_CODES)[number])) {
    return;
  }
  ctx.report({
    code: "invalid_enum_value",
    severity: "warning",
    path: [...path],
    model,
    message:
      `\`languageCode\` ${JSON.stringify(languageCode)} has a primary subtag ("${primary}") that is ` +
      `not on the speech-generation guide's ${GEMINI_TTS_LANGUAGE_CODES.length}-language table. ` +
      "A warning rather than an error: the table lists the languages the models speak, not the values the field accepts.",
    meta: {
      value: languageCode,
      primarySubtag: primary,
      allowed: [...GEMINI_TTS_LANGUAGE_CODES],
      source: GEMINI_TTS_DOCS_URL,
    },
  });
}

// ---------------------------------------------------------------------------
// S7–S10 — generationConfig.responseFormat.audio
// ---------------------------------------------------------------------------

/**
 * S7–S10 — the audio output format block.
 *
 * - S7 `mimeType` off the twelve documented spellings → ERROR. Both first-party
 *   pages publish the same six values; only the spelling differs.
 * - S8 `bitRate` on an uncompressed format → ERROR. "Only applicable for
 *   compressed formats (MP3, Opus)" is unambiguous first-party wording.
 * - S9 `sampleRate` that is not a positive integer → ERROR (a shape fact, not
 *   a policy one).
 * - S10 `sampleRate` outside 8000–48000 → WARNING, and `meta.source` says the
 *   doc basis is thin: the only rate Google publishes is the 24 kHz native one.
 *
 * S10 reports `invalid_enum_value` at `severity: "warning"` rather than a code
 * of its own. `IssueCode` has no "this looks implausible" member, and
 * `invalid_enum_value` is already what this library reports for an
 * out-of-documented-range NUMBER (`generationConfig.temperature` outside
 * [0, 2] in ./chat) — the severity override is what carries "we are not sure",
 * and a caller can silence it per code like any other.
 */
export function checkAudioResponseFormat(
  audio: AudioResponseFormatLike | undefined,
  basePath: Array<string | number>,
  model: string,
  ctx: PipelineContext,
): void {
  if (audio == null) return;

  const { mimeType, sampleRate, bitRate } = audio;

  const known =
    mimeType !== undefined &&
    GEMINI_AUDIO_OUTPUT_MIME_TYPES.includes(mimeType as (typeof GEMINI_AUDIO_OUTPUT_MIME_TYPES)[number]);

  // S7. MIME_TYPE_UNSPECIFIED is the proto default and means "the model picks";
  // refusing it would be an error the API does not raise.
  if (mimeType !== undefined && !known && mimeType !== "MIME_TYPE_UNSPECIFIED") {
    ctx.report({
      code: "invalid_enum_value",
      path: [...basePath, "mimeType"],
      model,
      message: `\`responseFormat.audio.mimeType\` must be one of ${GEMINI_AUDIO_OUTPUT_MIME_TYPES.join(", ")}; got ${JSON.stringify(mimeType)}.`,
      meta: {
        value: mimeType,
        allowed: [...GEMINI_AUDIO_OUTPUT_MIME_TYPES],
        source: API_DOCS_URL,
      },
    });
  }

  // S8. Only enforced against a RECOGNISED format: an unknown mimeType already
  // errored above, and guessing whether it compresses would be a second error
  // built on the first.
  if (
    bitRate !== undefined &&
    known &&
    !GEMINI_COMPRESSED_AUDIO_MIME_TYPES.includes(
      mimeType as (typeof GEMINI_COMPRESSED_AUDIO_MIME_TYPES)[number],
    )
  ) {
    ctx.report({
      code: "unsupported_param",
      path: [...basePath, "bitRate"],
      model,
      message: `\`responseFormat.audio.bitRate\` is only applicable for compressed formats (MP3, Opus); "${mimeType}" is uncompressed.`,
      meta: {
        mimeType,
        compressed: [...GEMINI_COMPRESSED_AUDIO_MIME_TYPES],
        source: API_DOCS_URL,
      },
    });
  }

  if (sampleRate === undefined) return;

  // S9.
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    ctx.report({
      code: "invalid_shape",
      path: [...basePath, "sampleRate"],
      model,
      message: `\`responseFormat.audio.sampleRate\` is a rate in Hertz and must be a positive integer; got ${JSON.stringify(sampleRate)}.`,
      meta: { value: sampleRate, source: API_DOCS_URL },
    });
    return;
  }

  // S10.
  if (
    sampleRate < GEMINI_SPEECH_SAMPLE_RATE_RANGE.min ||
    sampleRate > GEMINI_SPEECH_SAMPLE_RATE_RANGE.max
  ) {
    ctx.report({
      code: "invalid_enum_value",
      severity: "warning",
      path: [...basePath, "sampleRate"],
      model,
      message:
        `\`responseFormat.audio.sampleRate\` ${sampleRate} Hz is outside the ` +
        `${GEMINI_SPEECH_SAMPLE_RATE_RANGE.min}–${GEMINI_SPEECH_SAMPLE_RATE_RANGE.max} Hz band this check assumes. ` +
        `Google publishes no allowed range for this field — only that Gemini TTS renders natively at ` +
        `${GEMINI_SPEECH_NATIVE_SAMPLE_RATE} Hz — so this is a plausibility warning, not a documented limit.`,
      meta: {
        value: sampleRate,
        ...GEMINI_SPEECH_SAMPLE_RATE_RANGE,
        nativeSampleRate: GEMINI_SPEECH_NATIVE_SAMPLE_RATE,
        // Deliberately the guide rather than the reference: the reference
        // enumerates NOTHING for this field, and the 24 kHz sentence on the
        // guide is the entire documentary basis for the band above.
        source: GEMINI_TTS_DOCS_URL,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// The capability triple — temperature / thinkingConfig / maxOutputTokens
// ---------------------------------------------------------------------------

/**
 * The three catalog-flag checks both surfaces run over `generationConfig`,
 * extracted from `chat.ts`'s `checkCapabilities` so the TTS surface enforces
 * exactly the same tri-state semantics: absent means "the catalog has no
 * answer" and must not fail a request; only an explicit `false` refuses.
 *
 * `basePath` is the config's own coordinates (`["generationConfig"]` on both
 * surfaces today, but the parameter keeps that from being an assumption).
 */
export function checkGenerationCapabilities(
  config: TtsCapabilityConfigLike | undefined,
  basePath: Array<string | number>,
  model: string,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (config === undefined || info === undefined) return;

  if (config.temperature !== undefined && info.temperature === false) {
    ctx.report({
      code: "unsupported_param",
      path: [...basePath, "temperature"],
      model,
      message: `\`generationConfig.temperature\` is not supported by "${model}".`,
    });
  }

  if (config.thinkingConfig !== undefined && info.reasoning === false) {
    ctx.report({
      code: "unsupported_capability",
      path: [...basePath, "thinkingConfig"],
      model,
      message: `"${model}" is not a reasoning model; remove \`generationConfig.thinkingConfig\`.`,
    });
  }

  const outputLimit = info.limit.output;
  if (
    config.maxOutputTokens !== undefined &&
    outputLimit !== undefined &&
    outputLimit > 0 &&
    config.maxOutputTokens > outputLimit
  ) {
    ctx.report({
      code: "over_output_limit",
      path: [...basePath, "maxOutputTokens"],
      model,
      message: `\`generationConfig.maxOutputTokens\` (${config.maxOutputTokens}) exceeds the ${outputLimit}-token output limit of "${model}".`,
      meta: { limit: outputLimit, value: config.maxOutputTokens },
    });
  }
}

// ---------------------------------------------------------------------------
// S1 — a TTS model must be asked for AUDIO
// ---------------------------------------------------------------------------

/**
 * S1 — "TTS models can only receive text inputs and generate audio outputs",
 * and an empty/absent `responseModalities` "is equivalent to requesting only
 * text", which a TTS model cannot produce.
 *
 * `requested` is the caller's already-normalized (upper-cased) modality list,
 * because the two surfaces read it out of differently-typed configs.
 */
export function checkAudioModalityRequested(
  requested: readonly string[],
  path: Array<string | number>,
  model: string,
  ctx: PipelineContext,
): void {
  if (requested.includes("AUDIO")) return;
  ctx.report({
    code: "unsupported_capability",
    path: [...path],
    model,
    message:
      `"${model}" is a TTS model and only produces audio; set \`generationConfig.responseModalities\` to ["AUDIO"]. ` +
      "For a surface where that is the only option, use `tts` from `unmodel/google` (google.tts) or `tts()` from `unmodel/tts`.",
    meta: { requested: [...requested], surface: "google.tts", source: GEMINI_TTS_DOCS_URL },
  });
}
