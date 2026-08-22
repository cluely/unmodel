/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/openai/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import type { TranscriptionChunkingStrategy } from "./stt";

/** Every transcription model the hand catalog carries — the `openai/…` refs. */
export const MODELS = [
  "gpt-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "gpt-4o-mini-transcribe-2025-12-15",
  "gpt-4o-transcribe-diarize",
  "whisper-1",
] as const;

/**
 * OpenAI's per-model transcription surface — the category's sharpest
 * `timestamps` split, and four crossing extras tables.
 *
 * ## `timestamps`
 *
 * "The `timestamp_granularities[]` parameter is only supported for
 * `whisper-1`", and `transcriptionConstraints` denies it on all five other ids.
 * So `whisper-1` completes `word` and `segment` and every other model completes
 * `"none"` and nothing else — which is the deny rule moved to the call site,
 * where the fix (change the ref) is still cheap.
 *
 * `"none"` is on every row because it is genuinely expressible here: these
 * routes return no timings unless asked, so asking for none is what omitting
 * the field already does and the value is honest rather than a no-op.
 *
 * ## Extras, one row at a time
 *
 * `temperature` and `chunking_strategy` are on all six — the sampling
 * temperature and the server-VAD segmentation config, neither of which the
 * canonical vocabulary has a word for. The rest is the deny table read
 * backwards: `keywords` is "supported by `gpt-transcribe`"; `include:
 * ["logprobs"]` is the three `gpt-4o(-mini)-transcribe` ids'; and the two
 * `known_speaker_*` arrays belong to `gpt-4o-transcribe-diarize`, which is also
 * the only model that can use them (speaker labels are what it produces).
 *
 * **`response_format` is deliberately not an extra**, though the wire has one
 * and it differs per model. It is the single wire key this adapter writes
 * *itself*, from a canonical word: `timestamps` on `whisper-1` compiles to
 * `response_format: "verbose_json"`, because the granularity array is only
 * legal alongside it. An extra of the same name would be copied on after that
 * and would silently defeat the canonical param — the one failure this
 * mechanism must not make possible. It stays on `providerOptions.openai`, which
 * is merged later still and is *documented* to win.
 */
export const SHARED_EXTRAS = {
  temperature: EXTRA as number,
  chunking_strategy: EXTRA as TranscriptionChunkingStrategy,
} as const;

/** The three ids whose `include` accepts `["logprobs"]`. */
export const LOGPROBS_ROW = {
  timestamps: ["none"],
  extras: { ...SHARED_EXTRAS, include: EXTRA as Array<"logprobs"> },
} as const;

export const OPENAI_STT_MODEL_PARAMS = {
  "gpt-transcribe": {
    timestamps: ["none"],
    extras: { ...SHARED_EXTRAS, keywords: EXTRA as string[] },
  },
  "gpt-4o-transcribe": LOGPROBS_ROW,
  "gpt-4o-mini-transcribe": LOGPROBS_ROW,
  "gpt-4o-mini-transcribe-2025-12-15": LOGPROBS_ROW,
  "gpt-4o-transcribe-diarize": {
    timestamps: ["none"],
    extras: {
      ...SHARED_EXTRAS,
      known_speaker_names: EXTRA as string[],
      known_speaker_references: EXTRA as string[],
    },
  },
  "whisper-1": { timestamps: ["none", "word", "segment"], extras: SHARED_EXTRAS },
} as const satisfies SttModelParamTable;
