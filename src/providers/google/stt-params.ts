/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/google/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import { GEMINI_STT_MODEL_IDS } from "./audio-constraints";
import type { GoogleSttGenerationConfigBase } from "./stt";
import type { GoogleContent, GoogleThinkingConfig } from "./wire";

/** The thirteen curated transcription ids — the `google/…` ref union. */
export const MODELS = GEMINI_STT_MODEL_IDS;

/**
 * `"word"` and `"none"`, and nothing else.
 *
 * `wordTimestamp` is a bare boolean: there is no segment grouping and no
 * character alignment anywhere in `AudioTranscriptionConfig`, so `"segment"`
 * and `"character"` are an `invalid_enum_value` naming the two this route
 * reports. `"none"` is genuinely expressible — omitting the field returns a
 * plain transcript — which is why it is on the list rather than refused.
 */
export const TIMESTAMPS = ["word", "none"] as const;

/**
 * What a transcription request can carry that the vocabulary has no word for.
 *
 * One object rather than thirteen literals, and the table below is built from
 * it, because the thirteen curated ids have **identical** capability flags in
 * the generated catalog — `temperature`, `reasoning` and `structuredOutput` are
 * all true on every one, and their output limits agree. Thirteen copies would
 * imply a distinction the catalog does not make; the drift test in
 * `stt.test.ts` is what keeps the curated list itself honest.
 *
 * `customVocabulary` nests one level deeper than the rest — it is an ASR knob,
 * not a generation one — and `systemInstruction` one level shallower, at the
 * body root. {@link EXTRA_NESTING} carries both exceptions.
 */
export const STT_EXTRAS = {
  /** "Phrases that bias the ASR model toward specific terms (names, jargon)." */
  customVocabulary: EXTRA as readonly string[],
  temperature: EXTRA as number,
  maxOutputTokens: EXTRA as number,
  /** Trades audio-token count against fidelity. */
  mediaResolution: EXTRA as NonNullable<GoogleSttGenerationConfigBase["mediaResolution"]>,
  /** `"text/plain"` for a transcript, `"application/json"` with a schema for structure. */
  responseMimeType: EXTRA as NonNullable<GoogleSttGenerationConfigBase["responseMimeType"]>,
  /** An OpenAPI-subset schema, for a structured transcript. */
  responseSchema: EXTRA as Record<string, unknown>,
  thinkingConfig: EXTRA as GoogleThinkingConfig,
  /**
   * A system turn, which is a different slot from the canonical `prompt`: the
   * prompt is a user part beside the audio, this is the standing instruction
   * above it. Both exist on the wire, so both are reachable.
   */
  systemInstruction: EXTRA as GoogleContent,
} as const;

export const STT_ROW = { timestamps: TIMESTAMPS, extras: STT_EXTRAS } as const;

/**
 * The thirteen rows, built from one.
 *
 * The cast is a mapped type rather than `Record<GeminiSttModelId, typeof
 * STT_ROW>` for Deepgram's reason: only a mapped type over the id tuple keeps
 * each key a literal, and a lost literal is a silently dead narrowing with a
 * green build.
 */
export const GOOGLE_STT_MODEL_PARAMS = Object.fromEntries(
  MODELS.map((model) => [model, STT_ROW]),
) as {
  readonly [M in (typeof MODELS)[number]]: typeof STT_ROW;
} satisfies SttModelParamTable;
