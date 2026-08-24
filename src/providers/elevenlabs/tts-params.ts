/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/elevenlabs/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsDeliverySpec, TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type { ElevenlabsPronunciationDictionaryLocator } from "./tts";

/** The six text-to-speech model ids — the ref union for `elevenlabs/…`. */
export const MODELS = [
  "eleven_v3",
  "eleven_multilingual_v2",
  "eleven_flash_v2_5",
  "eleven_flash_v2",
  "eleven_turbo_v2_5",
  "eleven_turbo_v2",
] as const;

export const TTS_DOCS = "https://elevenlabs.io/docs/api-reference/text-to-speech/convert";

/**
 * The capability behind `output_format`, enumerated from the same
 * `TTS_OUTPUT_FORMATS` list the provider validator checks against.
 *
 * `ulaw`/`alaw` are bare telephony streams with no WAV header, so their only
 * container is `"raw"` — asking for μ-law substitutes the container the
 * canonical default assumes and says so.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", opus: "opus", pcm_s16le: "pcm", pcm_mulaw: "ulaw", pcm_alaw: "alaw" },
  containers: {
    mp3: ["mp3"],
    opus: ["ogg"],
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["raw"],
    pcm_alaw: ["raw"],
  },
  sampleRates: {
    mp3: [22050, 24000, 44100],
    opus: [48000],
    pcm_s16le: [8000, 16000, 22050, 24000, 32000, 44100, 48000],
    pcm_mulaw: [8000],
    pcm_alaw: [8000],
  },
  bitrates: {
    mp3: [32000, 48000, 64000, 96000, 128000, 192000],
    opus: [32000, 64000, 96000, 128000, 192000],
  },
  // PCM, μ-law and A-law are uncompressed: the composite has no bitrate slot.
  unavailable: { pcm_s16le: ["bitrate"], pcm_mulaw: ["bitrate"], pcm_alaw: ["bitrate"] },
  defaults: { sampleRate: 44100, bitrate: 128000 },
  defaultsByCodec: {
    opus: { sampleRate: 48000 },
    pcm_mulaw: { sampleRate: 8000 },
    pcm_alaw: { sampleRate: 8000 },
  },
  source: TTS_DOCS,
};

/**
 * ElevenLabs' per-model speech surface — one row, six times.
 *
 * The six model ids share one endpoint, one schema and one `output_format`
 * enum, and `constraints.ts` carries exactly one per-model rule
 * (`language_code` is a documented no-op on `eleven_multilingual_v2`) which is
 * a *warning* about a param the API accepts. So there is nothing here that
 * differs by model, and saying so with one shared row is the honest shape —
 * six divergent-looking literals would imply a distinction the wire does not
 * make.
 *
 * `codecs` is `FORMAT.codecs`' key set, which is the composite enum's codec
 * half: `aac`, `flac` and the wider PCM widths are absent from
 * `TTS_OUTPUT_FORMATS` and are therefore compile errors rather than requests
 * that 422.
 *
 * **No `languages`.** `language_code` is documented as "ISO 639-1" with no
 * published enum — models that do not serve a code ignore it silently — so
 * there is no list to complete, and inventing one would be a completion list
 * with no authority behind it.
 *
 * ## Extras, and the one that nests
 *
 * `voice_settings` is a per-request override of the voice's stored settings,
 * and the adapter already writes `voice_settings.speed` there from the
 * canonical `speed`. Its four other members ride in as extras through
 * {@link VOICE_SETTINGS_NESTING}, so a caller writes `stability: 0.3` beside
 * `speed: 1.1` and both land in the same object — `applyExtras` merges into it
 * rather than replacing it, which is exactly why that merge exists.
 *
 * `pronunciation_dictionary_locators` is on the list even though the research
 * pass did not surface it: it is a documented, typed, generation-affecting body
 * field on every one of the six, and its two sibling providers (Cartesia's
 * `pronunciation_dict_id`, smallest.ai's `pronunciation_dicts`) expose theirs.
 *
 * Excluded on purpose: `output_format` and `voice_id` are canonical words'
 * wire spellings, and the streaming-only knobs (`optimize_streaming_latency`,
 * `enable_logging`) are transport and stay on `providerOptions.elevenlabs`.
 */
export const TTS_EXTRAS = {
  // → voice_settings.*
  stability: EXTRA as number | null,
  similarity_boost: EXTRA as number | null,
  style: EXTRA as number | null,
  use_speaker_boost: EXTRA as boolean | null,
  // → body root
  pronunciation_dictionary_locators: EXTRA as ElevenlabsPronunciationDictionaryLocator[] | null,
  seed: EXTRA as number | null,
  previous_text: EXTRA as string | null,
  next_text: EXTRA as string | null,
  previous_request_ids: EXTRA as string[] | null,
  next_request_ids: EXTRA as string[] | null,
  apply_text_normalization: EXTRA as "auto" | "on" | "off",
  apply_language_text_normalization: EXTRA as boolean,
  use_pvc_as_ivc: EXTRA as boolean,
} as const;

export const ROW = {
  codecs: ["mp3", "opus", "pcm_s16le", "pcm_mulaw", "pcm_alaw"],
  extras: TTS_EXTRAS,
} as const;

export const ELEVENLABS_TTS_MODEL_PARAMS = {
  eleven_v3: ROW,
  eleven_multilingual_v2: ROW,
  eleven_flash_v2_5: ROW,
  eleven_flash_v2: ROW,
  eleven_turbo_v2_5: ROW,
  eleven_turbo_v2: ROW,
} as const satisfies TtsModelParamTable;

/**
 * Raw audio bytes: "The endpoint responds with raw audio bytes, not JSON, so
 * there is no response checker for TTS" (./tts.ts). `output_format` picks the
 * encoding of those bytes, never where they land.
 */
export const ELEVENLABS_TTS_DELIVERY = { kind: "bytes" } as const satisfies TtsDeliverySpec;
