/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/inworld/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsDeliverySpec, TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type {
  InworldApplyTextNormalization,
  InworldDeliveryMode,
  InworldTimestampType,
} from "./tts";

/** The six TTS model ids — the ref union for `inworld/…`. */
export const MODELS = [
  "inworld-tts-2",
  "inworld-tts-2-flash",
  "inworld-tts-1.5-max",
  "inworld-tts-1.5-mini",
  "inworld-tts-1",
  "inworld-tts-1-max",
] as const;

export const SYNTHESIZE_DOCS =
  "https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech";

export const SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000] as const;

export const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "MP3",
    flac: "FLAC",
    opus: "OGG_OPUS",
    pcm_alaw: "ALAW",
    pcm_mulaw: "MULAW",
    pcm_s16le: "WAV",
  },
  containers: {
    mp3: ["mp3"],
    flac: ["flac"],
    opus: ["ogg"],
    pcm_alaw: ["raw"],
    pcm_mulaw: ["raw"],
    pcm_s16le: ["wav", "raw"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    flac: SAMPLE_RATES,
    opus: SAMPLE_RATES,
    pcm_alaw: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
  },
  // "Bits per second; compressed formats only" — there is no bitrate to set on
  // an uncompressed stream, and FLAC's is a property of the encoder.
  unavailable: { pcm_alaw: ["bitrate"], pcm_mulaw: ["bitrate"], pcm_s16le: ["bitrate"], flac: ["bitrate"] },
  source: SYNTHESIZE_DOCS,
};

/**
 * Inworld's per-model surface: one codec set, and a `ttsConstraints` table
 * read into three rows.
 *
 * `deliveryMode` is "Only supported by `inworld-tts-2`" — which in the deny
 * table means the two TTS-2 ids, since the 1.x generations are the ones it
 * denies — and `temperature` runs the other way: it is flagged `ignored` on
 * `inworld-tts-2`, where "the request is accepted but sampling is unaffected;
 * use `deliveryMode` to steer stability instead". So the flagship carries
 * `deliveryMode` and not `temperature`, the 1.x line carries `temperature` and
 * not `deliveryMode`, and `inworld-tts-2-flash` is the one id that carries
 * both. Two crossing per-model rules, stated once here and enforced again by
 * the provider for the callers a type cannot reach.
 *
 * No `languages`: `language` is BCP-47 with a region and passes through
 * unmapped, against no published enum.
 */
export const SHARED_EXTRAS = {
  applyTextNormalization: EXTRA as InworldApplyTextNormalization,
  enhanceGeneration: EXTRA as boolean,
  timestampType: EXTRA as InworldTimestampType,
} as const;

export const CODECS = ["mp3", "flac", "opus", "pcm_s16le", "pcm_mulaw", "pcm_alaw"] as const;

export const LEGACY_ROW = {
  codecs: CODECS,
  extras: { ...SHARED_EXTRAS, temperature: EXTRA as number },
} as const;

export const INWORLD_TTS_MODEL_PARAMS = {
  "inworld-tts-2": {
    codecs: CODECS,
    extras: { ...SHARED_EXTRAS, deliveryMode: EXTRA as InworldDeliveryMode },
  },
  "inworld-tts-2-flash": {
    codecs: CODECS,
    extras: {
      ...SHARED_EXTRAS,
      deliveryMode: EXTRA as InworldDeliveryMode,
      temperature: EXTRA as number,
    },
  },
  "inworld-tts-1.5-max": LEGACY_ROW,
  "inworld-tts-1.5-mini": LEGACY_ROW,
  "inworld-tts-1": LEGACY_ROW,
  "inworld-tts-1-max": LEGACY_ROW,
} as const satisfies TtsModelParamTable;

/**
 * JSON with base64 audio: "The response is JSON but carries no quality/usage
 * signals beyond `usage.processedCharactersCount`, so there is no response
 * checker" (./tts.ts) — the audio itself is the `audioContent` string.
 *
 * The streaming variant (/tts/v1/voice:stream) returns NDJSON and "unmodel
 * finalizes to the non-streaming URL only", so no request field flips this.
 */
export const INWORLD_TTS_DELIVERY = {
  kind: "base64",
  path: ["audioContent"],
} as const satisfies TtsDeliverySpec;
