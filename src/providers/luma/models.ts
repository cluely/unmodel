// Hand-maintained — Luma (Dream Machine API) is not in models.dev; refresh from
//   https://docs.lumalabs.ai/docs/video-generation  (video models, durations, resolutions)
//   https://docs.lumalabs.ai/docs/image-generation  (image models)
//   https://docs.lumalabs.ai/docs/modify-video      (modify models, modes, limits, rates)
//   https://docs.lumalabs.ai/docs/reframe-video-image (reframe models, dimension maps)
//   https://docs.lumalabs.ai/reference/creategeneration (the embedded OpenAPI
//     definition, "Dream Machine API" version 1.1.0, is the wire contract these
//     endpoints are transcribed from)
// Verified 2026-08-13.
//
// Model coverage: the whole Dream Machine API is these four ids. Every video
// route (generate / modify / reframe) takes exactly ray-2 | ray-flash-2, and
// every image route takes photon-1 | photon-flash-1, so no route needs its own
// model-support table.
//
// Pricing: no `cost` field, deliberately. Luma bills Dream Machine usage per
// million pixels, not per second, per image or per token, and `ModelCost` has
// no unit that can carry that without lying:
//   - Modify Video publishes $0.01582/Mpx (ray-2) and $0.00544/Mpx
//     (ray-flash-2) — see ./pricing.ts, which encodes the rates, the 24fps the
//     worked examples imply, and the aspect-ratio→pixel maps.
//   - Plain generation, reframe, upscale and add-audio publish no USD rate at
//     all; https://lumalabs.ai/api/pricing has moved on to the Luma Agents API
//     models and lists nothing for these four ids.
// Since a request carries only media URLs, unmodel cannot recover the pixel
// count from the wire either — so these endpoints produce no cost estimate,
// and ./pricing.ts exports the arithmetic for callers who know the dimensions.
//
// Ray 3 / Ray 3.2 and Uni 1 / Uni 1 Max are NOT available on the Dream Machine
// API — they are exposed via the separate Luma Agents API
// (https://docs.agents.lumalabs.ai, POST /v1/generations) and are out of scope
// for this provider directory.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "luma",
  name: "Luma AI",
  // The official SDK (lumaai) reads LUMAAI_API_KEY.
  env: ["LUMAAI_API_KEY"],
  doc: "https://docs.lumalabs.ai/docs/api",
} as const satisfies ProviderInfo;

const videoModels = {
  "ray-2": {
    id: "ray-2",
    name: "Ray 2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
  },
  "ray-flash-2": {
    id: "ray-flash-2",
    name: "Ray 2 Flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

const imageModels = {
  "photon-1": {
    id: "photon-1",
    name: "Photon 1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
  },
  "photon-flash-1": {
    id: "photon-flash-1",
    name: "Photon Flash 1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...videoModels,
  ...imageModels,
} as const satisfies Record<string, ModelInfo>;

/** Route-scoped catalogs: video models for POST /generations, image for /generations/image. */
export { videoModels, imageModels };

export type LumaVideoModelId = keyof typeof videoModels;
export type LumaImageModelId = keyof typeof imageModels;
export type LumaModelId = keyof typeof models;
