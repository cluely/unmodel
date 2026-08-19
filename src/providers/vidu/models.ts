// Hand-maintained — Vidu is not in models.dev; refresh from
//   https://platform.vidu.com/docs/text-to-video       (text2video wire schema)
//   https://platform.vidu.com/docs/image-to-video      (img2video wire schema)
//   https://platform.vidu.com/docs/start-end-to-video  (start-end2video)
//   https://platform.vidu.com/docs/reference-to-video  (reference2video, both forms)
//   https://platform.vidu.com/docs/reference-to-image  (imageFromReference)
//   https://platform.vidu.com/docs/pricing             (credit price + per-model rates)
// Verified 2026-08-13.
//
// Pricing conversion (documented so the arithmetic never rots unexplained):
// "Credits are available for $0.005 each" (docs/pricing), and the same page
// prints the USD column next to every credit rate — so USD = credits × 0.005
// and the numbers below are the page's own USD figures, not derived ones.
//
// Which rate a model carries here:
//   - Q3 models bill a flat per-second rate that varies by resolution; the
//     catalog records the rate at each model's DOCUMENTED DEFAULT resolution
//     (720p for every Q3 model), and ./pricing.ts has the full tier table.
//   - viduq1 / viduq1-classic only generate 5s 1080p clips at a flat 80
//     credits ($0.40), i.e. $0.08 per second of output.
//   - The Q2 family is billed on a tiered "starts at N credits, +M credits
//     per second" curve whose first-second boundary the docs do not pin down
//     (e.g. Q2-turbo 720p: "Starts at 8 credits, 10 credits for 2nd sec, then
//     +10 credits per second"). Encoding that as a single number would be a
//     guess, so those models carry no `cost` and produce no estimate.
//   - vidu2.0 is priced per generation by (route × duration × resolution)
//     with no default resolution, so it carries no `cost` either.
//
// Shared ids: `viduq1` and `viduq2` serve both the video routes and
// `POST /ent/v2/reference2image`, so their entries carry both `video` and
// `image` output modalities and both a per-second and a per-image rate.
//
// Model coverage vs. the artificialanalysis census: Vidu Q3 Pro
// (`viduq3-pro`), Q3 Turbo (`viduq3-turbo`), Q2 (`viduq2`), Q2 Pro
// (`viduq2-pro`), Q2 Turbo (`viduq2-turbo`) and Q1 (`viduq1`) are all
// documented API ids and all appear below, as does the census's image entry
// (Vidu Q2 → `viduq2` on imageFromReference).

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "vidu",
  name: "Vidu",
  // Auth is `Authorization: Token <key>` — https://platform.vidu.com/docs/text-to-video
  env: ["VIDU_API_KEY"],
  doc: "https://platform.vidu.com/docs",
} as const satisfies ProviderInfo;

/** USD per Vidu credit — https://platform.vidu.com/docs/pricing */
export const CREDIT_USD = 0.005;

export const videoModels = {
  "viduq3-pro": {
    id: "viduq3-pro",
    name: "Vidu Q3 Pro",
    family: "viduq3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 20 credits/s at the default 720p ($0.10/s); 9 at 540p, 24 at 1080p.
    cost: { perVideoSecond: 0.1 },
  },
  "viduq3-pro-fast": {
    id: "viduq3-pro-fast",
    name: "Vidu Q3 Pro Fast",
    family: "viduq3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // img2video only.
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 20 credits/s at the default 720p ($0.10/s); 25 at 1080p. 540p is not offered.
    cost: { perVideoSecond: 0.1 },
  },
  "viduq3-turbo": {
    id: "viduq3-turbo",
    name: "Vidu Q3 Turbo",
    family: "viduq3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 11 credits/s at the default 720p ($0.055/s) on text/img/start-end;
    // reference2video is cheaper (10 credits/s at 720p). See ./pricing.ts.
    cost: { perVideoSecond: 0.055 },
  },
  viduq3: {
    id: "viduq3",
    name: "Vidu Q3",
    family: "viduq3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // reference2video only.
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 12 credits/s at the default 720p ($0.06/s).
    cost: { perVideoSecond: 0.06 },
  },
  "viduq3-mix": {
    id: "viduq3-mix",
    name: "Vidu Q3 Mix",
    family: "viduq3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // reference2video only; does not support off_peak.
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 24 credits/s at the default 720p ($0.12/s); 29 at 1080p.
    cost: { perVideoSecond: 0.12 },
  },
  viduq2: {
    id: "viduq2",
    name: "Vidu Q2",
    family: "viduq2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // text2video, reference2video — and imageFromReference.
    modalities: { input: ["text", "image"], output: ["video", "image"] },
    limit: { context: 0 },
    // Video: tiered "starts at N, +M/s" curve → no per-second number (see
    // the header). Image: 6 credits ($0.03) per 1080p text-to-image.
    cost: { perImage: 0.03 },
  },
  "viduq2-pro": {
    id: "viduq2-pro",
    name: "Vidu Q2 Pro",
    family: "viduq2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // img2video, start-end2video, reference2video (the only model that takes
    // `videos` references).
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
  },
  "viduq2-pro-fast": {
    id: "viduq2-pro-fast",
    name: "Vidu Q2 Pro Fast",
    family: "viduq2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
  },
  "viduq2-turbo": {
    id: "viduq2-turbo",
    name: "Vidu Q2 Turbo",
    family: "viduq2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
  },
  viduq1: {
    id: "viduq1",
    name: "Vidu Q1",
    family: "viduq1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video", "image"] },
    limit: { context: 0 },
    // Video: 80 credits ($0.40) per 5s 1080p generation → $0.08/s.
    // Image: 20 credits ($0.10) per imageFromReference output.
    cost: { perVideoSecond: 0.08, perImage: 0.1 },
  },
  "viduq1-classic": {
    id: "viduq1-classic",
    name: "Vidu Q1 Classic",
    family: "viduq1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // img2video and start-end2video only.
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    cost: { perVideoSecond: 0.08 },
  },
  "vidu2.0": {
    id: "vidu2.0",
    name: "Vidu 2.0",
    family: "vidu2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // Priced per generation by route × duration × resolution, with no
    // documented default resolution — see ./pricing.ts.
  },
} as const satisfies Record<string, ModelInfo>;

/** Models accepted by `POST /ent/v2/reference2image`. */
export const imageModels = {
  viduq2: videoModels.viduq2,
  viduq1: videoModels.viduq1,
} as const satisfies Record<string, ModelInfo>;

export const models = videoModels;

export type ViduModelId = keyof typeof videoModels;
export type ViduImageModelId = keyof typeof imageModels;
