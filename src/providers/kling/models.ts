// Hand-maintained — Kling AI (Kuaishou) is not in models.dev; refresh from
//   https://kling.ai/document-api/api/get-started/authentication          (base URL, auth)
//   https://kling.ai/document-api/apiReference/model/textToVideo          (POST /v1/videos/text2video)
//   https://kling.ai/document-api/apiReference/model/imageToVideo         (POST /v1/videos/image2video)
//   https://kling.ai/document-api/api/video/1-0/text-to-video             (POST /v1/videos/text2video)
//   https://kling.ai/document-api/api/video/1-0/image-to-video            (POST /v1/videos/image2video)
//   https://kling.ai/document-api/api/image/3-0-omni/image-generation     (POST /v1/images/generations)
//   https://kling.ai/document-api/api/image/3-0-omni/image-omni           (POST /v1/images/omni-image)
//   https://kling.ai/document-api/guides/capability-map/video             (per-model capability matrix)
//   https://kling.ai/document-api/pricing/base/video                      (USD per second)
//   https://kling.ai/document-api/pricing/base/image                      (USD per image)
// and, for the EXPERIMENTAL path-addressed video family only (see below):
//   https://kling.ai/document-api/api/video/3-0-omni/text-to-video        (POST /text-to-video/kling-3.0)
//   https://kling.ai/document-api/api/video/3-0-omni/image-to-video       (POST /image-to-video/kling-3.0)
//   https://kling.ai/document-api/api/video/3-0-omni/video-omni           (POST /omni-video/kling-3.0-omni)
//   https://kling.ai/document-api/api/video/3-0-turbo/text-to-video       (POST /text-to-video/kling-3.0-turbo)
//   https://kling.ai/document-api/api/video/2-6/text-to-video             (POST /text-to-video/kling-2.6)
//   https://kling.ai/document-api/api/video/2-5-turbo/text-to-video       (POST /text-to-video/kling-2.5-turbo)
//   https://kling.ai/document-api/api/video/o1/video-omni                 (POST /omni-video/kling-o1)
// Verified 2026-08-13.
//
// TWO ROUTE FAMILIES / TWO ID SPACES, deliberately kept apart:
//   - CORROBORATED — `POST /v1/videos/text2video` and `/v1/videos/image2video`
//     take a `model_name` BODY field (`kling-v3`, `kling-v2-6`, …), which is
//     also the id space the capability map and the whole image API use
//     (`v1VideoModels` / `imageModels` / `omniImageModels`). Independently
//     confirmed: the endpoint line on `apiReference/model/textToVideo` reads
//     `POST https://api-singapore.klingai.com/v1/videos/text2video`, and the
//     polling route is `GET /v1/videos/text2video/{task_id}`. These are the
//     primary exports — `kling.textToVideo` / `kling.imageToVideo`.
//   - EXPERIMENTAL — a path-addressed family (`POST /text-to-video/kling-3.0`,
//     `/omni-video/kling-o1`, polled via `GET /tasks`) keyed by the path
//     segment (`pathVideoModels`). Its route shapes were recovered by
//     evaluating the doc site's own JS bundle, NOT read off a served page, and
//     no independent source corroborates them (the doc site answers HTTP 446
//     to every non-browser client and serves one byte-identical SPA shell to
//     curl, so no fetch can ever confirm or refute them). Exported under the
//     experimental names `kling.textToVideoV3` / `kling.imageToVideoV3` /
//     `kling.omniVideo` — see those modules' EXPERIMENTAL notes.
// Both spellings name the same weights; ./pricing.ts normalizes them so a
// request priced through either route lands on the same rate.
//
// Pricing conversion (documented so the arithmetic never rots unexplained):
// Kling bills prepaid "Units" and the pricing pages print the USD equivalent
// beside every rate, so the numbers below are transcriptions. Note the unit
// price differs per resource package: video Units are $0.14 each
// (0.8 Units = $0.112 /s) while image Units are $0.0035 each
// (8 Units = $0.028 /image) — which is exactly why unmodel records USD and
// never multiplies Units itself.
//
// Which rate an entry carries: the DEFAULT configuration's rate — `mode`
// defaults to `std` (720P) on the `/v1/videos/*` routes and
// `settings.resolution` to `720p` on the path-addressed ones, with audio off
// by default — and ./pricing.ts carries the full resolution × audio ×
// video-input tier tables.
//
// Model coverage vs. the artificialanalysis census: every census entry maps to
// a documented id — Kling 3.0 Pro/Standard and 3.0 Omni Pro/Standard are the
// 1080p/720p tiers of `kling-3.0` / `kling-3.0-omni` (`kling-v3` /
// `kling-v3-omni` in the `model_name` space), Kling O1 Pro/Standard are
// `kling-o1` (`kling-video-o1`), the dated "Kling 2.6 Pro (December/January)" variants
// are all `kling-2.6` / `kling-v2-6`, and 2.5 Turbo, 2.1 Master, 2.1, 2.0,
// 1.6, 1.5 and 1.0 map to the ids below. On the image side, the census's
// Kolors 2.1 is `kling-v2-1`, Kling Image 3.0 is `kling-v3`, and Kling Image
// 3.0 Omni / Kling Image O1 are `kling-v3-omni` / `kling-image-o1` on
// `POST /v1/images/omni-image`.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "kling",
  name: "Kling AI (Kuaishou)",
  // Auth is `Authorization: Bearer <API key or JWT>`; the docs' JWT recipe is
  // the caller's problem — unmodel never touches keys.
  env: ["KLING_API_KEY", "KLING_ACCESS_KEY", "KLING_SECRET_KEY"],
  doc: "https://kling.ai/document-api",
} as const satisfies ProviderInfo;

const videoModality = { input: ["text", "image"], output: ["video"] } as const;
const omniModality = { input: ["text", "image", "video"], output: ["video"] } as const;

/**
 * EXPERIMENTAL — models addressed by URL path on the uncorroborated
 * path-addressed video routes (`/text-to-video/{model}`,
 * `/image-to-video/{model}`, `/omni-video/{model}`). See the header comment:
 * these ids and routes come from the doc site's JS bundle and no reachable
 * source confirms them. For the corroborated `model_name` spellings of the
 * same weights use `v1VideoModels` (`kling-3.0` is `kling-v3` there).
 */
export const pathVideoModels = {
  "kling-3.0": {
    id: "kling-3.0",
    name: "Kling 3.0",
    family: "kling-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // 0.6 Units ($0.084)/s silent at the default 720p; 0.8 ($0.112) at 1080p,
    // 3.0 ($0.42) at 4K, and more with native audio — see ./pricing.ts.
    cost: { perVideoSecond: 0.084 },
  },
  "kling-3.0-turbo": {
    id: "kling-3.0-turbo",
    name: "Kling 3.0 Turbo",
    family: "kling-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // 0.8 Units ($0.112)/s at 720p, 1.0 ($0.14) at 1080p.
    cost: { perVideoSecond: 0.112 },
  },
  "kling-3.0-omni": {
    id: "kling-3.0-omni",
    name: "Kling 3.0 Omni",
    family: "kling-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: omniModality,
    limit: { context: 0 },
    // 0.6 Units ($0.084)/s with no video input and no native audio at 720p.
    cost: { perVideoSecond: 0.084 },
  },
  "kling-o1": {
    id: "kling-o1",
    name: "Kling O1",
    family: "kling-o1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: omniModality,
    limit: { context: 0 },
    // 0.6 Units ($0.084)/s with no video input at 720p.
    cost: { perVideoSecond: 0.084 },
  },
  "kling-2.6": {
    id: "kling-2.6",
    name: "Kling 2.6",
    family: "kling-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: omniModality,
    limit: { context: 0 },
    // 0.3 Units ($0.042)/s silent at 720p; 0.5 ($0.07) at 1080p.
    cost: { perVideoSecond: 0.042 },
  },
  "kling-2.5-turbo": {
    id: "kling-2.5-turbo",
    name: "Kling 2.5 Turbo",
    family: "kling-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.042 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * `model_name` values on the corroborated `POST /v1/videos/*` routes — the
 * id space `kling.textToVideo` and `kling.imageToVideo` validate against.
 */
export const v1VideoModels = {
  "kling-v3": {
    id: "kling-v3",
    name: "Kling 3.0",
    family: "kling-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.084 },
  },
  "kling-v2-6": {
    id: "kling-v2-6",
    name: "Kling 2.6",
    family: "kling-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: omniModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.042 },
  },
  "kling-v2-5-turbo": {
    id: "kling-v2-5-turbo",
    name: "Kling 2.5 Turbo",
    family: "kling-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.042 },
  },
  "kling-v2-1-master": {
    id: "kling-v2-1-master",
    name: "Kling 2.1 Master",
    family: "kling-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // 1080P only: 2.0 Units ($0.28)/s.
    cost: { perVideoSecond: 0.28 },
  },
  "kling-v2-1": {
    id: "kling-v2-1",
    name: "Kling 2.1",
    family: "kling-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // image_to_video only — the capability map marks text-to-video
    // unsupported for this id.
    modalities: videoModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.056 },
  },
  "kling-v2-master": {
    id: "kling-v2-master",
    name: "Kling 2.0 Master",
    family: "kling-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: videoModality,
    limit: { context: 0 },
    // 1080P only: 2.0 Units ($0.28)/s.
    cost: { perVideoSecond: 0.28 },
  },
  "kling-v1-6": {
    id: "kling-v1-6",
    name: "Kling 1.6",
    family: "kling-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: omniModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.056 },
  },
  "kling-v1-5": {
    id: "kling-v1-5",
    name: "Kling 1.5",
    family: "kling-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // image_to_video only on the `/v1/videos/*` routes.
    modalities: videoModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.056 },
  },
  "kling-v1": {
    id: "kling-v1",
    name: "Kling 1.0",
    family: "kling-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: omniModality,
    limit: { context: 0 },
    // 0.2 Units ($0.028)/s at 720P; 0.7 ($0.098) at 1080P.
    cost: { perVideoSecond: 0.028 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Every VIDEO row, in both spellings — the unambiguous per-kind lookup. The
 * two id spaces are disjoint (`kling-v3` vs `kling-3.0`), so nothing shadows
 * anything here and every entry is priced `perVideoSecond`. Use this (not
 * `models`) when a video rate is what you mean: four ids also name image
 * models, and `models` merges those into dual-kind rows.
 */
export const videoModels = {
  ...v1VideoModels,
  ...pathVideoModels,
} as const satisfies Record<string, ModelInfo>;

const imageModality = { input: ["text", "image"], output: ["image"] } as const;

/**
 * `model_name` values on `POST /v1/images/generations` — and the unambiguous
 * per-kind IMAGE lookup: every entry is priced `perImage`. Four of these ids
 * (`kling-v3`, `kling-v2-1`, `kling-v1-5`, `kling-v1`) also name a different
 * VIDEO model on `POST /v1/videos/*`; use this map, never `models`, when an
 * image rate is what you mean. (`POST /v1/images/omni-image` has its own,
 * disjoint id space — see `omniImageModels`.)
 */
export const imageModels = {
  "kling-v3": {
    id: "kling-v3",
    name: "Kling Image 3.0",
    family: "kling-image-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: imageModality,
    limit: { context: 0 },
    // 8 Units ($0.028) per 1K/2K image.
    cost: { perImage: 0.028 },
  },
  "kling-v2-1": {
    id: "kling-v2-1",
    name: "Kling Image 2.1 (Kolors 2.1)",
    family: "kling-image-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: imageModality,
    limit: { context: 0 },
    // 4 Units ($0.014) per text-to-image; 8 ($0.028) image-to-image and
    // 16 ($0.056) multi-image-to-image — see ./pricing.ts.
    cost: { perImage: 0.014 },
  },
  "kling-v2-new": {
    id: "kling-v2-new",
    name: "Kling Image 2.1 New",
    family: "kling-image-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: imageModality,
    limit: { context: 0 },
    // The pricing page's "Kling Image 2.1 New" row (image-to-image, 1K,
    // 8 Units) is the only row left once every other name is matched to an
    // id, but the page never prints the id itself — so the name is recorded
    // by elimination and no rate is claimed here.
  },
  "kling-v2": {
    id: "kling-v2",
    name: "Kling Image 2.0",
    family: "kling-image-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: imageModality,
    limit: { context: 0 },
    // 4 Units ($0.014) per text-to-image; 8 ($0.028) image-to-image.
    cost: { perImage: 0.014 },
  },
  "kling-v1-5": {
    id: "kling-v1-5",
    name: "Kling Image 1.5",
    family: "kling-image-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: imageModality,
    limit: { context: 0 },
    cost: { perImage: 0.014 },
  },
  "kling-v1": {
    id: "kling-v1",
    name: "Kling Image 1.0",
    family: "kling-image-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: imageModality,
    limit: { context: 0 },
    // 1 Unit ($0.0035) per image.
    cost: { perImage: 0.0035 },
  },
} as const satisfies Record<string, ModelInfo>;

/** `model_name` values on `POST /v1/images/omni-image`. */
export const omniImageModels = {
  "kling-image-o1": {
    id: "kling-image-o1",
    name: "Kling Image O1",
    family: "kling-image-o1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: imageModality,
    limit: { context: 0 },
    // 8 Units ($0.028) per 1K/2K image.
    cost: { perImage: 0.028 },
  },
  "kling-v3-omni": {
    id: "kling-v3-omni",
    name: "Kling Image 3.0 Omni",
    family: "kling-image-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: imageModality,
    limit: { context: 0 },
    // 8 Units ($0.028) at 1K/2K, 16 ($0.056) at 4K.
    cost: { perImage: 0.028 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * SHADOWED IDS. Four `model_name` values name one model on `POST /v1/videos/*`
 * and a *different* one on `POST /v1/images/generations`:
 *
 *   kling-v3    Kling 3.0   ($0.084/s)  vs  Kling Image 3.0            ($0.028/image)
 *   kling-v2-1  Kling 2.1   ($0.056/s)  vs  Kling Image 2.1 (Kolors)   ($0.014/image)
 *   kling-v1-5  Kling 1.5   ($0.056/s)  vs  Kling Image 1.5            ($0.014/image)
 *   kling-v1    Kling 1.0   ($0.028/s)  vs  Kling Image 1.0            ($0.0035/image)
 *
 * A plain spread would let the video row win and hand a `perVideoSecond` rate
 * to a caller who meant `perImage` — a 3x-to-24x unit error, and the header
 * comment's census mapping ("Kolors 2.1 is `kling-v2-1`, Kling Image 3.0 is
 * `kling-v3`") explicitly invites that lookup. So the provider-wide view
 * carries a MERGED row for each: both output modalities, both rates, so a
 * same-id lookup gets the field it asks for whichever kind it meant. `family`
 * is omitted on these four because the two kinds sit in different families
 * (`kling-2` vs `kling-image-2`) — the per-kind maps keep theirs.
 *
 * Validation is unaffected: every validator is scoped to its own route's
 * catalog. For an unambiguous single-kind lookup use `videoModels` /
 * `imageModels` / `omniImageModels`.
 */
const dualKindModels = {
  "kling-v3": {
    id: "kling-v3",
    name: "Kling 3.0 (video) / Kling Image 3.0 (image)",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video", "image"] },
    limit: { context: 0 },
    cost: { perVideoSecond: 0.084, perImage: 0.028 },
  },
  "kling-v2-1": {
    id: "kling-v2-1",
    name: "Kling 2.1 (video) / Kling Image 2.1, Kolors 2.1 (image)",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video", "image"] },
    limit: { context: 0 },
    cost: { perVideoSecond: 0.056, perImage: 0.014 },
  },
  "kling-v1-5": {
    id: "kling-v1-5",
    name: "Kling 1.5 (video) / Kling Image 1.5 (image)",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image"], output: ["video", "image"] },
    limit: { context: 0 },
    cost: { perVideoSecond: 0.056, perImage: 0.014 },
  },
  "kling-v1": {
    id: "kling-v1",
    name: "Kling 1.0 (video) / Kling Image 1.0 (image)",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text", "image", "video"], output: ["video", "image"] },
    limit: { context: 0 },
    cost: { perVideoSecond: 0.028, perImage: 0.0035 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * The provider-wide view: every id this provider answers to, exactly once.
 * `kling-v3-omni` and `kling-video-o1` also exist as VIDEO ids on the
 * capability map, but the only routes that take them in a body are the image
 * ones, so the merged map carries their image entries; the path-addressed
 * video routes address those weights as `kling-3.0-omni` / `kling-o1`.
 *
 * `dualKindModels` is spread LAST so the four shadowed ids above resolve to
 * their merged row rather than to whichever kind happened to be spread later.
 */
export const models = {
  ...videoModels,
  ...omniImageModels,
  ...imageModels,
  ...dualKindModels,
} as const satisfies Record<string, ModelInfo>;

export type KlingPathVideoModelId = keyof typeof pathVideoModels;
export type KlingV1VideoModelId = keyof typeof v1VideoModels;
export type KlingVideoModelId = keyof typeof videoModels;
export type KlingImageModelId = keyof typeof imageModels;
export type KlingOmniImageModelId = keyof typeof omniImageModels;
export type KlingModelId = keyof typeof models;
