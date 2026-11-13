// Hand-maintained — Atlas Cloud is not in models.dev (`data/models-dev.json` carries 184
// providers and none of them is Atlas), so this file is the catalog. Refresh from
//   https://api.atlascloud.ai/api/v1/models                     (the keyless catalog — 608 rows)
//   https://static.atlascloud.ai/model/schema/<id-with-dashes>.json  (one OpenAPI 3.0.0 per model)
//   https://www.atlascloud.ai/docs/models/video                  (route, auth, polling)
//   https://www.atlascloud.ai/models/<id>                        (the model page: pricing prose)
//   https://www.atlascloud.ai/models/<id>/llms.txt               (the same page as markdown, schema included)
// Verified 2026-11-12. `bun run audit:atlascloud` diffs the live catalog against
// `data/atlascloud/curation.json` and reports gone / new / changed; it never writes.
//
// SCOPE, recorded: unmodel serves Atlas's VIDEO route only. Atlas is a 608-model aggregator
// whose three media routes (`/model/generateVideo`, `/generateImage`, `/generateAudio`) cover
// nine unmodel verbs, and whose `type`/`categories` taxonomy is lossy enough that it can never
// be the source of a verb map — three `suno/chirp-*` MUSIC models are filed under
// TEXT-TO-SPEECH, `tripo-h3.1/image-to-3d` is `type: "Image"`, and `bytedance/seed-asr-2.0`
// (speech-to-text) is `type: "Audio"`. So the roster is curated by hand in
// `data/atlascloud/curation.json`, which also records what is deliberately OUT and why.
//
// PRICING IS DELIBERATELY ABSENT FROM EVERY ROW. See ./pricing.ts: no curated catalog row
// carries a price `unit` (389 of Atlas's 470 media rows are a bare `base_price` string), 223 of
// 608 rows carry a promotional `discount` (30–95%) so `price.actual` is not the list price, and
// the model page's single "per second" figure is contradicted by Atlas's own billing page
// ("Varies by model, duration, and resolution") and its own cost test (one model at $0.134/s for
// a 480p draft, $0.596/s at 1080p). A `cost` here would be a guess dressed as a catalog fact. The figures Atlas publishes are transcribed in ./pricing.ts as what they are:
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
//     not in the live catalog (none of its 38 `kwaivgi/kling-*` ids is that one);
//   - `google/veo3.1/reference-to-video`'s schema lists `aspect_ratio` in `x-order-properties`
//     but declares no such property, and carries a stray top-level `seed` object beside
//     `properties`;
//   - `bytedance/seedance-v1.5-pro/*` describes `image` and `last_image` as "The positive
//     prompt for the generation" — a copy-paste from `prompt`;
//   - nine of the thirty-one schemas (Seedance v1.5 pro, Veo 3.1 and Veo 3.1 Fast) declare
//     the read-back route as `GET /api/v1/model/result/{request_id}`, twenty-one declare
//     `GET /api/v1/model/prediction/{request_id}`, and `google/veo3.1-lite/image-to-video`
//     spells it `/api/v1/model/prediction{request_id}`, slash missing (./urls.ts exports
//     both real spellings).

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

/** Reference-to-video: the Seedance and Wan omni arms, which also take clips and audio. */
const OMNI_TO_VIDEO = {
  attachment: true,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text", "image", "video", "audio"], output: VIDEO_OUT },
  limit: { context: 0 },
} as const;

/**
 * Draft completion: the input is an earlier draft RENDER, named by id (Atlas
 * files the route `VIDEO-TO-VIDEO`), and nothing is uploaded with it.
 */
const DRAFT_TO_VIDEO = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["video"], output: VIDEO_OUT },
  limit: { context: 0 },
} as const;

/**
 * The thirty-one curated ids on `POST /api/v1/model/generateVideo`.
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
 *
 * The other eight are the in-family routes those families grew: Veo 3.1 Fast
 * (2) and Lite (3), Seedance 2.5's `draft-complete` (the second step of its
 * draft mode, and the one wire-only id here) and the two Wan 3.0 reference
 * routes.
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
  // The catalog row (read 2026-11-12): `"displayName":"Seedance 2.5 Draft
  // Complete"`, `"familyName":"seedance-2.5"`, filed `VIDEO-TO-VIDEO`. It takes
  // no prompt and no media — `draft_id` names a finished 480p draft render —
  // so it is wire-only: no canonical word reaches `draft_id`, and the id is
  // absent from `unmodel/video` (./video-params.ts).
  "bytedance/seedance-2.5/draft-complete": {
    id: "bytedance/seedance-2.5/draft-complete",
    name: "Seedance 2.5 Draft Complete",
    family: "seedance-2.5",
    ...DRAFT_TO_VIDEO,
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
  // Catalog rows (read 2026-11-12): `"displayName":"Wan-3.0 Reference-to-video"`
  // and `"Wan-3.0-Prime Reference-to-video"`, both `"familyName":"wan-3.0"`,
  // filed `VIDEO-TO-VIDEO`. "Any mix of reference images (<=10), reference
  // videos (<=5, total <=15s), and reference audio (<=5, total <=15s)" — the
  // prime schema's `refers` description.
  "alibaba/wan-3.0/reference-to-video": {
    id: "alibaba/wan-3.0/reference-to-video",
    name: "Wan-3.0 Reference-to-video",
    family: "wan-3.0",
    ...OMNI_TO_VIDEO,
  },
  "alibaba/wan-3.0-prime/reference-to-video": {
    id: "alibaba/wan-3.0-prime/reference-to-video",
    name: "Wan-3.0-Prime Reference-to-video",
    family: "wan-3.0",
    ...OMNI_TO_VIDEO,
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
  // Catalog rows (read 2026-11-12): `"displayName":"Veo3.1 Fast Text-to-video"`
  // / `"Veo3.1 Fast Image-to-video"`, `"familyName":"veo-3.1-fast"`.
  "google/veo3.1-fast/text-to-video": {
    id: "google/veo3.1-fast/text-to-video",
    name: "Veo3.1 Fast Text-to-video",
    family: "veo-3.1-fast",
    ...TEXT_TO_VIDEO,
  },
  "google/veo3.1-fast/image-to-video": {
    id: "google/veo3.1-fast/image-to-video",
    name: "Veo3.1 Fast Image-to-video",
    family: "veo-3.1-fast",
    ...IMAGE_TO_VIDEO,
  },
  // Catalog rows (read 2026-11-12): `"displayName":"Veo 3.1 Lite Text-to-video"`,
  // `"Veo 3.1 Lite Image-to-video"` and `"Veo 3.1 Lite Start-End Frame to
  // Video"`, `"familyName":"veo-3.1-lite"`. "Veo 3.1 Lite does not support
  // 4K." — each schema's `resolution` description.
  "google/veo3.1-lite/text-to-video": {
    id: "google/veo3.1-lite/text-to-video",
    name: "Veo 3.1 Lite Text-to-video",
    family: "veo-3.1-lite",
    ...TEXT_TO_VIDEO,
  },
  "google/veo3.1-lite/image-to-video": {
    id: "google/veo3.1-lite/image-to-video",
    name: "Veo 3.1 Lite Image-to-video",
    family: "veo-3.1-lite",
    ...IMAGE_TO_VIDEO,
  },
  "google/veo3.1-lite/start-end-frame-to-video": {
    id: "google/veo3.1-lite/start-end-frame-to-video",
    name: "Veo 3.1 Lite Start-End Frame to Video",
    family: "veo-3.1-lite",
    ...IMAGE_TO_VIDEO,
  },
} as const satisfies Record<string, ModelInfo>;

/** Every cataloged Atlas Cloud model. Video is the only route unmodel serves. */
export const models = { ...videoModels } as const satisfies Record<string, ModelInfo>;

export type AtlascloudModelId = keyof typeof models;
export type AtlascloudVideoModelId = keyof typeof videoModels;
