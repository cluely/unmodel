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
import { CARTESIA_TTS_3_6_LANGUAGES, CARTESIA_TTS_LANGUAGES } from "./models";

/**
 * The ref union for `cartesia/…`: the four ids the 2026-03-01 `model_id` enum
 * publishes, plus `sonic-3.6` — GA since 2026-08-27 and off that enum, so it
 * validates with the off-enum warning (see ./models).
 */
export const MODELS = ["sonic-3.6", "sonic-3.5", "sonic-3", "sonic-preview", "sonic-latest"] as const;

export const TTS_BYTES_DOCS = "https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes";

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
 * Cartesia's per-model speech surface — two rows, and the languages are the
 * provider's own arrays rather than copies of them.
 *
 * All five served ids sit on one `/tts/bytes` schema with one `encoding` enum,
 * and `ttsConstraints` denies nothing on any of them. What differs is the
 * language list ("Supported languages
 * are model-specific."): `sonic-3.6` speaks the 44 codes of
 * {@link CARTESIA_TTS_3_6_LANGUAGES}, and so do the two aliases whose backing
 * model no page names (`sonic-preview` points at the Sonic 3.6 page; on
 * `sonic-latest` `checkEnums` warns, never refuses, past the 42 — see
 * CARTESIA_TTS_ALIAS_LANGUAGES in ./models); sonic-3.5 and sonic-3 speak the 42
 * of {@link CARTESIA_TTS_LANGUAGES}. Each row holds its array by reference, so
 * the list an editor offers and the list `checkEnums` checks against are the
 * same array, and cannot drift. (Sonic 3.6's regional locales are not a row
 * value: the unified `language` is open, and the adapter sends a listed
 * regional tag as `locale` on the Sonic 3.6 ids.)
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

/** {@link ROW} with Sonic 3.6's 44 languages — the one field that differs. */
export const ROW_3_6 = { ...ROW, languages: CARTESIA_TTS_3_6_LANGUAGES } as const;

export const CARTESIA_TTS_MODEL_PARAMS = {
  "sonic-3.6": ROW_3_6,
  "sonic-3.5": ROW,
  "sonic-3": ROW,
  "sonic-preview": ROW_3_6,
  "sonic-latest": ROW_3_6,
} as const satisfies TtsModelParamTable;

/**
 * Raw audio bytes — POST /tts/bytes is named after its answer: "The response is
 * raw audio bytes, so there is no response checker for this endpoint"
 * (./tts.ts). The SSE and WebSocket variants are separate routes (SSE is not
 * validated; the WebSocket generation message is ./tts-websocket's), so nothing
 * here flips.
 */
export const CARTESIA_TTS_DELIVERY = { kind: "bytes" } as const satisfies TtsDeliverySpec;
