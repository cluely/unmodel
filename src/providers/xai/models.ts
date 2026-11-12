// Hand-supplemented — models.dev's xai snapshot (src/catalog/xai.gen.ts)
// tracks four Imagine ids (grok-imagine-image, grok-imagine-video,
// grok-imagine-video-1.5, grok-imagine-video-1.5-lite) but carries no cost for
// any of them, and does not track grok-imagine-image-2.0 or
// grok-imagine-image-quality, which xAI still serves. Refresh from
//   https://docs.x.ai/developers/models                                (model list + Imagine pricing table)
//   https://docs.x.ai/developers/model-capabilities/images/generation  (image endpoints)
//   https://docs.x.ai/developers/model-capabilities/images/editing     (image edit endpoint)
//   https://docs.x.ai/developers/model-capabilities/video/generation   (video endpoints)
//   https://docs.x.ai/developers/model-capabilities/video/overview     (per-model video capability matrix)
// Verified 2026-11-12.
//
// Pricing (the "Imagine Pricing" table on https://docs.x.ai/developers/models,
// quoted verbatim — flat per-image / per-second rates, no arithmetic needed):
// - grok-imagine-image:          "$0.02 / image"
// - grok-imagine-image-2.0:      "$0.04 / image"
// - grok-imagine-video:          "$0.050 / sec"
// - grok-imagine-video-1.5:      "$0.080 / sec"
// - grok-imagine-video-1.5-lite: "$0.020 / sec"
// grok-imagine-image-quality's rate is IMAGE_QUALITY_PER_IMAGE_USD below.
//
// The four snapshot-tracked rows are MIRRORED by hand rather than imported:
// pulling `src/catalog/xai.gen.ts` in here would put the generated chat
// catalog inside the `unmodel/image` and `unmodel/video` packs, whose catalog
// graphs are pinned in test/bundle-budget.test.ts (same trade as
// google/tts-models.ts). Cross-check the mirrored fields against the
// generated file on each codegen refresh; if models.dev ever grows real cost
// data for these ids, reconcile the rates here. `models.test.ts` makes that
// cross-check mechanical. The two hand-only rows follow HAND_CATALOGS.md:
// `limit.context: 0` because they are not token-context models, and each
// cites the page that keeps it reachable.

import type { ModelInfo } from "../../core/catalog-types";

/** Shared shape of the Imagine rows. */
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
/** "| grok-imagine-video-1.5-lite | $0.020 / sec |" — https://docs.x.ai/developers/models (2026-11-12). */
export const VIDEO_1_5_LITE_PER_SECOND_USD = 0.02;

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
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 16000, output: 0 },
    cost: { perImage: IMAGE_PER_IMAGE_USD },
  },
  // Hand-only. "Images: Grok Imagine Image 2.0" is the models page's image
  // pick, priced "| grok-imagine-image-2.0 | $0.04 / image |"
  // (https://docs.x.ai/developers/models), and its model page reads
  // "- **Modalities:** text, image → image"
  // (https://docs.x.ai/developers/models/grok-imagine-image-2.0), both
  // 2026-11-12. No prompt limit is published (`max_prompt_length` sits behind
  // the key-gated GET /v1/image-generation-models/{model_id}), so `context`
  // is the HAND_CATALOGS 0. Text-to-image here; the same id also drives
  // POST /v1/images/edits.
  "grok-imagine-image-2.0": {
    ...IMAGINE_BASE,
    id: "grok-imagine-image-2.0",
    name: "Grok Imagine Image 2.0",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: IMAGE_2_0_PER_IMAGE_USD },
  },
  // Hand-only. "The slug continues to resolve, so you do not need to change
  // your code to avoid breakage", and requests to it "are served by
  // `grok-imagine-image-2.0` with `quality` set to `low`" — so the row takes
  // 2.0's modalities and limit
  // (https://docs.x.ai/developers/migration/imagine-image-quality-nov-2,
  // 2026-11-12).
  "grok-imagine-image-quality": {
    ...IMAGINE_BASE,
    id: "grok-imagine-image-quality",
    name: "Grok Imagine Image Quality",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: IMAGE_QUALITY_PER_IMAGE_USD },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Models the `/v1/videos/*` routes accept. All three ids appear (with distinct
 * per-second rates) on https://docs.x.ai/developers/models; the capability
 * docs' examples all use grok-imagine-video-1.5. Which routes each id serves
 * is ./video's `VIDEO_TEXT_IMAGE_ONLY_MODELS`.
 */
export const videoModels = {
  "grok-imagine-video": {
    ...IMAGINE_BASE,
    id: "grok-imagine-video",
    name: "Grok Imagine Video",
    releaseDate: "2026-01-28",
    lastUpdated: "2026-01-28",
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 1024, output: 0 },
    cost: { perVideoSecond: VIDEO_PER_SECOND_USD },
  },
  "grok-imagine-video-1.5": {
    ...IMAGINE_BASE,
    id: "grok-imagine-video-1.5",
    name: "Grok Imagine Video 1.5",
    releaseDate: "2026-05-30",
    lastUpdated: "2026-05-30",
    modalities: { input: ["text", "image", "audio"], output: ["video"] },
    limit: { context: 1024, output: 0 },
    cost: { perVideoSecond: VIDEO_1_5_PER_SECOND_USD },
  },
  // "For simple videos, we recommend `grok-imagine-video-1.5-lite`, the lowest
  // price per second."
  // (https://docs.x.ai/developers/model-capabilities/video/generation,
  // 2026-11-12). The dates are models.dev's: xAI's release notes do not date
  // this id.
  "grok-imagine-video-1.5-lite": {
    ...IMAGINE_BASE,
    id: "grok-imagine-video-1.5-lite",
    name: "Grok Imagine Video 1.5 Lite",
    releaseDate: "2026-10-01",
    lastUpdated: "2026-10-01",
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 1024, output: 0 },
    cost: { perVideoSecond: VIDEO_1_5_LITE_PER_SECOND_USD },
  },
} as const satisfies Record<string, ModelInfo>;

export type XaiImageGenerationModelId = keyof typeof imageModels;
export type XaiVideoGenerationModelId = keyof typeof videoModels;

/** Runtime allow-list backing the image endpoint's model gate. */
export const IMAGE_MODEL_IDS: readonly string[] = Object.keys(imageModels);
/** Runtime allow-list backing the video endpoints' model gate. */
export const VIDEO_MODEL_IDS: readonly string[] = Object.keys(videoModels);
