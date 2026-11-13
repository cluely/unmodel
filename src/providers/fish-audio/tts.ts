/**
 * Fish Audio Text to Speech — POST https://api.fish.audio/v1/tts
 *
 * Wire reference:
 * https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 * and the `TTSRequest` schema in
 * https://docs.fish.audio/api-reference/openapi.json (verified 2026-11-12).
 *
 * - `model` is a HEADER param, not a body field. It rides in the params
 *   object for ergonomics but is STRIPPED from the wire body and emitted as
 *   `.request.headers.model`. Sending it in the JSON body is a silent no-op:
 *   the docs say an omitted or unrecognized header "falls back to
 *   `s2.1-pro`", so a body-borne model silently synthesizes on the wrong
 *   model instead of erroring.
 * - CONTENT TYPE: the endpoint accepts `application/json` **or**
 *   `application/msgpack`. unmodel validates the JSON shape and finalizes to
 *   `content-type: application/json`. MessagePack takes the identical field
 *   set, so the same validated object serializes to msgpack unchanged —
 *   swap the header yourself. `references` (zero-shot cloning with inline
 *   audio) is documented as MessagePack-only, because its `audio` field is
 *   raw bytes; passing it with the JSON content type is flagged.
 * - BILLING UNIT: Fish Audio prices "$15.00 / M UTF-8 bytes", not per
 *   character. The estimate therefore feeds the catalog rate a UTF-8 byte
 *   count (`utf8ByteLength`), so CJK/emoji text is priced 3–4× an
 *   equal-length ASCII string, matching the invoice. A pronunciation
 *   dictionary that can rewrite the text (a reference, or an inline `alias`
 *   entry) makes the billed text unknowable, so that request gets no
 *   estimate.
 * - The response is a chunked raw audio stream, not JSON, so there is no
 *   response checker.
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
import { computeCharacterCostUSD } from "../../core/cost";
import {
  models,
  TTS_MODEL_IDS,
  S2_MODEL_IDS,
  MULTI_SPEAKER_MODEL_IDS,
  type FishAudioTtsModelId,
} from "./models";

export const TTS_URL = "https://api.fish.audio/v1/tts";

const TTS_DOCS = "https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech";
const MODELS_DOCS = "https://docs.fish.audio/developer-guide/models-pricing/models-overview";

/**
 * Server-side default for the `model` header — "If omitted or set to an
 * unrecognized value, the request falls back to `s2.1-pro`" (TTS_DOCS).
 * Model-dependent checks and pricing run against this when no model is given.
 */
export const DEFAULT_TTS_MODEL = "s2.1-pro";

/** `content-type` to send when serializing the body with MessagePack. */
export const MSGPACK_CONTENT_TYPE = "application/msgpack";

/** Documented `format` values; default "mp3". */
export const TTS_FORMATS = ["wav", "pcm", "mp3", "opus"] as const;
export type FishAudioFormat = (typeof TTS_FORMATS)[number];

/** Documented `latency` values; default "normal". */
export const TTS_LATENCIES = ["low", "normal", "balanced"] as const;
export type FishAudioLatency = (typeof TTS_LATENCIES)[number];

/** Documented `mp3_bitrate` values in kbps; default 128. MP3 output only. */
export const MP3_BITRATES = [64, 128, 192] as const;
export type FishAudioMp3Bitrate = (typeof MP3_BITRATES)[number];

/**
 * Documented `opus_bitrate` values in bps; default -1000 ("auto"). Opus
 * output only.
 */
export const OPUS_BITRATES = [-1000, 24000, 32000, 48000, 64000] as const;
export type FishAudioOpusBitrate = (typeof OPUS_BITRATES)[number];

/** Documented bounds of `prosody.speed` — "Valid range: 0.5 to 2.0". */
export const PROSODY_SPEED_MIN = 0.5;
export const PROSODY_SPEED_MAX = 2.0;

/** `language`: `maxLength: 35`, `pattern: ^[A-Za-z0-9_-]*$` (TTSRequest). */
const LANGUAGE_MAX_LENGTH = 35;
const LANGUAGE_PATTERN = /^[A-Za-z0-9_-]*$/;

/** Documented `PronunciationItem.type` values; default "phoneme". */
export const PRONUNCIATION_ITEM_TYPES = ["phoneme", "alias"] as const;
export type FishAudioPronunciationItemType = (typeof PRONUNCIATION_ITEM_TYPES)[number];

/** `pronunciation_dictionary`: "up to 3 pronunciation dictionaries". */
const PRONUNCIATION_DICTIONARIES_MAX = 3;
/** `PronunciationDictionaryInline.items`: `maxItems: 5000`. */
const PRONUNCIATION_ITEMS_MAX = 5000;
/** `PronunciationItem.key` / `.value` lengths: 1–256 and 1–1024. */
const PRONUNCIATION_KEY_MAX_LENGTH = 256;
const PRONUNCIATION_VALUE_MAX_LENGTH = 1024;
/** `PronunciationDictionaryRef.id` / `.version`: `^[A-Za-z0-9_-]{1,128}$`. */
const PRONUNCIATION_REF_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// ---------------------------------------------------------------------------
// Wire types — mirror the TTSRequest schema exactly (snake_case). Explicit
// `null` is the documented default for the nullable fields.
// ---------------------------------------------------------------------------

/**
 * A zero-shot voice-cloning sample. MessagePack only: `audio` carries raw
 * bytes, which JSON cannot express.
 */
export interface FishAudioReferenceAudio {
  /**
   * "Raw audio bytes of the voice sample. Supported formats: WAV, MP3, FLAC.
   * For best results, use 10-30 seconds of clear speech with minimal
   * background noise."
   */
  audio: Uint8Array | ArrayBuffer | string;
  /**
   * "The exact transcript of what is spoken in the audio sample. Accuracy is
   * important for voice cloning quality."
   */
  text: string;
}

export interface FishAudioProsodyControl {
  /** "Speaking rate multiplier. Valid range: 0.5 to 2.0." Default 1. */
  speed?: number | null;
  /** "Volume adjustment in decibels (dB)." Default 0. */
  volume?: number | null;
  /**
   * "Normalize output loudness … Applies to the S2 family (`s2-pro`,
   * `s2.1-pro`, `s2.1-pro-free`); on `s1` it is accepted but has no effect."
   * Default true.
   */
  normalize_loudness?: boolean | null;
}

/**
 * `PronunciationDictionaryRef` — "Reference to a server-managed pronunciation
 * dictionary". `additionalProperties: false`.
 */
export interface FishAudioPronunciationDictionaryRef {
  /** "Dictionary identifier as registered on the platform." `^[A-Za-z0-9_-]{1,128}$`. */
  id: string;
  /**
   * "Immutable version identifier for the dictionary. Version is required —
   * there is no implicit `latest`." `^[A-Za-z0-9_-]{1,128}$`.
   */
  version: string;
}

/** `PronunciationItem` — one key/value entry. `additionalProperties: false`. */
export interface FishAudioPronunciationItem {
  /** "Source substring to match. Pure substring match"; 1–256 characters. */
  key: string;
  /** "Replacement for the key during synthesis"; 1–1024 characters. */
  value: string;
  /**
   * "`phoneme` (default) speaks the value as a phonetic form. `alias`
   * substitutes the literal text". "Omitted or `null` means `phoneme`".
   */
  type?: FishAudioPronunciationItemType | null;
  /** "When true the match is case-sensitive". Default false. */
  case_sensitive?: boolean;
}

/**
 * `PronunciationDictionaryInline` — "Inline literal pronunciation
 * dictionary". `additionalProperties: false`.
 */
export interface FishAudioInlinePronunciationDictionary {
  /** Up to 5000 entries. */
  items: FishAudioPronunciationItem[];
}

export interface TtsBody {
  /**
   * HEADER param — stripped from the wire body and emitted as
   * `.request.headers.model`. Defaults to "s2.1-pro" server-side.
   */
  model?: FishAudioTtsModelId | (string & {});
  /** The text to convert to speech (billed per UTF-8 byte). */
  text: string;
  /** "Controls expressiveness"; range 0–1, default 0.7. */
  temperature?: number | null;
  /** "Nucleus sampling diversity"; range 0–1, default 0.7. */
  top_p?: number | null;
  /**
   * Voice model id. An ARRAY selects multi-speaker dialogue, which "is
   * available with the S2 family (`s2-pro`, `s2.1-pro`, `s2.1-pro-free`) and
   * `drama-3`, not `s1`".
   */
  reference_id?: string | string[] | null;
  /**
   * Zero-shot cloning samples — MessagePack only (see module JSDoc). Single
   * speaker: `ReferenceAudio[]`. Multi-speaker: `ReferenceAudio[][]`.
   */
  references?: FishAudioReferenceAudio[] | FishAudioReferenceAudio[][] | null;
  /** Speed/volume adjustments. */
  prosody?: FishAudioProsodyControl | null;
  /** Characters per synthesis chunk; range 100–300, default 300. */
  chunk_length?: number | null;
  /**
   * "Rewrites numbers, dates, units and symbols as spoken words before
   * synthesis, improving stability. Uses `language` when it is set and
   * otherwise detects the language of each text chunk." Default true.
   */
  normalize?: boolean | null;
  /**
   * "BCP-47 language tag of the text, for example `en`, `es-MX` or `zh-CN`."
   * "Used only by text normalization … and by word-timestamp alignment. It
   * is not passed to the speech model and does not change the voice, accent
   * or audio quality." Omit it, or send `auto` or `""`, to detect the
   * language per chunk. At most 35 characters of letters, digits, `-` and
   * `_`; anything else "is rejected with HTTP 400".
   */
  language?: string | null;
  /** Container/codec; default "mp3". */
  format?: FishAudioFormat;
  /** Output sample rate in Hz. Defaults per format (48000 for opus). */
  sample_rate?: number | null;
  /** kbps, MP3 output only; default 128. */
  mp3_bitrate?: FishAudioMp3Bitrate;
  /** bps, Opus output only; default -1000 (auto). */
  opus_bitrate?: FishAudioOpusBitrate;
  /** Latency profile; default "normal". */
  latency?: FishAudioLatency;
  /** "Maximum audio tokens per chunk"; default 1024. */
  max_new_tokens?: number | null;
  /** "Values >1.0 reduce repetition"; default 1.2. */
  repetition_penalty?: number | null;
  /** Range 0–100, default 50. */
  min_chunk_length?: number | null;
  /** "Use prior audio for voice consistency". Default true. */
  condition_on_previous_chunks?: boolean | null;
  /** Range 0–1, default 1. */
  early_stop_threshold?: number | null;
  /** Feature flags, e.g. `["quality-guard"]`. Default `[]`. */
  features?: string[] | null;
  /**
   * Up to 3 pronunciation dictionaries: references to platform dictionaries
   * OR inline ones — "the two forms are mutually exclusive in a single
   * request". "Missing or unresolvable references are silently dropped —
   * the request still succeeds." Billing counts alias replacements, so a
   * reference or an inline `alias` entry leaves the request without a cost
   * estimate (see module JSDoc).
   */
  pronunciation_dictionary?:
    | FishAudioPronunciationDictionaryRef[]
    | FishAudioInlinePronunciationDictionary[]
    | null;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const referenceAudioSchema = z.looseObject({
  // Uint8Array / ArrayBuffer / base64 string — msgpack carries the bytes.
  audio: z.unknown(),
  text: z.string(),
});

// The three dictionary shapes are `additionalProperties: false` upstream, so
// they are strict here: an unknown key inside one is a 422, not a warning.
const pronunciationRefSchema = z.strictObject({
  id: z.string().regex(PRONUNCIATION_REF_PATTERN, "id must match ^[A-Za-z0-9_-]{1,128}$"),
  version: z
    .string()
    .regex(PRONUNCIATION_REF_PATTERN, "version must match ^[A-Za-z0-9_-]{1,128}$"),
});

const pronunciationItemSchema = z.strictObject({
  key: z.string().min(1).max(PRONUNCIATION_KEY_MAX_LENGTH),
  value: z.string().min(1).max(PRONUNCIATION_VALUE_MAX_LENGTH),
  type: z.enum(PRONUNCIATION_ITEM_TYPES).nullable().optional(),
  case_sensitive: z.boolean().optional(),
});

const inlinePronunciationSchema = z.strictObject({
  items: z
    .array(pronunciationItemSchema)
    .max(
      PRONUNCIATION_ITEMS_MAX,
      `an inline dictionary holds at most ${PRONUNCIATION_ITEMS_MAX} items`,
    ),
});

const schema = z.looseObject({
  model: z.string().optional(),
  text: z.string().min(1, "text must not be empty."),
  temperature: z.number().min(0).max(1).nullable().optional(),
  top_p: z.number().min(0).max(1).nullable().optional(),
  reference_id: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  references: z
    .union([z.array(referenceAudioSchema), z.array(z.array(referenceAudioSchema))])
    .nullable()
    .optional(),
  prosody: z
    .looseObject({
      speed: z.number().min(PROSODY_SPEED_MIN).max(PROSODY_SPEED_MAX).nullable().optional(),
      volume: z.number().nullable().optional(),
      normalize_loudness: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
  chunk_length: z.number().int().min(100).max(300).nullable().optional(),
  normalize: z.boolean().nullable().optional(),
  language: z
    .string()
    .max(LANGUAGE_MAX_LENGTH, `language is at most ${LANGUAGE_MAX_LENGTH} characters`)
    .regex(LANGUAGE_PATTERN, "language may contain only letters, digits, - and _")
    .nullable()
    .optional(),
  format: z.string().optional(),
  sample_rate: z.number().int().positive().nullable().optional(),
  mp3_bitrate: z.number().optional(),
  opus_bitrate: z.number().optional(),
  latency: z.string().optional(),
  max_new_tokens: z.number().int().positive().nullable().optional(),
  repetition_penalty: z.number().nullable().optional(),
  min_chunk_length: z.number().int().min(0).max(100).nullable().optional(),
  condition_on_previous_chunks: z.boolean().nullable().optional(),
  early_stop_threshold: z.number().min(0).max(1).nullable().optional(),
  features: z.array(z.string()).nullable().optional(),
  pronunciation_dictionary: z
    .array(z.union([pronunciationRefSchema, inlinePronunciationSchema]))
    .max(
      PRONUNCIATION_DICTIONARIES_MAX,
      `pronunciation_dictionary takes at most ${PRONUNCIATION_DICTIONARIES_MAX} dictionaries`,
    )
    .nullable()
    .optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const FORMAT_SET = new Set<string>(TTS_FORMATS);
const LATENCY_SET = new Set<string>(TTS_LATENCIES);
const MP3_BITRATE_SET = new Set<number>(MP3_BITRATES);
const OPUS_BITRATE_SET = new Set<number>(OPUS_BITRATES);
const TTS_MODEL_ID_SET = new Set<string>(TTS_MODEL_IDS);
const MULTI_SPEAKER_MODEL_ID_SET = new Set<string>(MULTI_SPEAKER_MODEL_IDS);

/** The one model `prosody.normalize_loudness` is documented as a no-op on. */
const NORMALIZE_LOUDNESS_NO_OP_MODEL = "s1";

function modelOf(params: TtsBody): string {
  return params.model ?? DEFAULT_TTS_MODEL;
}

/**
 * The catalog also carries the retired `speech-1.5` / `speech-1.6` ids so
 * legacy call sites get a precise error rather than a bare `unknown_model`
 * warning. Ids unknown to the catalog stay a warning — they may be new.
 */
function checkModelKind(params: TtsBody, info: ModelInfo | undefined, ctx: PipelineContext): void {
  const model = modelOf(params);
  if (info === undefined || TTS_MODEL_ID_SET.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message: `"${model}" is not served by POST /v1/tts; the \`model\` header accepts ${TTS_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.`,
    meta: { allowed: [...TTS_MODEL_IDS], source: MODELS_DOCS },
  });
}

function checkEnums(params: TtsBody, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const model = modelOf(params);
  const { format, latency, mp3_bitrate, opus_bitrate } = params;
  if (format !== undefined && !FORMAT_SET.has(format)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["format"],
      model,
      message: `\`format\` must be one of ${TTS_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
      meta: { allowed: [...TTS_FORMATS], value: format, source: TTS_DOCS },
    });
  }
  if (latency !== undefined && !LATENCY_SET.has(latency)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["latency"],
      model,
      message: `\`latency\` must be one of ${TTS_LATENCIES.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(latency)}.`,
      meta: { allowed: [...TTS_LATENCIES], value: latency, source: TTS_DOCS },
    });
  }
  if (mp3_bitrate !== undefined && !MP3_BITRATE_SET.has(mp3_bitrate)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["mp3_bitrate"],
      model,
      message: `\`mp3_bitrate\` must be one of ${MP3_BITRATES.join(", ")} (kbps); got ${JSON.stringify(mp3_bitrate)}.`,
      meta: { allowed: [...MP3_BITRATES], value: mp3_bitrate, source: TTS_DOCS },
    });
  }
  if (opus_bitrate !== undefined && !OPUS_BITRATE_SET.has(opus_bitrate)) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["opus_bitrate"],
      model,
      message: `\`opus_bitrate\` must be one of ${OPUS_BITRATES.join(", ")} (bps, -1000 = auto); got ${JSON.stringify(opus_bitrate)}.`,
      meta: { allowed: [...OPUS_BITRATES], value: opus_bitrate, source: TTS_DOCS },
    });
  }
}

/**
 * `mp3_bitrate` / `opus_bitrate` are documented as codec-scoped ("MP3 only",
 * "Opus only"). Setting one against a different `format` is accepted and
 * dropped, so the request succeeds at a bitrate the caller did not choose —
 * a warning, not an error.
 */
function checkBitrateFormatPairing(
  params: TtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const format = params.format ?? "mp3";
  if (params.mp3_bitrate !== undefined && format !== "mp3") {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["mp3_bitrate"],
      model: modelOf(params),
      message: `\`mp3_bitrate\` applies to MP3 output only; \`format\` is ${JSON.stringify(format)}, so it is ignored.`,
      meta: { ignored: true, format, source: TTS_DOCS },
    });
  }
  if (params.opus_bitrate !== undefined && format !== "opus") {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["opus_bitrate"],
      model: modelOf(params),
      message: `\`opus_bitrate\` applies to Opus output only; \`format\` is ${JSON.stringify(format)}, so it is ignored.`,
      meta: { ignored: true, format, source: TTS_DOCS },
    });
  }
}

/**
 * "Multi-speaker dialogue synthesis is available with the S2 family
 * (`s2-pro`, `s2.1-pro`, `s2.1-pro-free`) and `drama-3`, not `s1`"
 * (TTSRequest, 2026-11-12). A `reference_id` array (or a nested `references`
 * array-of-arrays) is the multi-speaker form.
 */
function checkMultiSpeaker(
  params: TtsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = modelOf(params);
  // Unknown to the catalog → nothing documented about it; stay quiet rather
  // than guess.
  if (info === undefined || MULTI_SPEAKER_MODEL_ID_SET.has(model)) return;

  if (Array.isArray(params.reference_id)) {
    ctx.report({
      code: "unsupported_capability",
      path: ["reference_id"],
      model,
      message: `a \`reference_id\` array requests multi-speaker dialogue, which is available with ${MULTI_SPEAKER_MODEL_IDS.join(", ")}; "${model}" is single-speaker only.`,
      meta: { allowed: [...MULTI_SPEAKER_MODEL_IDS], source: TTS_DOCS },
    });
  }
  const references = params.references;
  if (Array.isArray(references) && references.some((entry) => Array.isArray(entry))) {
    ctx.report({
      code: "unsupported_capability",
      path: ["references"],
      model,
      message: `a nested \`references\` array (ReferenceAudio[][]) requests multi-speaker dialogue, which is available with ${MULTI_SPEAKER_MODEL_IDS.join(", ")}; "${model}" is single-speaker only.`,
      meta: { allowed: [...MULTI_SPEAKER_MODEL_IDS], source: TTS_DOCS },
    });
  }
}

/**
 * "`normalize_loudness` … Applies to the S2 family …; on `s1` it is accepted
 * but has no effect." The request is fulfilled, so this is a warning about a
 * silent no-op rather than an error. Only `s1` is named: the docs say nothing
 * of `drama-3` either way, and an undocumented effect is not a documented
 * no-op.
 */
function checkNormalizeLoudness(
  params: TtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = modelOf(params);
  if (model !== NORMALIZE_LOUDNESS_NO_OP_MODEL) return;
  if (params.prosody?.normalize_loudness == null) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["prosody", "normalize_loudness"],
    model,
    message: `\`prosody.normalize_loudness\` is accepted but has no effect on "${model}"; it is documented for the S2 family (${S2_MODEL_IDS.join(", ")}).`,
    meta: { ignored: true, allowed: [...S2_MODEL_IDS], source: TTS_DOCS },
  });
}

/**
 * "Provide either references to platform-managed dictionaries OR inline
 * literal dictionaries (the two forms are mutually exclusive in a single
 * request)." The schema accepts each entry on its own; this is the
 * whole-array rule.
 */
function checkPronunciationDictionaryForms(
  params: TtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const entries = pronunciationEntries(params);
  const inline = entries.filter(isInlineDictionary).length;
  if (inline === 0 || inline === entries.length) return;
  ctx.report({
    code: "invalid_shape",
    path: ["pronunciation_dictionary"],
    model: modelOf(params),
    message:
      "`pronunciation_dictionary` mixes references ({ id, version }) and inline dictionaries ({ items }); the two forms are mutually exclusive in a single request — send one or the other.",
    meta: { source: TTS_DOCS },
  });
}

/**
 * `references` carries raw audio bytes, which is why the docs mark it
 * "MessagePack only". `finalize` emits `content-type: application/json`, so
 * the caller must re-serialize with MessagePack and swap the header — the
 * field set is otherwise identical. A warning, because the msgpack path is
 * fully supported and the validated shape is correct for it.
 */
function checkReferencesNeedMsgpack(
  params: TtsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.references == null) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["references"],
    model: modelOf(params),
    message: `\`references\` carries raw audio bytes and is documented as MessagePack-only; serialize this body with MessagePack and send \`content-type: ${MSGPACK_CONTENT_TYPE}\` instead of the JSON header on \`.request\`.`,
    meta: { contentType: MSGPACK_CONTENT_TYPE, source: TTS_DOCS },
  });
}

// ---------------------------------------------------------------------------
// Estimation — billed per UTF-8 BYTE, not per character (see module JSDoc).
// ---------------------------------------------------------------------------

const ENCODER = new TextEncoder();

/** UTF-8 byte length of `text` — Fish Audio's billing unit. */
export function utf8ByteLength(text: string): number {
  return ENCODER.encode(text).length;
}

function estimate(
  params: TtsBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  if (rewritesBilledText(params)) return {};
  const costUSD = computeCharacterCostUSD(info?.cost, utf8ByteLength(params.text));
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * "Usage is billed on the text actually synthesized, with alias replacements
 * counted: an alias that expands a key is billed for the longer text … phoneme
 * rules never change billing." A referenced dictionary is resolved
 * server-side and may hold aliases; an inline `alias` entry rewrites the text
 * by leftmost-longest substring matching. Either way the request's own byte
 * count is not what is billed.
 */
function rewritesBilledText(params: TtsBody): boolean {
  return pronunciationEntries(params).some(
    (entry) => !isInlineDictionary(entry) || entry.items.some((item) => item.type === "alias"),
  );
}

type PronunciationEntry =
  | FishAudioPronunciationDictionaryRef
  | FishAudioInlinePronunciationDictionary;

function pronunciationEntries(params: TtsBody): readonly PronunciationEntry[] {
  return params.pronunciation_dictionary ?? [];
}

function isInlineDictionary(
  entry: PronunciationEntry,
): entry is FishAudioInlinePronunciationDictionary {
  return "items" in entry;
}

// ---------------------------------------------------------------------------
// Finalize: wire body (model stripped — it is a header) + .request
// ---------------------------------------------------------------------------

type TtsWireBody = Omit<TtsBody, "model">;

/**
 * SDK targets for `fish-audio.tts`. The JavaScript SDK (`fish-audio` on npm;
 * `fish-audio-sdk` is the Python package) takes the wire's snake_case
 * `TTSRequest`, so the single `"fish-audio"` formatter is the identity. Its
 * types lag the wire: fish-audio@0.1.0 types `reference_id` as one string and
 * `latency` as "normal" | "balanced", and has no `normalize_loudness`,
 * `language` or `pronunciation_dictionary` — a body using those is correct on
 * the wire but needs a cast at the SDK's `convert()`. Type alias, not
 * interface: an interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type TtsSdkTargets<B> = { "fish-audio": () => B };

function finalize(params: TtsBody): Validated<TtsWireBody, TtsSdkTargets<TtsWireBody>> {
  const { model, ...body } = params;
  return toValidated(
    body,
    {
      url: TTS_URL,
      method: "POST",
      // The `model` header is optional on the wire; only send it when asked so
      // an omitted model keeps the documented server-side fallback.
      headers: { ...JSON_HEADERS, ...(model !== undefined && { model }) },
    },
    { sdk: { "fish-audio": () => body } },
  );
}

const validator = createValidator<TtsBody, Validated<TtsWireBody, TtsSdkTargets<TtsWireBody>>>({
  endpoint: "fish-audio.tts",
  schema,
  // `model` is optional; checks and pricing run against the documented
  // server-side fallback when it is omitted.
  modelId: (params) => modelOf(params),
  catalog: models,
  checks: [
    checkModelKind,
    checkEnums,
    checkBitrateFormatPairing,
    checkMultiSpeaker,
    checkNormalizeLoudness,
    checkPronunciationDictionaryForms,
    checkReferencesNeedMsgpack,
  ],
  estimate,
  finalize,
});

/**
 * Validates raw wire params for Fish Audio `POST /v1/tts`.
 *
 * The result's enumerable properties are the exact fetch JSON body; `model`
 * is stripped because it is a HEADER param and appears on
 * `.request.headers.model` instead. `.toSdk("fish-audio")` returns the body unchanged —
 * the `fish-audio` npm SDK takes wire-shaped params. Auth is your job: add an
 * `authorization: Bearer …` header.
 *
 * ```ts
 * const params = fishAudio.tts({
 *   model: "s2.1-pro",
 *   text: "Hello world",
 *   reference_id: "802e3bc2b27e49c2995d23ef70e6ac89",
 *   format: "mp3",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY!}` },
 *   body: JSON.stringify(params),
 * });
 * const audio = await res.arrayBuffer();
 * ```
 */
export const tts = validator as unknown as {
  <T extends TtsBody>(
    params: T & ExactKeys<T, TtsBody>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "model">, TtsSdkTargets<Omit<T, "model">>>;
  safe<T extends TtsBody>(
    params: T & ExactKeys<T, TtsBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<Omit<T, "model">, TtsSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
