/**
 * The canonical vocabulary's **runtime twins** — one array per closed union the
 * unified surfaces speak.
 *
 * `vocabulary/` is types-only by law ("a constant here would be a constant in
 * six bundles"), and that law is what keeps `unmodel/image` and its five
 * siblings at the weight of the adapters a caller names. These arrays are the
 * same words as *values*, and they live here rather than there for exactly that
 * reason: `unmodel/values` — the entry a browser reaches for when it needs to
 * draw a picker — pays for this module and for nothing else.
 *
 * {@link CANONICAL_KEY_LISTS} is re-exported here and declared next door in
 * `./canonical-keys.ts`. It used to live inside `kernel.ts`, which made the hub
 * pay for the kernel's whole chunk to publish one object (33.7 KiB of chunk
 * graph); it is not declared in *this* module either, because the kernel reads
 * it and would then have put these nine arrays into all six packs. Three small
 * modules, each with exactly the readers it has.
 *
 * **Import-free on purpose.** Every value import in this module would be a
 * value import in a client bundle that wanted one nine-element array. The only
 * imports are `import type`, and `test/values-entries.test.ts` measures the
 * consequence against a real build.
 *
 * ## Why the unions are still declared by hand
 *
 * Each array carries `satisfies readonly <Union>[]`, which catches a member the
 * union does not have. The other direction — a union member missing from the
 * array — is not expressible in a `satisfies`, so it is asserted in
 * `test/types/values-hub.test-d.ts`, in both directions, for all ten. The
 * alternative was to *derive* each union from its array
 * (`type X = (typeof ARR)[number]`) and delete the hand-written one. It was
 * rejected twice over: it would put a value module's name inside the types-only
 * vocabulary — the one directory whose law is that it names no values — and it
 * would replace ten legible unions with an indexed access in every editor
 * hover and every emitted `.d.ts`. Two declarations plus a both-direction
 * proof is the trade this repo already makes for `CANONICAL_KEY_LISTS`
 * (`test/types/canonical-keys.test-d.ts`), and it is made for the same reason.
 */

import type { AudioContainer, AudioFormatCodec } from "./vocabulary/audio";
import type {
  AspectRatioPreset,
  ImageOutputFormat,
  OutputDelivery,
  ResolutionTier,
  TtsDeliveryKind,
  VideoResolution,
} from "./vocabulary/common";
import type { AudioInputKind, TimestampGranularity } from "./vocabulary/stt";
import type { VoiceSampleKind, VoiceVisibility } from "./vocabulary/voice-clone";

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

/**
 * The nine ratios worth autocompleting, in the order an editor should offer
 * them: square first, then the two 16:9 orientations, then the rest in
 * descending popularity. `AspectRatio` stays open (`` `${number}:${number}` ``),
 * so this is the suggestion list rather than the legal set — which model
 * accepts which is `<PROVIDER>_*_MODEL_PARAMS`'s answer, per model.
 */
export const ASPECT_RATIO_PRESETS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "9:21",
] as const satisfies readonly AspectRatioPreset[];

/** The three still-image size tiers, smallest first. */
export const RESOLUTION_TIERS = ["1k", "2k", "4k"] as const satisfies readonly ResolutionTier[];

/** The five clip resolutions, named after the short edge, smallest first. */
export const VIDEO_RESOLUTIONS = [
  "480p",
  "720p",
  "1080p",
  "1440p",
  "4k",
] as const satisfies readonly VideoResolution[];

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** The three still-image encodings. */
export const IMAGE_OUTPUT_FORMATS = [
  "png",
  "jpeg",
  "webp",
] as const satisfies readonly ImageOutputFormat[];

/** URL or inline bytes — the two ways a provider hands an artefact back. */
export const OUTPUT_DELIVERIES = ["url", "base64"] as const satisfies readonly OutputDelivery[];

/**
 * The five ways a speech endpoint answers, cheapest to read first.
 *
 * The closed set the `kind` on every adapter's `delivery` is drawn from; WHICH
 * one a given provider uses — and which request field flips it, and at which
 * path the audio sits — is that provider's own `TTS_DELIVERY` at
 * `unmodel/<provider>/values`.
 */
export const TTS_DELIVERY_KINDS = [
  "bytes",
  "base64",
  "hex",
  "url",
  "sse",
] as const satisfies readonly TtsDeliveryKind[];

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/**
 * The eleven codecs, in the order the vocabulary declares them: the five
 * compressed ones, then the six PCM variants spelled the way ffmpeg spells
 * them.
 */
export const AUDIO_FORMAT_CODECS = [
  "mp3",
  "aac",
  "flac",
  "opus",
  "vorbis",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_f32le",
  "pcm_mulaw",
  "pcm_alaw",
] as const satisfies readonly AudioFormatCodec[];

/** The eight wrappers a codec is delivered in; `"raw"` means no container. */
export const AUDIO_CONTAINERS = [
  "mp3",
  "wav",
  "ogg",
  "webm",
  "flac",
  "mp4",
  "aac",
  "raw",
] as const satisfies readonly AudioContainer[];

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/** The four timing granularities `timestamps` takes, coarsest to finest. */
export const TIMESTAMP_GRANULARITIES = [
  "none",
  "word",
  "segment",
  "character",
] as const satisfies readonly TimestampGranularity[];

/**
 * The four ways a caller hands audio over.
 *
 * Which of them a given model accepts is on that provider's adapter as
 * `audioInputs`; this is the closed set those lists are drawn from.
 */
export const AUDIO_INPUT_KINDS = [
  "file",
  "url",
  "fileId",
  "data",
] as const satisfies readonly AudioInputKind[];

// ---------------------------------------------------------------------------
// Voice creation
// ---------------------------------------------------------------------------

/**
 * The three ways a caller hands reference recordings over. A strict subset of
 * {@link AUDIO_INPUT_KINDS} today (no wave-one clone route fetches a URL);
 * which of them a given route accepts is on that provider's adapter as
 * `sampleInputs`.
 */
export const VOICE_SAMPLE_KINDS = [
  "file",
  "data",
  "fileId",
] as const satisfies readonly VoiceSampleKind[];

/** Who can see a created voice, most private first. */
export const VOICE_VISIBILITIES = [
  "private",
  "unlisted",
  "public",
] as const satisfies readonly VoiceVisibility[];

// ---------------------------------------------------------------------------
// The params vocabulary itself
//
// Declared in `./canonical-keys.ts` rather than here, and re-exported: the
// kernel needs it and the six packs therefore pay for whatever module it sits
// in. Alone it is ~1.5 KiB; beside the arrays above it would have been 3.5, in
// every pack, for nine lists no pack reads.
// ---------------------------------------------------------------------------

export { CANONICAL_KEY_LISTS } from "./canonical-keys";
