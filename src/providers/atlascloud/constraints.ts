/**
 * Per-model constraint tables for Atlas Cloud's `POST /model/generateVideo`.
 *
 * Atlas publishes ONE OpenAPI 3.0.0 document per model — keyless, at
 * `https://static.atlascloud.ai/model/schema/<model-id-with-dashes>.json` — and
 * every one of them declares its own `components.schemas.Input`. So unlike
 * ModelArk (one route schema narrowed per model in prose) there is no shared
 * body to narrow: **each model's param surface is its own document**, and these
 * tables are those documents transcribed. The committed snapshots are in
 * `data/atlascloud/openapi/`, one file per curated id, and
 * `scripts/atlascloud-audit.ts` is what notices when they drift.
 *
 * Ground truth: the 23 snapshots in `data/atlascloud/openapi/`, fetched and
 * transcribed 2026-08-26. Route and auth prose: ./urls.ts.
 *
 * ## RESTATED, never imported
 *
 * unmodel already speaks most of this vocabulary — `ratio`, the `duration: -1`
 * sentinel, `watermark`, `omni_reference_task_type`, `output_format` and
 * `asset://` references are all in `src/providers/bytedance/constraints.ts`,
 * because Atlas resells ByteDance's ModelArk models and keeps ModelArk's
 * spelling. Sharing those tables would be the tempting wrong move: Atlas's
 * bounds are Atlas's own, and they differ in ways a shared table could not
 * express —
 *
 * | | ModelArk (`bytedance`) | Atlas (`atlascloud`) |
 * |---|---|---|
 * | Seedance 2.5 `resolution` | 2 values (`480p`, `720p`) | **11** (the `-sr`/`-esr` ladder up to `4k-esr`) |
 * | Seedance 2.5 i2v `ratio` | the 7-member enum | **`adaptive` only** |
 * | reference input | `content[]` items with a `role` | three flat string arrays |
 * | the route | one url for every model | one url, and `model` is a REAL body field |
 *
 * Two sources of truth about one page is what `docs/decisions.md` §1 forbids;
 * two providers transcribing their own pages is that rule working.
 */

import type { DenyRule, EndpointConstraints } from "../../core/constraint-types";

/** The video API reference — route, auth, polling, the response envelope. */
export const VIDEO_API_SOURCE = "https://www.atlascloud.ai/docs/models/video";

/** Where a model's own request schema lives (`<id>` with `/` → `-`). */
export const VIDEO_SCHEMA_SOURCE = "https://static.atlascloud.ai/model/schema/";

/** The keyless catalog `scripts/atlascloud-audit.ts` diffs the roster against. */
export const VIDEO_MODELS_SOURCE = "https://api.atlascloud.ai/api/v1/models";

/** The date every table in this file was transcribed from those documents. */
export const VIDEO_VERIFIED = "2026-08-26";

function denyTable(
  entries: Readonly<Record<string, string>>,
  source: string,
): Record<string, DenyRule> {
  const out: Record<string, DenyRule> = {};
  for (const [param, reason] of Object.entries(entries)) out[param] = { reason, source };
  return out;
}

// ---------------------------------------------------------------------------
// Enums, as Atlas publishes them
// ---------------------------------------------------------------------------

/**
 * `ratio` on the Seedance 2.x models — "Aspect ratio. 'adaptive' uses primary
 * media aspect ratio."
 *
 * `adaptive` is NOT a shape: it is what an input-driven request follows its
 * input with, and it is the documented default on every model that has the
 * field. `unified-video.ts` filters it out of the candidate list for exactly
 * that reason.
 */
export const VIDEO_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"] as const;

/** `ratio` on Wan 3.0 / 3.0-prime text-to-video — the same list without `21:9`. */
export const WAN_RATIOS = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

/** `aspect_ratio` on Seedance v1.5 pro — a different field name and no `adaptive`. */
export const SEEDANCE_15_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

/** `aspect_ratio` on Veo 3.1 — two shapes, and the schema says so. */
export const VEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;

/**
 * Seedance 2.5's `resolution` — **eleven** values, and the reason this
 * provider's tables cannot be shared with `bytedance`'s two.
 *
 * "480p, 720p, and 1080p are native Seedance outputs. Every -sr and -esr option
 * first generates the nearest native source, then upscales or enhances it:
 * 720p-sr and 720p-esr from 480p; 1080p-sr, 1080p-esr, and 1080p-esr & 60fps
 * from 720p; 1440p-sr, 1440p-esr, and 4k-esr from 1080p. … Native 1080p,
 * 1080p-sr, and 1080p-esr are different products and are priced differently.
 * 4k-esr delivers a 2160-pixel short edge (3840x2160 at 16:9), not native 4K
 * generation."
 */
export const SEEDANCE_25_RESOLUTIONS = [
  "480p",
  "720p",
  "720p-sr",
  "720p-esr",
  "1080p",
  "1080p-sr",
  "1080p-esr",
  "1080p-esr & 60fps",
  "1440p-sr",
  "1440p-esr",
  "4k-esr",
] as const;

/**
 * Seedance 2.0's `resolution` — the full 2.0 model is the only Seedance here
 * with native `4k`: "\"4k\" is native UHD (3840×2160, 16:9) available on the
 * full Seedance 2.0 models only (not Fast/Mini)".
 *
 * Note the CASING difference from 2.5: the 2.0 series spells its upscaler
 * suffix `-SR` and 2.5 spells it `-sr`. Transcribed, not normalised.
 */
export const SEEDANCE_20_RESOLUTIONS = [
  "480p",
  "720p",
  "720p-SR",
  "1080p",
  "1080p-SR",
  "1440p-SR",
  "4k",
] as const;

/** Seedance 2.0 fast / mini: the same ladder minus native `1080p` and `4k`. */
export const SEEDANCE_20_SMALL_RESOLUTIONS = [
  "480p",
  "720p",
  "720p-SR",
  "1080p-SR",
  "1440p-SR",
] as const;

/** Seedance v1.5 pro `resolution`; the `-fast` pair renders 720p only. */
export const SEEDANCE_15_RESOLUTIONS = ["720p", "480p"] as const;
export const SEEDANCE_15_FAST_RESOLUTIONS = ["720p"] as const;

/** Wan 3.0 prime `resolution` — UPPER-case P, unlike every other row here. */
export const WAN_PRIME_RESOLUTIONS = ["1080P", "720P", "480P"] as const;

/** Wan 3.0 `resolution` — lower-case, with an `-esr` enhancement ladder. */
export const WAN_RESOLUTIONS = [
  "1080p",
  "720p",
  "480p",
  "720p-esr",
  "1080p-esr",
  "1440p-esr",
  "4k-esr",
] as const;

/** Veo 3.1 `resolution`. */
export const VEO_RESOLUTIONS = ["720p", "1080p", "4k"] as const;

/** `output_format` — Seedance 2.5 only. */
export const VIDEO_OUTPUT_FORMATS = ["mp4", "mov"] as const;

/** `bitrate_mode` — the Seedance 2.0 series only. "Does not affect token cost." */
export const BITRATE_MODES = ["standard", "high"] as const;

/** `omni_reference_task_type` — Seedance 2.5 reference-to-video only. */
export const OMNI_REFERENCE_TASK_TYPES = ["auto", "reference", "edit", "extend"] as const;

/** "Value range: [-1, 2^32-1]. The default -1 means a random seed is used." */
export const VIDEO_SEED_RANGE = { min: -1, max: 4_294_967_295 } as const;

/**
 * The sentinel every Atlas duration enum that has one spells the same way:
 * `-1` = "let the model choose the length".
 *
 * It is a real enum member on the Seedance 2.x and Wan 3.0 families and it is
 * absent from Seedance v1.5 pro (a plain `[4, 12]` range) and Veo 3.1 (a
 * three-member enum). `unified-video.ts` never invents it: the canonical
 * `duration` is "a positive number of seconds" everywhere in this library, so
 * the sentinel is reached wire-side — `atlascloud.video({ duration: -1 })` — or
 * through `providerOptions.atlascloud.duration` from the unified surface.
 */
export const AUTO_DURATION = -1;

// ---------------------------------------------------------------------------
// Per-model shape rules
// ---------------------------------------------------------------------------

/**
 * The narrowing no `deny` or `enums` entry can express: which fields a model
 * REQUIRES, what its `duration` enum is, and how many reference items each of
 * its three flat arrays takes.
 */
export interface VideoShapeRule {
  /** Body fields the schema's `required` list names, minus `model`. */
  readonly required: readonly string[];
  /** Inclusive `duration` bounds in seconds, ignoring the `-1` sentinel. */
  readonly minDuration: number;
  readonly maxDuration: number;
  /**
   * The exact `duration` enum, when the schema publishes one, with `-1`
   * filtered out (it is {@link allowsAutoDuration}'s job). Seedance v1.5 pro
   * publishes a `[minimum, maximum]` range instead and gets `undefined`.
   */
  readonly durations?: readonly number[];
  /** Whether `duration: -1` ("the model picks") is an enum member. */
  readonly allowsAutoDuration: boolean;
  /** Max `reference_images` / `images` items; 0 when the model has no such field. */
  readonly maxReferenceImages: number;
  /** The schema's `minItems` for the reference-image array. */
  readonly minReferenceImages: number;
  /** Max `reference_videos` items; 0 when the model has no such field. */
  readonly maxReferenceVideos: number;
  /** Max `reference_audios` items; 0 when the model has no such field. */
  readonly maxReferenceAudios: number;
  /** Whether reference audio may be the only non-text input (2.5 only). */
  readonly supportsAudioOnlyReference: boolean;
  /** Whether `ratio`/`aspect_ratio` is restricted to `adaptive` on this model. */
  readonly forcesAdaptiveRatio: boolean;
  /** `resolution ∈ {1080p, 4k}` ⇒ `duration` must be 8 (Veo 3.1's `allOf`). */
  readonly durationLockedAtHighResolution?: readonly number[];
}

const SEEDANCE_25_DURATIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30,
] as const;

const SEEDANCE_20_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

const WAN_DURATIONS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30,
] as const;

/** Veo 3.1 text/image: `[8, 4, 6]` as the schema orders it. */
const VEO_DURATIONS = [8, 4, 6] as const;

const NO_REFERENCES = {
  maxReferenceImages: 0,
  minReferenceImages: 0,
  maxReferenceVideos: 0,
  maxReferenceAudios: 0,
  supportsAudioOnlyReference: false,
} as const;

const SEEDANCE_25_BASE = {
  minDuration: 4,
  maxDuration: 30,
  durations: SEEDANCE_25_DURATIONS,
  allowsAutoDuration: true,
} as const;

const SEEDANCE_20_BASE = {
  minDuration: 4,
  maxDuration: 15,
  durations: SEEDANCE_20_DURATIONS,
  allowsAutoDuration: true,
} as const;

/**
 * The 2.0 series' reference caps, which are a THIRD of Seedance 2.5's: "Up to 9
 * images … Up to 3 videos, total duration <= 15s … Up to 3 audios". Note the
 * `minItems: 1` — an empty array is a schema violation here, where 2.5 allows
 * `minItems: 0`.
 */
const SEEDANCE_20_REFERENCES = {
  maxReferenceImages: 9,
  minReferenceImages: 1,
  maxReferenceVideos: 3,
  maxReferenceAudios: 3,
  // "Must include at least 1 reference video or image." — reference_audios
  supportsAudioOnlyReference: false,
} as const;

const WAN_BASE = {
  minDuration: 2,
  maxDuration: 30,
  durations: WAN_DURATIONS,
  allowsAutoDuration: true,
  forcesAdaptiveRatio: false,
  ...NO_REFERENCES,
} as const;

/** Seedance v1.5 pro: `{"type":"integer","minimum":4,"maximum":12}` — a RANGE. */
const SEEDANCE_15_BASE = {
  minDuration: 4,
  maxDuration: 12,
  allowsAutoDuration: false,
  forcesAdaptiveRatio: false,
  ...NO_REFERENCES,
} as const;

const VEO_BASE = {
  minDuration: 4,
  maxDuration: 8,
  durations: VEO_DURATIONS,
  allowsAutoDuration: false,
  forcesAdaptiveRatio: false,
  durationLockedAtHighResolution: [8],
} as const;

export const videoShapeRules: Readonly<Partial<Record<string, VideoShapeRule>>> = {
  "bytedance/seedance-2.5/text-to-video": {
    ...SEEDANCE_25_BASE,
    ...NO_REFERENCES,
    required: ["prompt"],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.5/image-to-video": {
    ...SEEDANCE_25_BASE,
    ...NO_REFERENCES,
    required: ["image"],
    // "Seedance 2.5 image-to-video (first-frame and first+last-frame) accepts
    // only 'adaptive': the output preserves the source image's aspect ratio."
    forcesAdaptiveRatio: true,
  },
  "bytedance/seedance-2.5/reference-to-video": {
    ...SEEDANCE_25_BASE,
    required: [],
    maxReferenceImages: 30,
    minReferenceImages: 0,
    maxReferenceVideos: 10,
    maxReferenceAudios: 10,
    // "Audio-only referencing is supported (unique to Seedance 2.5)."
    supportsAudioOnlyReference: true,
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.0/text-to-video": {
    ...SEEDANCE_20_BASE,
    ...NO_REFERENCES,
    required: ["prompt"],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.0/image-to-video": {
    ...SEEDANCE_20_BASE,
    ...NO_REFERENCES,
    required: ["image"],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.0/reference-to-video": {
    ...SEEDANCE_20_BASE,
    ...SEEDANCE_20_REFERENCES,
    required: [],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.0-mini/text-to-video": {
    ...SEEDANCE_20_BASE,
    ...NO_REFERENCES,
    required: ["prompt"],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.0-mini/image-to-video": {
    ...SEEDANCE_20_BASE,
    ...NO_REFERENCES,
    required: ["image"],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.0-mini/reference-to-video": {
    ...SEEDANCE_20_BASE,
    ...SEEDANCE_20_REFERENCES,
    required: [],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.0-fast/text-to-video": {
    ...SEEDANCE_20_BASE,
    ...NO_REFERENCES,
    required: ["prompt"],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.0-fast/image-to-video": {
    ...SEEDANCE_20_BASE,
    ...NO_REFERENCES,
    required: ["image"],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-2.0-fast/reference-to-video": {
    ...SEEDANCE_20_BASE,
    ...SEEDANCE_20_REFERENCES,
    required: [],
    forcesAdaptiveRatio: false,
  },
  "bytedance/seedance-v1.5-pro/text-to-video": { ...SEEDANCE_15_BASE, required: ["prompt"] },
  "bytedance/seedance-v1.5-pro/image-to-video": { ...SEEDANCE_15_BASE, required: ["image"] },
  "bytedance/seedance-v1.5-pro/text-to-video-fast": { ...SEEDANCE_15_BASE, required: ["prompt"] },
  "bytedance/seedance-v1.5-pro/image-to-video-fast": { ...SEEDANCE_15_BASE, required: ["image"] },
  "alibaba/wan-3.0-prime/text-to-video": { ...WAN_BASE, required: ["prompt"] },
  "alibaba/wan-3.0-prime/image-to-video": { ...WAN_BASE, required: ["prompt", "image"] },
  "alibaba/wan-3.0/text-to-video": { ...WAN_BASE, required: ["prompt"] },
  "alibaba/wan-3.0/image-to-video": { ...WAN_BASE, required: ["prompt", "image"] },
  "google/veo3.1/text-to-video": { ...VEO_BASE, ...NO_REFERENCES, required: ["prompt"] },
  "google/veo3.1/image-to-video": {
    ...VEO_BASE,
    ...NO_REFERENCES,
    required: ["prompt", "image"],
  },
  "google/veo3.1/reference-to-video": {
    ...VEO_BASE,
    required: ["prompt", "images"],
    // "Accepts 1 to 3 images" — and `duration` narrows to the single value 8.
    durations: [8],
    minDuration: 8,
    maxReferenceImages: 3,
    minReferenceImages: 1,
    maxReferenceVideos: 0,
    maxReferenceAudios: 0,
    supportsAudioOnlyReference: false,
  },
};

// ---------------------------------------------------------------------------
// Deny tables — a param that belongs to another family, named
// ---------------------------------------------------------------------------

const SEEDANCE_25_ONLY = {
  output_format:
    "`output_format` (mp4/mov) is a Seedance 2.5 parameter; every other Atlas video model always returns mp4",
} as const;

/**
 * The one param narrower than a family: it exists on ONE of Seedance 2.5's
 * three routes, so the 2.5 text and image arms deny it too.
 */
const OMNI_ONLY = {
  omni_reference_task_type:
    "`omni_reference_task_type` is a Seedance 2.5 reference-to-video parameter — it validates an omni sub-task, and only that route takes reference media",
} as const;

const SEEDANCE_20_ONLY = {
  bitrate_mode: "`bitrate_mode` is a Seedance 2.0 / 2.0-fast / 2.0-mini parameter",
} as const;

const SEEDANCE_2X_ONLY = {
  watermark: "`watermark` is a Seedance 2.x parameter on Atlas",
  return_last_frame: "`return_last_frame` is a Seedance 2.x parameter on Atlas",
} as const;

const REFERENCE_ONLY = {
  reference_images:
    "`reference_images` exists on the Seedance 2.x reference-to-video routes only; at Atlas the ROUTE is the model, so pick the `/reference-to-video` id",
  reference_videos:
    "`reference_videos` exists on the Seedance 2.x reference-to-video routes only; at Atlas the ROUTE is the model, so pick the `/reference-to-video` id",
  reference_audios:
    "`reference_audios` exists on the Seedance 2.x reference-to-video routes only; at Atlas the ROUTE is the model, so pick the `/reference-to-video` id",
} as const;

const FRAME_ONLY = {
  image:
    "`image` is a first-frame field on the `/image-to-video` routes; at Atlas the ROUTE is the model, so pick the `/image-to-video` id",
  last_image:
    "`last_image` is a last-frame field on the `/image-to-video` routes; at Atlas the ROUTE is the model, so pick the `/image-to-video` id",
} as const;

const SEED_ABSENT = {
  seed: "`seed` is absent from the Seedance 2.5 and Veo 3.1 reference schemas on Atlas",
} as const;

const VEO_ONLY = {
  negative_prompt: "`negative_prompt` is a Veo 3.1 parameter; no Seedance or Wan model on Atlas has one",
} as const;

const RATIO_ABSENT = {
  ratio: "`ratio` is a Seedance 2.x / Wan 3.0 field; Seedance v1.5 pro and Veo 3.1 spell it `aspect_ratio`",
} as const;

const ASPECT_RATIO_ABSENT = {
  aspect_ratio:
    "`aspect_ratio` is a Seedance v1.5 pro / Veo 3.1 field; the Seedance 2.x and Wan 3.0 models spell it `ratio`",
} as const;

const AUDIO_FIELD_ABSENT = {
  audio: "`audio` is the Wan 3.0 spelling of the audio toggle; this model spells it `generate_audio`",
} as const;

const GENERATE_AUDIO_ABSENT = {
  generate_audio: "Wan 3.0 spells its audio toggle `audio`, not `generate_audio`",
} as const;

const CAMERA_FIXED_ONLY = {
  camera_fixed: "`camera_fixed` is a Seedance v1.5 pro parameter",
} as const;

const IMAGES_ONLY = {
  images:
    "`images` is Veo 3.1 reference-to-video's reference array; the Seedance reference routes spell theirs `reference_images`",
} as const;

/**
 * Two combinators, because at Atlas the ROUTE IS THE MODEL: a family's fields
 * split three ways across its text / image / reference ids, and the two
 * groups a given arm does not own are denied by name so the message can say
 * which id to pick instead.
 */
const denyFrames = (deny: Record<string, DenyRule>): Record<string, DenyRule> => ({
  ...denyTable(FRAME_ONLY, VIDEO_API_SOURCE),
  ...deny,
});

const denyReferences = (deny: Record<string, DenyRule>): Record<string, DenyRule> => ({
  ...denyTable(REFERENCE_ONLY, VIDEO_API_SOURCE),
  ...deny,
});

/** Shared by every Seedance 2.x arm — `ratio` IS theirs, `aspect_ratio` is not. */
const seedance2xDeny: Record<string, DenyRule> = {
  ...denyTable(VEO_ONLY, VIDEO_API_SOURCE),
  ...denyTable(ASPECT_RATIO_ABSENT, VIDEO_API_SOURCE),
  ...denyTable(AUDIO_FIELD_ABSENT, VIDEO_API_SOURCE),
  ...denyTable(CAMERA_FIXED_ONLY, VIDEO_API_SOURCE),
  ...denyTable(IMAGES_ONLY, VIDEO_API_SOURCE),
};

const seedance25Base: Record<string, DenyRule> = {
  ...seedance2xDeny,
  ...denyTable(SEEDANCE_20_ONLY, VIDEO_API_SOURCE),
  ...denyTable(SEED_ABSENT, VIDEO_API_SOURCE),
};

const seedance20Base: Record<string, DenyRule> = {
  ...seedance2xDeny,
  ...denyTable(SEEDANCE_25_ONLY, VIDEO_API_SOURCE),
  ...denyTable(OMNI_ONLY, VIDEO_API_SOURCE),
};

const wanDeny: Record<string, DenyRule> = denyReferences({
  ...denyTable(OMNI_ONLY, VIDEO_API_SOURCE),
  ...denyTable(VEO_ONLY, VIDEO_API_SOURCE),
  ...denyTable(ASPECT_RATIO_ABSENT, VIDEO_API_SOURCE),
  ...denyTable(GENERATE_AUDIO_ABSENT, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_25_ONLY, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_20_ONLY, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_2X_ONLY, VIDEO_API_SOURCE),
  ...denyTable(CAMERA_FIXED_ONLY, VIDEO_API_SOURCE),
  ...denyTable(IMAGES_ONLY, VIDEO_API_SOURCE),
});

const seedance15Deny: Record<string, DenyRule> = denyReferences({
  ...denyTable(OMNI_ONLY, VIDEO_API_SOURCE),
  ...denyTable(VEO_ONLY, VIDEO_API_SOURCE),
  ...denyTable(RATIO_ABSENT, VIDEO_API_SOURCE),
  ...denyTable(AUDIO_FIELD_ABSENT, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_25_ONLY, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_20_ONLY, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_2X_ONLY, VIDEO_API_SOURCE),
  ...denyTable(IMAGES_ONLY, VIDEO_API_SOURCE),
});

/** Everything Veo 3.1 rejects *except* `images`, which its reference arm owns. */
const veoCommonDeny: Record<string, DenyRule> = denyReferences({
  ...denyTable(OMNI_ONLY, VIDEO_API_SOURCE),
  ...denyTable(RATIO_ABSENT, VIDEO_API_SOURCE),
  ...denyTable(AUDIO_FIELD_ABSENT, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_25_ONLY, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_20_ONLY, VIDEO_API_SOURCE),
  ...denyTable(SEEDANCE_2X_ONLY, VIDEO_API_SOURCE),
  ...denyTable(CAMERA_FIXED_ONLY, VIDEO_API_SOURCE),
});

const veoDeny: Record<string, DenyRule> = {
  ...veoCommonDeny,
  ...denyTable(IMAGES_ONLY, VIDEO_API_SOURCE),
};

const WAN_NO_RATIO = {
  ratio:
    "Wan 3.0 image-to-video has no `ratio` field: the first frame decides the shape. Use the `/text-to-video` id to name one.",
} as const;

export const videoConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "bytedance/seedance-2.5/text-to-video": {
    deny: { ...denyFrames(denyReferences(seedance25Base)), ...denyTable(OMNI_ONLY, VIDEO_API_SOURCE) },
    enums: { resolution: SEEDANCE_25_RESOLUTIONS, ratio: VIDEO_RATIOS, output_format: VIDEO_OUTPUT_FORMATS },
  },
  "bytedance/seedance-2.5/image-to-video": {
    deny: { ...denyReferences(seedance25Base), ...denyTable(OMNI_ONLY, VIDEO_API_SOURCE) },
    // The one row in the tree whose `ratio` enum has a single member, and it is
    // the schema's: `{"enum":["adaptive"]}`.
    enums: { resolution: SEEDANCE_25_RESOLUTIONS, ratio: ["adaptive"], output_format: VIDEO_OUTPUT_FORMATS },
  },
  "bytedance/seedance-2.5/reference-to-video": {
    deny: denyFrames(seedance25Base),
    enums: {
      resolution: SEEDANCE_25_RESOLUTIONS,
      ratio: VIDEO_RATIOS,
      output_format: VIDEO_OUTPUT_FORMATS,
      omni_reference_task_type: OMNI_REFERENCE_TASK_TYPES,
    },
  },
  "bytedance/seedance-2.0/text-to-video": {
    deny: denyFrames(denyReferences(seedance20Base)),
    enums: { resolution: SEEDANCE_20_RESOLUTIONS, ratio: VIDEO_RATIOS, bitrate_mode: BITRATE_MODES },
  },
  "bytedance/seedance-2.0/image-to-video": {
    deny: denyReferences(seedance20Base),
    enums: { resolution: SEEDANCE_20_RESOLUTIONS, ratio: VIDEO_RATIOS, bitrate_mode: BITRATE_MODES },
  },
  "bytedance/seedance-2.0/reference-to-video": {
    deny: denyFrames(seedance20Base),
    enums: { resolution: SEEDANCE_20_RESOLUTIONS, ratio: VIDEO_RATIOS, bitrate_mode: BITRATE_MODES },
  },
  "bytedance/seedance-2.0-mini/text-to-video": {
    deny: denyFrames(denyReferences(seedance20Base)),
    enums: { resolution: SEEDANCE_20_SMALL_RESOLUTIONS, ratio: VIDEO_RATIOS, bitrate_mode: BITRATE_MODES },
  },
  "bytedance/seedance-2.0-mini/image-to-video": {
    deny: denyReferences(seedance20Base),
    enums: { resolution: SEEDANCE_20_SMALL_RESOLUTIONS, ratio: VIDEO_RATIOS, bitrate_mode: BITRATE_MODES },
  },
  "bytedance/seedance-2.0-mini/reference-to-video": {
    deny: denyFrames(seedance20Base),
    enums: { resolution: SEEDANCE_20_SMALL_RESOLUTIONS, ratio: VIDEO_RATIOS, bitrate_mode: BITRATE_MODES },
  },
  "bytedance/seedance-2.0-fast/text-to-video": {
    deny: denyFrames(denyReferences(seedance20Base)),
    enums: { resolution: SEEDANCE_20_SMALL_RESOLUTIONS, ratio: VIDEO_RATIOS, bitrate_mode: BITRATE_MODES },
  },
  "bytedance/seedance-2.0-fast/image-to-video": {
    deny: denyReferences(seedance20Base),
    enums: { resolution: SEEDANCE_20_SMALL_RESOLUTIONS, ratio: VIDEO_RATIOS, bitrate_mode: BITRATE_MODES },
  },
  "bytedance/seedance-2.0-fast/reference-to-video": {
    deny: denyFrames(seedance20Base),
    enums: { resolution: SEEDANCE_20_SMALL_RESOLUTIONS, ratio: VIDEO_RATIOS, bitrate_mode: BITRATE_MODES },
  },
  "bytedance/seedance-v1.5-pro/text-to-video": {
    deny: denyFrames(seedance15Deny),
    enums: { resolution: SEEDANCE_15_RESOLUTIONS, aspect_ratio: SEEDANCE_15_ASPECT_RATIOS },
  },
  "bytedance/seedance-v1.5-pro/image-to-video": {
    deny: seedance15Deny,
    enums: { resolution: SEEDANCE_15_RESOLUTIONS, aspect_ratio: SEEDANCE_15_ASPECT_RATIOS },
  },
  "bytedance/seedance-v1.5-pro/text-to-video-fast": {
    deny: denyFrames(seedance15Deny),
    enums: { resolution: SEEDANCE_15_FAST_RESOLUTIONS, aspect_ratio: SEEDANCE_15_ASPECT_RATIOS },
  },
  "bytedance/seedance-v1.5-pro/image-to-video-fast": {
    deny: seedance15Deny,
    enums: { resolution: SEEDANCE_15_FAST_RESOLUTIONS, aspect_ratio: SEEDANCE_15_ASPECT_RATIOS },
  },
  "alibaba/wan-3.0-prime/text-to-video": {
    deny: denyFrames(wanDeny),
    enums: { resolution: WAN_PRIME_RESOLUTIONS, ratio: WAN_RATIOS },
  },
  "alibaba/wan-3.0-prime/image-to-video": {
    // Wan's image-to-video schema drops `ratio` entirely — the first frame
    // decides the shape — so it is denied by name rather than silently ignored.
    deny: { ...wanDeny, ...denyTable(WAN_NO_RATIO, VIDEO_API_SOURCE) },
    enums: { resolution: WAN_PRIME_RESOLUTIONS },
  },
  "alibaba/wan-3.0/text-to-video": {
    deny: denyFrames(wanDeny),
    enums: { resolution: WAN_RESOLUTIONS, ratio: WAN_RATIOS },
  },
  "alibaba/wan-3.0/image-to-video": {
    deny: { ...wanDeny, ...denyTable(WAN_NO_RATIO, VIDEO_API_SOURCE) },
    enums: { resolution: WAN_RESOLUTIONS },
  },
  "google/veo3.1/text-to-video": {
    deny: denyFrames(veoDeny),
    // `duration` is NOT in this table: `checkDuration` in ./video.ts answers for
    // every model uniformly (enum, range and the `-1` sentinel rule in one
    // message), and a second enum here would report the same miss twice.
    enums: { resolution: VEO_RESOLUTIONS, aspect_ratio: VEO_ASPECT_RATIOS },
  },
  "google/veo3.1/image-to-video": {
    deny: veoDeny,
    // `duration` is NOT in this table: `checkDuration` in ./video.ts answers for
    // every model uniformly (enum, range and the `-1` sentinel rule in one
    // message), and a second enum here would report the same miss twice.
    enums: { resolution: VEO_RESOLUTIONS, aspect_ratio: VEO_ASPECT_RATIOS },
  },
  "google/veo3.1/reference-to-video": {
    // Veo 3.1's reference arm takes `images`, not `reference_images`, and its
    // `x-order-properties` lists an `aspect_ratio` its `properties` does not
    // declare — an Atlas schema bug, recorded in ./models.ts. The field is
    // denied by name rather than passed to a wire that has no home for it.
    deny: {
      ...denyFrames(veoCommonDeny),
      ...denyTable(
        {
          aspect_ratio:
            "Veo 3.1 reference-to-video declares no `aspect_ratio` property (its `x-order-properties` lists one, which is an Atlas schema bug); the reference images decide the shape",
        },
        VIDEO_API_SOURCE,
      ),
    },
    enums: { resolution: VEO_RESOLUTIONS },
  },
};
