/**
 * unmodel/topaz — Topaz Labs' Image API.
 *
 * `https://api.topazlabs.com/image/v1`, multipart form bodies,
 * `X-API-Key: <TOPAZ_API_KEY>`.
 *
 * ## What is here
 *
 * Both image UPSCALE routes, which is what `unmodel/upscale` is about:
 *
 * - `upscale` — `POST /image/v1/enhance/async`, the Gigapixel family: six
 *   classic (GAN) models that enlarge what is already in the picture.
 * - `upscaleGenerative` — `POST /image/v1/enhance-gen/async`, the Wonder and
 *   Bloom families: nine diffusion models that ADD detail, steered by a prompt
 *   and a creativity dial.
 *
 * Two addresses because Topaz publishes two paths with disjoint model enums and
 * different dials — a wire route fork, which is what a qualified address names.
 * `unmodel/upscale` hides the fork: its adapter picks the URL from the ref.
 *
 * ## Three things worth knowing before your first call
 *
 * **The body is a FORM, always.** Neither path declares a JSON arm, so even a
 * request whose only input is `source_url` is `multipart/form-data`. Post
 * `toFormData(params)`, never `JSON.stringify(params)`, and do not set
 * `content-type` — `fetch` derives the boundary. `.request.headers` is empty
 * for exactly that reason, and `.request.body` is `"form"`.
 *
 * **The dials are not in the OpenAPI document.** Every request schema ends
 * `additionalProperties: { type: string }`, so the machine-readable spec knows
 * the envelope (`model`, `output_width`, `output_height`, `crop_to_fill`,
 * `output_format`, `webhook_url`) and nothing about `creativity`, `texture`,
 * `faceEnhancement`, `denoise`, `strength` or `prompt`. Those are documented in
 * prose, per model, and are transcribed in `./shared.ts` — which is the whole
 * argument for a hand provider here. Topaz IGNORES a setting a model does not
 * read rather than refusing it, so a wrong dial is a silent no-op at the API
 * and a warning here.
 *
 * **Three calls minimum.** `POST …/async` answers `{ process_id, source_id,
 * eta }` (also in the `X-Process-ID` / `X-Source-ID` / `X-ETA` headers); poll
 * `statusUrl(process_id)` until `status` is `"Completed"`; then
 * `downloadUrl(process_id)` for a presigned link that expires after an hour.
 * `eta` is a Unix timestamp of the expected finish — schedule the first poll
 * against it rather than against a fixed interval. `webhook_url` replaces the
 * polling entirely.
 *
 * ## The model ids have spaces in them
 *
 * `"Standard V2"`, `"Upscale High Fidelity V3"`, `"Bloom Realism"` — Topaz's
 * `model` field takes product names rather than slugs, so a ref reads
 * `"topaz/Standard V2"`. They are the wire values verbatim; slugging them would
 * invent a vocabulary and then need a table to undo it.
 *
 * ## What is deliberately NOT here
 *
 * **The rest of the Image API.** `/denoise`, `/sharpen`, `/sharpen-gen`,
 * `/restore-gen` (dust and scratches), `/lighting` (relight, white balance,
 * colorize) and `/matting` (object matting, background removal) are separate
 * routes with their own model enums, and none of them upscales — they clean,
 * sharpen, relight or cut out a picture at the size it arrived. An `upscale`
 * verb that reached them would be an address that no longer names what the
 * endpoint does. They are strong candidates for a future operation of their
 * own. `/tool/async` ("Transparency Upscale") is the near miss: it DOES
 * upscale, preserving alpha, and it is still a third route with a one-value
 * enum, so it would be a third address rather than a model here.
 *
 * **The Video API.** `https://api.topazlabs.com/video` is real, separately
 * specced and genuinely useful, and it is absent because it is not a request —
 * it is a five-step protocol (quote → accept → S3 multipart upload →
 * complete-upload → poll) in which only the first step has a body, its body
 * needs facts about the file that only the caller can probe (`container`,
 * `duration`, `frameCount`, `frameRate`, `resolution`), and its model ids are
 * opaque codes (`prob-4`, `iris-3`, `thd-3`) whose mapping to the published
 * product names appears nowhere in the spec. `unmodel/upscale` reaches
 * `topaz/upscale/video/precision` through fal, which is the sort of gap an
 * aggregator is for. See `./models.ts` for the argument in full.
 */

export { upscale, upscaleConstraints, DEFAULT_ENHANCE_MODEL, ENHANCE_MODELS } from "./upscale";
export type { TopazUpscaleParams } from "./upscale";

export {
  upscaleGenerative,
  upscaleGenerativeConstraints,
  DEFAULT_ENHANCE_GEN_MODEL,
  ENHANCE_GEN_MODELS,
} from "./upscale-generative";
export type { TopazUpscaleGenerativeParams } from "./upscale-generative";

export {
  DOCS_BASE,
  ENHANCE_GEN_URL,
  ENHANCE_URL,
  ESTIMATE_GEN_URL,
  ESTIMATE_URL,
  OUTPUT_DIMENSION_MAX,
  OUTPUT_DIMENSION_MIN,
  PROMPT_MAX_CHARS,
  TOPAZ_ENHANCEMENT_STRENGTHS,
  TOPAZ_ENHANCE_GEN_MODELS,
  TOPAZ_ENHANCE_MODELS,
  TOPAZ_GRAIN_MODELS,
  TOPAZ_IMAGE_BASE_URL,
  TOPAZ_INPUT_FORMATS,
  TOPAZ_MEGAPIXEL_LIMITS,
  TOPAZ_MODELS,
  TOPAZ_OUTPUT_FORMATS,
  TOPAZ_SETTINGS_BY_MODEL,
  TOPAZ_STATUSES,
  TOPAZ_SUBJECT_DETECTION,
  cancelUrl,
  downloadUrl,
  statusUrl,
  toFormData,
} from "./shared";
export type {
  TopazEnhanceGenModel,
  TopazEnhanceGenSettings,
  TopazEnhanceModel,
  TopazEnhanceSettings,
  TopazEnhancementStrength,
  TopazFaceSettings,
  TopazGrainModel,
  TopazModelId,
  TopazModelSettings,
  TopazOutputFormat,
  TopazStatus,
  TopazSubjectDetection,
} from "./shared";

export {
  CREDIT_USD,
  MP_PER_CREDIT,
  TOPAZ_PRICING_FAMILY,
  topazCostUSD,
  topazCredits,
} from "./pricing";
export type { TopazCostInputs, TopazPricingFamily } from "./pricing";

export { models, provider } from "./models";
export type { TopazCatalogModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
