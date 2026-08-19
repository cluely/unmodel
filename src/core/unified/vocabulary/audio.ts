/**
 * How a caller asks for an audio encoding — one vocabulary for speech and
 * music, because the providers do not distinguish either.
 *
 * Types only. The normalization (`normalizeAudioFormat`), the container
 * defaults and the spec-driven mapping live in `../derive.ts`.
 *
 * ## Two spellings, one meaning
 *
 * `outputFormat: "mp3"` is the ninety-percent case and should not require an
 * object. `outputFormat: { format: "pcm_s16le", sampleRate: 24000 }` is the
 * case that actually needs the detail. Both normalize to the same
 * {@link AudioFormat}, so an adapter only ever handles the object form.
 */

/**
 * The codec, which is the part callers actually care about.
 *
 * PCM variants are spelled the way ffmpeg spells them (`pcm_s16le` — signed
 * 16-bit little-endian) because that is the one naming scheme that is
 * unambiguous about width, signedness and byte order, and every provider's own
 * spelling (`"pcm_16000"`, `"linear16"`, `"pcm"`) maps onto it without loss.
 * The reverse does not hold, which is why the ffmpeg names win.
 */
export type AudioFormatCodec =
  | "mp3"
  | "aac"
  | "flac"
  | "opus"
  | "vorbis"
  | "pcm_s16le"
  | "pcm_s24le"
  | "pcm_s32le"
  | "pcm_f32le"
  | "pcm_mulaw"
  | "pcm_alaw";

/**
 * The wrapper the codec is delivered in.
 *
 * Separate from the codec because they are separate choices that providers
 * conflate at different points: Opus is served in Ogg by one API, in WebM by
 * another, and raw by a third, and a caller who says `"opus"` has said nothing
 * about which. `"raw"` means no container — a bare elementary stream, which is
 * what the realtime PCM surfaces take.
 */
export type AudioContainer = "mp3" | "wav" | "ogg" | "webm" | "flac" | "mp4" | "aac" | "raw";

/**
 * A fully-spelled audio encoding.
 *
 * `bitrate` is in **bits per second**, not kbps — SI units throughout, so that
 * the one place a conversion happens (`bitsToKbps`) is a named function whose
 * exactness is asserted, rather than a `/1000` sprinkled through forty
 * adapters. Absent fields mean "the caller did not care": an adapter fills
 * them from its provider's documented defaults and warns `approximated_param`
 * when it does, so the request stays honest about what it invented.
 */
export interface AudioFormat {
  format: AudioFormatCodec;
  container?: AudioContainer;
  /** Hz, e.g. `24000`. */
  sampleRate?: number;
  /** Bits per second, e.g. `128000` for 128 kbps. */
  bitrate?: number;
}

/** The two spellings a caller may use for `outputFormat`. */
export type AudioFormatRequest = AudioFormatCodec | AudioFormat;
