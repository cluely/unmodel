// Hand-maintained — Lightricks (the LTX API) is not in models.dev; refresh from
//   https://docs.ltx.io/models.md              (model ids, endpoint compatibility)
//   https://docs.ltx.io/models/ltx-2-5.md      (LTX-2.5 support matrix)
//   https://docs.ltx.io/models/ltx-2-3.md      (LTX-2.3 support matrix)
//   https://docs.ltx.io/pricing.md             (USD per second, by model × resolution)
//   https://docs.ltx.io/ltx-2-deprecation.md   (LTX-2 retirement)
//   https://docs.ltx.io/openapi.json           (OpenAPI 3.1, the wire contract
//     these endpoints are transcribed from; server https://api.ltx.io)
// Verified 2026-08-13.
//
// Pricing: LTX bills USD per second of output directly (no credit currency),
// but the rate is a function of model × resolution — e.g. ltx-2-3-pro is
// $0.04/s at 720p and $0.32/s at 4K — and `resolution` is a REQUIRED request
// field with no documented default. A single `cost.perVideoSecond` would
// therefore have to pick a tier and lie about the others, so the catalog
// carries no `cost` and the full tier tables live in ./pricing.ts, which the
// endpoints use for a per-request `costUSD` estimate.
//
// Model coverage vs. the artificialanalysis census: ltx-2-3-fast, ltx-2-3-pro,
// ltx-2-fast and ltx-2-pro are all documented API ids and all appear below.
// "LTX Video v0.9.7 13B" is an open-weights checkpoint with no id in the LTX
// API's model enums (https://docs.ltx.io/openapi.json) — it is served only by
// third-party hosts, so it is deliberately absent.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "lightricks",
  name: "Lightricks (LTX)",
  // https://docs.ltx.io/authentication.md — Authorization: Bearer <key>.
  env: ["LTX_API_KEY"],
  doc: "https://docs.ltx.io/welcome",
} as const satisfies ProviderInfo;

/**
 * Video models accepted by the generation endpoints. Route coverage is per
 * model (audio-to-video, retake, extend and reframe do NOT accept
 * `ltx-2-3-fast`) and is enforced from the `*_MODELS` lists in ./shared.ts,
 * not from this catalog.
 */
export const models = {
  "ltx-2-5-fast": {
    id: "ltx-2-5-fast",
    name: "LTX-2.5 Fast",
    family: "ltx-2.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    // The LTX-2.5 weights are not published; only LTX-2/LTX-2.3 are open.
    openWeights: false,
    modalities: { input: ["text", "image", "audio"], output: ["video"] },
    limit: { context: 0 },
    // $0.09/s (720p) → $0.30/s (4K) — see ./pricing.ts.
  },
  "ltx-2-5-pro": {
    id: "ltx-2-5-pro",
    name: "LTX-2.5 Pro",
    family: "ltx-2.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "audio"], output: ["video"] },
    limit: { context: 0 },
    // $0.12/s (720p) or $0.17/s (1080p); 1080p is this model's ceiling.
  },
  "ltx-2-3-fast": {
    id: "ltx-2-3-fast",
    name: "LTX-2.3 Fast",
    family: "ltx-2.3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    // The LTX-2 family ships as open weights — docs.ltx.io carries a whole
    // "LTX Open Source Documentation" section (inference, LoRA training,
    // ComfyUI nodes) for it; only LTX-2.5 is API-only.
    openWeights: true,
    // text-to-video and image-to-video only — no audio-to-video arm.
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // $0.03/s (720p) → $0.24/s (4K) — see ./pricing.ts.
  },
  "ltx-2-3-pro": {
    id: "ltx-2-3-pro",
    name: "LTX-2.3 Pro",
    family: "ltx-2.3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    modalities: { input: ["text", "image", "audio", "video"], output: ["video"] },
    limit: { context: 0 },
    // $0.04/s (720p) → $0.32/s (4K) — see ./pricing.ts.
  },
  "ltx-2-fast": {
    id: "ltx-2-fast",
    name: "LTX-2 Fast",
    family: "ltx-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // "LTX-2 (ltx-2-fast, ltx-2-pro) has been deprecated and will be removed
    // on August 15, 2026" — https://docs.ltx.io/ltx-2-deprecation.md. It
    // "stays billed at its original LTX-2 rates", which the pricing page no
    // longer prints, so no rate is recorded here or in ./pricing.ts.
    status: "deprecated",
  },
  "ltx-2-pro": {
    id: "ltx-2-pro",
    name: "LTX-2 Pro",
    family: "ltx-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: true,
    modalities: { input: ["text", "image", "audio", "video"], output: ["video"] },
    limit: { context: 0 },
    status: "deprecated",
  },
} as const satisfies Record<string, ModelInfo>;

export type LightricksModelId = keyof typeof models;
