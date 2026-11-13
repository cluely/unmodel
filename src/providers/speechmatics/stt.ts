/**
 * Speechmatics Batch transcription — POST https://{region}.asr.api.speechmatics.com/v2/jobs
 *
 * Wire notes (verified 2026-08-13 against
 * https://docs.speechmatics.com/speech-to-text/batch/input (the `JobConfig`
 * schema), https://docs.speechmatics.com/api-ref/batch/create-a-new-job,
 * https://docs.speechmatics.com/speech-to-text/models and
 * https://docs.speechmatics.com/speech-to-text/batch/limits):
 * - This is a multipart/form-data endpoint with two parts: `config` (the
 *   JobConfig JSON, serialized as a string) and `data_file` (the media
 *   bytes). What unmodel validates is the CONFIG — `stt(config)` returns the
 *   exact JSON object to serialize into the `config` part, and
 *   {@link toFormData} assembles the request body. Media can also be fetched
 *   server-side via `fetch_data.url`, in which case there is no `data_file`
 *   part at all.
 * - Auth is `Authorization: Bearer <SPEECHMATICS_API_KEY>` — unmodel never
 *   touches keys. `.request.headers` is deliberately empty: fetch must derive
 *   the multipart content-type (with boundary) from the FormData body.
 * - The region is the endpoint: a job belongs to the endpoint that created it,
 *   and every follow-up request must use the same host. {@link jobsUrl} builds
 *   the URL for a region; {@link JOBS_URL} defaults to EU1.
 * - Billing is per minute of audio. Neither the config nor a Blob reveals the
 *   duration, so declare it via
 *   `options.media = [{ path: ["data_file"], durationSeconds }]` (or
 *   `["fetch_data", "url"]`) to get a `costUSD` estimate and `maxCostUSD`
 *   enforcement. Speech-intelligence bolt-ons (translation, summaries,
 *   chapters, sentiment, topics) are billed on top and are NOT estimated.
 * - Realtime transcription runs over the Speechmatics WebSocket API
 *   (`wss://eu.rt.speechmatics.com/v2`), which unmodel does not validate.
 * - Alignment jobs (`type: "alignment"` + `alignment_config`) are a different
 *   product and are out of scope here; this validator models transcription.
 *
 * Re-verified 2026-11-12 against the same pages plus
 * https://docs.speechmatics.com/speech-to-text/formatting.md,
 * https://docs.speechmatics.com/speech-to-text/languages.md and
 * https://docs.speechmatics.com/speech-to-text/batch/language-identification.md:
 * - `output_locale` is `string | string[]`. The array — "one per language
 *   present in the audio" — is carried by the formatting page, the models page
 *   (Melia 1 and Oak 1: "On Batch, `output_locale` also accepts an array of
 *   locales"), the Batch SaaS fix note of 2026-10-13 and the Melia 1 / Oak 1
 *   container 1.13.0 notes. The API reference still types it `string`, as do
 *   the Python (`Optional[str]`) and JS (`output_locale?: string`) batch SDKs;
 *   those lag, and refusing the array would refuse a request the API
 *   fulfils.
 * - Entity detection on Melia 1 / Oak 1 contradicts between two vendor pages:
 *   the models page says they "do not yet support" it, while
 *   https://www.speechmatics.com/pricing.md lists
 *   "| Entity detection | Pre-recorded | On request | Melia 1, Oak 1 |" and
 *   "| PII reduction | Pre-recorded | On request | Melia 1, Oak 1 |". So
 *   `enable_entities` on them is sent with a warning that names both pages,
 *   and `entities_config`, `enable_redaction` and `redaction_config` carry no
 *   per-model gate.
 * - `language` on Melia 1 / Oak 1: the models page's instruction is "Set
 *   `language` to `multi`", and the one value it says "returns an error" is
 *   `auto`. The languages page lists what the two do not support — "the `auto`
 *   option, the bilingual and multi-language pack codes, or translation" —
 *   which leaves single language codes out, and the Python batch SDK's
 *   `language_hints` docstring presumes one can be there: "Hints take
 *   precedence over ``language``, so the transcript may not contain the
 *   language named there. Applicable only for the next-gen models (e.g.
 *   melia-1, oak-1)"
 *   (https://raw.githubusercontent.com/speechmatics/speechmatics-python-sdk/main/sdk/batch/speechmatics/batch/_models.py).
 *   So `auto` and the pack codes are refused, and any other value besides
 *   `multi` is a warning.
 * - `output_locale` is refused beside `language: "auto"`: "Output Locale is
 *   currently not supported in combination with using Automatic Language
 *   Identification. Jobs with this combination of features will be rejected."
 *   (the language-identification page).
 * - `additional_vocab` is capped at 20,000 entries: "If a job's custom
 *   dictionary (`additional_vocab`) contains more than 20,000 items, the job
 *   is rejected with an `HTTP 400 Bad Request`" (LIMITS_DOCS). The custom
 *   dictionary page's "no more than 1000 words or phrases" is a performance
 *   recommendation, not a limit, and is not enforced.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ExactKeys, type ValidatedForm } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import { models, BATCH_HOSTS, type SpeechmaticsRegion } from "./models";

const MODELS_DOCS = "https://docs.speechmatics.com/speech-to-text/models";
const LIMITS_DOCS = "https://docs.speechmatics.com/speech-to-text/batch/limits";
const FORMATTING_DOCS = "https://docs.speechmatics.com/speech-to-text/formatting";
const LANGUAGES_DOCS = "https://docs.speechmatics.com/speech-to-text/languages";
const LANGUAGE_ID_DOCS = "https://docs.speechmatics.com/speech-to-text/batch/language-identification";
const API_REF = "https://docs.speechmatics.com/api-ref/batch/create-a-new-job";
const PRICING_DOCS = "https://www.speechmatics.com/pricing.md";

/** Builds the /v2/jobs URL for a Batch SaaS region. */
export function jobsUrl(region: SpeechmaticsRegion = "eu1"): string {
  return `https://${BATCH_HOSTS[region]}/v2/jobs`;
}

/** Default POST target (EU1); use {@link jobsUrl} for another region. */
export const JOBS_URL = jobsUrl("eu1");

/**
 * "the file must be less than 1 GB in size or the job will be rejected"
 * (LIMITS_DOCS). Files above this must be submitted via `fetch_data.url`.
 */
export const MAX_DATA_FILE_BYTES = 1_000_000_000;

/**
 * "If a job's custom dictionary (`additional_vocab`) contains more than 20,000
 * items, the job is rejected with an `HTTP 400 Bad Request`" (LIMITS_DOCS,
 * 2026-11-12).
 */
export const MAX_ADDITIONAL_VOCAB_ITEMS = 20_000;

/** "the `standard` model is used" when `model` is not set (MODELS_DOCS). */
export const DEFAULT_MODEL = "standard";

/**
 * File extensions the Batch API accepts — "The list above is exhaustive - any
 * file format outside the list above is explicitly not supported"
 * (https://docs.speechmatics.com/speech-to-text/batch/input). A Blob carries
 * only a MIME type, which does not map 1:1 onto extensions, so this is
 * exported for callers to check rather than enforced here.
 */
export const SUPPORTED_FILE_TYPES = [
  "wav",
  "mp3",
  "aac",
  "ogg",
  "mpeg",
  "amr",
  "m4a",
  "mp4",
  "flac",
] as const;

// ---------------------------------------------------------------------------
// Wire types — mirror the documented JobConfig schema exactly.
// ---------------------------------------------------------------------------

export interface SpeechmaticsFetchConfig {
  url: string;
  /** Extra headers for the fetch (e.g. an OAuth2 bearer token). */
  auth_headers?: string[];
}

export interface SpeechmaticsAdditionalVocabEntry {
  content: string;
  sounds_like?: string[];
}

export interface SpeechmaticsPunctuationOverrides {
  /** 0–1; higher produces more punctuation. Default 0.5. */
  sensitivity?: number;
  /** Accepted marks, or the special value "all" (the default). */
  permitted_marks?: string[];
}

export interface SpeechmaticsAudioFilteringConfig {
  /** 0–100; higher cuts out increasing amounts of quiet sound. */
  volume_threshold?: number;
}

export interface SpeechmaticsReplacement {
  from: string;
  to: string;
}

export interface SpeechmaticsTranscriptFilteringConfig {
  /** true removes disfluencies; false (default) tags them. */
  remove_disfluencies?: boolean;
  replacements?: SpeechmaticsReplacement[];
}

export interface SpeechmaticsSpeaker {
  /** Must not collide with the internal format (S1, S2, …). */
  label: string;
  /** Speaker identifiers; at least one, max 50 across all speakers. */
  speaker_identifiers: string[];
}

export interface SpeechmaticsSpeakerDiarizationConfig {
  prefer_current_speaker?: boolean;
  /** 0–1; higher keeps similar speakers apart. Default 0.5. */
  speaker_sensitivity?: number;
  /** Return speaker identifiers at the end of the transcript. */
  get_speakers?: boolean;
  /** Speaker labels linked to their identifiers (speaker identification). */
  speakers?: SpeechmaticsSpeaker[];
}

/** "Configuration for Advanced Entities Detection." */
export interface SpeechmaticsEntitiesConfig {
  /**
   * "Must be set together with `enable_entities: true`." Returns entities such
   * as names, dates of birth and card numbers, each with its own
   * `entity_class`, instead of the default entity detection.
   */
  detect_advanced_entities?: boolean;
}

/** "Required, and only applied, when `enable_redaction` is true." */
export interface SpeechmaticsRedactionConfig {
  /**
   * Groups (`pii`, `pci`, `health`, `gdpr`, `gdpr_sensitive`,
   * `hipaa_safe_harbor`, `cpra`, `quebec_privacy_act`, `appi`,
   * `appi_sensitive`) or specific entity types matched by their
   * `entity_class` (e.g. `name_given`, `dob`); at least one, unique.
   */
  entity_classes?: string[];
}

export interface SpeechmaticsTranscriptionConfig {
  /** ISO language code; `multi` for Melia 1 and Oak 1, `auto` for language ID. */
  language: string;
  /** Specialized variant of `language`, e.g. "medical" (Enhanced only). */
  domain?: string;
  /**
   * Locale for the transcription output, e.g. "en-US". On Batch, Melia 1 and
   * Oak 1 also take an array, "one per language present in the audio"; "each
   * locale in the array must belong to a different language". Rejected
   * together with `language: "auto"`.
   */
  output_locale?: string | string[];
  /** Model to transcribe with; defaults to "standard". */
  model?: "standard" | "enhanced" | "melia-1" | "oak-1" | (string & {});
  /** @deprecated Use `model`; kept for backward compatibility. */
  operating_point?: "standard" | "enhanced" | "melia-1" | "oak-1" | (string & {});
  /** Custom dictionary; at most {@link MAX_ADDITIONAL_VOCAB_ITEMS} entries. */
  additional_vocab?: SpeechmaticsAdditionalVocabEntry[];
  punctuation_overrides?: SpeechmaticsPunctuationOverrides;
  /** "none" (default), "speaker", or "channel". */
  diarization?: "none" | "speaker" | "channel";
  /** Labels used when collating separate input channels. */
  channel_diarization_labels?: string[];
  /** Include 'entity' objects (dates, numbers) with spoken/written forms. */
  enable_entities?: boolean;
  entities_config?: SpeechmaticsEntitiesConfig;
  /**
   * Redact advanced entities throughout the transcript. "Must be set together
   * with `redaction_config.entity_classes`. If `enable_entities` is true,
   * `entities_config.detect_advanced_entities` must also be true".
   */
  enable_redaction?: boolean;
  redaction_config?: SpeechmaticsRedactionConfig;
  /** Flexible endpointing: "fixed" or "flexible". */
  max_delay_mode?: "fixed" | "flexible";
  audio_filtering_config?: SpeechmaticsAudioFilteringConfig;
  transcript_filtering_config?: SpeechmaticsTranscriptFilteringConfig;
  speaker_diarization_config?: SpeechmaticsSpeakerDiarizationConfig;
  /** Languages expected in the audio, guiding multilingual transcription. */
  language_hints?: string[];
  /** "Whether to treat the provided language hints as strict." */
  language_hints_strict?: boolean;
}

export interface SpeechmaticsNotificationConfig {
  url: string;
  contents?: Array<
    "jobinfo" | "transcript" | "transcript.json-v2" | "transcript.txt" | "transcript.srt" | "data" | "text"
  >;
  /** "post" (default) or "put". */
  method?: "post" | "put";
  auth_headers?: string[];
}

export interface SpeechmaticsTracking {
  title?: string;
  reference?: string;
  tags?: string[];
  /** Customer-defined JSON structure. */
  details?: Record<string, unknown>;
}

export interface SpeechmaticsOutputConfig {
  srt_overrides?: {
    max_line_length?: number;
    max_lines?: number;
  };
}

export interface SpeechmaticsTranslationConfig {
  /** At most 5 target languages. */
  target_languages: string[];
}

export interface SpeechmaticsLanguageIdentificationConfig {
  expected_languages?: string[];
  low_confidence_action?: "allow" | "reject" | "use_default_language";
  default_language?: string;
}

export interface SpeechmaticsSummarizationConfig {
  content_type?: "auto" | "informative" | "conversational";
  /** "brief" (default) or "detailed". */
  summary_length?: "brief" | "detailed";
  summary_type?: "paragraphs" | "bullets";
}

export interface SpeechmaticsTopicDetectionConfig {
  topics?: string[];
}

export interface SpeechmaticsAudioEventsConfig {
  types?: string[];
}

/** The `config` part of POST /v2/jobs for a transcription job. */
export interface JobConfig {
  type: "transcription";
  transcription_config: SpeechmaticsTranscriptionConfig;
  /** Fetch the media server-side instead of attaching `data_file`. */
  fetch_data?: SpeechmaticsFetchConfig;
  fetch_text?: SpeechmaticsFetchConfig;
  notification_config?: SpeechmaticsNotificationConfig[];
  tracking?: SpeechmaticsTracking;
  output_config?: SpeechmaticsOutputConfig;
  translation_config?: SpeechmaticsTranslationConfig;
  language_identification_config?: SpeechmaticsLanguageIdentificationConfig;
  summarization_config?: SpeechmaticsSummarizationConfig;
  sentiment_analysis_config?: Record<string, unknown>;
  topic_detection_config?: SpeechmaticsTopicDetectionConfig;
  auto_chapters_config?: Record<string, unknown>;
  audio_events_config?: SpeechmaticsAudioEventsConfig;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// ---------------------------------------------------------------------------

const schema = z.looseObject({
  type: z.literal("transcription"),
  transcription_config: z.looseObject({
    language: z.string().min(1),
    domain: z.string().optional(),
    output_locale: z.union([z.string(), z.array(z.string())]).optional(),
    model: z.string().optional(),
    operating_point: z.string().optional(),
    additional_vocab: z
      .array(z.looseObject({ content: z.string(), sounds_like: z.array(z.string()).optional() }))
      .max(
        MAX_ADDITIONAL_VOCAB_ITEMS,
        "transcription_config.additional_vocab accepts at most 20,000 items; SaaS rejects larger dictionaries with HTTP 400 'Job rejected'.",
      )
      .optional(),
    punctuation_overrides: z
      .looseObject({
        sensitivity: z.number().min(0).max(1).optional(),
        permitted_marks: z.array(z.string()).optional(),
      })
      .optional(),
    diarization: z.enum(["none", "speaker", "channel"]).optional(),
    channel_diarization_labels: z
      .array(z.string().regex(/^[A-Za-z0-9._]+$/, "channel_diarization_labels must match ^[A-Za-z0-9._]+$."))
      .optional(),
    enable_entities: z.boolean().optional(),
    entities_config: z
      .looseObject({ detect_advanced_entities: z.boolean().optional() })
      .optional(),
    enable_redaction: z.boolean().optional(),
    redaction_config: z
      .looseObject({ entity_classes: z.array(z.string()).min(1).optional() })
      .optional(),
    max_delay_mode: z.enum(["fixed", "flexible"]).optional(),
    audio_filtering_config: z
      .looseObject({ volume_threshold: z.number().min(0).max(100).optional() })
      .optional(),
    transcript_filtering_config: z
      .looseObject({
        remove_disfluencies: z.boolean().optional(),
        replacements: z.array(z.looseObject({ from: z.string(), to: z.string() })).optional(),
      })
      .optional(),
    speaker_diarization_config: z
      .looseObject({
        prefer_current_speaker: z.boolean().optional(),
        speaker_sensitivity: z.number().min(0).max(1).optional(),
        get_speakers: z.boolean().optional(),
        speakers: z
          .array(
            z.looseObject({
              label: z.string().min(1),
              speaker_identifiers: z.array(z.string()).min(1),
            }),
          )
          .optional(),
      })
      .optional(),
    language_hints: z.array(z.string()).optional(),
    language_hints_strict: z.boolean().optional(),
  }),
  fetch_data: z
    .looseObject({ url: z.string().min(1), auth_headers: z.array(z.string()).optional() })
    .optional(),
  fetch_text: z
    .looseObject({ url: z.string().min(1), auth_headers: z.array(z.string()).optional() })
    .optional(),
  notification_config: z
    .array(
      z.looseObject({
        url: z.string().min(1),
        contents: z
          .array(
            z.enum([
              "jobinfo",
              "transcript",
              "transcript.json-v2",
              "transcript.txt",
              "transcript.srt",
              "data",
              "text",
            ]),
          )
          .optional(),
        method: z.enum(["post", "put"]).optional(),
        auth_headers: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  tracking: z.looseObject({}).optional(),
  output_config: z.looseObject({}).optional(),
  translation_config: z
    .looseObject({
      target_languages: z
        .array(z.string())
        .max(5, "translation_config.target_languages accepts at most 5 languages."),
    })
    .optional(),
  language_identification_config: z
    .looseObject({
      expected_languages: z.array(z.string()).optional(),
      low_confidence_action: z.enum(["allow", "reject", "use_default_language"]).optional(),
      default_language: z.string().optional(),
    })
    .optional(),
  summarization_config: z
    .looseObject({
      content_type: z.enum(["auto", "informative", "conversational"]).optional(),
      summary_length: z.enum(["brief", "detailed"]).optional(),
      summary_type: z.enum(["paragraphs", "bullets"]).optional(),
    })
    .optional(),
  sentiment_analysis_config: z.looseObject({}).optional(),
  topic_detection_config: z.looseObject({ topics: z.array(z.string()).optional() }).optional(),
  auto_chapters_config: z.looseObject({}).optional(),
  audio_events_config: z.looseObject({ types: z.array(z.string()).optional() }).optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Resolves the effective model id: `model`, else `operating_point`, else the documented default. */
export function resolveModel(config: JobConfig): string {
  const tc = config.transcription_config as SpeechmaticsTranscriptionConfig | undefined;
  return tc?.model ?? tc?.operating_point ?? DEFAULT_MODEL;
}

/**
 * "`operating_point` is deprecated. It maps to `model` and accepts the same
 * `enhanced` and `standard` values." (MODELS_DOCS). Warn on use, and fail when
 * the two disagree — only one of them can win, and which one is undocumented.
 */
function checkOperatingPoint(
  config: JobConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const tc = config.transcription_config;
  if (tc?.operating_point === undefined) return;
  ctx.report({
    code: "unsupported_param",
    severity: "warning",
    path: ["transcription_config", "operating_point"],
    model: resolveModel(config),
    message:
      "`transcription_config.operating_point` is deprecated and kept only for backward compatibility; use `transcription_config.model` instead.",
    meta: { replacement: "model", source: MODELS_DOCS },
  });
  if (tc.model !== undefined && tc.model !== tc.operating_point) {
    ctx.report({
      code: "invalid_shape",
      path: ["transcription_config", "operating_point"],
      model: tc.model,
      message: `\`transcription_config.model\` is "${tc.model}" but the deprecated \`operating_point\` is "${tc.operating_point}"; set only one.`,
      meta: { source: MODELS_DOCS },
    });
  }
}

/**
 * The multilingual models, which share one Batch feature set: "On Batch,
 * Melia 1 and Oak 1 match the Enhanced and Standard models for core
 * transcription features [...] They do not yet support the following
 * features" (MODELS_DOCS, 2026-11-12).
 */
const MULTILINGUAL_MODELS: ReadonlySet<string> = new Set(["melia-1", "oak-1"]);

/**
 * Config keys Melia 1 and Oak 1 do not support, with the doc's own wording.
 * Entity detection is on the models page's list too, but is a warning instead
 * (see {@link checkMultilingual}).
 */
const MULTILINGUAL_UNSUPPORTED: ReadonlyArray<{ path: Array<string | number>; feature: string }> = [
  { path: ["transcription_config", "additional_vocab"], feature: "custom dictionary" },
  {
    path: ["transcription_config", "transcript_filtering_config"],
    feature: "find and replace / profanity tagging",
  },
  { path: ["transcription_config", "audio_filtering_config"], feature: "audio filtering" },
  { path: ["translation_config"], feature: "translation" },
  { path: ["summarization_config"], feature: "summarization" },
  { path: ["auto_chapters_config"], feature: "chapters" },
  { path: ["topic_detection_config"], feature: "topics" },
  { path: ["sentiment_analysis_config"], feature: "sentiment" },
  { path: ["audio_events_config"], feature: "audio events" },
];

function readPath(root: unknown, path: Array<string | number>): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}

/**
 * The `language` values Melia 1 and Oak 1 refuse by name: "Melia 1 and Oak 1
 * do not support the `auto` option, the bilingual and multi-language pack
 * codes, or translation" (LANGUAGES_DOCS, 2026-11-12), and of `auto`, "which
 * returns an error" (MODELS_DOCS). The pack codes are that page's "Supported
 * packs" table; its fifth pack is `es` plus a `domain`, not a code.
 */
const MULTILINGUAL_REFUSED_LANGUAGES: ReadonlySet<string> = new Set([
  "auto",
  "ar_en",
  "en_ms",
  "cmn_en",
  "cmn_en_ms_ta",
]);

/**
 * Melia 1's and Oak 1's documented gaps (MODELS_DOCS): they "do not yet
 * support" custom vocabulary/formatting, entity detection, audio filtering,
 * speaker identification and every speech-intelligence add-on. On `language`
 * the docs say "Set `language` to `multi`": `auto` and the pack codes are
 * refused, and a single language code, which no page documents for these
 * models, is a warning. Entity detection is a warning too, because the pricing
 * page lists it for exactly these two models.
 */
function checkMultilingual(
  config: JobConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = resolveModel(config);
  if (!MULTILINGUAL_MODELS.has(model)) return;
  const tc = config.transcription_config;

  const language = tc?.language;
  if (language !== undefined && language !== "multi") {
    const refused = MULTILINGUAL_REFUSED_LANGUAGES.has(language);
    ctx.report({
      code: "invalid_enum_value",
      ...(!refused && { severity: "warning" as const }),
      path: ["transcription_config", "language"],
      model,
      message:
        language === "auto"
          ? `${model} is a multilingual model: "auto" returns an error for this model; set \`language: "multi"\`.`
          : refused
            ? `${model} is a multilingual model and does not support the language pack code ${JSON.stringify(language)}; set \`language: "multi"\` — it switches between the pack's languages on its own.`
            : `the ${model} docs say to set \`language: "multi"\`; a single language code (${JSON.stringify(language)}) is undocumented on this model and is sent as-is — to steer it toward a language, use \`language: "multi"\` with \`language_hints\`.`,
      meta: {
        allowed: ["multi"],
        value: language,
        source: refused && language !== "auto" ? LANGUAGES_DOCS : MODELS_DOCS,
      },
    });
  }

  if (tc?.enable_entities === true) {
    ctx.report({
      code: "unsupported_capability",
      severity: "warning",
      path: ["transcription_config", "enable_entities"],
      model,
      message: `entity detection on ${model} contradicts between Speechmatics pages: the models page lists it among the features Melia 1 and Oak 1 "do not yet support", while the pricing page lists Entity detection for Melia 1 and Oak 1 (pre-recorded) at a list rate "On request"; sent as-is — confirm it is enabled on your account.`,
      meta: { source: MODELS_DOCS, contradictedBy: PRICING_DOCS },
    });
  }

  for (const { path, feature } of MULTILINGUAL_UNSUPPORTED) {
    if (readPath(config, path) == null) continue;
    ctx.report({
      code: "unsupported_capability",
      path,
      model,
      message: `\`${path.join(".")}\` (${feature}) is not supported by ${model} yet; use "standard" or "enhanced".`,
      meta: { source: MODELS_DOCS },
    });
  }

  // Diarization itself works on both; SPEAKER IDENTIFICATION (labelled
  // speakers / returned identifiers) does not — "Not supported by Melia 1 and
  // Oak 1", on both `get_speakers` and `speakers`
  // (https://docs.speechmatics.com/api-ref/batch/create-a-new-job.md, 2026-11-12).
  const diarization = tc?.speaker_diarization_config;
  const identification =
    diarization?.speakers !== undefined || diarization?.get_speakers !== undefined;
  if (identification) {
    ctx.report({
      code: "unsupported_capability",
      path: ["transcription_config", "speaker_diarization_config"],
      model,
      message: `speaker identification (\`speakers\` / \`get_speakers\`) is not supported by ${model} yet; plain speaker diarization is.`,
      meta: { source: MODELS_DOCS },
    });
  }
}

/**
 * "The Enhanced Medical model" is an Enhanced variant: `domain: "medical"` is
 * documented only alongside `model: "enhanced"` (MODELS_DOCS). Oak 1 is the
 * other medical model, selected by its id alone: "Oak 1 is a standalone model
 * for healthcare audio. It is separate from the Enhanced Medical model"
 * (MODELS_DOCS, 2026-11-12).
 */
function checkMedicalDomain(
  config: JobConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const domain = config.transcription_config?.domain;
  if (domain !== "medical") return;
  const model = resolveModel(config);
  if (model === "enhanced") return;
  ctx.report({
    code: "unsupported_capability",
    path: ["transcription_config", "domain"],
    model,
    message:
      model === "oak-1"
        ? '`domain: "medical"` selects the Enhanced Medical model and requires `model: "enhanced"`; oak-1 is itself the multilingual medical model — drop `domain`, or use `model: "enhanced"` for single-language medical audio.'
        : `\`domain: "medical"\` selects the Enhanced Medical model and requires \`model: "enhanced"\`; got "${model}".`,
    meta: { source: MODELS_DOCS },
  });
}

/**
 * "Output Locale is currently not supported in combination with using
 * Automatic Language Identification. Jobs with this combination of features
 * will be rejected." (LANGUAGE_ID_DOCS, 2026-11-12). And "Each locale in the
 * array must belong to a different language. Passing two locales for the same
 * language, for example `en-GB` and `en-US` together, is rejected."
 * (FORMATTING_DOCS, 2026-11-12). A locale's language is its primary subtag:
 * `cmn` in `cmn-Hans`.
 */
function checkOutputLocales(
  config: JobConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const tc = config.transcription_config;
  if (tc?.language === "auto" && tc.output_locale !== undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["transcription_config", "output_locale"],
      model: resolveModel(config),
      message:
        '`output_locale` is rejected together with `language: "auto"` (automatic language identification); set a language or drop the locale.',
      meta: { source: LANGUAGE_ID_DOCS },
    });
    return;
  }
  const locales = tc?.output_locale;
  if (!Array.isArray(locales)) return;
  const firstByLanguage = new Map<string, string>();
  for (const [index, locale] of locales.entries()) {
    const language = (locale.split("-")[0] ?? locale).toLowerCase();
    const first = firstByLanguage.get(language);
    if (first === undefined) {
      firstByLanguage.set(language, locale);
      continue;
    }
    ctx.report({
      code: "invalid_shape",
      path: ["transcription_config", "output_locale", index],
      model: resolveModel(config),
      message: `\`output_locale\` lists "${first}" and "${locale}", two locales of one language, which Speechmatics rejects; give one locale per language in the audio.`,
      meta: { value: locale, conflictsWith: first, source: FORMATTING_DOCS },
    });
  }
}

/**
 * The redaction and advanced-entity pairing rules (API_REF, 2026-11-12):
 *
 * - `enable_redaction` "Must be set together with
 *   `redaction_config.entity_classes`", which is "Required, and only applied,
 *   when `enable_redaction` is true".
 * - "If `enable_entities` is true, `entities_config.detect_advanced_entities`
 *   must also be true (redaction relies on advanced entity detection); if
 *   `enable_entities` is false or omitted, `enable_redaction` can be used on
 *   its own."
 * - `detect_advanced_entities` "Must be set together with
 *   `enable_entities: true`". A warning, not an error: no rejection is
 *   documented, and the rule above lets redaction run without
 *   `enable_entities`.
 * - `entity_classes` is "`enum[]`≥ 1 items unique items". The schema holds the
 *   minimum; each repeat is reported at its own index.
 */
function checkRedaction(
  config: JobConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const tc = config.transcription_config;
  const model = resolveModel(config);
  const classes = tc.redaction_config?.entity_classes;

  if (tc.enable_redaction === true && classes === undefined) {
    ctx.report({
      code: "invalid_shape",
      path: ["transcription_config", "redaction_config"],
      model,
      message:
        '`enable_redaction: true` must be set together with `redaction_config.entity_classes`; name at least one group or entity class (e.g. "pii").',
      meta: { source: API_REF },
    });
  }

  const advanced = tc.entities_config?.detect_advanced_entities === true;
  if (tc.enable_redaction === true && tc.enable_entities === true && !advanced) {
    ctx.report({
      code: "invalid_shape",
      path: ["transcription_config", "entities_config", "detect_advanced_entities"],
      model,
      message:
        "`enable_redaction` with `enable_entities: true` also needs `entities_config.detect_advanced_entities: true` (redaction relies on advanced entity detection); set it, or drop `enable_entities` to redact on its own.",
      meta: { source: API_REF },
    });
  }

  if (advanced && tc.enable_entities !== true) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["transcription_config", "entities_config", "detect_advanced_entities"],
      model,
      message:
        "`entities_config.detect_advanced_entities` must be set together with `enable_entities: true`; without it, what the API does with the flag is undocumented.",
      meta: { requires: "enable_entities", source: API_REF },
    });
  }

  const seen = new Set<string>();
  for (const [index, entityClass] of (classes ?? []).entries()) {
    if (!seen.has(entityClass)) {
      seen.add(entityClass);
      continue;
    }
    ctx.report({
      code: "invalid_shape",
      path: ["transcription_config", "redaction_config", "entity_classes", index],
      model,
      message: `\`redaction_config.entity_classes\` lists ${JSON.stringify(entityClass)} more than once; its items must be unique.`,
      meta: { value: entityClass, source: API_REF },
    });
  }
}

/** Audio paths a media declaration may be attached to, most specific first. */
const AUDIO_PATHS: ReadonlyArray<Array<string | number>> = [["data_file"], ["fetch_data", "url"]];

function declaredAudio(
  ctx: PipelineContext,
): { path: readonly (string | number)[]; durationSeconds?: number; bytes?: number } | undefined {
  for (const path of AUDIO_PATHS) {
    const found = findMediaDeclaration(ctx.options.media, path);
    if (found !== undefined) return { ...found, path };
  }
  return ctx.options.media?.find((d) => d.durationSeconds !== undefined || d.bytes !== undefined);
}

/** 1 GB body cap (LIMITS_DOCS); larger media must go through `fetch_data`. */
function checkDataFileSize(
  config: JobConfig,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const declaration = findMediaDeclaration(ctx.options.media, ["data_file"]);
  const bytes = declaration?.bytes;
  if (bytes === undefined || bytes < MAX_DATA_FILE_BYTES) return;
  ctx.report({
    code: "media_too_large",
    path: ["data_file"],
    model: resolveModel(config),
    message: `the \`data_file\` part is ${bytes} bytes; Speechmatics rejects bodies of ${MAX_DATA_FILE_BYTES} bytes (1 GB) or more — submit larger media via \`fetch_data.url\`.`,
    meta: { bytes, limit: MAX_DATA_FILE_BYTES, source: LIMITS_DOCS },
  });
}

/**
 * Cost = declared audio minutes x the catalog per-minute rate. Without a
 * duration declaration the estimate is empty (the config cannot reveal it).
 */
function estimateJob(
  _config: JobConfig,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const seconds = declaredAudio(ctx)?.durationSeconds;
  if (seconds === undefined) return {};
  const costUSD = computeAudioMinutesCostUSD(info?.cost, minutesFromSeconds(seconds));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `speechmatics.stt`. Speechmatics publishes no official JS
 * SDK for this REST endpoint, so the single self-named `"speechmatics"` target
 * returns the config unchanged; naming it keeps the call site shaped like
 * every other endpoint's and leaves room for a real SDK formatter later. Type
 * alias, not interface: an interface has no implicit index signature and
 * cannot satisfy `SdkFormatters`.
 */
type JobsSdkTargets<B> = { speechmatics: () => B };

function finalize(config: JobConfig): unknown {
  const body = { ...config };
  return toValidated(
    body,
    {
      url: JOBS_URL,
      method: "POST",
      // Deliberately empty: fetch derives the multipart boundary from FormData.
      headers: {},
      body: "form",
    },
    { sdk: { speechmatics: () => body } },
  );
}

const validator = createValidator<JobConfig, unknown>({
  endpoint: "speechmatics.stt",
  schema,
  modelId: resolveModel,
  catalog: models,
  checks: [
    checkOperatingPoint,
    checkMultilingual,
    checkMedicalDomain,
    checkOutputLocales,
    checkRedaction,
    checkDataFileSize,
  ],
  // The audio arrives as a `data_file` FORM PART alongside this JSON config, so
  // a declaration addressed to it names a real coordinate that is not a key of
  // `JobConfig`. Same list `declaredAudio` reads, so the two cannot disagree.
  mediaPaths: AUDIO_PATHS,
  estimate: estimateJob,
  finalize,
});

/**
 * Validates the `config` object of POST /v2/jobs (Speechmatics Batch
 * transcription). The result's enumerable properties are the exact JobConfig
 * to serialize into the multipart `config` part; `.request` carries the
 * default EU1 url/method (swap in {@link jobsUrl} for another region and add
 * your own `authorization: Bearer <SPEECHMATICS_API_KEY>` header).
 *
 * Build the request body with {@link toFormData}:
 * `fetch(JOBS_URL, { method: "POST", body: toFormData({ config: validated, data_file: blob }), headers: { authorization } })`
 * — do NOT set a content-type header; fetch derives the multipart boundary.
 * Speechmatics has no official JS SDK for this REST endpoint, so
 * `.toSdk("speechmatics")` returns the config unchanged.
 *
 * Cost estimation: declare the audio length via
 * `options.media = [{ path: ["data_file"], durationSeconds }]` (or
 * `["fetch_data", "url"]`).
 */
export const stt = validator as unknown as {
  <T extends JobConfig>(
    config: T & ExactKeys<T, JobConfig>,
    options?: ValidateOptions,
  ): ValidatedForm<T, JobsSdkTargets<T>>;
  safe<T extends JobConfig>(
    config: T & ExactKeys<T, JobConfig>,
    options?: ValidateOptions,
  ): ValidateResult<ValidatedForm<T, JobsSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

// ---------------------------------------------------------------------------
// Multipart body
// ---------------------------------------------------------------------------

export interface SpeechmaticsJobUpload {
  /** The validated JobConfig; serialized into the `config` part as JSON. */
  config: JobConfig;
  /**
   * The media bytes. Omit when the job uses `fetch_data.url`. A string is
   * appended as-is per FormData semantics (useful for tests).
   */
  data_file?: Blob | string;
  /** Overrides the multipart filename of the `data_file` part. */
  filename?: string;
  /** Plain-text transcript for alignment-style flows that also send text. */
  text_file?: Blob | string;
}

/**
 * Builds the multipart body for POST {@link JOBS_URL}: a `config` part
 * carrying `JSON.stringify(config)` plus the optional `data_file` /
 * `text_file` parts
 * (https://docs.speechmatics.com/speech-to-text/batch/input).
 */
export function toFormData(upload: SpeechmaticsJobUpload): FormData {
  const form = new FormData();
  form.append("config", JSON.stringify(upload.config));
  appendFile(form, "data_file", upload.data_file, upload.filename);
  appendFile(form, "text_file", upload.text_file);
  return form;
}

function appendFile(form: FormData, field: string, value?: Blob | string, filename?: string): void {
  if (value === undefined) return;
  if (value instanceof Blob && filename !== undefined) form.append(field, value, filename);
  else form.append(field, value);
}
