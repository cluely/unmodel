/**
 * ElevenLabs realtime Speech to Text (Scribe v2 Realtime) — the SESSION CONFIG
 * of `wss://api.elevenlabs.io/v1/speech-to-text/realtime`.
 *
 * This socket has no configuration *message*: the whole session is configured
 * by the query params of the connection URL, which the server echoes back in
 * its `session_started` event (`{ message_type: "session_started", config: {
 * model_id, audio_format, language_code, sample_rate }, session_id }`). That
 * config object is what this module validates. The audio frames you then send
 * (`{ message_type: "input_audio_chunk", audio_base_64, commit, sample_rate }`)
 * and the transcript events you read back are transport and stay out of scope,
 * as does auth (the `xi-api-key` header or the `token` query param — unmodel
 * never touches credentials).
 *
 * Wire notes (verified 2026-08-13 against the AsyncAPI reference
 * https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime,
 * pricing from https://elevenlabs.io/pricing/api):
 * - `model_id` is REQUIRED and is realtime-only: `scribe_v2_realtime`. The
 *   batch ids (`scribe_v2`, `scribe_v1`) belong to POST /v1/speech-to-text and
 *   are rejected here — the mirror image of the gate in ./speech-to-text.
 * - `audio_format` publishes a closed list ("Supported formats: pcm_8000,
 *   pcm_16000, pcm_22050, pcm_24000, pcm_44100, pcm_48000, ulaw_8000"); the
 *   `session_started` example echoes `pcm_16000`.
 * - `filter_background_audio` "Cannot be combined with include_timestamps" —
 *   enforced as an error.
 * - `keyterms`: "Maximum 50 keyterms. Adds a 20% premium to the base
 *   transcription cost." The count is capped by the schema; the per-term
 *   LENGTH comes from the capabilities page (CAPABILITIES_DOCS_URL): "Batch
 *   supports up to 1000 keyterms (50 characters each), while realtime supports
 *   up to 50 keyterms (20 characters each)." The batch endpoint's additional
 *   5-words-per-term rule is not republished for realtime, so it is not
 *   enforced here.
 * - The VAD knobs (`vad_threshold`, `vad_silence_threshold_secs`,
 *   `min_speech_duration_ms`, `min_silence_duration_ms`) publish no numeric
 *   ranges or defaults, so none are invented; only the two `*_ms` fields are
 *   typed as integers, which the reference states.
 * - Realtime Scribe is billed at $0.39 per hour (catalog `perAudioMinute`), but
 *   the length of a live session is unknowable at connect time, so this
 *   validator produces no cost estimate.
 * - There is no `.request`: a WebSocket URL is not fetchable, and unmodel's
 *   `RequestMeta` describes an HTTP POST. Build the address with
 *   {@link speechToTextRealtimeUrl}.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import type { ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  models,
  REALTIME_STT_MODEL_IDS,
  STT_MODEL_IDS,
  type ElevenlabsRealtimeSttModelId,
} from "./models";

/**
 * The realtime transcription socket. ElevenLabs also publishes data-residency
 * hosts for this channel (`api.us.elevenlabs.io`, `api.eu.residency.elevenlabs.io`,
 * `api.in.residency.elevenlabs.io`, `api.sg.residency.elevenlabs.io`); swap the
 * host yourself if your workspace is pinned to one.
 */
export const SPEECH_TO_TEXT_REALTIME_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

const REALTIME_DOCS_URL =
  "https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime";
const MODELS_DOCS_URL = "https://elevenlabs.io/docs/models";
/**
 * The capabilities page, which is where the per-keyterm length caps are
 * published (the realtime AsyncAPI reference states only the 50-term count).
 */
const CAPABILITIES_DOCS_URL = "https://elevenlabs.io/docs/capabilities/speech-to-text";

/**
 * "Supported formats: pcm_8000, pcm_16000, pcm_22050, pcm_24000, pcm_44100,
 * pcm_48000, ulaw_8000" (REALTIME_DOCS_URL). Note this is the INPUT audio
 * encoding — a different, shorter list than the TTS `output_format` space.
 */
export const REALTIME_STT_AUDIO_FORMATS = [
  "pcm_8000",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_44100",
  "pcm_48000",
  "ulaw_8000",
] as const;

export type ElevenlabsRealtimeAudioFormat = (typeof REALTIME_STT_AUDIO_FORMATS)[number];

/** "Maximum 50 keyterms" on the realtime socket (REALTIME_DOCS_URL). */
export const REALTIME_STT_KEYTERMS_MAX = 50;

/**
 * "…realtime supports up to 50 keyterms (20 characters each)"
 * (CAPABILITIES_DOCS_URL). Read as INCLUSIVE — "20 characters each" states the
 * allowance, not an exclusive bound, so a 20-character term passes and 21
 * fails. (The batch reference words its cap differently — "must be less than
 * 50 characters" — and ./speech-to-text enforces that one exclusively.)
 */
export const REALTIME_STT_KEYTERM_MAX_CHARACTERS = 20;

/**
 * Entity CATEGORIES the reference enumerates for `entity_detection` ("'pii',
 * 'phi', 'pci', 'other', 'offensive_language'"), alongside `"all"` and any
 * single entity TYPE — the type space is not enumerated, so the union keeps a
 * free-form tail and no runtime check rejects unlisted values.
 */
export const REALTIME_STT_ENTITY_CATEGORIES = [
  "pii",
  "phi",
  "pci",
  "other",
  "offensive_language",
] as const;

export type ElevenlabsRealtimeEntityCategory = (typeof REALTIME_STT_ENTITY_CATEGORIES)[number];

/** `"all"`, a documented category, or a single entity type. */
export type ElevenlabsRealtimeEntitySelector =
  | "all"
  | ElevenlabsRealtimeEntityCategory
  | (string & {});

/** Speech segmentation strategy: explicit commits, or silence-based VAD. */
export type ElevenlabsCommitStrategy = "manual" | "vad";

// ---------------------------------------------------------------------------
// Wire types — the query params of the realtime socket, i.e. the session config
// the server echoes in `session_started`.
// ---------------------------------------------------------------------------

export interface SpeechToTextRealtimeParams {
  /** REQUIRED. Realtime-only model id (`scribe_v2_realtime`). */
  model_id: ElevenlabsRealtimeSttModelId | (string & {});
  /** Input audio encoding; the documented example is `pcm_16000`. */
  audio_format?: ElevenlabsRealtimeAudioFormat;
  /**
   * ISO-639-1 / ISO-639-3 code. "Defaults to null, in this case the language is
   * predicted automatically."
   */
  language_code?: string;
  /**
   * "Additional ISO-639-1 or ISO-639-3 language codes that may be present in
   * the audio", narrowing language identification.
   */
  secondary_languages?: string[];
  /**
   * "'manual' requires explicit commits, 'vad' automatically segments speech
   * using silence detection."
   */
  commit_strategy?: ElevenlabsCommitStrategy;
  /** "VAD sensitivity threshold … Lower values are more sensitive to speech." */
  vad_threshold?: number;
  /** Silence (seconds) that triggers a commit "when VAD commit strategy is enabled". */
  vad_silence_threshold_secs?: number;
  /** Minimum speech (ms) VAD counts as valid speech. */
  min_speech_duration_ms?: number;
  /** Minimum silence (ms) VAD counts as a speech break. */
  min_silence_duration_ms?: number;
  /** Word/character timestamps in a delayed final transcript. Default false. */
  include_timestamps?: boolean;
  /** Detected `language_code` in a delayed final transcript. Default false. */
  include_language_detection?: boolean;
  /**
   * Bias terms; maximum {@link REALTIME_STT_KEYTERMS_MAX}, each at most
   * {@link REALTIME_STT_KEYTERM_MAX_CHARACTERS} characters. Adds a 20% premium
   * to the transcription cost.
   */
  keyterms?: string[];
  /** "Removes filler words, false starts and disfluencies from the transcript." */
  no_verbatim?: boolean;
  /** `"all"`, one type/category, or a list of types/categories. */
  entity_detection?: ElevenlabsRealtimeEntitySelector | ElevenlabsRealtimeEntitySelector[];
  /**
   * Background speech filtering. "When enabled without an explicit
   * vad_threshold, a lower default threshold is applied. Cannot be combined
   * with include_timestamps."
   */
  filter_background_audio?: boolean;
  /** `false` selects zero-retention mode (enterprise only). */
  enable_logging?: boolean;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with a warning).
// ---------------------------------------------------------------------------

const entitySelectorSchema = z.union([z.string(), z.array(z.string())]);

const schema = z.looseObject({
  model_id: z.string().min(1, "model_id is required for the realtime socket"),
  audio_format: z.enum(REALTIME_STT_AUDIO_FORMATS).optional(),
  language_code: z.string().optional(),
  secondary_languages: z.array(z.string()).optional(),
  commit_strategy: z.enum(["manual", "vad"]).optional(),
  // No numeric range is published for any VAD knob — none is invented here.
  vad_threshold: z.number().optional(),
  vad_silence_threshold_secs: z.number().optional(),
  min_speech_duration_ms: z.number().int().optional(),
  min_silence_duration_ms: z.number().int().optional(),
  include_timestamps: z.boolean().optional(),
  include_language_detection: z.boolean().optional(),
  keyterms: z
    .array(z.string())
    .max(REALTIME_STT_KEYTERMS_MAX, `at most ${REALTIME_STT_KEYTERMS_MAX} keyterms are allowed`)
    .optional(),
  no_verbatim: z.boolean().optional(),
  entity_detection: entitySelectorSchema.optional(),
  filter_background_audio: z.boolean().optional(),
  enable_logging: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const REALTIME_MODEL_ID_SET = new Set<string>(REALTIME_STT_MODEL_IDS);

/**
 * The inverse of the batch gate in ./speech-to-text: this socket serves only
 * the realtime Scribe ids, and a cataloged batch/TTS/music id here is an error.
 * Ids unknown to the catalog stay a warning — they may be new realtime models.
 */
function checkRealtimeModelKind(
  params: SpeechToTextRealtimeParams,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || REALTIME_MODEL_ID_SET.has(params.model_id)) return;
  const batch = STT_MODEL_IDS.includes(params.model_id);
  ctx.report({
    code: "unsupported_capability",
    path: ["model_id"],
    model: params.model_id,
    message: `"${params.model_id}" is not a realtime speech-to-text model; wss /v1/speech-to-text/realtime accepts ${REALTIME_STT_MODEL_IDS.map((id) => `"${id}"`).join(", ")}.${batch ? " Batch Scribe runs over POST /v1/speech-to-text (see `elevenlabs.transcribe`)." : ""}`,
    meta: { allowed: [...REALTIME_STT_MODEL_IDS], source: MODELS_DOCS_URL },
  });
}

/**
 * The per-term length the count-only zod cap cannot express: "realtime
 * supports up to 50 keyterms (20 characters each)" (CAPABILITIES_DOCS_URL).
 * Reported per item so the message can name the offending term.
 */
function checkKeytermLengths(
  params: SpeechToTextRealtimeParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const keyterms = params.keyterms;
  if (!Array.isArray(keyterms)) return;
  keyterms.forEach((term, index) => {
    if (typeof term !== "string" || term.length <= REALTIME_STT_KEYTERM_MAX_CHARACTERS) return;
    ctx.report({
      code: "invalid_shape",
      path: ["keyterms", index],
      message: `keyterm ${JSON.stringify(term)} is ${term.length} characters; realtime Scribe allows at most ${REALTIME_STT_KEYTERM_MAX_CHARACTERS} characters per keyterm.`,
      meta: {
        limit: REALTIME_STT_KEYTERM_MAX_CHARACTERS,
        actual: term.length,
        source: CAPABILITIES_DOCS_URL,
      },
    });
  });
}

/** "Cannot be combined with include_timestamps" (REALTIME_DOCS_URL). */
function checkBackgroundAudioFilter(
  params: SpeechToTextRealtimeParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.filter_background_audio !== true || params.include_timestamps !== true) return;
  ctx.report({
    code: "invalid_shape",
    path: ["filter_background_audio"],
    message:
      "`filter_background_audio` cannot be combined with `include_timestamps`; drop one of the two.",
    meta: { source: REALTIME_DOCS_URL },
  });
}

/**
 * `vad_silence_threshold_secs` is documented as the silence "required to
 * trigger a commit when VAD commit strategy is enabled" — with
 * `commit_strategy: "manual"` there is nothing for it to act on, so it is
 * reported as ignored (warning), not as a failure.
 */
function checkCommitStrategy(
  params: SpeechToTextRealtimeParams,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (params.commit_strategy !== "manual") return;
  if (params.vad_silence_threshold_secs === undefined) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["vad_silence_threshold_secs"],
    message:
      '`vad_silence_threshold_secs` only triggers commits when `commit_strategy` is "vad"; with "manual" you commit explicitly, so it has no effect.',
    meta: { ignored: true, source: REALTIME_DOCS_URL },
  });
}

// ---------------------------------------------------------------------------
// Builder — the socket URL.
// ---------------------------------------------------------------------------

/**
 * Builds the realtime transcription socket address from validated params.
 * Array params (`secondary_languages`, `keyterms`, a list `entity_detection`)
 * are appended once per element under the same key, which is how the API's
 * list-valued query params are serialized; auth is deliberately absent — send
 * the `xi-api-key` header or append your own `token` query param.
 */
export function speechToTextRealtimeUrl(params: SpeechToTextRealtimeParams): string {
  const search = new URLSearchParams();
  const set = (key: string, value: string | number | boolean | undefined): void => {
    if (value !== undefined) search.set(key, String(value));
  };
  const setAll = (key: string, values: readonly string[] | undefined): void => {
    for (const value of values ?? []) search.append(key, value);
  };
  set("model_id", params.model_id);
  set("audio_format", params.audio_format);
  set("language_code", params.language_code);
  setAll("secondary_languages", params.secondary_languages);
  set("commit_strategy", params.commit_strategy);
  set("vad_threshold", params.vad_threshold);
  set("vad_silence_threshold_secs", params.vad_silence_threshold_secs);
  set("min_speech_duration_ms", params.min_speech_duration_ms);
  set("min_silence_duration_ms", params.min_silence_duration_ms);
  set("include_timestamps", params.include_timestamps);
  set("include_language_detection", params.include_language_detection);
  setAll("keyterms", params.keyterms);
  set("no_verbatim", params.no_verbatim);
  if (Array.isArray(params.entity_detection)) setAll("entity_detection", params.entity_detection);
  else set("entity_detection", params.entity_detection);
  set("filter_background_audio", params.filter_background_audio);
  set("enable_logging", params.enable_logging);
  const qs = search.toString();
  return qs === "" ? SPEECH_TO_TEXT_REALTIME_WS_URL : `${SPEECH_TO_TEXT_REALTIME_WS_URL}?${qs}`;
}

// ---------------------------------------------------------------------------
// Validator — no `finalize`: there is no HTTP body and no fetchable URL, so
// the validated object is the session config itself (see module JSDoc).
// ---------------------------------------------------------------------------

const validator = createValidator<SpeechToTextRealtimeParams>({
  endpoint: "elevenlabs.speechToTextRealtime",
  schema,
  modelId: (params) => params.model_id,
  catalog: models,
  checks: [
    checkRealtimeModelKind,
    checkKeytermLengths,
    checkBackgroundAudioFilter,
    checkCommitStrategy,
  ],
  // No estimate: realtime Scribe is billed per minute of audio and the length
  // of a live session is unknowable at connect time.
});

/**
 * Validates the SESSION CONFIG of the ElevenLabs realtime Scribe WebSocket
 * (`wss://api.elevenlabs.io/v1/speech-to-text/realtime`) — the query params the
 * server echoes back in its `session_started` event.
 *
 * The result is the validated config; turn it into the socket address with
 * {@link speechToTextRealtimeUrl}. Streaming `input_audio_chunk` frames,
 * committing, and reading partial/final/committed transcripts back is transport
 * and outside unmodel's scope, as is auth.
 *
 * ```ts
 * const session = elevenlabs.speechToTextRealtime({
 *   model_id: "scribe_v2_realtime",
 *   audio_format: "pcm_16000",
 *   commit_strategy: "vad",
 *   include_timestamps: true,
 *   keyterms: ["Cartesia", "unmodel"],
 * });
 * const ws = new WebSocket(speechToTextRealtimeUrl(session), {
 *   headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
 * });
 * ```
 */
export const speechToTextRealtime = validator as unknown as {
  <T extends SpeechToTextRealtimeParams>(
    params: T & ExactKeys<T, SpeechToTextRealtimeParams>,
    options?: ValidateOptions,
  ): T;
  safe<T extends SpeechToTextRealtimeParams>(
    params: T & ExactKeys<T, SpeechToTextRealtimeParams>,
    options?: ValidateOptions,
  ): ValidateResult<T>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
