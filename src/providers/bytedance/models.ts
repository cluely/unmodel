// Hand-maintained — BytePlus ModelArk (ByteDance Seed) is not in models.dev; refresh from
//   https://docs.byteplus.com/en/docs/ModelArk/1330310  (Model list — the authoritative model ids)
//   https://docs.byteplus.com/en/docs/ModelArk/1544106  (Pricing — per-image and per-token rates)
//   https://docs.byteplus.com/en/docs/ModelArk/1541523  (Image generation API — request/response shape)
//   https://docs.byteplus.com/en/docs/ModelArk/1520757  (Create a video generation task — request/response shape)
//   https://docs.byteplus.com/en/docs/ModelArk/2298881  (Video generation tutorial — per-model capability matrix)
//   https://docs.byteplus.com/en/docs/ModelArk/1824121  (Image generation tutorial — per-model capability matrix)
// Verified 2026-08-13.
//
// This is the INTERNATIONAL platform (BytePlus ModelArk). The mainland
// platform (Volcengine ModelArk, ark.cn-beijing.volces.com) is a separate host
// with its own `doubao-`-prefixed id space — the model BytePlus spells
// `seedream-5-0-260128` is `doubao-seedream-5-0-260128` there — and is out of
// scope. Both platforms read the key from `ARK_API_KEY`, so a Volcengine user
// gets a plausible-looking result aimed at a host their key cannot
// authenticate against; catalog every mainland id yourself if you need one.
//
// Every id below is a REAL ModelArk model id copied from the Model list page
// (the dated form is the id the API expects, e.g. `seedream-4-0-250828`).
// ModelArk also accepts a custom *Endpoint ID* (`ep-…`) in the `model` field;
// those are per-account and cannot be cataloged — they validate with an
// `unknown_model` warning (silence it with `severity: { unknown_model: "off" }`).
//
// Pricing conversions (documented so the arithmetic never rots unexplained):
// - IMAGE models bill per successfully generated image (Pricing → "Image
//   generation models"), so `cost.perImage` is the documented USD/image.
//   Seedream 5.0 pro is the one tiered row: 0.045/image at ≤ 2.61M output
//   pixels (1K/1.5K) and 0.09/image above it (2K); layer decomposition is
//   half that per layer (0.0225 / 0.045) and input images cost 0.003 each
//   from the 2nd on. `perImage` records the *default* configuration
//   (`size` defaults to `2K` → 0.09); ./pricing.ts resolves the real tier
//   per request.
// - VIDEO models bill by token: `price = token unit price × tokens` with
//   `tokens = (input video duration + output video duration) × width ×
//   height × fps / 1024` (Pricing → "Video generation models"). A single
//   catalog number cannot express that, so `cost.perVideoSecond` carries the
//   documented *price-example* rate for the model's DEFAULT resolution at
//   16:9 with no input video (Pricing → "Price examples"), and ./pricing.ts
//   re-derives the rate per resolution (and, for Seedance 1.5 pro, per
//   `generate_audio`). Requests that feed a reference VIDEO bill for the
//   input seconds too — unmodel cannot read the duration of a remote URL, so
//   those estimates are a floor, not a quote.
//
// Deliberately absent — the third deprecation batch (notified 2026-03-17,
// deactivated 2026-05-13, https://docs.byteplus.com/en/docs/ModelArk/1350667)
// retired Seedream 3.0 and the Seedance 1.0 lite pair, and the deprecation
// page spells their ids with a `bytedance-` prefix
// (`bytedance-seedream-3-0-t2i-250415`,
// `bytedance-seedance-1-0-lite-{t2v,i2v}-250428`) while their surviving model
// cards (1555133 / 1553576) spell them without it. Deactivated, dropped from
// the Model list and the Pricing tables, and ambiguously spelled — so they
// get no catalog entry.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "bytedance",
  name: "BytePlus ModelArk (ByteDance Seed)",
  // Every ModelArk sample reads the key from ARK_API_KEY.
  env: ["ARK_API_KEY"],
  doc: "https://docs.byteplus.com/en/docs/ModelArk/1099455",
  api: "https://ark.ap-southeast.bytepluses.com/api/v3",
} as const satisfies ProviderInfo;

/**
 * Seedream / SeedEdit models on `POST /api/v3/images/generations`.
 * https://docs.byteplus.com/en/docs/ModelArk/1330310#9df4d9fd
 */
export const imageModels = {
  "dola-seedream-5-0-pro-260628": {
    id: "dola-seedream-5-0-pro-260628",
    name: "Seedream 5.0 pro",
    family: "seedream",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-06-28",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // Output image: 0.045 (≤ 2.61M px, i.e. 1K/1.5K) or 0.09 (> 2.61M px,
    // i.e. 2K, the documented `size` default). Layer decomposition halves
    // both; input images bill 0.003 each from the 2nd on. — Pricing 1544106
    cost: { perImage: 0.09 },
  },
  "seedream-5-0-260128": {
    id: "seedream-5-0-260128",
    name: "Seedream 5.0 lite",
    family: "seedream",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-01-28",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // Model list 1330310 documents this id and `seedream-5-0-lite-260128` as
    // two spellings of the same Seedream 5.0 lite model; the price row is
    // published under the `-lite-` spelling.
    cost: { perImage: 0.035 },
  },
  "seedream-5-0-lite-260128": {
    id: "seedream-5-0-lite-260128",
    name: "Seedream 5.0 lite",
    family: "seedream",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-01-28",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 0.035 USD / output image — Pricing 1544106
    cost: { perImage: 0.035 },
  },
  "seedream-4-5-251128": {
    id: "seedream-4-5-251128",
    name: "Seedream 4.5",
    family: "seedream",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-11-28",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 0.04 USD / output image — Pricing 1544106
    cost: { perImage: 0.04 },
  },
  "seedream-4-0-250828": {
    id: "seedream-4-0-250828",
    name: "Seedream 4.0",
    family: "seedream",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-08-28",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 0.03 USD / output image — Pricing 1544106
    cost: { perImage: 0.03 },
  },
  "seededit-3-0-i2i-250628": {
    id: "seededit-3-0-i2i-250628",
    name: "SeedEdit 3.0 i2i",
    family: "seededit",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-06-28",
    // Second deprecation batch: notified 2025-11-17, deprecated 2025-11-24,
    // deactivated 2026-01-22 — recommended replacement seedream-4-0-250828,
    // automated replacement seedream-4-5-251128.
    // https://docs.byteplus.com/en/docs/ModelArk/1350667
    status: "deprecated",
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 0.03 USD / output image — still listed in the live Pricing table
    // (1544106) and on the model card
    // (https://docs.byteplus.com/en/docs/ModelArk/1729477), which is why the
    // id is cataloged at all. Its API reference and tutorial (docs 1666946 /
    // 1824691) were withdrawn with the deprecation, so the request surface is
    // undocumented: NO typed arm and NO constraints — params pass through
    // unvalidated rather than being guessed.
    cost: { perImage: 0.03 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Seedance models on `POST /api/v3/contents/generations/tasks`.
 * https://docs.byteplus.com/en/docs/ModelArk/1330310#7571da3f
 */
export const videoModels = {
  "dreamina-seedance-2-5-260628": {
    id: "dreamina-seedance-2-5-260628",
    name: "Dreamina Seedance 2.5",
    family: "seedance",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-06-28",
    modalities: { input: ["text", "image", "audio", "video"], output: ["video"] },
    limit: { context: 0 },
    // 720p (the documented `resolution` default) 16:9 without input video:
    // 1.156 USD per 5s video = 0.231 USD/s — Pricing 1544106 "Price examples".
    // 480p is 0.103 USD/s; input video adds cost. ./pricing.ts picks the tier.
    cost: { perVideoSecond: 0.231 },
  },
  "dreamina-seedance-2-0-260128": {
    id: "dreamina-seedance-2-0-260128",
    name: "Dreamina Seedance 2.0",
    family: "seedance",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-01-28",
    modalities: { input: ["text", "image", "audio", "video"], output: ["video"] },
    limit: { context: 0 },
    // 720p (default) 16:9 without input video: 0.15 USD/s (480p 0.07,
    // 1080p 0.37, 4k 0.78) — Pricing 1544106 "Price examples".
    cost: { perVideoSecond: 0.15 },
  },
  "dreamina-seedance-2-0-fast-260128": {
    id: "dreamina-seedance-2-0-fast-260128",
    name: "Dreamina Seedance 2.0 fast",
    family: "seedance",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-01-28",
    modalities: { input: ["text", "image", "audio", "video"], output: ["video"] },
    limit: { context: 0 },
    // 720p (default) 16:9 without input video: 0.12 USD/s (480p 0.06) —
    // Pricing 1544106. A limited-time 25% discount runs to 2026-09-07; the
    // catalog carries the list price.
    cost: { perVideoSecond: 0.12 },
  },
  "dreamina-seedance-2-0-mini-260615": {
    id: "dreamina-seedance-2-0-mini-260615",
    name: "Dreamina Seedance 2.0 mini",
    family: "seedance",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2026-06-15",
    modalities: { input: ["text", "image", "audio", "video"], output: ["video"] },
    limit: { context: 0 },
    // 720p (default) 16:9 without input video: 0.08 USD/s (480p 0.04) —
    // Pricing 1544106. A limited-time 60% discount runs to 2026-09-07; the
    // catalog carries the list price.
    cost: { perVideoSecond: 0.08 },
  },
  "seedance-1-5-pro-251215": {
    id: "seedance-1-5-pro-251215",
    name: "Seedance 1.5 pro",
    family: "seedance",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-12-15",
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 720p (default) 16:9 with audio (`generate_audio` defaults to true):
    // 0.26 USD per 5s = 0.052 USD/s; silent halves it — Pricing 1544106.
    cost: { perVideoSecond: 0.052 },
  },
  "seedance-1-0-pro-250528": {
    id: "seedance-1-0-pro-250528",
    name: "Seedance 1.0 pro",
    family: "seedance",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-05-28",
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 1080p (this model's documented `resolution` default) 16:9: 0.61 USD
    // per 5s = 0.122 USD/s (720p 0.052, 480p 0.024) — Pricing 1544106.
    cost: { perVideoSecond: 0.122 },
  },
  "seedance-1-0-pro-fast-251015": {
    id: "seedance-1-0-pro-fast-251015",
    name: "Seedance 1.0 pro fast",
    family: "seedance",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    releaseDate: "2025-10-15",
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 1080p (default) 16:9: 0.24 USD per 5s = 0.048 USD/s (720p 0.02,
    // 480p 0.01) — Pricing 1544106.
    cost: { perVideoSecond: 0.048 },
  },
} as const satisfies Record<string, ModelInfo>;

/** Every cataloged BytePlus ModelArk generation model. */
export const models = {
  ...imageModels,
  ...videoModels,
} as const satisfies Record<string, ModelInfo>;

export type BytedanceModelId = keyof typeof models;
export type BytedanceImageModelId = keyof typeof imageModels;
export type BytedanceVideoModelId = keyof typeof videoModels;
