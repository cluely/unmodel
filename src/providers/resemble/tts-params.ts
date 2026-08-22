/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/resemble/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { TtsModelParamTable } from "../../core/unified/vocabulary/tts";

/** The one TTS row the catalog carries — the ref union for `resemble/…`. */
export const MODELS = ["resemble-ultra"] as const;

export const SYNC_DOCS = "https://docs.resemble.ai/voice-generation/text-to-speech/synchronous";

export const SAMPLE_RATES = [8000, 16000, 22050, 32000, 44100, 48000] as const;

export const FORMAT: AudioFormatSpec = {
  codecs: {
    mp3: "mp3",
    pcm_s16le: "wav",
    pcm_s24le: "wav",
    pcm_s32le: "wav",
    pcm_mulaw: "wav",
  },
  containers: {
    mp3: ["mp3"],
    pcm_s16le: ["wav"],
    pcm_s24le: ["wav"],
    pcm_s32le: ["wav"],
    pcm_mulaw: ["wav"],
  },
  sampleRates: {
    mp3: SAMPLE_RATES,
    pcm_s16le: SAMPLE_RATES,
    pcm_s24le: SAMPLE_RATES,
    pcm_s32le: SAMPLE_RATES,
    pcm_mulaw: SAMPLE_RATES,
  },
  unavailable: ["bitrate"],
  source: SYNC_DOCS,
};

/**
 * Resemble's one catalog row, and the one thing worth saying about its codecs.
 *
 * `output_format` is only `wav` or `mp3`; the PCM *width* is a separate field
 * (`precision`), which is why this row lists four PCM codecs against an
 * endpoint whose format enum has two members. `pcm_s24le` and `pcm_s32le` are
 * genuinely reachable here and nowhere else in the category, and the canonical
 * spelling is what makes that visible — Resemble's own `PCM_24` says nothing
 * about byte order, and the caller's request is the same one everywhere else.
 *
 * The extras are the four body fields with no canonical word: `use_hd` picks
 * the higher-quality synthesis path, `apply_custom_pronunciations` applies the
 * account's dictionary, and `title` / `project_uuid` file the clip. There is no
 * `languages` row and no `speed` — both are properties of the voice here, which
 * the adapter declares as gaps.
 */
export const RESEMBLE_TTS_MODEL_PARAMS = {
  "resemble-ultra": {
    codecs: ["mp3", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_mulaw"],
    extras: {
      use_hd: EXTRA as boolean,
      apply_custom_pronunciations: EXTRA as boolean,
      title: EXTRA as string,
      project_uuid: EXTRA as string,
    },
  },
} as const satisfies TtsModelParamTable;
