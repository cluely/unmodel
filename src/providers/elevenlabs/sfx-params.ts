/**
 * The sound-effects adapter's **data**: the model list, the per-model narrowing
 * table, and the format spec.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/elevenlabs/values` publishes these arrays for client-side pickers
 * and the adapter imports this provider's validator, its zod schema and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { SfxModelParamTable } from "../../core/unified/vocabulary/sfx";

/** The one sound-effects model — the ref union for `elevenlabs/…`. */
export const MODELS = ["eleven_text_to_sound_v2"] as const;

export const SFX_DOCS = "https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert";

/**
 * The composite behind `output_format`, enumerated from the same
 * `SOUND_EFFECTS_OUTPUT_FORMATS` list the provider validator checks against.
 *
 * Deliberately a separate constant from `music-params.ts`'s `FORMAT`, even
 * though the two look alike: `/v1/sound-generation` publishes no 48 kHz MP3
 * arm, so sharing the music spec would let `{ format: "mp3", sampleRate: 48000 }`
 * compile into `mp3_48000_128` — a value this endpoint rejects. Reuse here
 * would be a false positive on the one axis this library cannot afford one.
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
  source: SFX_DOCS,
};

/**
 * The two extras are the body's own generation knobs.
 *
 * `loop` is here rather than in the canonical vocabulary because it has exactly
 * ONE witness across five vendors — the two-witness rule, and the vocabulary's
 * own header spells out why Mirelo's `ambience` is not a second one. It is
 * still fully typed and fully reachable; it is just this vendor's word.
 *
 * `prompt_influence` is the same story with a different shape: nobody else
 * publishes a prompt-adherence dial at all.
 *
 * `text`, `duration_seconds`, `output_format` and `model_id` are canonical
 * words' wire spellings and are therefore not extras.
 */
export const SFX_EXTRAS = {
  loop: EXTRA as boolean,
  prompt_influence: EXTRA as number,
} as const;

/**
 * The one sound-effects id, and the whole duration story on one row.
 *
 * `durationRange` is `[0.5, 30]` — the widest ElevenLabs offers and, notably,
 * WIDER than the 22-second cap fal puts on the same model. `durationDefault` is
 * deliberately absent: omitting the length here does not select a number, it
 * selects a behaviour ("we will guess the optimal duration using the prompt"),
 * so there is nothing to warn a caller they got.
 *
 * `codecs` is `FORMAT.codecs`' key set. `aac`, `flac` and `pcm_f32le` have no
 * composite spelling here and are compile errors rather than 422s.
 */
export const ROW = {
  codecs: ["mp3", "opus", "pcm_s16le", "pcm_mulaw", "pcm_alaw"],
  durationRange: [0.5, 30],
  extras: SFX_EXTRAS,
} as const;

export const ELEVENLABS_SFX_MODEL_PARAMS = {
  eleven_text_to_sound_v2: ROW,
} as const satisfies SfxModelParamTable;
