import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions, MediaDeclaration } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { computeAudioMinutesCostUSD, minutesFromSeconds } from "../../core/cost";
import { findMediaDeclaration } from "../../core/media/check";
import { models, type AssemblyaiModelId } from "./models";

export const TRANSCRIPT_URL = "https://api.assemblyai.com/v2/transcript";
/** EU data-residency variant of {@link TRANSCRIPT_URL}. */
export const TRANSCRIPT_URL_EU = "https://api.eu.assemblyai.com/v2/transcript";
/**
 * Raw-binary upload endpoint (NOT multipart): POST your audio bytes with
 * content-type application/octet-stream; the response's `upload_url` is a
 * valid `audio_url` for {@link transcript}. EU: swap the host as above.
 */
export const UPLOAD_URL = "https://api.assemblyai.com/v2/upload";

const SUBMIT_DOCS = "https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit";

// ---------------------------------------------------------------------------
// Wire types — mirror POST /v2/transcript exactly (verified against
// SUBMIT_DOCS on 2026-08-13).
// ---------------------------------------------------------------------------

export type AssemblyaiSpeechModel = AssemblyaiModelId | (string & {});

/**
 * The documented `domain` values — Medical Mode and Veterinary Mode (beta).
 * SUBMIT_DOCS (2026-11-12): "enum: - medical-v1 - veterinary-v1 - null".
 */
export const ASSEMBLYAI_DOMAINS = ["medical-v1", "veterinary-v1"] as const;
export type AssemblyaiDomain = (typeof ASSEMBLYAI_DOMAINS)[number];

/**
 * Documented word/term limits (SUBMIT_DOCS):
 * - `prompt`: "Max: 1,500 words".
 * - `keyterms_prompt`: "Max 6 words per phrase" (plus the per-model term caps
 *   below).
 * - `custom_spelling`: "Each `to` value must be a single word, each `from`
 *   phrase max 5 words".
 */
export const PROMPT_MAX_WORDS = 1500;
export const KEYTERM_MAX_WORDS = 6;
export const CUSTOM_SPELLING_FROM_MAX_WORDS = 5;

function countWords(text: string): number {
  return text.split(/\s+/u).filter((word) => word !== "").length;
}

export interface AssemblyaiSpeakerOptions {
  min_speakers_expected?: number | null;
  max_speakers_expected?: number | null;
  advanced_speaker_segmentation?: boolean | null;
  /**
   * Adds a 0–1 `speaker_confidence` to each word and utterance; default false
   * (SUBMIT_DOCS, 2026-11-12: "When `true`, includes a `speaker_confidence`
   * field per word and per utterance in the response.").
   */
  include_speaker_confidence?: boolean;
}

/** Documented fields of `language_detection_options` (SUBMIT_DOCS). */
export interface AssemblyaiLanguageDetectionOptions {
  /** Default ["all"]. */
  expected_languages?: string[] | null;
  /** Default "auto". */
  fallback_language?: string | null;
  /** Default false. */
  code_switching?: boolean | null;
  /** 0.0–1.0; default 0.3. */
  code_switching_confidence_threshold?: number | null;
  /** Supported: "en_au", "en_uk"; at most one locale per base language. */
  localization?: string[] | null;
  /**
   * Default "error". "fallback" needs a specific `fallback_language`
   * (SUBMIT_DOCS, 2026-11-12: "`fallback` requires `fallback_language` to be
   * set to a specific language code; `auto` returns a `400`.").
   */
  on_no_speech_detected?: "error" | "fallback";
}

export interface TranscriptBody {
  /** URL of the audio/video file to transcribe (public, or a /v2/upload upload_url). */
  audio_url: string;
  /**
   * Priority-ordered routing list; defaults to
   * ["universal-3-5-pro", "universal-2"] when neither model field is sent.
   */
  speech_models?: AssemblyaiSpeechModel[];
  /**
   * Deprecated predecessor of `speech_models`. AssemblyAI's changelog
   * (2026-11-12): "Passing a current model name ( universal-2 ,
   * universal-3-5-pro ) to the async speech_model field now returns a 400.
   * Passing a legacy name ( best , nano , universal ) returns 200 but always
   * routes to the default model." Pin a model with `speech_models`; those two
   * current names are refused here.
   */
  speech_model?: AssemblyaiSpeechModel | null;
  /** Cannot be combined with `language_detection: true`. */
  language_code?: string | null;
  /**
   * Constrains code switching / detection to these languages. Must include
   * "en" on Universal-2 only; Universal-3.5 Pro takes any set.
   */
  language_codes?: string[] | null;
  /** Defaults to true when `language_code` is unspecified. */
  language_detection?: boolean;
  /** 0.0–1.0; default 0. */
  language_confidence_threshold?: number;
  language_detection_options?: AssemblyaiLanguageDetectionOptions | null;
  /** Default true. */
  punctuate?: boolean;
  /** Default true. */
  format_text?: boolean;
  /** Transcribe filler words (uh, um). */
  disfluencies?: boolean;
  multichannel?: boolean;
  speaker_labels?: boolean;
  /** Positive integer; conflicts with `speaker_options`. */
  speakers_expected?: number | null;
  speaker_options?: AssemblyaiSpeakerOptions | null;
  /** Milliseconds offset where transcription begins. */
  audio_start_from?: number;
  /** Milliseconds offset where transcription stops. */
  audio_end_at?: number;
  word_boost?: string[];
  boost_param?: string;
  filter_profanity?: boolean;
  redact_pii?: boolean;
  redact_pii_audio?: boolean;
  redact_pii_audio_quality?: "mp3" | "wav" | null;
  redact_pii_audio_options?: {
    return_redacted_no_speech_audio?: boolean | null;
    override_audio_redaction_method?: "silence" | null;
  } | null;
  /** PII categories, e.g. "us_social_security_number", "credit_card_number". */
  redact_pii_policies?: string[] | null;
  redact_pii_sub?: "entity_name" | "hash" | null;
  redact_pii_return_unredacted?: boolean;
  /**
   * User-defined terms to redact, e.g. `{ INTERNAL_TOOL: ["Bearclaw"] }`.
   * Requires `redact_pii: true`; max 100 labels, 200 terms per label,
   * 200 characters per term, 80 characters per label.
   */
  redact_static_entities?: Record<string, string[]> | null;
  webhook_url?: string;
  webhook_auth_header_name?: string | null;
  webhook_auth_header_value?: string | null;
  content_safety?: boolean;
  /** 25–100; requires `content_safety: true`. */
  content_safety_confidence?: number;
  entity_detection?: boolean;
  /** Requires punctuation (`punctuate` must not be false). */
  sentiment_analysis?: boolean;
  /** Topic Detection. */
  iab_categories?: boolean;
  /** Key Phrases. */
  auto_highlights?: boolean;
  /**
   * Domain terms; up to 200 on Universal-2, 1000 on Universal-3.5 Pro, and
   * at most 6 words per phrase.
   */
  keyterms_prompt?: string[] | null;
  /** Each `to` must be a single word; each `from` phrase at most 5 words. */
  custom_spelling?: Array<{ from: string[]; to: string }> | null;
  /** Contextual guidance, up to 1500 words — Universal-3.5 Pro only. */
  prompt?: string | null;
  /** 0.0–1.0; default 0 — Universal-3.5 Pro only. */
  temperature?: number;
  /** Reject audio whose speech fraction is below this (0.0–1.0); nullable. */
  speech_threshold?: number | null;
  /**
   * Legacy Summarization — `true` is refused on every model. AssemblyAI's
   * changelog (2026-10-06 entry, checked 2026-11-12): "Starting October 20,
   * 2026, requests using them will return errors." Its replacement is
   * `speech_understanding.request.summarization`. `false` still validates.
   */
  summarization?: boolean;
  /** Legacy Summarization's model — refused when non-null, like `summarization`. */
  summary_model?: "informative" | "catchy" | "conversational" | null;
  /**
   * Legacy Summarization's output shape — "The type of summary generated, if
   * Summarization is enabled." (SUBMIT_DOCS); not refused on its own.
   */
  summary_type?: "gist" | "headline" | "paragraph" | "bullets" | "bullets_verbose" | null;
  /**
   * Legacy Auto Chapters — `true` is refused on every model, like
   * `summarization`; `speech_understanding.request.summarization` with
   * `summary_type: "paragraph"` gives chapter-style sections.
   */
  auto_chapters?: boolean;
  /** "medical-v1" (Medical Mode) or "veterinary-v1" (Veterinary Mode, beta). */
  domain?: AssemblyaiDomain | null;
  /** Universal-3.5 Pro only. */
  remove_audio_tags?: "all" | "speaker" | null;
  speech_understanding?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Schema (loose: unknown keys pass through with an unknown_param warning).
// Cross-field pairing rules live in superRefine so they surface as
// invalid_shape errors with precise paths.
// ---------------------------------------------------------------------------

const schema = z
  .looseObject({
    audio_url: z.string(),
    speech_models: z.array(z.string()).optional(),
    speech_model: z.string().nullable().optional(),
    language_code: z.string().nullable().optional(),
    language_codes: z.array(z.string()).nullable().optional(),
    language_detection: z.boolean().optional(),
    language_confidence_threshold: z.number().min(0).max(1).optional(),
    language_detection_options: z
      .looseObject({
        expected_languages: z.array(z.string()).nullable().optional(),
        fallback_language: z.string().nullable().optional(),
        code_switching: z.boolean().nullable().optional(),
        code_switching_confidence_threshold: z.number().min(0).max(1).nullable().optional(),
        localization: z.array(z.string()).nullable().optional(),
        on_no_speech_detected: z.enum(["error", "fallback"]).optional(),
      })
      .nullable()
      .optional(),
    punctuate: z.boolean().optional(),
    format_text: z.boolean().optional(),
    disfluencies: z.boolean().optional(),
    multichannel: z.boolean().optional(),
    speaker_labels: z.boolean().optional(),
    speakers_expected: z.int().positive().nullable().optional(),
    speaker_options: z.looseObject({}).nullable().optional(),
    audio_start_from: z.int().nonnegative().optional(),
    audio_end_at: z.int().nonnegative().optional(),
    word_boost: z.array(z.string()).optional(),
    boost_param: z.string().optional(),
    filter_profanity: z.boolean().optional(),
    redact_pii: z.boolean().optional(),
    redact_pii_audio: z.boolean().optional(),
    redact_pii_audio_quality: z.enum(["mp3", "wav"]).nullable().optional(),
    redact_pii_audio_options: z.looseObject({}).nullable().optional(),
    redact_pii_policies: z.array(z.string()).nullable().optional(),
    redact_pii_sub: z.enum(["entity_name", "hash"]).nullable().optional(),
    redact_pii_return_unredacted: z.boolean().optional(),
    redact_static_entities: z.looseObject({}).nullable().optional(),
    webhook_url: z.string().optional(),
    // "ASCII letters, numbers, hyphens, underscores only" / "No carriage
    // returns or newlines" (SUBMIT_DOCS).
    webhook_auth_header_name: z
      .string()
      .min(1)
      .max(1000)
      .regex(
        /^[A-Za-z0-9_-]+$/u,
        "webhook_auth_header_name may only contain ASCII letters, numbers, hyphens and underscores.",
      )
      .nullable()
      .optional(),
    webhook_auth_header_value: z
      .string()
      .min(1)
      .max(1000)
      .regex(/^[^\r\n]*$/u, "webhook_auth_header_value must not contain carriage returns or newlines.")
      .nullable()
      .optional(),
    content_safety: z.boolean().optional(),
    content_safety_confidence: z.int().min(25).max(100).optional(),
    entity_detection: z.boolean().optional(),
    sentiment_analysis: z.boolean().optional(),
    iab_categories: z.boolean().optional(),
    auto_highlights: z.boolean().optional(),
    keyterms_prompt: z.array(z.string()).nullable().optional(),
    custom_spelling: z
      .array(z.looseObject({ from: z.array(z.string()), to: z.string() }))
      .nullable()
      .optional(),
    prompt: z.string().nullable().optional(),
    temperature: z.number().min(0).max(1).optional(),
    // SUBMIT_DOCS (2026-11-12): "type: - number - 'null' … minimum: 0 maximum: 1".
    speech_threshold: z.number().min(0).max(1).nullable().optional(),
    summarization: z.boolean().optional(),
    summary_model: z.enum(["informative", "catchy", "conversational"]).nullable().optional(),
    summary_type: z
      .enum(["gist", "headline", "paragraph", "bullets", "bullets_verbose"])
      .nullable()
      .optional(),
    auto_chapters: z.boolean().optional(),
    domain: z.string().nullable().optional(),
    remove_audio_tags: z.enum(["all", "speaker"]).nullable().optional(),
    speech_understanding: z.looseObject({}).nullable().optional(),
  })
  .superRefine((params, ctx) => {
    if (params.speakers_expected != null && params.speaker_options != null) {
      ctx.addIssue({
        code: "custom",
        path: ["speakers_expected"],
        message: "`speakers_expected` conflicts with `speaker_options`; send one or the other.",
      });
    }

    if (params.content_safety_confidence !== undefined && params.content_safety !== true) {
      ctx.addIssue({
        code: "custom",
        path: ["content_safety_confidence"],
        message: "`content_safety_confidence` requires `content_safety: true`.",
      });
    }

    if (
      params.audio_start_from !== undefined &&
      params.audio_end_at !== undefined &&
      params.audio_end_at <= params.audio_start_from
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["audio_end_at"],
        message: `audio_end_at (${params.audio_end_at}ms) must be greater than audio_start_from (${params.audio_start_from}ms).`,
      });
    }

    // Features that require automatic punctuation; punctuate defaults to
    // true, so only an explicit false is a conflict (SUBMIT_DOCS). The retired
    // `summarization` / `auto_chapters` pairings are not checked here: those
    // params are refused outright (checkRetiredSummaryParams), and a shape
    // issue would hide that refusal behind advice that cannot make them work.
    for (const feature of ["sentiment_analysis", "speaker_labels"] as const) {
      if (params[feature] === true && params.punctuate === false) {
        ctx.addIssue({
          code: "custom",
          path: [feature],
          message: `\`${feature}\` requires automatic punctuation; remove \`punctuate: false\`.`,
        });
      }
    }

    // Requires text formatting (also default-true).
    if (params.redact_pii === true && params.format_text === false) {
      ctx.addIssue({
        code: "custom",
        path: ["redact_pii"],
        message: "`redact_pii` requires text formatting; remove `format_text: false`.",
      });
    }

    // Redaction sub-options only mean anything with redact_pii enabled.
    for (const dependent of [
      "redact_pii_audio",
      "redact_pii_return_unredacted",
      "redact_static_entities",
    ] as const) {
      if (params[dependent] != null && params[dependent] !== false && params.redact_pii !== true) {
        ctx.addIssue({
          code: "custom",
          path: [dependent],
          message: `\`${dependent}\` requires \`redact_pii: true\`.`,
        });
      }
    }

    if (params.speaker_options != null && params.speaker_labels !== true) {
      ctx.addIssue({
        code: "custom",
        path: ["speaker_options"],
        message: "`speaker_options` requires `speaker_labels: true`.",
      });
    }

    // "Cannot be used together with language_detection."
    if (params.language_code != null && params.language_detection === true) {
      ctx.addIssue({
        code: "custom",
        path: ["language_code"],
        message:
          "`language_code` cannot be combined with `language_detection: true`; drop one — omitting `language_code` is what turns detection on.",
      });
    }

    // SUBMIT_DOCS (2026-11-12): "`fallback` requires `fallback_language` to be
    // set to a specific language code; `auto` returns a `400`." Unspecified
    // means "auto" (https://www.assemblyai.com/docs/pre-recorded-audio/language-detection,
    // 2026-11-12: "When `fallback_language` is unspecified, it is set to
    // `"auto"` by default.").
    const detection = params.language_detection_options;
    if (
      detection?.on_no_speech_detected === "fallback" &&
      (detection.fallback_language == null || detection.fallback_language === "auto")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["language_detection_options", "fallback_language"],
        message:
          '`on_no_speech_detected: "fallback"` needs `fallback_language` set to a specific language code (e.g. "en"); "auto", the default, returns a 400.',
      });
    }

    // English is required on Universal-2 only: "These two-code,
    // English-required limits apply to Universal-2 only." and "On
    // Universal-3.5 Pro, `language_codes` accepts any number of languages, and
    // English is **not** required"
    // (https://www.assemblyai.com/docs/pre-recorded-audio/code-switching,
    // 2026-11-12). SUBMIT_DOCS still reads "One of the values specified must be
    // `en`." — stale against that guide and the 2026-09-11 changelog entry
    // ("It takes any number of languages, and English is not required, for
    // example ["es", "fr"]"), so only a Universal-2-only routing is checked.
    if (
      params.language_codes != null &&
      !params.language_codes.includes("en") &&
      effectiveModels(params).every((model) => model === "universal-2")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["language_codes"],
        message:
          '`language_codes` must include "en" on "universal-2" (its code switching is anchored on English); "universal-3-5-pro" takes any set of languages.',
      });
    }

    if (params.prompt != null && countWords(params.prompt) > PROMPT_MAX_WORDS) {
      ctx.addIssue({
        code: "custom",
        path: ["prompt"],
        message: `\`prompt\` is ${countWords(params.prompt)} words; the documented maximum is ${PROMPT_MAX_WORDS}.`,
      });
    }

    params.keyterms_prompt?.forEach((term, index) => {
      if (countWords(term) > KEYTERM_MAX_WORDS) {
        ctx.addIssue({
          code: "custom",
          path: ["keyterms_prompt", index],
          message: `keyterm ${JSON.stringify(term)} has ${countWords(term)} words; a phrase may contain at most ${KEYTERM_MAX_WORDS} words.`,
        });
      }
    });

    params.custom_spelling?.forEach((entry, index) => {
      if (countWords(entry.to) > 1) {
        ctx.addIssue({
          code: "custom",
          path: ["custom_spelling", index, "to"],
          message: `custom_spelling \`to\` must be a single word; got ${JSON.stringify(entry.to)}.`,
        });
      }
      entry.from.forEach((phrase, fromIndex) => {
        if (countWords(phrase) > CUSTOM_SPELLING_FROM_MAX_WORDS) {
          ctx.addIssue({
            code: "custom",
            path: ["custom_spelling", index, "from", fromIndex],
            message: `custom_spelling \`from\` phrase ${JSON.stringify(phrase)} has ${countWords(phrase)} words; the maximum is ${CUSTOM_SPELLING_FROM_MAX_WORDS}.`,
          });
        }
      });
    });
  });

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Default routing when neither speech_model nor speech_models is sent (SUBMIT_DOCS). */
export const DEFAULT_SPEECH_MODELS = ["universal-3-5-pro", "universal-2"] as const;

/** The model catalog checks run against: speech_model, else the first routing entry. */
function primaryModelId(params: TranscriptBody): string | undefined {
  return params.speech_model ?? params.speech_models?.[0] ?? undefined;
}

/** All models the request can route to, including the documented default. */
function effectiveModels(
  params: Pick<TranscriptBody, "speech_models" | "speech_model">,
): readonly string[] {
  if (params.speech_models !== undefined && params.speech_models.length > 0) {
    return params.speech_models;
  }
  if (params.speech_model != null) return [params.speech_model];
  return DEFAULT_SPEECH_MODELS;
}

/**
 * Current model names in the deprecated singular `speech_model` are a 400:
 * "Passing a current model name ( universal-2 , universal-3-5-pro ) to the
 * async speech_model field now returns a 400. Passing a legacy name ( best ,
 * nano , universal ) returns 200 but always routes to the default model."
 * (https://www.assemblyai.com/changelog, 2026-07-10 entry, checked
 * 2026-11-12), and ERRORS_DOCS: "`400` when a current model name is sent in
 * `speech_model` | The singular `speech_model` is deprecated. | Use
 * `speech_models`." Only the two named ids are refused: `slam-1` is a legacy
 * value in SDK 4.43.0's `speech_model` type, and `universal-3-6-pro-preview`
 * is named by neither source.
 */
const SPEECH_MODEL_CURRENT_NAMES = new Set<string>(["universal-3-5-pro", "universal-2"]);
const ERRORS_DOCS = "https://www.assemblyai.com/docs/errors";

function checkSpeechModel(
  params: TranscriptBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.speech_model;
  if (model == null || !SPEECH_MODEL_CURRENT_NAMES.has(model)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["speech_model"],
    message: `\`speech_model\` is deprecated and returns 400 for current model names; send speech_models: [${JSON.stringify(model)}].`,
    meta: { value: model, source: ERRORS_DOCS },
  });
}

/**
 * `prompt` and `remove_audio_tags` are "only supported for the Universal-3.5
 * Pro model", and `temperature` "only takes effect on the Universal-3.5 Pro
 * model" (SUBMIT_DOCS, 2026-11-12) — so a routing without universal-3-5-pro,
 * `universal-3-6-pro-preview` included, cannot carry them.
 */
const PRO_ONLY_PARAMS = ["prompt", "temperature", "remove_audio_tags"] as const;

function checkProOnlyParams(
  params: TranscriptBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const routing = effectiveModels(params);
  if (routing.includes("universal-3-5-pro")) return;
  for (const param of PRO_ONLY_PARAMS) {
    if (params[param] != null) {
      ctx.report({
        code: "unsupported_param",
        path: [param],
        ...(routing[0] !== undefined && { model: routing[0] }),
        message: `\`${param}\` is only supported by "universal-3-5-pro"; this request routes to ${routing.map((m) => `"${m}"`).join(", ")}.`,
        meta: { source: SUBMIT_DOCS },
      });
    }
  }
}

/**
 * The legacy Summarization and Auto Chapters models are retired on every
 * routing. The changelog's 2026-10-06 entry (https://www.assemblyai.com/changelog,
 * checked 2026-11-12): "The legacy Summarization model (the top-level
 * `summarization` boolean and `summary_model` parameter) and the legacy Auto
 * Chapters model are deprecated. Starting October 20, 2026, requests using them
 * will return errors." The model reference (RETIRED_SUMMARY_SOURCE, last
 * updated 2026-11-10) states it in the present tense — "the top-level
 * `summarization` and `auto_chapters` options return errors since October 20,
 * 2026" — and names the replacement: "set
 * `speech_understanding.request.summarization` … `summary_type: "paragraph"`
 * gives chapter-style sections." `summary_type` is named by neither source,
 * and `false` / `null` (what the submit reference's own TranscriptParams
 * example sends) is not a use, so neither is refused.
 */
const RETIRED_SUMMARY_PARAMS = ["summarization", "auto_chapters", "summary_model"] as const;
const RETIRED_SUMMARY_SOURCE = "https://www.assemblyai.com/llms/models.md";

function checkRetiredSummaryParams(
  params: TranscriptBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  for (const param of RETIRED_SUMMARY_PARAMS) {
    const value = params[param];
    if (value == null || value === false) continue;
    const chapters =
      param === "auto_chapters" ? ' (`summary_type: "paragraph"` gives chapter-style sections)' : "";
    ctx.report({
      code: "unsupported_param",
      path: [param],
      message: `The top-level \`${param}\` returns an error on every model since October 20, 2026, when AssemblyAI retired its legacy Summarization and Auto Chapters models; use \`speech_understanding.request.summarization\` instead${chapters}.`,
      meta: { source: RETIRED_SUMMARY_SOURCE },
    });
  }
}

/**
 * `redact_static_entities` limits (SUBMIT_DOCS): "Max 100 labels, 200 terms
 * per label, 200 chars per term. Label chars: letters, numbers, spaces,
 * underscores, hyphens (max 80)."
 */
export const STATIC_ENTITY_MAX_LABELS = 100;
export const STATIC_ENTITY_MAX_TERMS_PER_LABEL = 200;
export const STATIC_ENTITY_MAX_TERM_CHARACTERS = 200;
export const STATIC_ENTITY_MAX_LABEL_CHARACTERS = 80;
const STATIC_ENTITY_LABEL_PATTERN = /^[A-Za-z0-9 _-]+$/u;

function checkStaticEntities(
  params: TranscriptBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const entities = params.redact_static_entities;
  if (entities == null || typeof entities !== "object") return;
  const labels = Object.keys(entities);
  if (labels.length > STATIC_ENTITY_MAX_LABELS) {
    ctx.report({
      code: "invalid_shape",
      path: ["redact_static_entities"],
      message: `redact_static_entities has ${labels.length} labels; the maximum is ${STATIC_ENTITY_MAX_LABELS}.`,
      meta: { count: labels.length, limit: STATIC_ENTITY_MAX_LABELS, source: SUBMIT_DOCS },
    });
  }
  for (const label of labels) {
    if (label.length > STATIC_ENTITY_MAX_LABEL_CHARACTERS || !STATIC_ENTITY_LABEL_PATTERN.test(label)) {
      ctx.report({
        code: "invalid_shape",
        path: ["redact_static_entities", label],
        message: `redact_static_entities label ${JSON.stringify(label)} must be at most ${STATIC_ENTITY_MAX_LABEL_CHARACTERS} characters of letters, numbers, spaces, underscores or hyphens.`,
        meta: { limit: STATIC_ENTITY_MAX_LABEL_CHARACTERS, source: SUBMIT_DOCS },
      });
    }
    const terms = entities[label];
    if (!Array.isArray(terms)) continue;
    if (terms.length > STATIC_ENTITY_MAX_TERMS_PER_LABEL) {
      ctx.report({
        code: "invalid_shape",
        path: ["redact_static_entities", label],
        message: `redact_static_entities label ${JSON.stringify(label)} has ${terms.length} terms; the maximum is ${STATIC_ENTITY_MAX_TERMS_PER_LABEL} per label.`,
        meta: { count: terms.length, limit: STATIC_ENTITY_MAX_TERMS_PER_LABEL, source: SUBMIT_DOCS },
      });
    }
    terms.forEach((term, index) => {
      if (typeof term === "string" && term.length > STATIC_ENTITY_MAX_TERM_CHARACTERS) {
        ctx.report({
          code: "invalid_shape",
          path: ["redact_static_entities", label, index],
          message: `redact_static_entities term is ${term.length} characters; the maximum is ${STATIC_ENTITY_MAX_TERM_CHARACTERS}.`,
          meta: { limit: STATIC_ENTITY_MAX_TERM_CHARACTERS, source: SUBMIT_DOCS },
        });
      }
    });
  }
}

const DOMAIN_SET = new Set<string>(ASSEMBLYAI_DOMAINS);

/** `domain` is a closed enum (ASSEMBLYAI_DOMAINS); the SDK types it as a string. */
function checkDomain(
  params: TranscriptBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const domain = params.domain;
  if (domain == null || DOMAIN_SET.has(domain)) return;
  ctx.report({
    code: "invalid_enum_value",
    path: ["domain"],
    message: `\`domain\` must be one of ${ASSEMBLYAI_DOMAINS.map((d) => JSON.stringify(d)).join(", ")}; got ${JSON.stringify(domain)}.`,
    meta: { allowed: [...ASSEMBLYAI_DOMAINS], value: domain, source: SUBMIT_DOCS },
  });
}

/** keyterms_prompt caps: 1000 terms on Universal-3.5 Pro, 200 on Universal-2 (SUBMIT_DOCS). */
const KEYTERMS_MAX_PRO = 1000;
const KEYTERMS_MAX_UNIVERSAL_2 = 200;

function checkKeytermsPrompt(
  params: TranscriptBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const count = params.keyterms_prompt?.length ?? 0;
  if (count === 0) return;
  // The docs publish caps only for universal-3-5-pro (1,000) and
  // universal-2 (200); other routings (universal-3-6-pro-preview, slam-1)
  // have no documented cap, so they are not checked.
  const routing = effectiveModels(params);
  const capped = routing.includes("universal-3-5-pro")
    ? { cap: KEYTERMS_MAX_PRO, model: "universal-3-5-pro" }
    : routing.includes("universal-2")
      ? { cap: KEYTERMS_MAX_UNIVERSAL_2, model: "universal-2" }
      : undefined;
  if (capped !== undefined && count > capped.cap) {
    ctx.report({
      code: "invalid_shape",
      path: ["keyterms_prompt"],
      message: `keyterms_prompt has ${count} terms; the limit is ${capped.cap} for "${capped.model}".`,
      meta: { count, limit: capped.cap, source: SUBMIT_DOCS },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

function declaredDurationSeconds(media: MediaDeclaration[] | undefined): number | undefined {
  const exact = findMediaDeclaration(media, ["audio_url"]);
  if (exact?.durationSeconds !== undefined) return exact.durationSeconds;
  return media?.find((d) => d.durationSeconds !== undefined)?.durationSeconds;
}

function estimateTranscript(
  params: TranscriptBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): ValidateEstimate {
  const declared = declaredDurationSeconds(ctx.options.media);
  if (declared === undefined) return {};
  // When neither model field is sent, requests route to universal-3-5-pro
  // first (DEFAULT_SPEECH_MODELS), so price at that rate.
  const effective =
    info ?? (primaryModelId(params) === undefined ? models["universal-3-5-pro"] : undefined);
  const costUSD = computeAudioMinutesCostUSD(effective?.cost, minutesFromSeconds(declared));
  return costUSD === undefined ? {} : { costUSD };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * SDK targets for `assemblyai.stt`. The official `assemblyai` JS SDK's
 * `client.transcripts.submit()` accepts these wire-shaped fields, so the
 * single `"assemblyai"` formatter is the identity. Type alias, not interface:
 * an interface has no implicit index signature and cannot satisfy
 * `SdkFormatters`.
 */
type TranscriptSdkTargets<B> = { assemblyai: () => B };

function finalize(params: TranscriptBody): unknown {
  const body = { ...params };
  return toValidated(
    body,
    {
      url: TRANSCRIPT_URL,
      method: "POST",
      headers: JSON_HEADERS,
    },
    { sdk: { assemblyai: () => body } },
  );
}

const validator = createValidator<TranscriptBody, unknown>({
  endpoint: "assemblyai.stt",
  schema,
  modelId: primaryModelId,
  catalog: models,
  checks: [
    checkSpeechModel,
    checkProOnlyParams,
    checkRetiredSummaryParams,
    checkKeytermsPrompt,
    checkDomain,
    checkStaticEntities,
  ],
  estimate: estimateTranscript,
  finalize,
});

/**
 * Validates params for POST https://api.assemblyai.com/v2/transcript. The
 * result's enumerable properties are the exact fetch JSON body; `.request`
 * carries url/method/static headers (add your own `authorization: <API_KEY>`
 * header; for EU residency swap the URL for {@link TRANSCRIPT_URL_EU}).
 * `.toSdk("assemblyai")` returns the wire body unchanged — the official `assemblyai` JS
 * SDK's `client.transcripts.submit()` accepts these wire-shaped fields (its
 * `audio` convenience alias for `audio_url` is optional sugar).
 *
 * Model-dependent checks run against `speech_model`, else
 * `speech_models[0]` — the head of the priority routing list.
 *
 * Cost estimation: declare the audio length via
 * `options.media = [{ path: ["audio_url"], durationSeconds }]`. Requests
 * without an explicit model are priced at the universal-3-5-pro rate (the
 * documented default routing head).
 */
export const stt = validator as unknown as {
  <T extends TranscriptBody>(
    params: T & ExactKeys<T, TranscriptBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, TranscriptSdkTargets<T>>;
  safe<T extends TranscriptBody>(
    params: T & ExactKeys<T, TranscriptBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, TranscriptSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
