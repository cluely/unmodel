// Hand-maintained — Krea is not in models.dev; refresh from
//   https://api.krea.ai/openapi.json                          (routes + request schemas; ground truth)
//   https://www.krea.ai/docs/api-reference/krea/krea-2-medium (per-variant billing tiers)
//   https://www.krea.ai/docs/api-reference/krea/krea-2-large
//   https://www.krea.ai/docs/api-reference/krea/krea-2-medium-turbo
//   https://www.krea.ai/docs/developers/krea-2/overview       (pricing table + parameter notes)
//   https://www.krea.ai/docs/llms.txt                         (docs index)
// Verified 2026-08-13.
//
// Catalog modeling: the Krea API has no `model` body field — the model IS the
// route (`POST https://api.krea.ai/generate/image/krea/krea-2/{variant}`), so
// each id below is the route tail after `/generate/image/krea/` and doubles as
// the URL segment. The three Krea 2 variants share one request schema; only
// price differs.
//
// Pricing (USD per generated image, "Fixed API prices in USD" on each model's
// API-reference page). Krea bills a request at ONE of three tiers:
//   tier            medium    large     medium-turbo
//   text to image   $0.030    $0.060    $0.0150
//   style refs      $0.035    $0.065    $0.0175
//   moodboards      $0.040    $0.070    $0.0200
// "Combining moodboards with style references does not increase the price per
// generation — you pay the moodboard rate" (developers/krea-2/overview), so the
// moodboard rate wins when both are present. `cost.perImage` records the
// text-to-image base rate; KREA_BILLING_TIERS carries all three so the
// validator can price the request it actually sees. Trained styles (`styles`,
// the LoRA array) have no published surcharge — they bill at the base rate.
//
// NOT modeled here: Krea also proxies ~50 third-party image/video/3D models
// (`/generate/image/{vendor}/{model}`, e.g. bfl/flux-1.1-pro, google/imagen-4).
// Those belong to their own providers' catalogs, and their Krea routes have
// their own per-vendor request schemas.
//
// Krea 1 (artificialanalysis lists it as a Krea model) has no route in
// https://api.krea.ai/openapi.json and therefore no catalog row.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "krea",
  name: "Krea",
  env: ["KREA_API_KEY", "KREA_API_TOKEN"],
  doc: "https://www.krea.ai/docs/developers/introduction",
} as const satisfies ProviderInfo;

const base = {
  // `image_url` (image-to-image) and `image_style_references` accept images.
  attachment: true,
  reasoning: false,
  toolCall: false,
  // The hosted API is closed; the Krea 2 RAW/Turbo checkpoints published on
  // Hugging Face are a separate open-source release, not these routes.
  openWeights: false,
  modalities: { input: ["text", "image"], output: ["image"] },
} as const;

export const models = {
  "krea-2/medium": {
    ...base,
    id: "krea-2/medium",
    name: "Krea 2 Medium",
    family: "krea-2",
    limit: { context: 0 },
    cost: { perImage: 0.03 },
  },
  "krea-2/large": {
    ...base,
    id: "krea-2/large",
    name: "Krea 2 Large",
    family: "krea-2",
    limit: { context: 0 },
    cost: { perImage: 0.06 },
  },
  "krea-2/medium-turbo": {
    ...base,
    id: "krea-2/medium-turbo",
    name: "Krea 2 Medium Turbo",
    family: "krea-2",
    limit: { context: 0 },
    cost: { perImage: 0.015 },
  },
} as const satisfies Record<string, ModelInfo>;

export type KreaModelId = keyof typeof models;

/** The three billable tiers of a Krea 2 generation, in USD per image. */
export interface KreaBillingTiers {
  /** Prompt only (plus trained `styles`, seed, sliders, image-to-image). */
  textToImage: number;
  /** At least one `image_style_references` entry. */
  styleReferences: number;
  /** At least one `moodboards` entry (wins over style references). */
  moodboards: number;
}

/**
 * Per-variant billing tiers — https://www.krea.ai/docs/developers/krea-2/overview
 * ("Pricing") and each variant's API-reference page ("K2 Billing Tier").
 */
export const KREA_BILLING_TIERS: Readonly<Record<KreaModelId, KreaBillingTiers>> = {
  "krea-2/medium": { textToImage: 0.03, styleReferences: 0.035, moodboards: 0.04 },
  "krea-2/large": { textToImage: 0.06, styleReferences: 0.065, moodboards: 0.07 },
  "krea-2/medium-turbo": { textToImage: 0.015, styleReferences: 0.0175, moodboards: 0.02 },
};
