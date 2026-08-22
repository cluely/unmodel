/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/fish-audio/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type { FishAudioLatency } from "./tts";

/** The four TTS model ids — the ref union for `fish-audio/…`. */
export const MODELS = ["s2.1-pro", "s2.1-pro-free", "s2-pro", "s1"] as const;

export const TTS_DOCS = "https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech";

export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", opus: "opus", pcm_s16le: "wav" },
  containers: { mp3: ["mp3"], opus: ["ogg"], pcm_s16le: ["wav", "raw"] },
  // `sample_rate` is an open positive integer on the wire ("defaults per
  // format"), so there is no list to check against here.
  bitrates: { mp3: [64000, 128000, 192000], opus: [24000, 32000, 48000, 64000] },
  unavailable: { pcm_s16le: ["bitrate"] },
  source: TTS_DOCS,
};

/**
 * Fish Audio's per-model surface: one codec set, and one row that is a member
 * short.
 *
 * `normalize_loudness` "applies to the S2 family (`s2-pro`, `s2.1-pro`,
 * `s2.1-pro-free`); on `s1` it is accepted but has no effect" — the
 * accepted-and-ignored case again, and the provider's own `checkProsody` warns
 * about it. Declaring it on the three S2 ids and not on `s1` moves that warning
 * to compile time, where a caller can still change their mind about the model.
 *
 * The rest is one shared block of sampling and chunking controls, which is what
 * this endpoint has instead of a canonical vocabulary: `temperature` / `top_p`
 * / `repetition_penalty` steer the model, `chunk_length` / `min_chunk_length` /
 * `max_new_tokens` / `early_stop_threshold` / `condition_on_previous_chunks`
 * steer the streaming decoder, and `latency` picks a quality-versus-delay
 * profile. `prosody.volume` nests beside the `speed` the adapter compiles;
 * everything else is a body-root field.
 *
 * `references` and `reference_audio` are excluded: they are inline voice
 * cloning payloads, and `voice` — the canonical word — is Fish's
 * `reference_id`, the *stored* form of the same thing.
 */
export const SHARED_TTS_EXTRAS = {
  // → prosody.*
  volume: EXTRA as number | null,
  // → body root
  temperature: EXTRA as number | null,
  top_p: EXTRA as number | null,
  repetition_penalty: EXTRA as number | null,
  normalize: EXTRA as boolean | null,
  latency: EXTRA as FishAudioLatency,
  chunk_length: EXTRA as number | null,
  min_chunk_length: EXTRA as number | null,
  max_new_tokens: EXTRA as number | null,
  condition_on_previous_chunks: EXTRA as boolean | null,
  early_stop_threshold: EXTRA as number | null,
  features: EXTRA as string[] | null,
} as const;

export const CODECS = ["mp3", "opus", "pcm_s16le"] as const;

export const S2_ROW = {
  codecs: CODECS,
  extras: { ...SHARED_TTS_EXTRAS, normalize_loudness: EXTRA as boolean | null },
} as const;

export const FISH_AUDIO_TTS_MODEL_PARAMS = {
  "s2.1-pro": S2_ROW,
  "s2.1-pro-free": S2_ROW,
  "s2-pro": S2_ROW,
  s1: { codecs: CODECS, extras: SHARED_TTS_EXTRAS },
} as const satisfies TtsModelParamTable;
