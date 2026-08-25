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

/** The one published model id — the ref union for `breezeblue/…`. */
export const MODELS = ["breeze-tts-2"] as const;

export const TTS_DOCS =
  "https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech";

const OUTPUT_FORMAT_DOCS = "https://docs.breezeblue.ai/concepts/output-format";

/**
 * The capability behind the `output_format` QUERY param, from the same list
 * the provider validator checks against: "mp3, wav, flac, pcm, aac, opus"
 * (default mp3).
 *
 * The wire value is a BARE codec name — the HTTP API has no sample-rate or
 * bitrate field at all (only the realtime WebSocket pins a rate, 24 kHz, and
 * it takes no `output_format`) — so both numeric halves are `unavailable`
 * endpoint-wide: asking for 48 kHz is an error, never a silent drop. `wav`
 * and `pcm` are the same samples with and without a RIFF header, so
 * `pcm_s16le` maps to both containers and the adapter picks the wire word
 * from the container.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", flac: "flac", pcm_s16le: "pcm", aac: "aac", opus: "opus" },
  containers: {
    mp3: ["mp3"],
    flac: ["flac"],
    pcm_s16le: ["wav", "raw"],
  },
  unavailable: ["sampleRate", "bitrate"],
  source: OUTPUT_FORMAT_DOCS,
};

export const CODECS = ["mp3", "flac", "pcm_s16le", "aac", "opus"] as const;

/**
 * The two body fields with no canonical word:
 *
 * - `instructions` — free-text performance direction ("Say it softly and
 *   emotionally, …"). Documented language rule: write them in Chinese for
 *   Chinese TTS and in English for every other language; the API never
 *   translates them.
 * - `guidance_scale` — how strongly generation follows the instructions and
 *   the reference voice, 1.0–10.0 (default 1.0). It lands nested under
 *   `voice_settings` via {@link VOICE_SETTINGS_NESTING} in the adapter.
 *
 * Excluded on purpose: `output_format` and `language_code` are canonical
 * words' wire spellings, `voice_id` is the canonical voice, and `delivery`
 * is transport (sync bytes vs async job) — it stays on
 * `providerOptions.breezeblue`.
 *
 * **No `languages` row.** The TTS `language_code` contract is only "two
 * ASCII letters" plus a runtime rule (the model must list the code in its
 * `supported_languages` — GET /v1/models); the 23-code list on
 * https://docs.breezeblue.ai/concepts/multilingual is the VOICE-metadata
 * contract, not this model's synthesis enum, so completing it here would be a
 * list with no authority behind it. (It is published for pickers as
 * `VOICE_LANGUAGE_CODES` on `unmodel/breezeblue/values`.)
 */
export const TTS_EXTRAS = {
  instructions: EXTRA as string | null,
  // → voice_settings.guidance_scale
  guidance_scale: EXTRA as number | null,
} as const;

export const BREEZEBLUE_TTS_MODEL_PARAMS = {
  "breeze-tts-2": { codecs: CODECS, extras: TTS_EXTRAS },
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
