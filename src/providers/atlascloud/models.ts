// Hand-maintained — Atlas Cloud is not in models.dev (`data/models-dev.json` carries 184
// providers and none of them is Atlas), so this file is the catalog. Refresh from
//   https://api.atlascloud.ai/api/v1/models                     (the keyless catalog — 473 rows)
//   https://static.atlascloud.ai/model/schema/<id-with-dashes>.json  (one OpenAPI 3.0.0 per model)
//   https://www.atlascloud.ai/docs/models/video                  (route, auth, polling)
//   https://www.atlascloud.ai/models/<id>                        (the model page: pricing prose)
// Verified 2026-08-26. `bun run audit:atlascloud` diffs the live catalog against
// `data/atlascloud/curation.json` and reports gone / new / changed; it never writes.
//
// SCOPE, recorded: unmodel serves Atlas's VIDEO route only. Atlas is a 473-model aggregator
// whose three media routes (`/model/generateVideo`, `/generateImage`, `/generateAudio`) cover
// nine unmodel verbs, and whose `type`/`categories` taxonomy is lossy enough that it can never
// be the source of a verb map — seven `suno/chirp-*` MUSIC models are filed under
// TEXT-TO-SPEECH, `tripo-h3.1/image-to-3d` is `type: "Image"`, and `bytedance/seed-asr-2.0`
// (speech-to-text) is `type: "Audio"`. So the roster is curated by hand in
// `data/atlascloud/curation.json`, which also records what is deliberately OUT and why.
//
// PRICING IS DELIBERATELY ABSENT FROM EVERY ROW. See ./pricing.ts: Atlas's catalog carries a
// bare `base_price` string with no unit on 335 of its 337 media rows, 152 of 473 rows carry a
// promotional `discount` (40–90%) so `price.actual` is not the list price, and the model page
// itself renders three mutually exclusive sentences from three templates in the same bundle
// ("… per run", "… /second", "… per 1000 tokens"). A `cost` here would be a guess dressed as a
// catalog fact. The figures Atlas publishes are transcribed in ./pricing.ts as what they are:
// unit-less listed numbers with the caveat attached.
//
// RELEASE DATES ARE ABSENT for the same reason: Atlas's catalog publishes no release date, and
// the upstream vendors' dates describe the WEIGHTS rather than the date this transport started
// serving them. `bytedance/*` here is the same Seedance that `src/providers/bytedance/models.ts`
// dates from ByteDance's own model list; a second, guessed date on the resale row would be a
// second opinion about a fact this provider does not publish.
//
// DOC ROT ALREADY VISIBLE, recorded so a reader does not mistake it for our error:
//   - the video API reference's own sample body sends `"model": "kling-v2.0"`, an id that is
//     not in the live catalog (Atlas serves `kwaivgi/kling-v3.0-*` and `kwaivgi/kling-v2.6-*`);
//   - `google/veo3.1/reference-to-video`'s schema lists `aspect_ratio` in `x-order-properties`
//     but declares no such property, and carries a stray top-level `seed` object beside
//     `properties`;
//   - `bytedance/seedance-v1.5-pro/*` describes `image` and `last_image` as "The positive
//     prompt for the generation" — a copy-paste from `prompt`;
//   - five of the twenty-three schemas declare the read-back route as
//     `GET /api/v1/model/result/{request_id}` and eighteen declare
//     `GET /api/v1/model/prediction/{request_id}` (./urls.ts exports both).

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "atlascloud",
  name: "Atlas Cloud",
  // Atlas's own model-page sample: `-H "Authorization: Bearer $ATLASCLOUD_API_KEY"`.
  env: ["ATLASCLOUD_API_KEY"],
  doc: "https://www.atlascloud.ai/docs",
  api: "https://api.atlascloud.ai/api/v1",
} as const satisfies ProviderInfo;

const VIDEO_OUT = ["video"] as const;

/** Text-to-video: prompt in, clip out. */
const TEXT_TO_VIDEO = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text"], output: VIDEO_OUT },
  limit: { context: 0 },
} as const;

/** Image-to-video: a first frame (and optionally a last one). */
const IMAGE_TO_VIDEO = {
  attachment: true,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text", "image"], output: VIDEO_OUT },
  limit: { context: 0 },
} as const;

/** Reference-to-video: the Seedance omni arms, which also take clips and audio. */
const OMNI_TO_VIDEO = {
  attachment: true,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text", "image", "video", "audio"], output: VIDEO_OUT },
  limit: { context: 0 },
} as const;

/**
 * The twenty-three curated ids on `POST /api/v1/model/generateVideo`.
 *
 * The id IS the model AND the route, which is why a family appears three times:
 * `bytedance/seedance-2.5/text-to-video` and `.../reference-to-video` are the
 * same weights behind two different Input schemas.
 *
 * Roster shape, and why these: the Seedance families the adopter named
 * (2.5, 2.0, 2.0-mini, 2.0-fast, v1.5-pro — 16 ids, and the `-mini` tier plus
 * the SR/ESR resolution ladder are Atlas's genuine additions over fal), plus
 * the earners at the top of Atlas's own TEXT-TO-VIDEO / IMAGE-TO-VIDEO listing:
 * Wan 3.0 and Wan 3.0-prime (Atlas's highest-priority video rows, tagged HOT +
 * NEW) and Veo 3.1 (the third transport for weights unmodel already reaches at
 * `google.video` and `fal.video` — the sharpest instance of the same-weights,
 * different-bodies comparison this library exists to make cheap).
 */
export const videoModels = {
  "bytedance/seedance-2.5/text-to-video": {
    id: "bytedance/seedance-2.5/text-to-video",
    name: "Seedance 2.5 Text-to-Video",
    family: "seedance-2.5",
    ...TEXT_TO_VIDEO,
  },
  "bytedance/seedance-2.5/image-to-video": {
    id: "bytedance/seedance-2.5/image-to-video",
    name: "Seedance 2.5 Image-to-Video",
    family: "seedance-2.5",
    ...IMAGE_TO_VIDEO,
  },
  "bytedance/seedance-2.5/reference-to-video": {
    id: "bytedance/seedance-2.5/reference-to-video",
    name: "Seedance 2.5 Reference-to-Video",
    family: "seedance-2.5",
    ...OMNI_TO_VIDEO,
  },
  "bytedance/seedance-2.0/text-to-video": {
    id: "bytedance/seedance-2.0/text-to-video",
    name: "Seedance 2.0 Text-to-Video",
    family: "seedance2",
    ...TEXT_TO_VIDEO,
  },
  "bytedance/seedance-2.0/image-to-video": {
    id: "bytedance/seedance-2.0/image-to-video",
    name: "Seedance 2.0 Image-to-Video",
    family: "seedance2",
    ...IMAGE_TO_VIDEO,
  },
  "bytedance/seedance-2.0/reference-to-video": {
    id: "bytedance/seedance-2.0/reference-to-video",
    name: "Seedance 2.0 Reference-to-Video",
    family: "seedance2",
    ...OMNI_TO_VIDEO,
  },
  "bytedance/seedance-2.0-mini/text-to-video": {
    id: "bytedance/seedance-2.0-mini/text-to-video",
    name: "Seedance 2.0 Mini Text-to-Video",
    family: "seedance-2.0-mini",
    ...TEXT_TO_VIDEO,
  },
  "bytedance/seedance-2.0-mini/image-to-video": {
    id: "bytedance/seedance-2.0-mini/image-to-video",
    name: "Seedance 2.0 Mini Image-to-Video",
    family: "seedance-2.0-mini",
    ...IMAGE_TO_VIDEO,
  },
  "bytedance/seedance-2.0-mini/reference-to-video": {
    id: "bytedance/seedance-2.0-mini/reference-to-video",
    name: "Seedance 2.0 Mini Reference-to-Video",
    family: "seedance-2.0-mini",
    ...OMNI_TO_VIDEO,
  },
  "bytedance/seedance-2.0-fast/text-to-video": {
    id: "bytedance/seedance-2.0-fast/text-to-video",
    name: "Seedance 2.0 Fast Text-to-Video",
    family: "seedance2",
    ...TEXT_TO_VIDEO,
  },
  "bytedance/seedance-2.0-fast/image-to-video": {
    id: "bytedance/seedance-2.0-fast/image-to-video",
    name: "Seedance 2.0 Fast Image-to-Video",
    family: "seedance2",
    ...IMAGE_TO_VIDEO,
  },
  "bytedance/seedance-2.0-fast/reference-to-video": {
    id: "bytedance/seedance-2.0-fast/reference-to-video",
    name: "Seedance 2.0 Fast Reference-to-Video",
    family: "seedance2",
    ...OMNI_TO_VIDEO,
  },
  "bytedance/seedance-v1.5-pro/text-to-video": {
    id: "bytedance/seedance-v1.5-pro/text-to-video",
    name: "Seedance v1.5 Pro Text-to-Video",
    family: "seedance1.5",
    ...TEXT_TO_VIDEO,
  },
  "bytedance/seedance-v1.5-pro/image-to-video": {
    id: "bytedance/seedance-v1.5-pro/image-to-video",
    name: "Seedance v1.5 Pro Image-to-Video",
    family: "seedance1.5",
    ...IMAGE_TO_VIDEO,
  },
  "bytedance/seedance-v1.5-pro/text-to-video-fast": {
    id: "bytedance/seedance-v1.5-pro/text-to-video-fast",
    name: "Seedance v1.5 Pro Text-to-Video Fast",
    family: "seedance1.5",
    ...TEXT_TO_VIDEO,
  },
  "bytedance/seedance-v1.5-pro/image-to-video-fast": {
    id: "bytedance/seedance-v1.5-pro/image-to-video-fast",
    name: "Seedance v1.5 Pro Image-to-Video Fast",
    family: "seedance1.5",
    ...IMAGE_TO_VIDEO,
  },
  "alibaba/wan-3.0-prime/text-to-video": {
    id: "alibaba/wan-3.0-prime/text-to-video",
    name: "Wan-3.0-Prime Text-to-video",
    family: "wan-3.0",
    ...TEXT_TO_VIDEO,
  },
  "alibaba/wan-3.0-prime/image-to-video": {
    id: "alibaba/wan-3.0-prime/image-to-video",
    name: "Wan-3.0-Prime Image-to-video",
    family: "wan-3.0",
    ...IMAGE_TO_VIDEO,
  },
  "alibaba/wan-3.0/text-to-video": {
    id: "alibaba/wan-3.0/text-to-video",
    name: "Wan-3.0 Text-to-video",
    family: "wan-3.0",
    ...TEXT_TO_VIDEO,
  },
  "alibaba/wan-3.0/image-to-video": {
    id: "alibaba/wan-3.0/image-to-video",
    name: "Wan-3.0 Image-to-video",
    family: "wan-3.0",
    ...IMAGE_TO_VIDEO,
  },
  "google/veo3.1/text-to-video": {
    id: "google/veo3.1/text-to-video",
    name: "Veo3.1 Text-to-video",
    family: "veo-3.1",
    ...TEXT_TO_VIDEO,
  },
  "google/veo3.1/image-to-video": {
    id: "google/veo3.1/image-to-video",
    name: "Veo3.1 Image-to-video",
    family: "veo-3.1",
    ...IMAGE_TO_VIDEO,
  },
  "google/veo3.1/reference-to-video": {
    id: "google/veo3.1/reference-to-video",
    name: "Veo3.1 Reference-to-video",
    family: "veo-3.1",
    ...IMAGE_TO_VIDEO,
  },
} as const satisfies Record<string, ModelInfo>;

/** Every cataloged Atlas Cloud model. Video is the only route unmodel serves. */
export const models = { ...videoModels } as const satisfies Record<string, ModelInfo>;

export type AtlascloudModelId = keyof typeof models;
export type AtlascloudVideoModelId = keyof typeof videoModels;
