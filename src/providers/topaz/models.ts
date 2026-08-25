// Hand-maintained — Topaz Labs is not in models.dev; refresh from
//   https://openapi.gitbook.com/o/HctdcUHRfIWXBVA1egPp/spec/image-yaml-feb-2026.yaml  (Image API 1.2.0, OpenAPI 3.1.2)
//   https://developer.topazlabs.com/reference/openapi-specs/readme                    (re-resolve that URL from here — the slug is dated)
//   https://developer.topazlabs.com/image-models/gigapixel                            (the classic upscalers, one page per model)
//   https://developer.topazlabs.com/image-models/wonder                               (the generative upscalers)
//   https://developer.topazlabs.com/image-models/bloom                                (the creative upscalers)
//   https://developer.topazlabs.com/getting-started/model-pricing                     (MP per credit, per family)
//   https://developer.topazlabs.com/getting-started/api-key-setup                     (X-API-Key, self-serve)
//   https://developer.topazlabs.com/resources/api-limits                              (500 MB request cap; rate limits are load-dependent)
//   https://www.topazlabs.com/enhance-api                                             (USD per credit)
// Verified 2026-08-25. Every developer.topazlabs.com route also serves raw
// Markdown at `<route>.md`, which is what was read.
//
// THE MODEL IDS HAVE SPACES IN THEM, AND THAT IS DELIBERATE.
// Topaz's `model` field takes product names — "Standard V2", "Upscale High
// Fidelity V3", "Bloom Realism" — rather than slugs. They are the wire values
// verbatim, which is why a ref reads `"topaz/Standard V2"`. Slugging them would
// invent a vocabulary and then need a table to undo it before every request,
// and the table would be the only place the real string lived.
//
// WHY NO ROW CARRIES A `cost`.
// Topaz bills per output MEGAPIXEL, rounded up to a whole credit, and
// `ModelCost` has no field for that — `perImage` would be wrong by a factor of
// five across the sizes one model serves. The credit tables and the exact
// formula live in ./pricing.ts, and each endpoint estimates per request, which
// it can do EXACTLY whenever the request states `output_width` and
// `output_height`: unlike most upscalers, Topaz's price is a pure function of
// the body. A request that lets Topaz choose the size estimates `undefined`,
// and Topaz's own POST /image/v1/estimate is the answer for those.
//
// MODEL COVERAGE, AND THE ONE PLACE THE SPEC AND THE DOCS DISAGREE.
// The published OpenAPI document enumerates five models on /enhance/async and
// four on /enhance-gen/async. The live per-model pages document six and nine
// respectively — the spec is a dated snapshot (`image-yaml-feb-2026`) and the
// model pages are the per-route reference, each naming its endpoint and its own
// `model` string, so the pages win where they ADD. The one value that goes the
// other way is `"Recovery V2"`: in the spec, on no page, with no credit table,
// and looking very much like the earlier name of what is now `"Recover 3"`. It
// is not typed, for the reason nothing undocumented is.
//
// DELIBERATELY NOT SERVED — the rest of the Image API.
// `/denoise/async`, `/sharpen/async` and `/sharpen-gen/async`,
// `/restore-gen/async` (dust and scratches), `/lighting/async` (relight, white
// balance, colorize) and `/matting/async` (object matting, background removal)
// are SEPARATE ROUTES with their own model enums, and none of them upscales:
// they clean, sharpen, relight or cut out a picture at the size it arrived. An
// `upscale` verb that reached them would be an address that no longer names
// what the endpoint does. They are good candidates for a future
// `imageEdit`-side operation or a category of their own; they are not extras on
// this surface, because they do not ride this route.
// `/tool/async` ("Transparency Upscale") is the near miss — it DOES upscale,
// preserving alpha — and it is still a separate route with a one-value enum, so
// it would be a third address rather than a model here. It joins the day it is
// worth its own `upscaleTransparent`.
//
// DELIBERATELY NOT SERVED — the Video API.
// https://api.topazlabs.com/video is a real, published, separately-specced API
// (OpenAPI 3.0.3, `Video API` 1.0.0) that upscales and interpolates clips, and
// it is absent for three reasons that compound:
//   1. It is not a request, it is a PROTOCOL. `POST /video/` returns a QUOTE
//      and starts nothing; you then PATCH `/video/{id}/accept` for upload
//      credentials, push the source to S3 as a multipart upload, PATCH
//      `/video/{id}/complete-upload/` to begin, poll, and download. Only the
//      first step has a body, and a `Validated` for a step that does nothing on
//      its own would misrepresent what it is.
//   2. Its body needs facts about the file that unmodel has no words for and
//      the caller must probe for — `container`, `size`, `duration`,
//      `frameCount`, `frameRate`, `resolution` — so it could not join
//      `unmodel/upscale`, whose `source` is a URL and nothing else.
//   3. Its model ids are opaque codes (`prob-4`, `iris-3`, `thd-3`, `apo-8`)
//      whose mapping to the published product names (Proteus, Starlight, Astra,
//      Apollo…) appears nowhere in the spec, so a catalog row could not be
//      named honestly.
// fal resells `topaz/upscale/video/precision` behind its own queue, and
// `unmodel/upscale` reaches it there — which is exactly the sort of gap an
// aggregator is for.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "topaz",
  name: "Topaz Labs",
  // `X-API-Key: <TOPAZ_API_KEY>` — https://developer.topazlabs.com/getting-started/api-key-setup.
  // The spec's security scheme spells the header `X-API-Key`; the quickstart's
  // Python sample writes `X-API-KEY`. HTTP header names are case-insensitive,
  // so both work and unmodel states the spec's.
  env: ["TOPAZ_API_KEY"],
  doc: "https://developer.topazlabs.com/reference/api-endpoints/image",
} as const satisfies ProviderInfo;

/** A picture in, a bigger picture out. No prompt, no seed, no invention. */
const enhanceModality = { input: ["image"], output: ["image"] } as const;

/**
 * A picture and optionally a description in, a bigger picture out.
 *
 * `text` is on the INPUT side for the generative route because `prompt` is a
 * real field there — it is the second witness that made `prompt` canonical in
 * `unmodel/upscale`.
 */
const enhanceGenModality = { input: ["image", "text"], output: ["image"] } as const;

/**
 * Every model both upscale routes serve.
 *
 * One table across two endpoints, because the pipeline looks a model up by id
 * and the ids are disjoint — which is also what lets `unified.ts` pick the
 * route from the model rather than from a parameter.
 */
export const models = {
  // --- POST /image/v1/enhance/async — the Gigapixel family, 24 MP/credit ----
  /**
   * 24 MP of output per credit.
   *
   * Source: https://developer.topazlabs.com/getting-started/model-pricing — verified 2026-08-25.
   * Quote: “| Precision Upscale | `Gigapixel` | 24 |”
   */
  "Standard V2": {
    id: "Standard V2",
    name: "Standard 2",
    family: "gigapixel",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceModality,
    limit: { context: 0 },
    // The default (the spec's own `default: Standard V2`) and the one to reach
    // for first: "the general-purpose image upscaling model recommended for
    // most photos and graphics". 512 MP in, 1024 MP out.
  },
  "High Fidelity V2": {
    id: "High Fidelity V2",
    name: "High Fidelity 2",
    family: "gigapixel",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceModality,
    limit: { context: 0 },
    // For sources that are already high-resolution — professional photos where
    // the job is fidelity rather than recovery.
  },
  "Upscale High Fidelity V3": {
    id: "Upscale High Fidelity V3",
    name: "High Fidelity 3",
    family: "gigapixel",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceModality,
    limit: { context: 0 },
    // Documented on its own page and NOT in the published OpenAPI enum — see
    // the header. It is the one model here with `recoveryStrength` and
    // `opacity`, which is how you blend its result back toward the source.
  },
  "Low Resolution V2": {
    id: "Low Resolution V2",
    name: "Low Resolution 2",
    family: "gigapixel",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceModality,
    limit: { context: 0 },
    // Recovery-focused: heavily compressed or genuinely small sources.
  },
  CGI: {
    id: "CGI",
    name: "Art & CGI",
    family: "gigapixel",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceModality,
    limit: { context: 0 },
    // Artwork, illustrations and renders, where photographic grain would be
    // wrong. Adds `deblurStrength`.
  },
  "Text Refine": {
    id: "Text Refine",
    name: "Text & Shapes",
    family: "gigapixel",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceModality,
    limit: { context: 0 },
    // Graphics and typography — the case where a photo upscaler smears the
    // letterforms. The one model page that lists the shared settings
    // snake_cased; see ./shared.ts on the casing.
  },

  // --- POST /image/v1/enhance-gen/async — Wonder (4 MP/credit) --------------
  /**
   * 4 MP of output per credit.
   *
   * Source: https://developer.topazlabs.com/getting-started/model-pricing — verified 2026-08-25.
   * Quote: “| Generative Upscale | `Wonder` | 4 |”
   */
  Redefine: {
    id: "Redefine",
    name: "Redefine",
    family: "wonder",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
    // The generative route's default, and the prompt-driven one: "the only
    // local, prompt-driven generative image model". 256 MP in and out.
  },
  Wonder: {
    id: "Wonder",
    name: "Wonder",
    family: "wonder",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
    // One-click repair of low-to-medium resolution images. 128 MP ceiling —
    // the tightest of the family, and the reason `checkOutputMegapixels`
    // exists.
  },
  "Wonder 2": {
    id: "Wonder 2",
    name: "Wonder 2",
    family: "wonder",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
  },
  "Wonder 3": {
    id: "Wonder 3",
    name: "Wonder 3",
    family: "wonder",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
    // Adds `enhancementStrength` — high, medium or low — which is a coarser
    // dial than `creativity` and moves the whole result rather than the detail.
  },
  "Wonder 3.5": {
    id: "Wonder 3.5",
    name: "Wonder 3.5",
    family: "wonder",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
    // The newest generative upscaler and the one with the film-grain block.
    // Its page lists a camelCased `outputWidth`/`outputHeight` alongside the
    // envelope's `output_width`/`output_height` and says nothing about
    // precedence — both are typed, neither is preferred.
  },
  "Standard MAX": {
    id: "Standard MAX",
    name: "Standard Max",
    family: "wonder",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
    // Precision upscaling on the generative route: 24 MP in, 384 MP out — the
    // widest ratio in the catalog.
  },
  "Recover 3": {
    id: "Recover 3",
    name: "Recover 3",
    family: "wonder",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
    // Its page names a SECOND accepted string, `"Natural Enhance"`. Only one id
    // can be the row key and it is the one the page leads with; the alias is
    // recorded here rather than typed, because two ids for one model would show
    // up twice in every picker.
  },

  // --- POST /image/v1/enhance-gen/async — Bloom (2 MP/credit) ---------------
  /**
   * 2 MP of output per credit — twelve times the price of a Gigapixel model
   * for the same picture.
   *
   * Source: https://developer.topazlabs.com/getting-started/model-pricing — verified 2026-08-25.
   * Quote: “| Creative Upscale | `Bloom` | 2 |”
   */
  "Bloom 2": {
    id: "Bloom 2",
    name: "Bloom 2",
    family: "bloom",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
    // For images that were GENERATED rather than photographed: it reimagines
    // detail rather than recovering it. The only model here with `seed` and
    // `colorPreservation`.
  },
  "Bloom Realism": {
    id: "Bloom Realism",
    name: "Bloom 1 Realism",
    family: "bloom",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
    // The realism half of the first Bloom generation. Its `creativity` runs
    // 1–4 where the endpoint's own block says 1–9 — a per-model narrowing of a
    // shared dial, and the sharpest one in this catalog.
  },
} as const satisfies Record<string, ModelInfo>;

export type TopazCatalogModelId = keyof typeof models;
