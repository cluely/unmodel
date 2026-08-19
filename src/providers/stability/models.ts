// Hand-maintained — Stability AI is not in models.dev; refresh from
//   https://api.stability.ai/v2alpha/openapi           (MACHINE-READABLE ground
//     truth: despite the /v2alpha path this URL serves the v2beta REST spec,
//     stable-image generate/edit/control/upscale routes included. It is the
//     spec the rendered reference SPA loads — see VITE_REST_API_SPEC_URL in
//     https://platform.stability.ai/assets/index-*.js)
//   https://platform.stability.ai/docs/api-reference   (rendered reference)
//   https://platform.stability.ai/pricing              (credit rates; "1 credit = $0.01")
// Verified 2026-08-13.
//
// Pricing conversions (documented so the arithmetic never rots unexplained):
// - Stability bills flat credits per successful generation; failed
//   generations are not charged. Every route's spec description states its
//   flat credit cost under a "### Credits" heading. 1 credit = $0.01
//   (platform pricing page), so cost.perImage = credits × $0.01:
//     Stable Image Ultra          8   credits → $0.08
//     Stable Image Core           3   credits → $0.03
//     sd3.5-large                 6.5 credits → $0.065
//     sd3.5-large-turbo           4   credits → $0.04
//     sd3.5-medium                3.5 credits → $0.035
//     sd3.5-flash                 2.5 credits → $0.025
//     edit/erase                  5   credits → $0.05
//     edit/inpaint                5   credits → $0.05
//     edit/outpaint               4   credits → $0.04
//     edit/search-and-replace     5   credits → $0.05
//     edit/search-and-recolor     5   credits → $0.05
//     edit/remove-background      5   credits → $0.05
// - The ultra/core routes and every edit route have no `model` wire field —
//   the route is the model. Their catalog ids ("stable-image-ultra",
//   "stable-image-inpaint", …) are unmodel-internal handles for those routes.
// - As of 2025-04-17 the sd3-large / sd3-large-turbo / sd3-medium ids are
//   deprecated and re-routed server-side to their sd3.5 equivalents "at the
//   same price" (API release notes) — kept here as deprecated entries.
// - The Stable Audio ids carry NO `cost`: their billing unit is flat credits
//   per successful GENERATION of audio, which `ModelCost` cannot express
//   (`perImage` is images, `perAudioMinute` is per minute — Stable Audio is
//   neither: a 10-second and a 190-second track cost the same). The rates are
//   real and documented, so ./audio exports the arithmetic
//   (`stableAudioCredits` / `STABILITY_USD_PER_CREDIT`) and its validators
//   still produce an exact `estimate.costUSD`:
//     stable-audio-2      17 + 0.06 x steps credits (50 steps → 20 → $0.20)
//     stable-audio-2.5    20 credits flat → $0.20
//     stable-audio-3      26 credits flat → $0.26

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "stability",
  name: "Stability AI",
  env: ["STABILITY_API_KEY"],
  doc: "https://platform.stability.ai/docs/api-reference",
} as const satisfies ProviderInfo;

/** 1 credit = $0.01 — https://platform.stability.ai/pricing */
const USD_PER_CREDIT = 0.01;

const routeModels = {
  "stable-image-ultra": {
    id: "stable-image-ultra",
    name: "Stable Image Ultra",
    family: "stable-image",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 8 credits per successful generation.
    cost: { perImage: 8 * USD_PER_CREDIT },
  },
  "stable-image-core": {
    id: "stable-image-core",
    name: "Stable Image Core",
    family: "stable-image",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["image"] },
    limit: { context: 0 },
    // 3 credits per successful generation.
    cost: { perImage: 3 * USD_PER_CREDIT },
  },
} as const satisfies Record<string, ModelInfo>;

const sd3Models = {
  "sd3.5-large": {
    id: "sd3.5-large",
    name: "Stable Diffusion 3.5 Large",
    family: "sd3",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 6.5 credits per successful generation.
    cost: { perImage: 6.5 * USD_PER_CREDIT },
  },
  "sd3.5-large-turbo": {
    id: "sd3.5-large-turbo",
    name: "Stable Diffusion 3.5 Large Turbo",
    family: "sd3",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 4 credits per successful generation.
    cost: { perImage: 4 * USD_PER_CREDIT },
  },
  "sd3.5-medium": {
    id: "sd3.5-medium",
    name: "Stable Diffusion 3.5 Medium",
    family: "sd3",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 3.5 credits per successful generation.
    cost: { perImage: 3.5 * USD_PER_CREDIT },
  },
  "sd3.5-flash": {
    id: "sd3.5-flash",
    name: "Stable Diffusion 3.5 Flash",
    family: "sd3",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 2.5 credits per successful generation.
    cost: { perImage: 2.5 * USD_PER_CREDIT },
  },
} as const satisfies Record<string, ModelInfo>;

/** Deprecated SD3.0 ids — re-routed to sd3.5 equivalents at the same price. */
const sd3DeprecatedModels = {
  "sd3-large": {
    id: "sd3-large",
    name: "Stable Diffusion 3 Large",
    family: "sd3",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    status: "deprecated",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: 6.5 * USD_PER_CREDIT },
  },
  "sd3-large-turbo": {
    id: "sd3-large-turbo",
    name: "Stable Diffusion 3 Large Turbo",
    family: "sd3",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    status: "deprecated",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: 4 * USD_PER_CREDIT },
  },
  "sd3-medium": {
    id: "sd3-medium",
    name: "Stable Diffusion 3 Medium",
    family: "sd3",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    status: "deprecated",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: 3.5 * USD_PER_CREDIT },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * v2beta stable-image EDIT routes. Like ultra/core these have no `model` wire
 * field — the route is the model — so each id below is an unmodel-internal
 * handle for `POST /v2beta/stable-image/edit/{route}`.
 */
const editModels = {
  "stable-image-erase": {
    id: "stable-image-erase",
    name: "Stable Image Erase",
    family: "stable-image-edit",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per successful generation.
    cost: { perImage: 5 * USD_PER_CREDIT },
  },
  "stable-image-inpaint": {
    id: "stable-image-inpaint",
    name: "Stable Image Inpaint",
    family: "stable-image-edit",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per successful generation.
    cost: { perImage: 5 * USD_PER_CREDIT },
  },
  "stable-image-outpaint": {
    id: "stable-image-outpaint",
    name: "Stable Image Outpaint",
    family: "stable-image-edit",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 4 credits per successful generation.
    cost: { perImage: 4 * USD_PER_CREDIT },
  },
  "stable-image-search-and-replace": {
    id: "stable-image-search-and-replace",
    name: "Stable Image Search and Replace",
    family: "stable-image-edit",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per successful generation.
    cost: { perImage: 5 * USD_PER_CREDIT },
  },
  "stable-image-search-and-recolor": {
    id: "stable-image-search-and-recolor",
    name: "Stable Image Search and Recolor",
    family: "stable-image-edit",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per successful generation.
    cost: { perImage: 5 * USD_PER_CREDIT },
  },
  "stable-image-remove-background": {
    id: "stable-image-remove-background",
    name: "Stable Image Remove Background",
    family: "stable-image-edit",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per successful generation.
    cost: { perImage: 5 * USD_PER_CREDIT },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Stable Audio models. `stable-audio-2` and `stable-audio-2.5` are the `model`
 * values of the synchronous `POST /v2beta/audio/stable-audio-2/{text-to-audio,
 * audio-to-audio,inpaint}` routes (the inpaint route has no `model` field —
 * it is Stable Audio 2.5 only). `stable-audio-3` is served by the separate
 * ASYNC `/v2beta/audio/stable-audio/*` routes (HTTP 202 + poll
 * `GET /v2beta/audio/results/{id}`), which unmodel does not validate yet; it
 * is catalogued for completeness and pricing, and ./audio rejects it on the
 * 2.x routes. See the header for why these carry no `cost`.
 */
const audioModels = {
  "stable-audio-2.5": {
    id: "stable-audio-2.5",
    name: "Stable Audio 2.5",
    family: "stable-audio",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "audio"], output: ["audio"] },
    limit: { context: 0, characters: 10000 },
  },
  "stable-audio-2": {
    id: "stable-audio-2",
    name: "Stable Audio 2.0",
    family: "stable-audio",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "audio"], output: ["audio"] },
    limit: { context: 0, characters: 10000 },
  },
  "stable-audio-3": {
    id: "stable-audio-3",
    name: "Stable Audio 3.0",
    family: "stable-audio",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "audio"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...routeModels,
  ...sd3Models,
  ...sd3DeprecatedModels,
  ...editModels,
  ...audioModels,
} as const satisfies Record<string, ModelInfo>;

export type StabilitySd3ModelId = keyof typeof sd3Models | keyof typeof sd3DeprecatedModels;
export type StabilityEditRouteId = keyof typeof editModels;
/** Model ids the Stable Audio routes accept. */
export type StabilityAudioModelId = keyof typeof audioModels;
export type StabilityModelId = keyof typeof models;

/** Model ids the synchronous /v2beta/audio/stable-audio-2/* routes accept. */
export const STABLE_AUDIO_2_MODEL_IDS: readonly string[] = ["stable-audio-2", "stable-audio-2.5"];
