/**
 * The stt adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/inworld/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { SttModelParamTable } from "../../core/unified/vocabulary/stt";
import type {
  InworldGroqConfig,
  InworldSttAudioEncoding,
  InworldSttV1Config,
  InworldVoiceProfileConfig,
} from "./stt";

/**
 * The two ids POST /stt/v1/transcribe serves. The rest of Inworld's STT
 * catalog is the streaming router's, and its own `checkTranscribeConfig`
 * rejects those here — so they are not refs.
 */
export const MODELS = ["inworld/inworld-stt-1", "groq/whisper-large-v3"] as const;

/**
 * The per-model table.
 *
 * ## `timestamps`
 *
 * `inworld/inworld-stt-1` gets `["none"]`. "Word timestamps & diarization:
 * Available for AssemblyAI, Soniox, Deepgram; **not yet for Inworld**" — and
 * the field is "accepted but no per-word data comes back", which is the
 * accepted-and-ignored case, so `timestamps: "word"` is refused by name there.
 * Groq is named on neither side of that sentence, so `groq/whisper-large-v3`
 * keeps `["none", "word"]`, exactly as the provider's own check does.
 *
 * ## The vendor blocks
 *
 * `transcribeConfig` carries at most one provider block and it must match the
 * model's vendor — `inworldSttV1Config` for `inworld/…`, `groqConfig` for
 * `groq/…` — so each row declares its own and refuses the other by name.
 * `voiceProfileConfig` goes the same way: "Voice Profile … is only produced by
 * `inworld/inworld-stt-1`". All three are whole typed objects rather than
 * flattened members, because `voiceProfileConfig.enableVoiceProfile` is
 * *required* when the object is present and the two turn-taking blocks share
 * member names (`minEndOfTurnSilenceWhenConfident`, `vadThreshold`) with the
 * streaming surface's AssemblyAI block.
 *
 * Everything nests under `transcribeConfig` ({@link CONFIG_NESTING}), which is
 * where the whole request lives.
 */
export const SHARED_EXTRAS = {
  /** The adapter defaults it to `AUTO_DETECT`; this is how a caller pins it. */
  audioEncoding: EXTRA as InworldSttAudioEncoding,
  sampleRateHertz: EXTRA as number,
  numberOfChannels: EXTRA as number,
  inactivityTimeoutSeconds: EXTRA as number,
  endOfTurnConfidenceThreshold: EXTRA as number,
} as const;

export const INWORLD_STT_MODEL_PARAMS = {
  "inworld/inworld-stt-1": {
    timestamps: ["none"],
    extras: {
      ...SHARED_EXTRAS,
      voiceProfileConfig: EXTRA as InworldVoiceProfileConfig,
      inworldSttV1Config: EXTRA as InworldSttV1Config,
    },
  },
  "groq/whisper-large-v3": {
    timestamps: ["none", "word"],
    extras: { ...SHARED_EXTRAS, groqConfig: EXTRA as InworldGroqConfig },
  },
} as const satisfies SttModelParamTable;
