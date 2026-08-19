// Hand-maintained — the Sora video models are not in models.dev; refresh from
//   https://developers.openai.com/api/docs/api-reference/videos/create (model ids, size/seconds enums)
//   https://developers.openai.com/api/docs/guides/video-generation        (per-model resolution guidance)
//   https://developers.openai.com/api/docs/pricing                        (per-second video rates)
// Verified 2026-08-13 (cross-checked against the OpenAPI-generated
// openai@7.4.0 `resources/videos.d.ts` types).
//
// Pricing (standard tier, USD per second of generated video):
// - sora-2:      $0.10 at 720p (720x1280 / 1280x720) — the only documented tier.
// - sora-2-pro:  $0.30 at 720p, $0.50 at 1024p (1024x1792 / 1792x1024),
//                $0.70 at 1080p (1920x1080 / 1080x1920).
// `ModelCost.perVideoSecond` is a single number, so it carries the base 720p
// rate; the full per-resolution table lives in `SORA_RATE_PER_SECOND` below
// and drives the cost estimate in videos.ts. Batch-tier rates (half price)
// are not modeled — unmodel validates the direct endpoint.
// Dated snapshots bill at their family's rate (the pricing page lists rates
// per family, "Sora-2" / "Sora-2-Pro", not per snapshot).

import type { ModelInfo } from "../../core/catalog-types";

/** $/second at 720p — https://developers.openai.com/api/docs/pricing */
const SORA_2_PER_VIDEO_SECOND = 0.1;
/** $/second at 720p — https://developers.openai.com/api/docs/pricing */
const SORA_2_PRO_PER_VIDEO_SECOND = 0.3;

const SORA_2_BASE = {
  family: "sora",
  // input_reference accepts an image (jpeg/png/webp) used as the first frame.
  attachment: true,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text", "image"], output: ["video"] },
  // Video generation is not token-based; context 0 skips context checks.
  limit: { context: 0 },
  cost: { perVideoSecond: SORA_2_PER_VIDEO_SECOND },
} as const;

const SORA_2_PRO_BASE = {
  ...SORA_2_BASE,
  cost: { perVideoSecond: SORA_2_PRO_PER_VIDEO_SECOND },
} as const;

/**
 * The five model ids POST /v1/videos documents (create API reference /
 * openai@7.4.0 `VideoModel`): the `sora-2` and `sora-2-pro` aliases plus
 * their dated snapshots. Release dates are derived from the snapshot ids.
 */
export const SORA_MODELS = {
  "sora-2": { ...SORA_2_BASE, id: "sora-2", name: "Sora 2" },
  "sora-2-2025-10-06": {
    ...SORA_2_BASE,
    id: "sora-2-2025-10-06",
    name: "Sora 2 (2025-10-06)",
    releaseDate: "2025-10-06",
  },
  "sora-2-2025-12-08": {
    ...SORA_2_BASE,
    id: "sora-2-2025-12-08",
    name: "Sora 2 (2025-12-08)",
    releaseDate: "2025-12-08",
  },
  "sora-2-pro": { ...SORA_2_PRO_BASE, id: "sora-2-pro", name: "Sora 2 Pro" },
  "sora-2-pro-2025-10-06": {
    ...SORA_2_PRO_BASE,
    id: "sora-2-pro-2025-10-06",
    name: "Sora 2 Pro (2025-10-06)",
    releaseDate: "2025-10-06",
  },
} as const satisfies Record<string, ModelInfo>;

export type SoraModelId = keyof typeof SORA_MODELS;

const SORA_2_RATES: Readonly<Record<string, number>> = {
  "720x1280": SORA_2_PER_VIDEO_SECOND,
  "1280x720": SORA_2_PER_VIDEO_SECOND,
};

const SORA_2_PRO_RATES: Readonly<Record<string, number>> = {
  "720x1280": SORA_2_PRO_PER_VIDEO_SECOND,
  "1280x720": SORA_2_PRO_PER_VIDEO_SECOND,
  "1024x1792": 0.5,
  "1792x1024": 0.5,
  "1920x1080": 0.7,
  "1080x1920": 0.7,
};

/**
 * USD per second of generated video, by model id and `size` — standard tier
 * from https://developers.openai.com/api/docs/pricing (verified 2026-08-13).
 */
export const SORA_RATE_PER_SECOND: Readonly<
  Record<SoraModelId, Readonly<Record<string, number>>>
> = {
  "sora-2": SORA_2_RATES,
  "sora-2-2025-10-06": SORA_2_RATES,
  "sora-2-2025-12-08": SORA_2_RATES,
  "sora-2-pro": SORA_2_PRO_RATES,
  "sora-2-pro-2025-10-06": SORA_2_PRO_RATES,
};
