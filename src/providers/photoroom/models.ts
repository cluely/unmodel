// Hand-maintained — Photoroom is not in models.dev; refresh from
//   https://image-api.photoroom.com/openapi                                 (the form-field tables are GENERATED from this — data/photoroom/, scripts/codegen-photoroom.ts)
//   https://docs.photoroom.com/image-editing-api-plus-plan/pricing.md       ($0.10 per call)
//   https://docs.photoroom.com/remove-background-api-basic-plan/pricing.md  ($0.02 per call)
//   https://www.photoroom.com/api/pricing                                   (FAQ: the rate follows the ENDPOINT, not the plan; the plan matrix)
//   https://docs.photoroom.com/getting-started/pricing.md                   (errors are free; the quota units)
// Verified 2026-11-24. Research: docs/research/photoroom-api-2026-11-24.md §3.
//
// Neither wire has a `model` field — the route is the model — so every id here
// is SYNTHETIC, an unmodel-internal handle for a route:
//
//   image-editing       POST https://image-api.photoroom.com/v2/edit. "Image
//                       Editing API" is Photoroom's own name for it.
//   edit-with-ai        the SAME route, when `editWithAI.mode` is set — the
//                       documented mode whose shape is "a prompt and a picture".
//   remove-background   POST https://sdk.photoroom.com/v1/segment. "Remove
//                       Background API" is Photoroom's own name for it.
//
// Two rows on one route is unusual here: a validator normally pins its synthetic
// id with `modelId: () => "<id>"` (src/providers/HAND_CATALOGS.md). `/v2/edit`
// has a row per documented MODE instead of one per route because a
// `"provider/model"` ref has to name what a caller is asking for, and
// "photoroom/image-editing" names forty unrelated features while
// "photoroom/edit-with-ai" names one. So `photoroom.imageEdit` resolves its id
// from the params — `edit-with-ai` when `editWithAI.mode` is present,
// `image-editing` otherwise — and the row a ref names is the row the estimate
// reads. Both rows carry the same rate, by the quote below, so the choice of
// row can never move a price.
//
// Pricing, and what the two numbers are NOT (the same facts are exported as
// `PHOTOROOM_PRICING_CAVEAT`, so a caller showing an estimate can show them):
// - They are the SELF-SERVE Basic / Plus unit rates. Images are "bought through
//   a monthly subscription and consumed on each successful API call" — $0.02 and
//   $0.10 are the unit price of a prepaid block, not a metered charge.
// - The rate follows the endpoint, not the plan: "If you're on the Basic API
//   plan … and make a Plus call (which is the Image Editing API), you'll be
//   charged the Plus price per image of $0.10. If you're on the Plus API plan
//   and call the Remove Background API, you'll be charged the Basic price per
//   image of $0.02." (https://www.photoroom.com/api/pricing, FAQ)
// - Enterprise can be billed from "a committed wallet in EUR, USD or GBP"
//   (same FAQ), and no per-call rate for it is published anywhere. An
//   Enterprise caller's cost is unknowable from public sources.
// - Volume discounts are Enterprise-only by the pricing page's own plan matrix
//   ("Scalable Pricing with Volume-Based Discounts": false for Basic and Plus).
// - `virtualModel.quality` above `standard` has NO published price: "`standard`
//   outputs ~1K, `advanced` ~2K, and `premium` ~4K resolution" (OpenAPI), and
//   "Output resolutions of 2K and 4K are available for Enterprise plans"
//   (…/virtual-model.md). `photoroom.imageEdit` returns no cost estimate for
//   those two values rather than quoting the 1K rate for a 4K image.
// - "Calls that result in an error will **not** consume an image."

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "photoroom",
  name: "Photoroom",
  env: ["PHOTOROOM_API_KEY"],
  doc: "https://docs.photoroom.com/",
} as const satisfies ProviderInfo;

/** Where the two rates were read. */
export const PHOTOROOM_PRICING_SOURCE = "https://www.photoroom.com/api/pricing";

/** The sentence to show beside any `estimate.costUSD` a Photoroom validator returns. */
export const PHOTOROOM_PRICING_CAVEAT =
  "This is Photoroom's self-serve rate — $0.02 per Remove Background call, $0.10 per Image Editing " +
  "call — and it is the unit price of a prepaid monthly block of images, not a metered charge: " +
  "unused images do not roll over. The rate follows the endpoint, not the plan. Enterprise accounts " +
  "billed from a usage wallet have no published per-call rate, and neither does " +
  "`virtualModel.quality` above `standard` (2K and 4K output are Enterprise-only), so no estimate " +
  "is returned for those requests. A call that errors is not billed.";

export const models = {
  // SYNTHETIC — the route POST /v2/edit, whatever it is asked to do.
  // "The Image Editing API is part of our "Plus plan" and each API call is
  // priced at $0.10. This means that an API call can include as many edit
  // options as needed, **with no impact on the price**."
  // https://docs.photoroom.com/image-editing-api-plus-plan/pricing.md, read 2026-11-24.
  "image-editing": {
    id: "image-editing",
    name: "Photoroom Image Editing",
    family: "photoroom-image-editing",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: 0.1 },
  },
  // SYNTHETIC — POST /v2/edit with `editWithAI.mode` set. Same route, same
  // rate, by the same quote as `image-editing`: edit options have "no impact on
  // the price". https://docs.photoroom.com/image-editing-api-plus-plan/pricing.md,
  // read 2026-11-24.
  "edit-with-ai": {
    id: "edit-with-ai",
    name: "Photoroom Edit With AI",
    family: "photoroom-image-editing",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: 0.1 },
  },
  // SYNTHETIC — the route POST /v1/segment.
  // "The Remove Background API is part of our "Basic plan" and each API call is
  // priced at $0.02"
  // https://docs.photoroom.com/remove-background-api-basic-plan/pricing.md, read 2026-11-24.
  "remove-background": {
    id: "remove-background",
    name: "Photoroom Remove Background",
    family: "photoroom-remove-background",
    attachment: true,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["image"], output: ["image"] },
    limit: { context: 0 },
    cost: { perImage: 0.02 },
  },
} as const satisfies Record<string, ModelInfo>;

export type PhotoroomModelId = keyof typeof models;
