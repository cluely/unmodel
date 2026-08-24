/**
 * The tts adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/murf/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { TtsDeliverySpec, TtsModelParamTable } from "../../core/unified/vocabulary/tts";
import type { MurfChannelType } from "./tts";

/** The two catalog rows — the ref union for `murf/…`. */
export const MODELS = ["gen2", "falcon-2"] as const;

/**
 * Murf's per-model surface, which is really a per-**route** surface — and here
 * that is the same thing.
 *
 * The ref picks the endpoint (`gen2` → `/v1/speech/generate`, `falcon-2` →
 * `/v1/speech/stream`, because Falcon 2 is served nowhere else), so a model
 * serves exactly one route and the video wave's route hazard cannot arise: an
 * extra declared on a row is a field of the one body that row compiles to.
 *
 * `style`, `pitch` and `channelType` are `SpeechCommon` and therefore on both.
 * The four the generate body adds are Gen2's alone: `variation` and
 * `audioDuration` are marked "Gen2 only" in the reference, and
 * `encodeAsBase64` / `wordDurationsAsOriginalText` exist only on
 * `SpeechGenerateBody`. Sending any of them to `/v1/speech/stream` would put a
 * key on a body that has no such field, which is the silent-drop the loss
 * contract forbids — so `falcon-2`'s row stops at three.
 *
 * No `languages`: `locale` is BCP-47 and passes through unmapped (Murf
 * publishes a voice list, not a language enum), so there is nothing closed to
 * complete. `multiNativeLocale` is excluded as deprecated — the provider's own
 * validator says so — and `OGG` never reaches `codecs` because the adapter
 * refuses to guess which codec is inside the container.
 */
export const SHARED_MURF_EXTRAS = {
  /** Predefined voice style, e.g. "Angry", "Sad" — a catalog string, not an enum. */
  style: EXTRA as string,
  /** Integer −50…50, like `rate`; the canonical vocabulary has no word for pitch. */
  pitch: EXTRA as number,
  channelType: EXTRA as MurfChannelType,
} as const;

export const MURF_CODECS = ["mp3", "flac", "pcm_s16le", "pcm_mulaw", "pcm_alaw"] as const;

export const MURF_TTS_MODEL_PARAMS = {
  gen2: {
    codecs: MURF_CODECS,
    extras: {
      ...SHARED_MURF_EXTRAS,
      variation: EXTRA as number,
      audioDuration: EXTRA as number,
      encodeAsBase64: EXTRA as boolean,
      wordDurationsAsOriginalText: EXTRA as boolean,
    },
  },
  "falcon-2": { codecs: MURF_CODECS, extras: SHARED_MURF_EXTRAS },
} as const satisfies TtsModelParamTable;

/**
 * The one provider in the category where the **model ref** decides, because it
 * decides the route: "`/v1/speech/generate` answers with JSON (`audioFile`,
 * `audioLengthInSeconds`, `remainingCharacterCount`, `wordDurations`) …
 * `/v1/speech/stream` answers with an audio stream, so it has no response
 * checker" (./tts.ts), and `gen2` and `falcon-2` are served by one each.
 *
 * On the generate route the audio is a URL by default — `audioFile` is the
 * "URL to generated audio", "available for download for 72 hours" (./check.ts),
 * so there are no bytes in hand — and base64 only when `encodeAsBase64` is set:
 * "Set to true to receive audio in response as Base64 encoded string".
 */
export const MURF_TTS_DELIVERY = {
  byModel: {
    gen2: {
      byRequestField: "encodeAsBase64",
      variants: {
        true: { kind: "base64", path: ["encodedAudio"] },
        false: { kind: "url", path: ["audioFile"] },
      },
      default: { kind: "url", path: ["audioFile"] },
    },
    "falcon-2": { kind: "bytes" },
  },
} as const satisfies TtsDeliverySpec;
