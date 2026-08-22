/**
 * The music adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/elevenlabs/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { MusicModelParamTable } from "../../core/unified/vocabulary/music";

/** The two music models — the ref union for `elevenlabs/…`. */
export const MODELS = ["music_v2", "music_v1"] as const;

export const MUSIC_DOCS = "https://elevenlabs.io/docs/api-reference/music/compose";

/**
 * The composite behind `output_format`, enumerated from the same
 * `MUSIC_OUTPUT_FORMATS` list the provider validator checks against.
 *
 * PCM, μ-law and A-law are uncompressed, so the composite has no bitrate slot
 * for them; μ-law and A-law are bare telephony streams at 8 kHz with no
 * container of their own, which is what `"raw"` says.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", opus: "opus", pcm_s16le: "pcm", pcm_mulaw: "ulaw", pcm_alaw: "alaw" },
  containers: {
    mp3: ["mp3"],
    opus: ["ogg"],
    pcm_s16le: ["raw"],
    pcm_mulaw: ["raw"],
    pcm_alaw: ["raw"],
  },
  sampleRates: {
    mp3: [22050, 24000, 44100, 48000],
    opus: [48000],
    pcm_s16le: [8000, 16000, 22050, 24000, 32000, 44100, 48000],
    pcm_mulaw: [8000],
    pcm_alaw: [8000],
  },
  bitrates: {
    mp3: [32000, 48000, 64000, 96000, 128000, 192000, 240000, 320000],
    opus: [32000, 64000, 96000, 128000, 192000],
  },
  unavailable: { pcm_s16le: ["bitrate"], pcm_mulaw: ["bitrate"], pcm_alaw: ["bitrate"] },
  defaults: { sampleRate: 44100, bitrate: 128000 },
  defaultsByCodec: {
    opus: { sampleRate: 48000 },
    pcm_mulaw: { sampleRate: 8000 },
    pcm_alaw: { sampleRate: 8000 },
  },
  source: MUSIC_DOCS,
};

/**
 * The two music ids, which are wire-identical, and one shared row says so.
 *
 * `POST /v1/music` has no per-model constraint table at all: both ids go
 * through one validator, one `MUSIC_OUTPUT_FORMATS` enum and one schema. What
 * differs between them is the *shape* of `composition_plan` (`sections` on v1,
 * `chunks` on v2) and the `"auto"` output-format default — neither of which is
 * a value-space difference a row can carry, and `composition_plan` is excluded
 * for the first of those reasons: one key whose type depends on the model id is
 * a discriminated union the extras mechanism has no way to express, and it is
 * an alternative to `prompt` rather than an addition to it.
 *
 * `codecs` is `FORMAT.codecs`' key set. `aac`, `flac` and `pcm_f32le` have no
 * composite spelling here and are compile errors rather than 422s.
 *
 * The five extras are the body's own generation knobs: a fine-tune and its
 * strength, phonetic name handling, C2PA signing, and whether the result is
 * retained so it can be inpainted later. `music_length_ms`,
 * `force_instrumental`, `output_format` and `seed` are canonical words' wire
 * spellings and are therefore not extras.
 */
export const MUSIC_EXTRAS = {
  finetune_id: EXTRA as string | null,
  finetune_strength: EXTRA as number,
  use_phonetic_names: EXTRA as boolean,
  sign_with_c2pa: EXTRA as boolean,
  store_for_inpainting: EXTRA as boolean,
} as const;

export const ROW = {
  codecs: ["mp3", "opus", "pcm_s16le", "pcm_mulaw", "pcm_alaw"],
  extras: MUSIC_EXTRAS,
} as const;

export const ELEVENLABS_MUSIC_MODEL_PARAMS = {
  music_v2: ROW,
  music_v1: ROW,
} as const satisfies MusicModelParamTable;
