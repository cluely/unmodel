/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/assemblyai/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import type { AssemblyaiDomain, AssemblyaiLanguageDetectionOptions } from "./stt";

/** The four speech models AssemblyAI routes to — the `assemblyai/…` refs. */
export const MODELS = ["universal-3-5-pro", "universal-2", "universal-3-pro", "slam-1"] as const;

/**
 * AssemblyAI's per-model surface — the largest extras table in the library, and
 * two model-gated blocks that point in opposite directions.
 *
 * ## `timestamps: ["word"]`, with no `"none"`
 *
 * /v2/transcript has no granularity field: `words[]` arrives on every response.
 * So the row states the one thing the route reports, which makes
 * `timestamps: "word"` a request that agrees with reality and compiles to
 * nothing, and `"segment"` / `"character"` compile errors naming what it does
 * report. `"none"` is off the row for the same reason it is off Deepgram's —
 * there is no switch, so asking for none would be a request that says one thing
 * and gets another.
 *
 * ## The two gated blocks
 *
 * "Supported: Universal-3.5 Pro only" covers `temperature` and
 * `remove_audio_tags`; "Supported: Universal-2 only" covers `summarization` and
 * `auto_chapters` (and therefore `summary_model` / `summary_type`, which are
 * that feature's settings). `universal-3-pro` and `slam-1` get neither block —
 * they are the two ids the docs gate *both* features away from, and their row
 * is the shared body alone.
 *
 * ## What is excluded, and why each one is
 *
 * - **`prompt`** — AssemblyAI's is a Universal-3.5-Pro *instruction* field
 *   rather than the acoustic conditioning the canonical word means everywhere
 *   else, and this adapter already declares that gap. An extra of the same name
 *   would be shadowed by the kernel's `unsupported` check before compile even
 *   ran, so the key would be unreachable *and* misleading.
 * - **`speech_model` / `speech_models`, `language_code(s)`, `speaker_labels`,
 *   `speakers_expected`, `speaker_options.{min,max}_speakers_expected`,
 *   `audio_url`** — canonical words' wire spellings.
 * - **`webhook_*`** — transport, and they carry credentials besides; they stay
 *   on `providerOptions.assemblyai`.
 *
 * Several of these have documented dependencies (`redact_pii_audio` needs
 * `redact_pii: true`, `speaker_options` needs `speaker_labels: true`, and
 * `auto_chapters` cannot ride with `summarization`). Those are *combination*
 * rules rather than per-model ones, they are already checked by the provider's
 * own schema, and a per-model row is the wrong shape to hold them — so they
 * stay exactly where they are and surface as refusals, never as drops.
 */
export const TRANSCRIPT_EXTRAS = {
  // Formatting
  punctuate: EXTRA as boolean,
  format_text: EXTRA as boolean,
  disfluencies: EXTRA as boolean,
  multichannel: EXTRA as boolean,
  // Which audio, and which words
  audio_start_from: EXTRA as number,
  audio_end_at: EXTRA as number,
  word_boost: EXTRA as string[],
  boost_param: EXTRA as string,
  keyterms_prompt: EXTRA as string[] | null,
  custom_spelling: EXTRA as Array<{ from: string[]; to: string }> | null,
  speech_threshold: EXTRA as number,
  domain: EXTRA as AssemblyaiDomain | null,
  // Language detection — the half of the language decision `language` does not own
  language_detection: EXTRA as boolean,
  language_confidence_threshold: EXTRA as number,
  language_detection_options: EXTRA as AssemblyaiLanguageDetectionOptions | null,
  // → speaker_options.*, beside the counts compiled from `diarization`
  advanced_speaker_segmentation: EXTRA as boolean | null,
  // Redaction and safety
  filter_profanity: EXTRA as boolean,
  redact_pii: EXTRA as boolean,
  redact_pii_audio: EXTRA as boolean,
  redact_pii_audio_quality: EXTRA as "mp3" | "wav" | null,
  redact_pii_audio_options: EXTRA as {
    return_redacted_no_speech_audio?: boolean | null;
    override_audio_redaction_method?: "silence" | null;
  } | null,
  redact_pii_policies: EXTRA as string[] | null,
  redact_pii_sub: EXTRA as "entity_name" | "hash" | null,
  redact_pii_return_unredacted: EXTRA as boolean,
  redact_static_entities: EXTRA as Record<string, string[]> | null,
  content_safety: EXTRA as boolean,
  content_safety_confidence: EXTRA as number,
  // Post-transcription understanding
  entity_detection: EXTRA as boolean,
  sentiment_analysis: EXTRA as boolean,
  iab_categories: EXTRA as boolean,
  auto_highlights: EXTRA as boolean,
  speech_understanding: EXTRA as Record<string, unknown> | null,
} as const;

export const TIMESTAMPS = ["word"] as const;

export const SHARED_ROW = { timestamps: TIMESTAMPS, extras: TRANSCRIPT_EXTRAS } as const;

export const ASSEMBLYAI_STT_MODEL_PARAMS = {
  "universal-3-5-pro": {
    timestamps: TIMESTAMPS,
    extras: {
      ...TRANSCRIPT_EXTRAS,
      temperature: EXTRA as number,
      remove_audio_tags: EXTRA as "all" | "speaker" | null,
    },
  },
  "universal-2": {
    timestamps: TIMESTAMPS,
    extras: {
      ...TRANSCRIPT_EXTRAS,
      summarization: EXTRA as boolean,
      summary_model: EXTRA as "informative" | "catchy" | "conversational" | null,
      summary_type: EXTRA as "gist" | "headline" | "paragraph" | "bullets" | "bullets_verbose" | null,
      auto_chapters: EXTRA as boolean,
    },
  },
  "universal-3-pro": SHARED_ROW,
  "slam-1": SHARED_ROW,
} as const satisfies SttModelParamTable;
