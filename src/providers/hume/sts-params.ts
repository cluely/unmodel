/**
 * The voice-conversion adapter's **data**: the model list, the per-model
 * narrowing table, and the format spec.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/hume/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA, type AudioFormatSpec } from "../../core/unified/derive";
import type { StsModelParamTable } from "../../core/unified/vocabulary/sts";
import type { HumeContext, HumeTimestampType } from "./tts";

/** The one synthetic id — the ref union for `hume/…` in this category. */
export const MODELS = ["voice-conversion"] as const;

export const VOICE_CONVERSION_DOCS =
  "https://dev.hume.ai/reference/text-to-speech-tts/convert-voice-file";

/**
 * `format` is an object carrying a container NAME and nothing else
 * (`{ type: "mp3" | "pcm" | "wav" }`), so a sample rate or a bitrate is an
 * `unsupported_param` rather than a value dropped on the floor. The same spec
 * `hume.tts` uses, restated here rather than imported from `./tts-params` for
 * the reason `sfx-params.ts` gives: a `*-params` leaf is what the values entry
 * and the bundle budget read, and pulling in the TTS leaf would make every
 * `sts` consumer carry Octave's per-model rows and delivery spec for a
 * constant.
 */
export const FORMAT: AudioFormatSpec = {
  codecs: { mp3: "mp3", pcm_s16le: "pcm" },
  containers: { mp3: ["mp3"], pcm_s16le: ["wav", "raw"] },
  unavailable: ["sampleRate", "bitrate"],
  source: VOICE_CONVERSION_DOCS,
};

/**
 * The route's three non-canonical fields, each with exactly ONE witness across
 * the category's two vendors — `docs/decisions.md` §8, which is why they are
 * extras rather than vocabulary.
 *
 * `include_timestamp_types` is documented "Only supported for Octave 2
 * requests" and this route has no version field to select a generation with, so
 * unmodel neither gates it nor warns: there is nothing here to compare it
 * against, and refusing a field the endpoint accepts would be the one failure
 * this library must never have.
 */
export const VOICE_CONVERSION_EXTRAS = {
  strip_headers: EXTRA as boolean,
  context: EXTRA as HumeContext | null,
  include_timestamp_types: EXTRA as HumeTimestampType[],
} as const;

export const HUME_STS_MODEL_PARAMS = {
  "voice-conversion": {
    codecs: ["mp3", "pcm_s16le"],
    extras: VOICE_CONVERSION_EXTRAS,
  },
} as const satisfies StsModelParamTable;
