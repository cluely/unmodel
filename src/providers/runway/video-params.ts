/**
 * The video adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/runway/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VideoModelParamTable } from "../../core/unified/vocabulary/video";
import type { RunwayTargetAspectRatio } from "./constraints";
import type { RunwayAudioReference, RunwayContentModeration } from "./shared";
import type { RunwayVideoKeyframe } from "./video-from-video";

/** Every model with an arm on any of the three video routes. */
export const MODELS = [
  "gen4.5",
  "gen4_turbo",
  "veo3.1",
  "veo3.1_fast",
  "hailuo3",
  "happyhorse_1_0",
  "seedance2",
  "seedance2_fast",
  "seedance2_mini",
  "seedance2_5",
  "grok_imagine_1_5",
  "gemini_omni_flash",
  "aleph2",
] as const;

/**
 * Runway's per-model surface — the widest table in the category, because its
 * `ratio` enums are pixel pairs and every pair reduces to a shape.
 *
 * ## What `ratios` means here
 *
 * Not the wire values. `ratio` on most of these models is `"1280:720"`, and
 * what a caller writes is `"16:9"` — {@link toRatioEnum} matches on the reduced
 * ratio and picks the entry inside the tier's bucket. So these lists are the
 * *shapes* those pairs reduce to, deduplicated, which is exactly the set an
 * editor should offer. A shape that is in the enum at one tier and not another
 * is still listed: the tier picks the bucket, and the endpoint answers when the
 * combination has no entry.
 *
 * ## What `resolutions` means here
 *
 * "This tier is reachable on this model, at **some** shape it offers" — which
 * is the only true statement a per-field row can make about a provider whose
 * size and shape are one field. `gen4_turbo` reaches 720p at `16:9` and 1080p
 * at `1:1` and neither at the other, because its enum is a list of pairs rather
 * than a grid.
 *
 * Four models have a real `resolution` field instead, and there the row is the
 * plain enum: `hailuo3` (720p → `768P`, which warns, and 1440p → `2K`),
 * `happyhorse_1_0` (720p/1080p) and `grok_imagine_1_5` (480p/720p/1080p).
 *
 * `aleph2` is the exception twice over. It has **no duration parameter at all**
 * (the output follows the input clip) and no resolution field, so both lists
 * are empty and both fields are compile errors rather than params silently
 * dropped — which is what the adapter does with a `resolution` today when a
 * shape is passed beside it. Its shape control is the `targetAspectRatio`
 * extra, not the deprecated `ratio`, so it declares no `ratios` and the wide
 * vocabulary stands.
 *
 * ## Which extras are here, and which are deliberately not
 *
 * A Runway model can serve up to three routes and the unified surface picks one
 * from the *inputs*, so an extra that exists on only one route body would land
 * on the wrong body for a caller who used another. Three are excluded for
 * exactly that: `referenceVideos` (absent from `ImageToVideoParams`), `mode`
 * (video_to_video only, on a model that serves all four routes) and
 * `referenceAudio` **on `grok_imagine_1_5`** (accepted on text_to_video,
 * denied on image_to_video). All three stay on `providerOptions.runway`.
 *
 * What is left is accepted on every route its model serves:
 * `contentModeration` (gen4.5, gen4_turbo, aleph2), `outputFormat` /
 * `proresProfile` (gen4.5 and aleph2 — `gen4_turbo` denies both),
 * `audio` (the veo3.1 pair and the four seedance2 arms) and `referenceAudio`
 * (hailuo3 and the four seedance2 arms).
 */
export const OUTPUT_EXTRAS = {
  outputFormat: EXTRA as "mp4" | "prores" | "png_sequence",
  proresProfile: EXTRA as "422" | "4444" | "422 Proxy" | "422 LT" | "422 HQ" | "4444 XQ",
  contentModeration: EXTRA as RunwayContentModeration,
} as const;

export const SEEDANCE_2_EXTRAS = {
  audio: EXTRA as boolean,
  referenceAudio: EXTRA as RunwayAudioReference[],
} as const;

export const GEN4_RATIOS = ["1:1", "16:9", "9:16", "69:52", "52:69", "33:14"] as const;

export const SEEDANCE_RATIOS = [
  "1:1", "16:9", "9:16", "4:3", "3:4", "21:9",
  "62:27", "54:31", "47:35", "35:47", "31:54",
] as const;

export const SEEDANCE_SMALL_ROW = {
  durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  resolutions: ["480p", "720p", "1080p"],
  ratios: SEEDANCE_RATIOS,
  extras: SEEDANCE_2_EXTRAS,
} as const;

export const VEO_ROW = {
  durations: [4, 6, 8],
  resolutions: ["720p", "1080p"],
  ratios: ["16:9", "9:16"],
  extras: { audio: EXTRA as boolean },
} as const;

export const RUNWAY_VIDEO_MODEL_PARAMS = {
  "gen4.5": {
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p", "1080p"],
    ratios: GEN4_RATIOS,
    extras: OUTPUT_EXTRAS,
  },
  gen4_turbo: {
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p", "1080p"],
    ratios: GEN4_RATIOS,
    extras: { contentModeration: EXTRA as RunwayContentModeration },
  },
  "veo3.1": VEO_ROW,
  "veo3.1_fast": VEO_ROW,
  hailuo3: {
    durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1440p"],
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
    extras: { referenceAudio: EXTRA as RunwayAudioReference[] },
  },
  happyhorse_1_0: {
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1080p"],
    ratios: ["1:1", "16:9", "9:16", "277:208", "208:277"],
  },
  seedance2: {
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480p", "720p", "1080p", "1440p", "4k"],
    ratios: [...SEEDANCE_RATIOS, "1103:473", "1920:823"],
    extras: SEEDANCE_2_EXTRAS,
  },
  seedance2_fast: SEEDANCE_SMALL_ROW,
  seedance2_mini: SEEDANCE_SMALL_ROW,
  seedance2_5: {
    durations: [
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "62:27", "47:35", "35:47", "427:240", "240:427"],
    extras: SEEDANCE_2_EXTRAS,
  },
  grok_imagine_1_5: {
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
  },
  gemini_omni_flash: {
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720p"],
    ratios: ["16:9", "9:16"],
  },
  aleph2: {
    durations: [],
    resolutions: [],
    extras: {
      ...OUTPUT_EXTRAS,
      targetAspectRatio: EXTRA as RunwayTargetAspectRatio,
      keyframes: EXTRA as RunwayVideoKeyframe[],
    },
  },
} as const satisfies VideoModelParamTable;
