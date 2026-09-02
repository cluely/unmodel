// Hand-supplemented — models.dev's xai snapshot (src/catalog/xai.gen.ts)
// tracks all five Imagine ids (grok-imagine-image, grok-imagine-image-2.0,
// grok-imagine-image-quality, grok-imagine-video, grok-imagine-video-1.5) but
// carries no cost for any of them. Refresh from
//   https://docs.x.ai/developers/models                                (model list + Imagine pricing table)
//   https://docs.x.ai/developers/model-capabilities/images/generation  (image endpoints)
//   https://docs.x.ai/developers/model-capabilities/images/editing     (image edit endpoint)
//   https://docs.x.ai/developers/model-capabilities/video/generation   (video endpoints)
// Verified 2026-09-02.
//
// Pricing (the "Imagine Pricing" table on https://docs.x.ai/developers/models,
// quoted verbatim — flat per-image / per-second rates, no arithmetic needed):
// - grok-imagine-image:         "$0.02 / image"
// - grok-imagine-image-2.0:     "$0.04 / image"
// - grok-imagine-image-quality: "$0.05 / image"
// - grok-imagine-video:         "$0.050 / sec"
// - grok-imagine-video-1.5:     "$0.080 / sec"
// The docs page lists these as five separate models with five separate rates —
// none is documented as an alias of another.
//
// All five rows are MIRRORED by hand rather than imported: pulling
// `src/catalog/xai.gen.ts` in here would put the generated chat catalog inside
// the `unmodel/image` and `unmodel/video` packs, whose catalog graphs are
// pinned in test/bundle-budget.test.ts (same trade as google/tts-models.ts).
// Cross-check the mirrored fields against the generated file on each codegen
// refresh; if models.dev ever grows real cost data for these ids, reconcile
// the rates here. `models.test.ts` makes that cross-check mechanical.

import type { ModelInfo } from "../../core/catalog-types";

/** Shared shape of the mirrored snapshot rows. */
const IMAGINE_BASE = {
  family: "grok",
  attachment: true,
  reasoning: false,
  toolCall: false,
  temperature: false,
  openWeights: false,
} as const;

/** "$0.02 / image" — https://docs.x.ai/developers/models. */
export const IMAGE_PER_IMAGE_USD = 0.02;
/** "$0.04 / image" — https://docs.x.ai/developers/models. */
export const IMAGE_2_0_PER_IMAGE_USD = 0.04;
/** "$0.05 / image" — https://docs.x.ai/developers/models. */
export const IMAGE_QUALITY_PER_IMAGE_USD = 0.05;
/** "$0.050 / sec" — https://docs.x.ai/developers/models. */
export const VIDEO_PER_SECOND_USD = 0.05;
/** "$0.080 / sec" — https://docs.x.ai/developers/models. */
export const VIDEO_1_5_PER_SECOND_USD = 0.08;

/**
 * Models `POST /v1/images/generations` accepts — the three ids in the models
 * page's image section. Route-scoped: the video ids are not valid here and
 * warn as unknown_model.
 */
export const imageModels = {
  "grok-imagine-image": {
    ...IMAGINE_BASE,
    id: "grok-imagine-image",
    name: "Grok Imagine Image",
    releaseDate: "2026-01-28",
    lastUpdated: "2026-01-28",
    modalities: { input: ["text", "image", "pdf"], output: ["image", "pdf"] },
    limit: { context: 8000, output: 0 },
    cost: { perImage: IMAGE_PER_IMAGE_USD },
  },
  // Text-to-image here; the same id also drives POST /v1/images/edits.
  "grok-imagine-image-2.0": {
    ...IMAGINE_BASE,
    id: "grok-imagine-image-2.0",
    name: "Grok Imagine Image 2.0",
    releaseDate: "2026-08-07",
    lastUpdated: "2026-08-07",
    modalities: { input: ["text", "image", "pdf"], output: ["image", "pdf"] },
    limit: { context: 8000, output: 0 },
    cost: { perImage: IMAGE_2_0_PER_IMAGE_USD },
  },
  "grok-imagine-image-quality": {
    ...IMAGINE_BASE,
    id: "grok-imagine-image-quality",
    name: "Grok Imagine Image Quality",
    releaseDate: "2026-04-03",
    lastUpdated: "2026-04-03",
    modalities: { input: ["text", "image", "pdf"], output: ["image", "pdf"] },
    limit: { context: 8000, output: 0 },
    cost: { perImage: IMAGE_QUALITY_PER_IMAGE_USD },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Models the `/v1/videos/*` routes accept. Both ids appear (with distinct
 * per-second rates) on https://docs.x.ai/developers/models; the capability
 * docs' examples all use grok-imagine-video-1.5.
 */
export const videoModels = {
  "grok-imagine-video": {
    ...IMAGINE_BASE,
    id: "grok-imagine-video",
    name: "Grok Imagine Video",
    releaseDate: "2026-01-28",
    lastUpdated: "2026-01-28",
    modalities: { input: ["text", "image", "video", "pdf"], output: ["video"] },
    limit: { context: 1024, output: 0 },
    cost: { perVideoSecond: VIDEO_PER_SECOND_USD },
  },
  "grok-imagine-video-1.5": {
    ...IMAGINE_BASE,
    id: "grok-imagine-video-1.5",
    name: "Grok Imagine Video 1.5",
    releaseDate: "2026-05-30",
    lastUpdated: "2026-05-30",
    modalities: { input: ["text", "image", "audio", "pdf"], output: ["video"] },
    limit: { context: 1024, output: 0 },
    cost: { perVideoSecond: VIDEO_1_5_PER_SECOND_USD },
  },
} as const satisfies Record<string, ModelInfo>;

export type XaiImageGenerationModelId = keyof typeof imageModels;
export type XaiVideoGenerationModelId = keyof typeof videoModels;

/** Runtime allow-list backing the image endpoint's model gate. */
export const IMAGE_MODEL_IDS: readonly string[] = Object.keys(imageModels);
/** Runtime allow-list backing the video endpoints' model gate. */
export const VIDEO_MODEL_IDS: readonly string[] = Object.keys(videoModels);
