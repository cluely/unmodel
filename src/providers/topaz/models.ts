// Hand-maintained — Topaz Labs is not in models.dev; refresh from
//   https://openapi.gitbook.com/o/HctdcUHRfIWXBVA1egPp/spec/image-yaml-feb-2026.yaml  (Image API 1.2.0, OpenAPI 3.1.2)
//   https://developer.topazlabs.com/reference/openapi-specs/readme                    (re-resolve that URL from here — the slug is dated)
//   https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision  (the classic upscalers and Detail, one page per model)
//   https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative (the generative upscalers)
//   https://developer.topazlabs.com/image-models/upscaling-and-enhancement/creative   (the creative upscalers)
//   https://developer.topazlabs.com/getting-started/model-pricing/image-models        (the formula; each model page states its own MP per credit)
//   https://developer.topazlabs.com/resources/model-deprecations                      (lifecycle status per `model` string)
//   https://developer.topazlabs.com/getting-started/api-key-setup                     (X-API-Key, self-serve)
//   https://developer.topazlabs.com/resources/api-limits                              (500 MB request cap; rate limits are load-dependent)
//   https://www.topazlabs.com/enhance-api                                             (USD per credit)
// Verified 2026-08-25; rows added 2026-11-12 carry their own dated quotes. Every
// developer.topazlabs.com route also serves raw Markdown at `<route>.md`, which
// is what was read.
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
// four on /enhance-gen/async. The live per-model pages document six and twelve
// respectively — the spec is a dated snapshot (`image-yaml-feb-2026`) and the
// model pages are the per-route reference, each naming its endpoint and its own
// `model` string, so the pages win where they ADD. The one value that goes the
// other way is `"Recovery V2"` — Recover 2, on its own page, deprecated — and
// it is out for the same reason as the deprecated first generation
// (`"Standard"`, `"Low Resolution"`, `"High Fidelity"`, `"Recover"`): each was
// already deprecated when first read. See TOPAZ_ENHANCE_GEN_MODELS in
// ./shared.ts for the quotes.
//
// DELIBERATELY NOT SERVED — the rest of the Image API.
// `/denoise/async` and `/denoise-gen/async` (Denoise Max), `/sharpen/async` and
// `/sharpen-gen/async`, `/restore-gen/async` (dust and scratches, Face Recovery
// V3), `/lighting/async` (relight, white balance, colorize, ImageHDR) and
// `/matting/async` (object matting, background removal)
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

/** A picture in, a bigger picture out, and no field that takes text. */
const enhanceModality = { input: ["image"], output: ["image"] } as const;

/**
 * A picture and optionally a description in, a bigger picture out.
 *
 * `text` is on the INPUT side exactly where `TOPAZ_SETTINGS_BY_MODEL` lists
 * `prompt` — it is the second witness that made `prompt` canonical in
 * `unmodel/upscale`. `Wonder 4` and `Detail` ride the same route with no
 * `prompt` on their pages, so they take {@link enhanceModality}.
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
    // most photos and graphics". 512 MP in, 1024 MP out. The one page that
    // spells its strength dials snake_case; see ./shared.ts on the casing.
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
    // Deprecated, still served. Verified 2026-11-12 on https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/high-fidelity-2.md:
    // “**High Fidelity 2 is deprecated** and will be retired no sooner than
    // January 1, 2027. Use High Fidelity 3 instead.”; “Deprecated” with
    // retirement “Not sooner than January 1, 2027” on https://developer.topazlabs.com/resources/model-deprecations.md.
    status: "deprecated",
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
    // the header. It is the one model here with `recoveryStrength`.
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
    // letterforms.
  },

  // --- POST /image/v1/enhance-gen/async — the generative upscalers ----------
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
    // One-click repair of low-to-medium resolution images. 256 MP in and out.
    // Deprecated, still served. Verified 2026-11-12 on https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-1.md:
    // “**Wonder 1 is deprecated** and will be retired no sooner than January 1,
    // 2027. Use Wonder 3.5 instead.”; “Deprecated” on https://developer.topazlabs.com/resources/model-deprecations.md.
    status: "deprecated",
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
    // Deprecated, still served. Verified 2026-11-12 on https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-2.md:
    // “**Wonder 2 is deprecated** and will be retired no sooner than January 1,
    // 2027. Use Wonder 3.5 instead.”; “Deprecated” on https://developer.topazlabs.com/resources/model-deprecations.md.
    status: "deprecated",
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
    // Deprecated, still served. Verified 2026-11-12 on https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-3.md:
    // “**Wonder 3 is deprecated** and will be retired no sooner than January 1,
    // 2027. Use Wonder 3.5 instead.”; “Deprecated” on https://developer.topazlabs.com/resources/model-deprecations.md.
    status: "deprecated",
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
    // The generative upscaler with the film-grain block.
    // Its page lists a camelCased `outputWidth`/`outputHeight` alongside the
    // envelope's `output_width`/`output_height` and says nothing about
    // precedence — both are typed, neither is preferred.
  },
  /**
   * Topaz's recommended generative upscaler, and per its page a model with no
   * setting at all — no `prompt` either, so its input is the picture alone.
   *
   * Source: https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-4.md — verified 2026-11-12.
   * Quotes: “| `model`   | `string` | Required           | `"Wonder 4"`    | —           |”,
   * “**Wonder 4** costs 1 credit per every 8 MP of generated output.” and “This
   * model accepts up to 256 MP input and output.” The family page,
   * https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative.md:
   * “We recommend using **Wonder 4** for generative upscaling.”
   */
  "Wonder 4": {
    id: "Wonder 4",
    name: "Wonder 4",
    family: "wonder",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceModality,
    limit: { context: 0 },
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
    // Takes `enhancementStrength` as a 0–10 decimal, where Wonder 3 and 3.5
    // take a word. 24 MP in, 384 MP out.
  },
  /**
   * Detail Faces: adds natural detail to faces in AI-generated images. Topaz
   * files it under Precision Upscaling — hence the family label and the classic
   * rate — while it rides this route. Its one setting is `detailStrength`; no
   * `prompt`, so its input is the picture alone. Its page states no MP ceiling.
   *
   * Source: https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/detail-faces.md — verified 2026-11-12.
   * Quotes: “`https://api.topazlabs.com/image/v1/enhance-gen/async`”,
   * “| `model`          | `string`  | Required           | `"Detail"`      | —                                  |”,
   * “**Detail Faces** costs 1 credit per every 24 MP of generated output.” and
   * “Works best when faces in the input are at least 512 × 512 pixels.”
   */
  Detail: {
    id: "Detail",
    name: "Detail Faces",
    family: "gigapixel",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceModality,
    limit: { context: 0 },
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
  /**
   * The creative half of the first Bloom generation, prompt-guided, with
   * `creativityBoost` and `facePreservation` beside the Bloom 2 dials.
   *
   * Source: https://developer.topazlabs.com/image-models/upscaling-and-enhancement/creative/bloom-1-creative.md — verified 2026-11-12.
   * Quotes: “| `model`             | `string`  | Required                                       | `"Bloom"`       | —                                                 |”,
   * “**Bloom 1 Creative** costs 1 credit per every 2 MP of generated output.”
   * and “This model accepts up to 256 MP input and output.”
   *
   * Legacy, not deprecated: the family page,
   * https://developer.topazlabs.com/image-models/upscaling-and-enhancement/creative.md,
   * says “Bloom 1 Creative is a legacy model and is no longer recommended. Bloom
   * 2 replaces this model. This model will be retired no sooner than December 9,
   * 2026.”, while https://developer.topazlabs.com/resources/model-deprecations.md
   * lists `Bloom` as “Active”. Topaz's own lifecycle words keep the two apart
   * (“**Legacy:** The model will no longer receive updates and may be deprecated
   * in the future.”), so the row carries no `status`.
   */
  Bloom: {
    id: "Bloom",
    name: "Bloom 1 Creative",
    family: "bloom",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: enhanceGenModality,
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export type TopazCatalogModelId = keyof typeof models;
