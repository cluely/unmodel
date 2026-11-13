/**
 * Which model ids each `revana.*` media address serves — the map behind the
 * signpost a foreign id gets.
 *
 * Import-free apart from the generated id lists. Every address module reads
 * {@link elsewhere} so that `revana.video({ model: "nano-banana-pro", … })`
 * answers "that is a model `revana.image` validates" rather than a bare
 * "unknown model" about an id that is in Revana's catalog.
 *
 * Only the four WIDE addresses are listed. Between them they partition the
 * media catalog by kind, so every id has exactly one home here; the narrower
 * views (`imageEdit`, `upscale`, `lipsync`, `avatar`) are subsets of `image`
 * and `video` and would only name the same model twice.
 */

import {
  REVANA_IMAGE_MODELS,
  REVANA_MUSIC_MODELS,
  REVANA_TTS_MODELS,
  REVANA_VIDEO_MODELS,
} from "./gen/ids.gen";

const WIDE_ADDRESSES = {
  "revana.video": REVANA_VIDEO_MODELS,
  "revana.image": REVANA_IMAGE_MODELS,
  "revana.tts": REVANA_TTS_MODELS,
  "revana.music": REVANA_MUSIC_MODELS,
} as const satisfies Record<string, readonly string[]>;

/**
 * The same partition on the queue route. A foreign id at `revana.videoQueue`
 * is pointed at the queue address that types it, not at the generation one:
 * the two routes take different bodies.
 */
const QUEUE_ADDRESSES = {
  "revana.videoQueue": REVANA_VIDEO_MODELS,
  "revana.imageQueue": REVANA_IMAGE_MODELS,
  "revana.ttsQueue": REVANA_TTS_MODELS,
  "revana.musicQueue": REVANA_MUSIC_MODELS,
} as const satisfies Record<string, readonly string[]>;

/** Every wide address on `own`'s route except `own`, with the ids it serves. */
export function elsewhere(
  own: keyof typeof WIDE_ADDRESSES | keyof typeof QUEUE_ADDRESSES,
): Record<string, readonly string[]> {
  const route = own in QUEUE_ADDRESSES ? QUEUE_ADDRESSES : WIDE_ADDRESSES;
  const others: Record<string, readonly string[]> = {};
  for (const [address, ids] of Object.entries(route)) {
    if (address !== own) others[address] = ids;
  }
  return others;
}
