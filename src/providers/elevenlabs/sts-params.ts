/**
 * The voice-conversion adapter's **data**: the model list, the per-model
 * narrowing table, and the format spec.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/elevenlabs/values` publishes these arrays for client-side pickers
 * and the adapter imports this provider's validator, its zod schema and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { StsModelParamTable } from "../../core/unified/vocabulary/sts";
import type { ElevenlabsVoiceSettings } from "./tts";
import type { ElevenlabsStsFileFormat } from "./sts";

/**
 * The three speech-to-speech ids — the ref union for `elevenlabs/…`.
 *
 * `eleven_english_sts_v1` is catalogued `status: "deprecated"` and is on the
 * list all the same: the docs/models page still publishes it, the endpoint
 * still accepts it, and a list that refused an id the API fulfils would be the
 * one failure this library must never have.
 */
export const MODELS = [
  "eleven_multilingual_sts_v2",
  "eleven_english_sts_v2",
  "eleven_english_sts_v1",
] as const;

export const STS_DOCS = "https://elevenlabs.io/docs/api-reference/speech-to-speech/convert";

/**
 * The composite behind the `output_format` QUERY param.
 *
 * Byte-identical to `tts-params.ts`'s spec, because the two endpoints publish
 * byte-identical 27-value enums (verified against `api.elevenlabs.io/openapi.json`
 * on 2026-08-31). It is declared here rather than imported from there for the
 * reason `sfx-params.ts` declares its own: a `*-params` leaf is what
 * `unmodel/elevenlabs/values` and the bundle budget both read, and pulling the
 * text-to-speech leaf into the voice-conversion pack would make every `sts`
 * consumer carry the TTS voice tables and delivery spec for a constant.
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
  unavailable: { pcm_s16le: ["bitrate"], pcm_mulaw: ["bitrate"], pcm_alaw: ["bitrate"] },
  defaults: { sampleRate: 44100, bitrate: 128000 },
  defaultsByCodec: {
    opus: { sampleRate: 48000 },
    pcm_mulaw: { sampleRate: 8000 },
    pcm_alaw: { sampleRate: 8000 },
  },
  source: STS_DOCS,
};

/**
 * Every knob on this wire that is not a canonical word, and every one of them
 * has exactly ONE witness across the category's two vendors — which is why
 * they are extras rather than vocabulary (`docs/decisions.md` §8).
 *
 * `voice_settings` is typed structured here and serialized to the wire's
 * JSON-string part by `stsToFormData`; `seed`'s 0–4294967295 bound and
 * `file_format`'s two-member enum live in the provider's own schema, so an
 * out-of-range value surfaces that message remapped onto the extra.
 *
 * `enable_logging` is on the list despite being a QUERY param: it is a real
 * knob (zero-retention mode), the adapter copies it onto the wire params
 * unchanged, and `elevenlabs.sts`'s own finalize is what moves it into the URL.
 */
export const STS_EXTRAS = {
  remove_background_noise: EXTRA as boolean,
  seed: EXTRA as number | null,
  voice_settings: EXTRA as ElevenlabsVoiceSettings | null,
  file_format: EXTRA as ElevenlabsStsFileFormat | null,
  enable_logging: EXTRA as boolean,
} as const;

/**
 * One row, shared by all three ids.
 *
 * The three models differ in what they can SPEAK — multilingual v2 covers 29
 * languages, the two English rows cover one — and not at all in what the
 * request may say: same body, same query enum, same knobs. A language list
 * would be the field that separates them, and this category has no `language`
 * word to hang one on (neither wire has a language field; the source recording
 * decides).
 *
 * `codecs` is `FORMAT.codecs`' key set. `aac`, `flac` and `pcm_f32le` have no
 * composite spelling here and are compile errors rather than 422s.
 */
export const ROW = {
  codecs: ["mp3", "opus", "pcm_s16le", "pcm_mulaw", "pcm_alaw"],
  extras: STS_EXTRAS,
} as const;

export const ELEVENLABS_STS_MODEL_PARAMS = {
  eleven_multilingual_sts_v2: ROW,
  eleven_english_sts_v2: ROW,
  eleven_english_sts_v1: ROW,
} as const satisfies StsModelParamTable;
