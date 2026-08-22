/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/deepgram/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import { ttsModels } from "./models";

export const MEDIA_DOCS = "https://developers.deepgram.com/docs/tts-media-output-settings";

/**
 * Every Aura and Aura-2 voice, read off the hand catalog rather than copied:
 * on this endpoint the model list *is* the voice list (all 105 of them), so
 * the ref union, the `unknown_model` warning and the catalog cannot drift
 * apart. The cast is what keeps the *literal* ids — `Object.keys` widens to
 * `string[]`, which would collapse the ref union to `` `deepgram/${string}` ``
 * and take the autocomplete with it.
 */
export const MODELS = Object.keys(ttsModels) as readonly (keyof typeof ttsModels)[];

export const FORMAT: AudioFormatSpec = {
  codecs: {
    pcm_s16le: "linear16",
    pcm_mulaw: "mulaw",
    pcm_alaw: "alaw",
    mp3: "mp3",
    opus: "opus",
    flac: "flac",
    aac: "aac",
  },
  containers: {
    pcm_s16le: ["wav", "raw"],
    pcm_mulaw: ["wav", "raw"],
    pcm_alaw: ["wav", "raw"],
    opus: ["ogg"],
    mp3: ["mp3"],
    flac: ["flac"],
    aac: ["aac"],
  },
  sampleRates: {
    pcm_s16le: [8000, 16000, 24000, 32000, 48000],
    pcm_mulaw: [8000, 16000],
    pcm_alaw: [8000, 16000],
    flac: [8000, 16000, 22050, 32000, 48000],
  },
  bitrates: { mp3: [32000, 48000] },
  unavailable: {
    // "the codec fixes it" — mp3 is always 22050 Hz here.
    mp3: ["sampleRate"],
    opus: ["sampleRate"],
    aac: ["sampleRate"],
    // Uncompressed formats have no configurable bitrate.
    pcm_s16le: ["bitrate"],
    pcm_mulaw: ["bitrate"],
    pcm_alaw: ["bitrate"],
    flac: ["bitrate"],
  },
  source: MEDIA_DOCS,
};

/**
 * The per-model surface, which on this endpoint is *one* surface.
 *
 * `POST /v1/speak` takes the same seven encodings and the same two
 * non-canonical query params whichever of the 103 voices the ref names —
 * because here the model id selects a *voice*, and a voice does not change
 * which container the bytes come back in. So the row is built rather than
 * typed out: `Object.fromEntries` over the same `MODELS` array the ref union
 * comes from, so a voice added to the catalog gets a row automatically and the
 * two lists cannot fall out of step. (103 hand-written identical literals would
 * also imply, wrongly, that some of them differ.)
 *
 * The cast is what keeps the literal keys — `Object.fromEntries` widens to
 * `Record<string, …>`, which would make every row lookup miss and silently
 * degrade all 103 models to the wide vocabulary. `satisfies` then checks the
 * row itself, field by field.
 *
 * No `languages`: the language is baked into the voice, which is baked into the
 * model, and the adapter declares the gap outright.
 *
 * `mip_opt_out` (Model Improvement Program opt-out) and `tag` (billing labels
 * that come back on the usage record) are the two documented query params with
 * no canonical word. Neither changes the audio, which is why the *research*
 * pass and this table agree that they are the whole extras list here.
 */
export const AURA_ROW = {
  codecs: ["mp3", "opus", "aac", "flac", "pcm_s16le", "pcm_mulaw", "pcm_alaw"],
  extras: {
    mip_opt_out: EXTRA as boolean,
    tag: EXTRA as string | string[],
  },
} as const;

export const DEEPGRAM_TTS_MODEL_PARAMS = Object.fromEntries(
  MODELS.map((model) => [model, AURA_ROW]),
) as Readonly<Record<(typeof MODELS)[number], typeof AURA_ROW>> satisfies TtsModelParamTable;
