// Hand-maintained — Reve is not in models.dev; refresh from
//   https://api.reve.com/console/docs    (endpoints, params, version strings)
//   https://api.reve.com/console/pricing (credit prices per route + top-up rate)
// Verified 2026-08-13.
//
// Catalog modeling: Reve selects the model with a `version` string, not a
// `model` field, and each route (create / edit / remix / v2 create) has its own
// short list of accepted version strings plus its own credit price. Each
// documented version string is therefore a catalog row, and the validators map
// the moving aliases (`latest`, `latest-fast`) onto the dated row they resolve
// to today so pricing and metadata stay exact. Pin the dated string in
// production — `latest` moves when Reve ships a new model.
//
// Pricing: the console's pricing page quotes credits per operation plus a
// dollar approximation, and states the top-up rate ("The minimum purchase is
// $10 of credits (7,500 credits)"), i.e. 1 credit = $10/7500 ≈ $0.001333.
// Every row's `cost.perImage` is credits × that rate, which reproduces the
// page's own dollar figures:
//   v1 Create              18 credits  ≈ $0.024
//   v1 Edit / Remix        30 credits  ≈ $0.04
//   v1 Edit / Remix Fast    5 credits  ≈ $0.007
//   v2 Create             150 credits  ≈ $0.20
// `test_time_scaling` multiplies the base cost; postprocessing (upscale,
// remove_background, effect) adds output-size-dependent cost that cannot be
// known before generation — the response's `credits_used` is authoritative.
//
// artificialanalysis mapping: "Reve 2.1" (T2I #2 / Editing #1, $200/1k images)
// is the v2 Create route — 150 credits = $0.20/image; Reve publishes no model
// id for it, so the row below carries the pseudo-id `reve-v2-create` (the v2
// route's only documented `version` alias is "latest"). "Reve Image
// (Halfmoon)" has no API surface at all.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";
import { reveCreditsToUSD } from "./shared";

export const provider = {
  id: "reve",
  name: "Reve",
  env: ["REVE_API_KEY"],
  doc: "https://api.reve.com/console/docs",
} as const satisfies ProviderInfo;

const base = {
  reasoning: false,
  toolCall: false,
  openWeights: false,
} as const;

const textOnly = {
  ...base,
  attachment: false,
  modalities: { input: ["text"], output: ["image"] },
} as const;

const withImages = {
  ...base,
  attachment: true,
  modalities: { input: ["text", "image"], output: ["image"] },
} as const;

export const models = {
  "reve-create@20250915": {
    ...textOnly,
    id: "reve-create@20250915",
    name: "Reve Create (v1)",
    family: "reve-v1",
    limit: { context: 0 },
    // 18 credits — https://api.reve.com/console/pricing ("Create").
    cost: { perImage: reveCreditsToUSD(18) },
  },
  "reve-edit@20250915": {
    ...withImages,
    id: "reve-edit@20250915",
    name: "Reve Edit (v1)",
    family: "reve-v1",
    limit: { context: 0 },
    // 30 credits — pricing page ("Edit").
    cost: { perImage: reveCreditsToUSD(30) },
  },
  "reve-edit-fast@20251030": {
    ...withImages,
    id: "reve-edit-fast@20251030",
    name: "Reve Edit Fast (v1)",
    family: "reve-v1",
    limit: { context: 0 },
    // 5 credits — pricing page ("Edit Fast").
    cost: { perImage: reveCreditsToUSD(5) },
  },
  "reve-remix@20250915": {
    ...withImages,
    id: "reve-remix@20250915",
    name: "Reve Remix (v1)",
    family: "reve-v1",
    limit: { context: 0 },
    // 30 credits — pricing page ("Remix").
    cost: { perImage: reveCreditsToUSD(30) },
  },
  "reve-remix-fast@20251030": {
    ...withImages,
    id: "reve-remix-fast@20251030",
    name: "Reve Remix Fast (v1)",
    family: "reve-v1",
    limit: { context: 0 },
    // 5 credits — pricing page ("Remix Fast").
    cost: { perImage: reveCreditsToUSD(5) },
  },
  "reve-v2-create": {
    ...withImages,
    id: "reve-v2-create",
    name: "Reve v2 Create",
    family: "reve-v2",
    limit: { context: 0 },
    // 150 credits — pricing page ("v2 Create"), quoted "~$0.20".
    cost: { perImage: reveCreditsToUSD(150) },
  },
} as const satisfies Record<string, ModelInfo>;

export type ReveModelId = keyof typeof models;

/** `version` strings `POST /v1/image/create` accepts. */
export const REVE_CREATE_VERSIONS = ["latest", "reve-create@20250915"] as const;
export type ReveCreateVersion = (typeof REVE_CREATE_VERSIONS)[number];

/** `version` strings `POST /v1/image/edit` accepts. */
export const REVE_EDIT_VERSIONS = [
  "latest-fast",
  "latest",
  "reve-edit-fast@20251030",
  "reve-edit@20250915",
] as const;
export type ReveEditVersion = (typeof REVE_EDIT_VERSIONS)[number];

/** `version` strings `POST /v1/image/remix` accepts. */
export const REVE_REMIX_VERSIONS = [
  "latest-fast",
  "latest",
  "reve-remix-fast@20251030",
  "reve-remix@20250915",
] as const;
export type ReveRemixVersion = (typeof REVE_REMIX_VERSIONS)[number];

/** `version` aliases `POST /v2/image/create` documents ("An optional public model version alias"). */
export const REVE_V2_CREATE_VERSIONS = ["latest"] as const;
export type ReveV2CreateVersion = (typeof REVE_V2_CREATE_VERSIONS)[number];

/**
 * Resolves a route's `version` (including the moving `latest` / `latest-fast`
 * aliases) to the catalog row it bills as today. An unknown string is returned
 * unchanged so the pipeline reports `unknown_model` instead of mispricing.
 */
export function resolveReveVersion(
  route: "create" | "edit" | "remix" | "v2-create",
  version: string | undefined,
): string {
  if (route === "v2-create") {
    return version === undefined || version === "latest" ? "reve-v2-create" : version;
  }
  if (route === "create") {
    return version === undefined || version === "latest" ? "reve-create@20250915" : version;
  }
  const fast = route === "edit" ? "reve-edit-fast@20251030" : "reve-remix-fast@20251030";
  const standard = route === "edit" ? "reve-edit@20250915" : "reve-remix@20250915";
  if (version === undefined || version === "latest") return standard;
  if (version === "latest-fast") return fast;
  return version;
}
