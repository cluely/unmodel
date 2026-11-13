// Hand-maintained — Runway is not in models.dev; refresh from
//   https://docs.dev.runwayml.com/guides/models.md   (model ids per route)
//   https://docs.dev.runwayml.com/guides/pricing.md  (credit costs; "Credit costs are documented only in /guides/pricing.md")
//   https://docs.dev.runwayml.com/openapi.json       (wire schemas; spec version 2024-11-06)
// Verified 2026-11-12: every row against all three pages, credit price
// unchanged.
//
// Pricing conversion (documented so the arithmetic never rots unexplained):
// Runway bills in credits; "Credits can be purchased for $0.01 per credit"
// (guides/pricing.md), so USD = credits × 0.01. Video models are billed in
// credits per second of output → `cost.perVideoSecond` = credits/s × $0.01.
// Image models billed per image → `cost.perImage` = credits × $0.01.
//
// Models whose credit rate depends on request fields (audio on/off,
// resolution, ratio tier, quality) cannot be expressed as a single catalog
// number; their catalog entry carries either the documented
// default-configuration rate (when the driving field has a documented
// default) or no cost at all, with the tier table in a comment. Request-aware
// estimation for all tiers lives in ./pricing.ts.
//
// Ids that appear in the API but are NOT generation models, and so are
// deliberately absent here (openapi.json, verified 2026-11-12):
//   gen3a_turbo, gen4_aleph, act_two — `gen3a_turbo` and `gen4_aleph` survive
//     only in the GET /v1/organization and POST /v1/organization/usage
//     response enums (historical credit reporting); neither has an arm in any
//     generation route's request union, so neither is callable. `gen4_aleph`
//     was superseded by `aleph2` on POST /v1/video_to_video.
//   act_two, gwm1_avatars, magnific_* , seed_audio, eleven_* — real models on
//     routes unmodel does not yet validate (character_performance,
//     image_upscale, video_upscale, and the audio routes).
//   ruby (POST /v1/video_to_hdr), enhance_frame_rate (POST /v1/video_upscale),
//     mirelo_sfx_2_0 (POST /v1/video_to_audio, /v1/sound_effect) and
//     eleven_music_v2_5 (POST /v1/text_to_music) — the same: routes unmodel
//     does not yet validate (openapi.json, 2026-11-12). `ideogram_vector` is
//     catalogued for its text_to_image arm; its POST /v1/image_to_vector
//     route is likewise unvalidated.
//   hailuo3_highspeed, hailuo3_lite, recraft_v4_1_flash, recraft_v4_1_vector —
//     arms in openapi.json and @runwayml/sdk 4.27.0, but on neither
//     guides/models.md ("Only use identifiers listed in /guides/models.md or
//     /api.md" — llms.txt) nor guides/pricing.md, verified 2026-11-12: no
//     published availability or price, so not catalogued. Valid requests for
//     them still pass the route schemas with an `unknown_model` warning.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "runway",
  name: "Runway",
  // The official SDK (@runwayml/sdk) reads RUNWAYML_API_SECRET.
  env: ["RUNWAYML_API_SECRET"],
  doc: "https://docs.dev.runwayml.com/",
} as const satisfies ProviderInfo;

/** USD per Runway credit — https://docs.dev.runwayml.com/guides/pricing.md */
export const CREDIT_USD = 0.01;

/**
 * Models accepted by the video routes (image_to_video / text_to_video /
 * video_to_video). Route coverage is per model — `gen4_turbo` is
 * image_to_video-only and `aleph2` is video_to_video-only — and is enforced
 * from `*_MODELS` in ./constraints.ts, not from this catalog.
 */
export const videoModels = {
  aleph2: {
    id: "aleph2",
    name: "Aleph 2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // video_to_video only: edits an input video (≤30s) with text + keyframes.
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // 28 credits/s, 56-credit minimum per generation — guides/pricing.md.
    // Output duration follows the input video, which unmodel cannot read from
    // a URI, so no per-request estimate is produced (see ./pricing.ts).
    cost: { perVideoSecond: 28 * CREDIT_USD },
  },
  "gen4.5": {
    id: "gen4.5",
    name: "Gen-4.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 12 credits/s — guides/pricing.md
    cost: { perVideoSecond: 12 * CREDIT_USD },
  },
  gen4_turbo: {
    id: "gen4_turbo",
    name: "Gen-4 Turbo",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // image_to_video only (models.md lists input: Image).
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 5 credits/s — guides/pricing.md
    cost: { perVideoSecond: 5 * CREDIT_USD },
  },
  "veo3.1": {
    id: "veo3.1",
    name: "Veo 3.1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 40 credits/s with audio (the documented default, `audio` defaults to
    // true in the request schema); 20 credits/s with `audio: false` —
    // guides/pricing.md. ./pricing.ts picks the right tier per request.
    cost: { perVideoSecond: 40 * CREDIT_USD },
  },
  "veo3.1_fast": {
    id: "veo3.1_fast",
    name: "Veo 3.1 Fast",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // 15 credits/s with audio (default true); 10 credits/s without —
    // guides/pricing.md.
    cost: { perVideoSecond: 15 * CREDIT_USD },
  },
  hailuo3: {
    id: "hailuo3",
    name: "Hailuo 3.0",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // "| `hailuo3` (2K) | 15 credits per second, plus 2 credits per reference
    // image or keyframe (including an image-to-video start frame)" (10 at
    // 768P) — guides/pricing.md; "`resolution` of `768P` or `2K` (default
    // `2K`)" — assets/inputs.md, 2026-11-12. The catalog carries the default
    // rate. See ./pricing.ts.
    cost: { perVideoSecond: 15 * CREDIT_USD },
  },
  happyhorse_1_0: {
    id: "happyhorse_1_0",
    name: "Happyhorse 1.0",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: 15 credits/s at 720p, 30 credits/s at 1080p
    // (guides/pricing.md, 2026-11-12). image_to_video defaults to `720P`
    // (assets/inputs.md); text_to_video documents no default. See
    // ./pricing.ts.
  },
  seedance2: {
    id: "seedance2",
    name: "Seedance 2.0",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: "| `seedance2` (480p) | 14 credits per second (56
    // credit minimum per generation) |", 30 at 720p, 40 at 1080p, 150 at 4K
    // (guides/pricing.md, 2026-11-12); the tier follows the requested
    // `ratio`, and the API reference documents no default. See ./pricing.ts.
  },
  seedance2_fast: {
    id: "seedance2_fast",
    name: "Seedance 2.0 Fast",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: "| `seedance2_fast` (480p) | 11 credits per second (44
    // credit minimum per generation) |" and 24 at 720p (guides/pricing.md,
    // 2026-11-12); no default ratio is documented. See ./pricing.ts.
  },
  seedance2_mini: {
    id: "seedance2_mini",
    name: "Seedance 2.0 Mini",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: "| `seedance2_mini` (480p) | 7 credits per second (28
    // credit minimum per generation) |" and 15 at 720p (guides/pricing.md,
    // 2026-11-12); no default ratio is documented. See ./pricing.ts.
  },
  seedance2_5: {
    id: "seedance2_5",
    name: "Seedance 2.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // "| `seedance2_5` (720p) | 30 credits per second of output, plus 15
    // credits per second of input and reference video" (20 / 10 at 480p, 68 /
    // 34 at 1080p, 80-credit minimum — guides/pricing.md); the ratio
    // "Defaults to `1280:720`" (openapi.json, 2026-11-12). The catalog carries
    // the default (720p) output rate. See ./pricing.ts.
    cost: { perVideoSecond: 30 * CREDIT_USD },
  },
  grok_imagine_1_5: {
    id: "grok_imagine_1_5",
    name: "Grok Imagine Video 1.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // "| `grok_imagine_1_5` (480p) | 10 credits per second, plus 1 credit per
    // image or audio reference" (16 / 29 at 720p / 1080p) — guides/pricing.md;
    // "`resolution` of `480p`, `720p`, or `1080p` (default `480p`)" —
    // assets/inputs.md, 2026-11-12. The catalog carries the default rate.
    cost: { perVideoSecond: 10 * CREDIT_USD },
  },
  gemini_omni_flash: {
    id: "gemini_omni_flash",
    name: "Gemini Omni Flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // 10 credits/s (text- and image-to-video; image-to-video adds 1 credit
    // for the first-frame image) — guides/pricing.md
    cost: { perVideoSecond: 10 * CREDIT_USD },
  },
  // Kling (guides/pricing.md, 2026-11-12). The 2.5 / 3.0 arms are on
  // image_to_video and text_to_video; the O3 and 4.0 arms also edit video.
  "kling2.5_turbo_pro": {
    id: "kling2.5_turbo_pro",
    name: "Kling 2.5 Turbo Pro",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // "| `kling2.5_turbo_pro`      | 12 credits per second" — guides/pricing.md, 2026-11-12
    cost: { perVideoSecond: 12 * CREDIT_USD },
  },
  "kling3.0_standard": {
    id: "kling3.0_standard",
    name: "Kling 3.0 Standard",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // "| `kling3.0_standard` (audio) | 13 credits per second" / "(no audio) |
    // 9 credits per second"; "`audio` defaults to `true`" — guides/pricing.md,
    // 2026-11-12. The catalog carries the default (audio) rate.
    cost: { perVideoSecond: 13 * CREDIT_USD },
  },
  "kling3.0_pro": {
    id: "kling3.0_pro",
    name: "Kling 3.0 Pro",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // "| `kling3.0_pro` (audio)    | 17 credits per second" / "(no audio) |
    // 12 credits per second" — guides/pricing.md, 2026-11-12 (audio default).
    cost: { perVideoSecond: 17 * CREDIT_USD },
  },
  "kling3.0_4k": {
    id: "kling3.0_4k",
    name: "Kling 3.0 4K",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // "| `kling3.0_4k`             | 43 credits per second"; "Kling 3.0 4K
    // uses the same rate either way." — guides/pricing.md, 2026-11-12
    cost: { perVideoSecond: 43 * CREDIT_USD },
  },
  klingO3_standard: {
    id: "klingO3_standard",
    name: "Kling O3 Standard",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // "| `klingO3_standard`        | 13 credits per second"; "Kling O3 is
    // billed at the rates above whether or not `audio` is `false`. Kling O3
    // video-to-video is billed per second of the input video." —
    // guides/pricing.md, 2026-11-12
    cost: { perVideoSecond: 13 * CREDIT_USD },
  },
  klingO3_pro: {
    id: "klingO3_pro",
    name: "Kling O3 Pro",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // "| `klingO3_pro`             | 17 credits per second" — guides/pricing.md, 2026-11-12
    cost: { perVideoSecond: 17 * CREDIT_USD },
  },
  klingO3_4k: {
    id: "klingO3_4k",
    name: "Kling O3 4K",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // "| `klingO3_4k`              | 43 credits per second" — guides/pricing.md, 2026-11-12
    cost: { perVideoSecond: 43 * CREDIT_USD },
  },
  kling_4: {
    id: "kling_4",
    name: "Kling 4.0",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: "List price: 15.7 and 9.4 credits per second" at 720p
    // and "23.5 and 14.1" at 1080p (without / with an input video, which also
    // bills its own seconds), and "20% off through November 30, 2026 UTC …
    // List prices apply from December 1, 2026 UTC." — guides/pricing.md,
    // 2026-11-12. A time-bound promotion over a tier- and input-dependent
    // rate is no catalog number. ./pricing.ts estimates at list price.
  },
  kling_4_flash: {
    id: "kling_4_flash",
    name: "Kling 4.0 Flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // "| `kling_4_flash` (720p) | 9.4 credits per second without input video;
    // with input video, 6.3 credits per second of output plus 6.3 credits per
    // second of the greater of total input-video duration and output
    // duration. Rounded up to the next credit; 29-credit minimum" —
    // guides/pricing.md, 2026-11-12. 720p is its only tier, so the catalog
    // carries the no-input-video rate. See ./pricing.ts.
    cost: { perVideoSecond: 9.4 * CREDIT_USD },
  },
  wan3: {
    id: "wan3",
    name: "WAN 3.0",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // 5 / 10 / 20 credits/s at 480p / 720p / 1080p ("| `wan3` (1080p) | 20
    // credits per second" — guides/pricing.md); "WAN 3.0 supports 480p, 720p,
    // and 1080p (default `auto_1080p`)" — assets/inputs.md, 2026-11-12. The
    // catalog carries the default (1080p) rate; ./pricing.ts tiers by `ratio`.
    cost: { perVideoSecond: 20 * CREDIT_USD },
  },
  wan3_prime: {
    id: "wan3_prime",
    name: "WAN 3.0 Prime",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: 6.8 / 14 / 28 credits/s at 480p / 720p / 1080p ("|
    // `wan3_prime` (1080p)      | 28 credits per second" — guides/pricing.md,
    // 2026-11-12), and no default ratio is documented for Prime. See
    // ./pricing.ts.
  },
  h3_max: {
    id: "h3_max",
    name: "MiniMax H3 Max",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: "| `h3_max` (480p) | 5 credits per second" / "(768p) |
    // 8 credits per second" — guides/pricing.md, 2026-11-12; no default
    // resolution is documented. See ./pricing.ts.
  },
  grok_imagine_1_5_lite: {
    id: "grok_imagine_1_5_lite",
    name: "Grok Imagine Video 1.5 Lite",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    // "| `grok_imagine_1_5_lite` (480p) | 2 credits per second, plus 1 credit
    // for an image-to-video start frame |" (3 at 720p, 14 at 1080p) —
    // guides/pricing.md; defaults "`848:480`" (text-to-video) and
    // "`auto_480p`" (image-to-video) — assets/inputs.md, 2026-11-12. The
    // catalog carries the default (480p) rate.
    cost: { perVideoSecond: 2 * CREDIT_USD },
  },
  "gemini_omni_flash_1.1": {
    id: "gemini_omni_flash_1.1",
    name: "Gemini Omni Flash 1.1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // No single rate: 3.4 / 10 / 15 / 30 credits/s at 360p / 720p / 1080p /
    // 4K, "plus 1 credit per reference image (including an image-to-video
    // start frame) and 1 credit per second of input video" —
    // guides/pricing.md, 2026-11-12; no default ratio is documented for 1.1.
    // See ./pricing.ts.
  },
  "gemini_omni_flash_1.2": {
    id: "gemini_omni_flash_1.2",
    name: "Gemini Omni 1.2 Flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video"] },
    limit: { context: 0 },
    // "| `gemini_omni_flash_1.2` (720p) | 7 credits per second, plus 1 credit
    // per reference image or keyframe and 1 credit per second of input video
    // |"; "`gemini_omni_flash_1.2` defaults to 720p." — guides/pricing.md,
    // 2026-11-12 (2 / 10 / 21 at 360p / 1080p / 4K). See ./pricing.ts.
    cost: { perVideoSecond: 7 * CREDIT_USD },
  },
} as const satisfies Record<string, ModelInfo>;

/** Models accepted by the text_to_image route. */
export const imageModels = {
  gen4_image: {
    id: "gen4_image",
    name: "Gen-4 Image",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // "5 credits per 720p image, or 8 credits per 1080p image"
    // (guides/pricing.md) — the ratio→tier mapping is not documented, so no
    // single catalog rate; ./pricing.ts estimates worst-case (8 credits).
  },
  gen4_image_turbo: {
    id: "gen4_image_turbo",
    name: "Gen-4 Image Turbo",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 2 credits per image, any resolution — guides/pricing.md
    cost: { perImage: 2 * CREDIT_USD },
  },
  gpt_image_2: {
    id: "gpt_image_2",
    name: "GPT Image 2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 1–41 credits per image by quality × resolution tier (default quality
    // is high: 20 credits at 1K/2K, 41 at 4K/auto) — guides/pricing.md.
    // See ./pricing.ts for the full tier table.
  },
  gemini_image3_pro: {
    id: "gemini_image3_pro",
    name: "Gemini Image 3 Pro",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 20 credits per 1K/2K image, 40 per 4K image — guides/pricing.md.
    // See ./pricing.ts.
  },
  "gemini_image3.1_flash": {
    id: "gemini_image3.1_flash",
    name: "Gemini Image 3.1 Flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No single rate: "| `gemini_image3.1_flash`   | 5 credits per 512px
    // image, 7 credits per 1K image, 11 credits per 2K image, 16 credits per
    // 4K image |" — guides/pricing.md, 2026-11-12; the tier follows `ratio`.
    // See ./pricing.ts.
  },
  seedream5_pro: {
    id: "seedream5_pro",
    name: "Seedream 5.0 Pro",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per 1K image, 9 per 2K image (auto_1k/auto_2k bill at their
    // tier) — guides/pricing.md. See ./pricing.ts.
  },
  seedream5_lite: {
    id: "seedream5_lite",
    name: "Seedream 5.0 Lite",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 4 credits per image, any resolution — guides/pricing.md
    cost: { perImage: 4 * CREDIT_USD },
  },
  grok_imagine_image_2: {
    id: "grok_imagine_image_2",
    name: "Grok Imagine Image 2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // Billed as outputCount × perImage + referenceCount × 1, where perImage
    // is 4 (low/1K), 6 (low/2K or medium/1K), or 8 (medium/2K) credits —
    // guides/pricing.md. See ./pricing.ts.
  },
  "gemini_2.5_flash": {
    id: "gemini_2.5_flash",
    name: "Gemini 2.5 Flash Image",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 5 credits per image, any resolution — guides/pricing.md
    cost: { perImage: 5 * CREDIT_USD },
  },
  muse_image: {
    id: "muse_image",
    name: "Muse Image",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // "| `muse_image`              | 1 credit per image, any resolution" —
    // guides/pricing.md, 2026-11-12
    cost: { perImage: 1 * CREDIT_USD },
  },
  "gemini_image3.1_flash_lite": {
    id: "gemini_image3.1_flash_lite",
    name: "Nano Banana 2 Lite",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // "| `gemini_image3.1_flash_lite` | 4 credits per 1K image |" (its ten
    // sizes are all 1K) — guides/pricing.md, 2026-11-12
    cost: { perImage: 4 * CREDIT_USD },
  },
  "nano_banana_2.1": {
    id: "nano_banana_2.1",
    name: "Nano Banana 2.1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No single rate: "| `nano_banana_2.1`         | 4 credits per 1K image,
    // 6 credits per 2K image, 12 credits per 4K image" — guides/pricing.md,
    // 2026-11-12; the tier follows `ratio`. See ./pricing.ts.
  },
  gpt_image_2_5_flare: {
    id: "gpt_image_2_5_flare",
    name: "GPT Image 2.5 Flare",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No single rate: "1–75 credits per image, by quality, resolution and
    // aspect ratio, plus 1 credit per reference image" — guides/pricing.md,
    // 2026-11-12. See ./pricing.ts for the three tables.
  },
  gpt_image_2_5_sunburst: {
    id: "gpt_image_2_5_sunburst",
    name: "GPT Image 2.5 Sunburst",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No single rate — the same tables as gpt_image_2_5_flare
    // (guides/pricing.md, 2026-11-12). See ./pricing.ts.
  },
  gpt_image_2_6_flare: {
    id: "gpt_image_2_6_flare",
    name: "GPT Image 2.6 Flare",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No single rate: "PNG/JPEG/WebP: 2–19 credits per image plus 1 per
    // reference image; GIF and SVG prices below" — guides/pricing.md,
    // 2026-11-12. See ./pricing.ts.
  },
  gpt_image_2_6_sunburst: {
    id: "gpt_image_2_6_sunburst",
    name: "GPT Image 2.6 Sunburst",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No single rate — the same tables as gpt_image_2_6_flare
    // (guides/pricing.md, 2026-11-12). See ./pricing.ts.
  },
  bria_fibo_1_5: {
    id: "bria_fibo_1_5",
    name: "FIBO 1.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No single rate: "| `bria_fibo_1_5`           | 5 credits per 1MP
    // image, 10 credits per 4MP image" — guides/pricing.md, 2026-11-12; the
    // tier follows `ratio`. See ./pricing.ts.
  },
  bria_fibo_edit_1_5: {
    id: "bria_fibo_edit_1_5",
    name: "FIBO Edit 1.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // "| `bria_fibo_edit_1_5`      | 5 credits per image" — guides/pricing.md, 2026-11-12
    cost: { perImage: 5 * CREDIT_USD },
  },
  ideogram_4_0: {
    id: "ideogram_4_0",
    name: "Ideogram 4.0",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 4 / 7 / 11 credits per image at low / medium / high; "`ideogram_4_0`
    // defaults to `medium`." — guides/pricing.md, 2026-11-12. The catalog
    // carries the default rate.
    cost: { perImage: 7 * CREDIT_USD },
  },
  ideogram_4_5: {
    id: "ideogram_4_5",
    name: "Ideogram 4.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No single rate: 1 / 4 / 8 / 25 credits per image at very_low / low /
    // medium / high, and "`ideogram_4_5` defaults to `medium` when generating
    // from reference images and `high` otherwise" — guides/pricing.md,
    // 2026-11-12. See ./pricing.ts.
  },
  ideogram_vector: {
    id: "ideogram_vector",
    name: "Ideogram Vector",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // 14 / 17 / 22 credits per SVG at low / medium / high (35 at high with
    // reference images); "On text to image, it is billed by `quality`, which
    // defaults to `medium`." — guides/pricing.md, 2026-11-12. One SVG per
    // request; the catalog carries the default rate.
    cost: { perImage: 17 * CREDIT_USD },
  },
  seedream5_flash: {
    id: "seedream5_flash",
    name: "Seedream 5.0 Flash",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // "| `seedream5_flash`         | 2 credits per image, any resolution" —
    // guides/pricing.md, 2026-11-12
    cost: { perImage: 2 * CREDIT_USD },
  },
  seedream5_pro_layers: {
    id: "seedream5_pro_layers",
    name: "Seedream 5 Pro Layers",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["image"] },
    limit: { context: 0 },
    // No single rate: "3 credits per 1K or 1.5K image, 5 credits per 2K or
    // auto image, for the base image and each layer", billed per returned
    // image, of which there are up to 17 — guides/pricing.md, 2026-11-12. See
    // ./pricing.ts.
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...videoModels,
  ...imageModels,
} as const satisfies Record<string, ModelInfo>;

export type RunwayVideoModelId = keyof typeof videoModels;
export type RunwayImageModelId = keyof typeof imageModels;
export type RunwayModelId = keyof typeof models;
