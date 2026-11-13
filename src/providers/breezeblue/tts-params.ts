/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/breezeblue/values` publishes these arrays for client-side pickers
 * and the adapter imports this provider's validator, its zod schema and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsDeliverySpec, TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import { VOICE_LANGUAGE_CODES } from "./models";

/**
 * The two published model ids — the ref union for `breezeblue/…`. The
 * compatibility alias `breeze-tts-2-preview` is catalogued (it validates at
 * `breezeblue.tts`) but not offered here: a ref names the formal id.
 */
export const MODELS = ["breeze-tts-2", "breeze-tts-2-multilingual"] as const;

export const TTS_DOCS =
  "https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech";

const OUTPUT_FORMAT_DOCS = "https://docs.breezeblue.ai/concepts/output-format";

/** "BreezeBlue generates native 24 kHz mono audio." — OUTPUT_FORMAT_DOCS. */
export const NATIVE_SAMPLE_RATE = 24000;

/**
 * The capability behind the `output_format` QUERY param, from the same
 * fourteen values the provider validator checks against: six bare encodings
 * and eight `codec_sample_rate[_bitrate]` profiles (OUTPUT_FORMAT_DOCS: "A
 * profile uses `codec_sample_rate_bitrate`, omitting the bitrate for WAV,
 * PCM, and FLAC").
 *
 * Every profile is at the native 24 kHz — "mp3_24000_64 MP3, 24 kHz, 64 kbps
 * … mp3_24000_160 MP3, 24 kHz, 160 kbps wav_24000 … pcm_24000 … flac_24000 …
 * aac_24000_128 AAC, 24 kHz, target bitrate 128 kbps" — so 24000 is the one
 * rate on offer, and asking for 48 kHz is an error, never a silent drop. The
 * bitrates are the profiles' own: four for MP3, one for AAC. Opus has no
 * profile at all ("opus Opus in Ogg, target bitrate 96 kbps by default"), so
 * neither half is settable there; FLAC and PCM have no bitrate slot.
 *
 * No `defaults`: a bare name is a legal value of its own (MP3 "128 kbps by
 * default", every encoding 24 kHz), so nothing has to be filled in. `wav` and
 * `pcm` are the same samples with and without a RIFF header, so `pcm_s16le`
 * maps to both containers and the adapter picks the wire word from the
 * container.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", flac: "flac", pcm_s16le: "pcm", aac: "aac", opus: "opus" },
  containers: {
    mp3: ["mp3"],
    flac: ["flac"],
    pcm_s16le: ["wav", "raw"],
  },
  sampleRates: {
    mp3: [NATIVE_SAMPLE_RATE],
    flac: [NATIVE_SAMPLE_RATE],
    pcm_s16le: [NATIVE_SAMPLE_RATE],
    aac: [NATIVE_SAMPLE_RATE],
  },
  bitrates: { mp3: [64000, 96000, 128000, 160000], aac: [128000] },
  unavailable: { opus: ["sampleRate", "bitrate"], flac: ["bitrate"], pcm_s16le: ["bitrate"] },
  source: OUTPUT_FORMAT_DOCS,
};

export const CODECS = ["mp3", "flac", "pcm_s16le", "aac", "opus"] as const;

/**
 * The four body fields with no canonical word:
 *
 * - `instructions` — free-text performance direction ("Say it softly and
 *   emotionally, …"). Documented language rule: "Write `instructions` in the
 *   same language as the input text and `language_code`"; the API never
 *   translates them.
 * - `guidance_scale` — how strongly generation follows the instructions and
 *   the reference voice, 1.0–10.0 (default 1.0).
 * - `volume` — "Request-only linear amplitude multiplier. Range: 0.01–2.0
 *   (1%–200%); default: 1.0."
 * - `use_speaker_boost` — "Improve similarity to the reference voice.
 *   Default: false."
 *
 * The last three land nested under `voice_settings` via
 * {@link VOICE_SETTINGS_NESTING} in the adapter, beside the canonical `speed`
 * it compiles into the same object. `volume` and `use_speaker_boost` are not
 * nullable on the wire, so their extras are not either.
 *
 * Excluded on purpose: `output_format` and `language_code` are canonical
 * words' wire spellings, `voice_id` is the canonical voice, `voice_settings.speed`
 * is the canonical `speed`, and `delivery` is transport (sync bytes vs async
 * job) — it stays on `providerOptions.breezeblue`.
 *
 * **`languages` on one row only.** The TTS `language_code` contract is only
 * "two ASCII letters" plus a runtime rule (the model must list the code in
 * its `supported_languages` — GET /v1/models). `breeze-tts-2-multilingual` is
 * the one model with a published list — it "supports all 51 codes accepted by
 * the Voice contract" (https://docs.breezeblue.ai/concepts/multilingual) — so
 * its row completes `language` from `VOICE_LANGUAGE_CODES` by reference, open
 * as every `languages` completion is. `breeze-tts-2` publishes no list, and
 * completing it would be a list with no authority behind it.
 */
export const TTS_EXTRAS = {
  // → body root
  instructions: EXTRA as string | null,
  // → voice_settings.*
  guidance_scale: EXTRA as number | null,
  volume: EXTRA as number,
  use_speaker_boost: EXTRA as boolean,
} as const;

export const BREEZEBLUE_TTS_MODEL_PARAMS = {
  "breeze-tts-2": { codecs: CODECS, extras: TTS_EXTRAS },
  "breeze-tts-2-multilingual": {
    codecs: CODECS,
    languages: VOICE_LANGUAGE_CODES,
    extras: TTS_EXTRAS,
  },
} as const satisfies TtsModelParamTable;

/**
 * What comes back is decided by the `delivery` QUERY param: `sync` (and
 * omitted — the documented default) answers 200 raw audio bytes whose
 * Content-Type matches `output_format`; `async` answers a 202 JSON job with
 * no audio in it — the bytes are a second request away.
 */
export const BREEZEBLUE_TTS_DELIVERY = {
  byRequestField: "delivery",
  variants: {
    sync: { kind: "bytes" },
    async:
      "a 202 `AsyncTtsJobResponse` job, not audio — poll GET /v1/generation-jobs/{generation_job_id} and download the bytes via GET /v1/generation-jobs/{generation_job_id}/audio",
  },
  default: { kind: "bytes" },
} as const satisfies TtsDeliverySpec;
