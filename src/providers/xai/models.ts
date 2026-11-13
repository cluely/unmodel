// Hand-supplemented — models.dev's xai snapshot (src/catalog/xai.gen.ts)
// tracks four Imagine ids (grok-imagine-image, grok-imagine-video,
// grok-imagine-video-1.5, grok-imagine-video-1.5-lite) but carries no cost for
// any of them, and does not track grok-imagine-image-2.0 or
// grok-imagine-image-quality, which xAI still serves. Refresh from
//   https://docs.x.ai/developers/models                                (model list + Imagine pricing table)
//   https://docs.x.ai/developers/pricing                               (rendered per-resolution Imagine table)
//   https://docs.x.ai/developers/model-capabilities/images/generation  (image endpoints)
//   https://docs.x.ai/developers/model-capabilities/images/editing     (image edit endpoint)
//   https://docs.x.ai/developers/model-capabilities/video/generation   (video endpoints)
//   https://docs.x.ai/developers/model-capabilities/video/overview     (per-model video capability matrix)
// Verified 2026-11-12.
//
// Pricing. Each row's `cost` is the id's DEFAULT-request rate as the
// "Imagine Pricing" table on https://docs.x.ai/developers/models quotes it
// (1k image at the default quality, 480p video):
// - grok-imagine-image:          "$0.02 / image"
// - grok-imagine-image-2.0:      "$0.04 / image"
// - grok-imagine-video:          "$0.050 / sec"
// - grok-imagine-video-1.5:      "$0.080 / sec"
// - grok-imagine-video-1.5-lite: "$0.020 / sec"
// grok-imagine-image-quality is billed at 2.0's low rate (IMAGE_QUALITY_PER_IMAGE_USD).
// The rates that move with `resolution` and `quality` exist only in the
// rendered "Imagine" table on https://docs.x.ai/developers/pricing (its .md
// rendering shows the flat rates above) and live in IMAGE_RATES,
// IMAGE_MEDIUM_RATES, VIDEO_RATES and VIDEO_INPUT_IMAGE_USD below.
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
/**
 * "It reflects the `grok-imagine-image-2.0` low price: $0.04 per 1K image and
 * $0.06 per 2K image, plus $0.01 per input image on edits." —
 * https://docs.x.ai/developers/migration/imagine-image-quality-nov-2 (2026-11-12).
 */
export const IMAGE_QUALITY_PER_IMAGE_USD = 0.04;
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
  // 2.0's modalities and limit. Deprecated: "**Effective November 2, 2026**,
  // the `grok-imagine-image-quality` model slug is retired from the xAI API."
  // (https://docs.x.ai/developers/migration/imagine-image-quality-nov-2,
  // 2026-11-12).
  "grok-imagine-image-quality": {
    ...IMAGINE_BASE,
    id: "grok-imagine-image-quality",
    name: "Grok Imagine Image Quality",
    status: "deprecated",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: IMAGE_QUALITY_PER_IMAGE_USD },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Models the `/v1/videos/*` routes accept. All three ids appear (with distinct
 * per-second rates) on https://docs.x.ai/developers/models; the capability
 * docs' examples all use grok-imagine-video-1.5. Which inputs and routes each
 * id serves is ./video's `VIDEO_TEXT_IMAGE_ONLY_MODELS`,
 * `VIDEO_VOICE_AND_FRAME_MODELS` and `SOURCE_CLIP_MODELS`.
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

/** USD by tier — keyed by the wire's own `resolution` spelling. */
type RatesByResolution = Readonly<Partial<Record<string, number>>>;

/**
 * USD per image by `resolution`, at the quality a request that omits
 * `quality` is billed at — the rendered "Imagine" table on
 * https://docs.x.ai/developers/pricing (2026-11-12):
 * - grok-imagine-image: "1K | $0.02 / img", "2K | $0.02 / img"
 * - grok-imagine-image-2.0: "1K · Low | $0.04 / img", "1.5K · Low | $0.05 / img",
 *   "2K · Low | $0.06 / img"
 * - grok-imagine-image-quality: 2.0's low row — "If you keep sending requests
 *   to the retired slug after November 2, you are billed at the
 *   `grok-imagine-image-2.0` `low` rate."
 *   (https://docs.x.ai/developers/migration/imagine-image-quality-nov-2)
 * A resolution an id has no row for has no published rate and prices nothing.
 *
 * An omitted `quality` on 2.0 is `auto`, and "Auto currently uses `low` for
 * image generation […] Images are billed at the quality they are served at"
 * (https://docs.x.ai/developers/model-capabilities/images/generation). The
 * low row is that documented current behaviour, not a fixed fact — the
 * OpenAPI's pricing-tier schema still reads "Medium is the default quality a
 * request serves at when it leaves `quality` unset" — so `quality: "low"` is
 * the request whose price cannot move.
 */
export const IMAGE_RATES = {
  "grok-imagine-image": { "1k": IMAGE_PER_IMAGE_USD, "2k": 0.02 },
  "grok-imagine-image-2.0": { "1k": IMAGE_2_0_PER_IMAGE_USD, "1.5k": 0.05, "2k": 0.06 },
  "grok-imagine-image-quality": { "1k": IMAGE_QUALITY_PER_IMAGE_USD, "1.5k": 0.05, "2k": 0.06 },
} as const satisfies Record<XaiImageGenerationModelId, RatesByResolution>;

/**
 * USD per image at `quality: "medium"` — "1K · Medium | $0.06 / img",
 * "1.5K · Medium | $0.07 / img", "2K · Medium | $0.08 / img" (same table).
 * 2.0 only: "The parameter is only supported for `grok-imagine-image-2.0`."
 * (https://docs.x.ai/developers/model-capabilities/images/generation)
 */
export const IMAGE_MEDIUM_RATES: Readonly<Partial<Record<string, RatesByResolution>>> = {
  "grok-imagine-image-2.0": { "1k": 0.06, "1.5k": 0.07, "2k": 0.08 },
};

/**
 * USD per second of generated video by `resolution` — the rendered "Imagine"
 * table on https://docs.x.ai/developers/pricing (2026-11-12). The 480p rate
 * is each row's `perVideoSecond` and the wire default ("| `480p` | Standard
 * definition, faster processing (default) |" —
 * https://docs.x.ai/developers/model-capabilities/video/generation).
 * - grok-imagine-video: "480p | $0.05 / sec", "720p | $0.07 / sec"; no 1080p
 *   ("`grok-imagine-video` supports up to 720p.")
 * - grok-imagine-video-1.5: "480p | $0.08 / sec", "720p | $0.14 / sec",
 *   "1080p | $0.25 / sec"
 * - grok-imagine-video-1.5-lite: "480p | $0.02 / sec", "720p | $0.03 / sec",
 *   "1080p | $0.14 / sec"
 * A resolution an id has no rate for prices nothing.
 */
export const VIDEO_RATES = {
  "grok-imagine-video": { "480p": VIDEO_PER_SECOND_USD, "720p": 0.07 },
  "grok-imagine-video-1.5": { "480p": VIDEO_1_5_PER_SECOND_USD, "720p": 0.14, "1080p": 0.25 },
  "grok-imagine-video-1.5-lite": {
    "480p": VIDEO_1_5_LITE_PER_SECOND_USD,
    "720p": 0.03,
    "1080p": 0.14,
  },
} as const satisfies Record<XaiVideoGenerationModelId, RatesByResolution>;

/**
 * USD per input image on POST /v1/videos/generations — `image` and each
 * `reference_images` entry — from the same table's input column:
 * "grok-imagine-video Text, Image, Video → Video | $0.01 / sec $0.002 / img",
 * "grok-imagine-video-1.5 Text, Image, Audio → Video | $0.01 / img",
 * "grok-imagine-video-1.5-lite Text, Image → Video | $0.01 / img".
 * grok-imagine-video's "$0.01 / sec" is its input-video rate on the edit and
 * extension routes, whose clip length the request does not carry.
 */
export const VIDEO_INPUT_IMAGE_USD = {
  "grok-imagine-video": 0.002,
  "grok-imagine-video-1.5": 0.01,
  "grok-imagine-video-1.5-lite": 0.01,
} as const satisfies Record<XaiVideoGenerationModelId, number>;

/**
 * Documented request aliases, each mapped to the row it serves: "Alias ID(s)
 * of the model that user can use in a request's model field."
 * (https://docs.x.ai/openapi.json). "- **Aliases:**
 * `grok-imagine-image-2026-03-02`"
 * (https://docs.x.ai/developers/models/grok-imagine-image, 2026-11-12).
 */
export const IMAGE_MODEL_ALIASES = {
  "grok-imagine-image-2026-03-02": "grok-imagine-image",
} as const satisfies Record<string, XaiImageGenerationModelId>;

/**
 * As {@link IMAGE_MODEL_ALIASES}: "- **Aliases:** `grok-imagine-video-1.5-preview`,
 * `grok-imagine-video-1.5-2026-05-30`"
 * (https://docs.x.ai/developers/models/grok-imagine-video-1.5, 2026-11-12).
 */
export const VIDEO_MODEL_ALIASES = {
  "grok-imagine-video-1.5-preview": "grok-imagine-video-1.5",
  "grok-imagine-video-1.5-2026-05-30": "grok-imagine-video-1.5",
} as const satisfies Record<string, XaiVideoGenerationModelId>;

/** Runtime allow-list backing the image endpoint's model gate (plus {@link IMAGE_MODEL_ALIASES}). */
export const IMAGE_MODEL_IDS: readonly string[] = Object.keys(imageModels);
/** Runtime allow-list backing the video endpoints' model gate (plus {@link VIDEO_MODEL_ALIASES}). */
export const VIDEO_MODEL_IDS: readonly string[] = Object.keys(videoModels);
