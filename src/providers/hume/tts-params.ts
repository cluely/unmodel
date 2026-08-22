/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/hume/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type { HumeTimestampType } from "./tts";

/** The two Octave rows the catalog carries — the ref union for `hume/…`. */
export const MODELS = ["octave", "octave-2"] as const;

export const SYNTHESIZE_DOCS = "https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json";

export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", pcm_s16le: "pcm" },
  containers: { mp3: ["mp3"], pcm_s16le: ["wav", "raw"] },
  unavailable: ["sampleRate", "bitrate"],
  source: SYNTHESIZE_DOCS,
};

/**
 * Hume's per-model surface, and the one place it splits.
 *
 * Both rows carry the same two codecs (`format.type` is `mp3` / `wav` / `pcm`
 * and nothing else) and the same three body-root knobs. What differs is
 * `include_timestamp_types`: "Only supported for Octave 2 requests", and on
 * `version: "1"` the API **accepts it and returns empty timestamp arrays**.
 * That is the accepted-and-ignored case the loss contract likes least — worse
 * than a refusal, because nothing in the response says the request lost
 * anything — so the key is declared on `octave-2` alone and an editor refuses
 * it on `octave` by name. The provider's own `checkTimestampTypes` still warns
 * for the callers no type reaches.
 *
 * ## The two extras that reach into `utterances[0]`
 *
 * Hume is the provider with no `text` field: `text`, `voice` and `speed`
 * compile into an utterance, and `description` (acting direction) and
 * `trailing_silence` are that utterance's siblings. {@link UTTERANCE_NESTING}
 * places them there, which is what the array-walking half of `applyExtras`'s
 * `place` exists for — the alternative was leaving the single most useful knob
 * on this endpoint reachable only through `providerOptions`.
 *
 * Deliberately absent:
 *
 * - **`utterances[].voice.provider`** (`"HUME_AI" | "CUSTOM_VOICE"`) — the only
 *   spelling a top-level extra could have is `provider`, which is the word this
 *   whole library uses for the other half of a model ref. A key that reads as
 *   `"hume"` and means `"CUSTOM_VOICE"` is worth more confusion than it saves;
 *   it stays on `providerOptions.hume`.
 * - **`num_generations`** — it asks for several takes of the same text, which
 *   is what the canonical `n` would mean if this category had one. Spelling it
 *   as a provider extra would put a word in front of callers that the
 *   vocabulary intends to standardise.
 * - **`context`, `instant_mode`** — the first is a prior-generation reference
 *   with its own request shape, the second is streaming-only transport.
 */
export const OCTAVE_EXTRAS = {
  // → utterances[0].*
  description: EXTRA as string | null,
  trailing_silence: EXTRA as number,
  // → body root
  temperature: EXTRA as number | null,
  split_utterances: EXTRA as boolean,
  strip_headers: EXTRA as boolean,
} as const;

export const HUME_TTS_MODEL_PARAMS = {
  octave: { codecs: ["mp3", "pcm_s16le"], extras: OCTAVE_EXTRAS },
  "octave-2": {
    codecs: ["mp3", "pcm_s16le"],
    extras: { ...OCTAVE_EXTRAS, include_timestamp_types: EXTRA as HumeTimestampType[] },
  },
} as const satisfies TtsModelParamTable;
