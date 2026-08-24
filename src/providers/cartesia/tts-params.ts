/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/cartesia/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsDeliverySpec, TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type { CartesiaEmotion } from "./tts";
import { CARTESIA_TTS_LANGUAGES } from "./models";

/** The sonic ids the `model_id` enum publishes — the ref union for `cartesia/…`. */
export const MODELS = ["sonic-3.5", "sonic-3", "sonic-preview", "sonic-latest"] as const;

export const TTS_BYTES_DOCS = "https://docs.cartesia.ai/api-reference/tts/bytes";

export const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000] as const;

export const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "mp3",
    pcm_s16le: "pcm_s16le",
    pcm_f32le: "pcm_f32le",
    pcm_mulaw: "pcm_mulaw",
    pcm_alaw: "pcm_alaw",
  },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav", "raw"],
    pcm_f32le: ["wav", "raw"],
    pcm_mulaw: ["wav", "raw"],
    pcm_alaw: ["wav", "raw"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_f32le: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
    pcm_alaw: SAMPLE_RATES,
  },
  bitrates: { mp3: [32000, 64000, 96000, 128000, 192000] },
  // Only the mp3 arm has a `bit_rate` field at all.
  unavailable: {
    pcm_s16le: ["bitrate"],
    pcm_f32le: ["bitrate"],
    pcm_mulaw: ["bitrate"],
    pcm_alaw: ["bitrate"],
  },
  defaults: { bitrate: 128000 },
  source: TTS_BYTES_DOCS,
};

/**
 * Cartesia's per-model speech surface — one row, four times, and the languages
 * are the provider's own array rather than a copy of it.
 *
 * All four served ids sit on one `/tts/bytes` schema with one `encoding` enum
 * and one 42-code `language` enum, and the only per-model rule in
 * `ttsConstraints` denies `pronunciation_dict_id` on `sonic-2` and
 * `sonic-turbo` — neither of which this adapter serves. So the row is shared,
 * and `languages` is {@link CARTESIA_TTS_LANGUAGES} by reference: the list an
 * editor offers and the list `checkEnums` refuses against are then the same
 * array, and cannot drift.
 *
 * `generation_config`'s two non-canonical members ride in through
 * {@link GENERATION_CONFIG_NESTING}, beside the `speed` the adapter compiles
 * into the same object. `emotion`'s type is the provider's own 58-label union,
 * so an editor completes them and a typo is caught before the request is built.
 */
export const CARTESIA_TTS_EXTRAS = {
  // → generation_config.*
  volume: EXTRA as number,
  emotion: EXTRA as CartesiaEmotion,
  // → body root
  pronunciation_dict_id: EXTRA as string,
} as const;

export const ROW = {
  codecs: ["mp3", "pcm_s16le", "pcm_f32le", "pcm_mulaw", "pcm_alaw"],
  languages: CARTESIA_TTS_LANGUAGES,
  extras: CARTESIA_TTS_EXTRAS,
} as const;

export const CARTESIA_TTS_MODEL_PARAMS = {
  "sonic-3.5": ROW,
  "sonic-3": ROW,
  "sonic-preview": ROW,
  "sonic-latest": ROW,
} as const satisfies TtsModelParamTable;

/**
 * Raw audio bytes — POST /tts/bytes is named after its answer: "The response is
 * raw audio bytes, so there is no response checker for this endpoint"
 * (./tts.ts). The SSE and WebSocket variants are separate routes and unmodel
 * does not validate them, so nothing here flips.
 */
export const CARTESIA_TTS_DELIVERY = { kind: "bytes" } as const satisfies TtsDeliverySpec;
