/**
 * `unmodel/fal/types` — every `fal` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That is
 * pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's request shapes at compile time
 * and are sending the request yourself — with `fetch`, with `@fal-ai/client`,
 * or through your own queue worker.
 *
 * ## What is here today
 *
 * The transport contract (`FalQueueSubmitResponse`, `FalQueueStatus`) and the
 * endpoint-shape vocabulary (`FalEndpointShape`, `FalPropSpec`, …) that the
 * generated narrowing tables are written against.
 *
 * The per-endpoint request bodies are GENERATED from fal's own OpenAPI
 * documents into `./gen/<category>-wire.gen.ts`, and each category's validator
 * brings a uniform `<Verb>Body` alias with it — one per endpoint address
 * `unmodel/fal` serves, named after the word you already type on the CLI. All
 * nine are here now: `ImageBody`, `ImageEditBody`, `VideoBody`, `LipsyncBody`,
 * `AvatarBody`, `UpscaleBody`, `TtsBody`, `SttBody` and `MusicBody`. A category
 * without a validator would have no address and so correctly no alias:
 * `test/types-entries.test.ts` derives that list from the CLI registry rather
 * than from this file's good intentions.
 *
 * ## The Body aliases are keyed by ENDPOINT
 *
 * `ImageBody` is the whole category's parameter surface, and the narrowing to
 * one endpoint's published parameters happens through the `endpoint` field:
 *
 * ```ts
 * import type { ImageBody, FalImageArm } from "unmodel/fal/types";
 *
 * const wide: ImageBody = { endpoint: "fal-ai/flux/dev", prompt: "a cat" };
 * const narrow: FalImageArm<"fal-ai/flux/schnell"> = {
 *   endpoint: "fal-ai/flux/schnell",
 *   prompt: "a cat",
 *   num_inference_steps: 4,   // typed to schnell's own ceiling of 12
 * };
 * ```
 */

export type { FalQueueStatus, FalQueueSubmitResponse } from "./urls";

export type {
  FalDimensionSpec,
  FalEndpointShape,
  FalMediaKind,
  FalParamShape,
  FalPropSpec,
  FalPropType,
  FalShapeClass,
  FalSizeSpec,
} from "./shape-types";

import type { FalImageParams } from "./image";
import type { FalImageEditParams } from "./image-edit";
import type { FalVideoParams } from "./video";
import type { FalLipsyncParams } from "./lipsync";
import type { FalAvatarParams } from "./avatar";
import type { FalUpscaleParams } from "./upscale";
import type { FalTtsParams } from "./tts";
import type { FalSttParams } from "./stt";
import type { FalMusicParams } from "./music";

/**
 * The request body `fal.image` accepts — every curated text-to-image endpoint,
 * keyed by `endpoint`. Narrow to one with {@link FalImageArm}.
 */
export type ImageBody = FalImageParams;

/**
 * The request body `fal.imageEdit` accepts — every curated editing endpoint,
 * keyed by `endpoint`. Narrow to one with {@link FalImageEditArm}.
 */
export type ImageEditBody = FalImageEditParams;

export type {
  FalImageArm,
  FalImageBodyById,
  FalImageEndpointId,
  FalImageResultById,
} from "./image";
export type {
  FalImageEditArm,
  FalImageEditBodyById,
  FalImageEditEndpointId,
  FalImageEditResultById,
} from "./image-edit";

/**
 * The request body `fal.video` accepts — every curated video endpoint, keyed by
 * `endpoint`. Narrow to one with {@link FalVideoArm}.
 *
 * Thirty endpoints and one address: text-to-video, image-to-video,
 * first-and-last-frame interpolation, reference-to-video and clip editing are
 * all here, because at fal they are one route shape with a different path. See
 * `./video.ts`.
 */
export type VideoBody = FalVideoParams;

/**
 * The request body `fal.lipsync` accepts. Narrow to one with
 * {@link FalLipsyncArm} — which is how `fal-ai/sync-lipsync/v2`'s real `model`
 * field types as its own two-value enum while every sibling refuses the key.
 */
export type LipsyncBody = FalLipsyncParams;

/**
 * The request body `fal.avatar` accepts. Narrow to one with
 * {@link FalAvatarArm} — which is how VEED's 28-value `avatar_id` enum types
 * itself on VEED's endpoint and nowhere else.
 */
export type AvatarBody = FalAvatarParams;

/**
 * The request body `fal.upscale` accepts. Narrow to one with
 * {@link FalUpscaleArm} — which is how the four Topaz and ESRGAN endpoints type
 * their real `model` field as their own restoration-network enum while every
 * sibling refuses the key.
 */
export type UpscaleBody = FalUpscaleParams;

/**
 * The request body `fal.tts` accepts. Narrow to one with {@link FalTtsArm} —
 * which is how twenty-three separate voice catalogs stay usable from one
 * address: `FalTtsBodyById["fal-ai/kokoro/french"]["voice"]` is the single
 * literal `"ff_siwis"`, and its American English sibling's is twenty names.
 */
export type TtsBody = FalTtsParams;

/**
 * The request body `fal.stt` accepts. Narrow to one with {@link FalSttArm} —
 * which is how `fal-ai/wizper`'s 99-language enum and `fal-ai/cohere-transcribe`'s
 * fourteen stay separate.
 */
export type SttBody = FalSttParams;

/**
 * The request body `fal.music` accepts. Narrow to one with
 * {@link FalMusicArm} — which is how `music_length_ms` types as a number only
 * at ElevenLabs Music, where it means milliseconds.
 */
export type MusicBody = FalMusicParams;

export type {
  FalVideoArm,
  FalVideoBodyById,
  FalVideoEndpointId,
  FalVideoResultById,
} from "./video";
export type {
  FalLipsyncArm,
  FalLipsyncBodyById,
  FalLipsyncEndpointId,
  FalLipsyncResultById,
} from "./lipsync";
export type {
  FalAvatarArm,
  FalAvatarBodyById,
  FalAvatarEndpointId,
  FalAvatarResultById,
} from "./avatar";
export type {
  FalUpscaleArm,
  FalUpscaleBodyById,
  FalUpscaleEndpointId,
  FalUpscaleResultById,
} from "./upscale";
export type {
  FalTtsArm,
  FalTtsBodyById,
  FalTtsEndpointId,
  FalTtsResultById,
} from "./tts";
export type {
  FalSttArm,
  FalSttBodyById,
  FalSttEndpointId,
  FalSttResultById,
} from "./stt";
export type {
  FalMusicArm,
  FalMusicBodyById,
  FalMusicEndpointId,
  FalMusicResultById,
} from "./music";

export type { FalEndpointId } from "./gen/endpoints.gen";
export type { FalRate, FalRateUnit, FalTier } from "./pricing-types";
