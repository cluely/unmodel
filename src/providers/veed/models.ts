// Hand-maintained — VEED is not in models.dev; refresh from
//   https://api.veed.io/openapi.json                     (OpenAPI 3.1.0, the whole supported surface)
//   https://api.veed.io/docs                             (overview, auth, the job protocol, errors)
//   https://api.veed.io/models/lipsync-2.0               (the clip route, its rate, its failure codes)
//   https://api.veed.io/models/fabric-1.0                (the still route, `resolution`, the two rates)
//   https://api.veed.io/reference                        (the 21 component schemas, standalone)
// Verified 2026-08-25.
//
// PRICING IS IN THE SPEC, WHICH IS RARE ENOUGH TO SAY OUT LOUD.
// Every submit operation carries an `x-veed-pricing` extension — currency,
// unit, unit_quantity, rounding, and a `rates` array whose entries may be
// conditioned on a request field. So the numbers on these rows are not
// transcribed from a marketing page that can drift away from the API; they are
// transcribed from the same document the request schemas come from, and a rate
// change lands in the same diff as a schema change.
//
//   POST /v1/lipsync-2.0   {"currency":"USD","measure":"the generated video","rounding":"exact",
//                           "unit":"second","unit_quantity":1,"rates":[{"amount":0.07}]}
//   POST /v1/fabric-1.0    {"currency":"USD","measure":"the generated video","rounding":"exact",
//                           "unit":"second","unit_quantity":1,
//                           "dimensions":[{"field":"resolution","label":"Resolution"}],
//                           "rates":[{"amount":0.08,"when":{"resolution":"480p"}},
//                                    {"amount":0.15,"when":{"resolution":"720p"}}]}
//
// WHERE THE PUBLISHED NUMBERS DISAGREE, AND WHICH ONE THIS FILE FOLLOWS.
// https://www.veed.io/api — the marketing page, which is written for fal's
// resale of these models — lists Fabric at "$0.08–$0.20/sec". api.veed.io says
// $0.08–$0.15, both on the model page and in the spec extension, and
// https://www.veed.io/tools/fabric-1.0-api breaks the same band down as 8¢/s at
// 480p and 15¢/s at 720p. Two of the three agree with each other and with the
// machine-readable document; the marketing page is the outlier and is not
// followed.
//
// `ModelCost.perVideoSecond` HOLDS ONE NUMBER AND FABRIC HAS TWO.
// `fabric-1.0`'s rate is conditioned on `resolution`, which is a REQUIRED
// request field — so unlike most conditional pricing in this library the
// condition is always known, and `VEED_RATE_USD_PER_SECOND` in ./shared-pricing
// terms is exact per request. What is NOT known is the OUTPUT'S DURATION, which
// is the audio's, behind a URL unmodel never fetches. So neither model
// estimates, and the row carries the TOP of the band ($0.15, the 720p rate)
// with the whole table quoted above it — an upper bound, which is the right
// direction for a figure a caller might budget against. The 480p rate is on
// `VEED_PRICING` for a client that wants to show both.
//
// Deliberately NOT served: the `video-background-removal` family — three
// variants (`/v1/video-background-removal`, `-fast`, `-green-screen`) with six
// of VEED's ten operations behind them. They are a real, priced, publicly
// documented product and they do not upscale, lipsync, animate a still, or
// generate anything: they matte a subject out of a clip and hand back a WebM
// with an alpha channel (or, on h264, two files — RGB plus the matte). unmodel
// has no category whose vocabulary that fits — `video` invents frames,
// `imageEdit` is a still, `upscale` changes resolution — and inventing a
// one-provider `matting` category from a single witness is the thing
// `docs/decisions.md` exists to prevent. They join the day a second vendor
// publishes the same operation.
//
// Also not served: nothing else exists. There is no avatar roster (`POST
// /v1/avatars` answers a real JSON 404 — fal's `veed/avatars` endpoint has no
// native equivalent), no assets API, no voice API and no editing API. The
// document is ten operations wide and this file covers the four that generate.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "veed",
  name: "VEED",
  // `Authorization: Bearer vp_...` — https://api.veed.io/docs#authentication.
  // `VEED_API_KEY` is the name VEED's own quick-start curl uses on every model
  // page (`-H "Authorization: Bearer $VEED_API_KEY"`); the spec calls the value
  // a "workspace API key" and the key prefix is `vp_`.
  env: ["VEED_API_KEY"],
  doc: "https://api.veed.io/docs",
} as const satisfies ProviderInfo;

/** Clip in, track in, clip out. */
const clipModality = { input: ["audio", "video"], output: ["video"] } as const;

/** Still in, track in, clip out — the other half of the split. */
const stillModality = { input: ["audio", "image"], output: ["video"] } as const;

export const models = {
  /**
   * $0.07 per second of generated video, flat.
   *
   * Source: https://api.veed.io/models/lipsync-2.0 — verified 2026-08-25.
   * Quote: “$0.07 per second”. The spec's `x-veed-pricing` on
   * `POST /v1/lipsync-2.0` says the same thing in machine-readable form:
   * `{"rates":[{"amount":0.07}],"unit":"second","rounding":"exact"}`.
   */
  "lipsync-2.0": {
    id: "lipsync-2.0",
    name: "Lipsync 2.0",
    family: "lipsync",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: clipModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.07 },
    // Two fields, both required, and nothing else: `video_url` and
    // `audio_url`. It is the smallest request surface in the library, and the
    // absence is the interesting part — there is no `sync_mode`, no
    // `loop_mode`, no fps control and no resolution control, so the question
    // "what happens when the clip and the track are different lengths" has no
    // answer on this wire at all. See ../../core/unified/vocabulary/lipsync.ts.
  },
  /**
   * $0.08 per second at 480p, $0.15 per second at 720p.
   *
   * Source: https://api.veed.io/models/fabric-1.0 — verified 2026-08-25.
   * Quote: “$0.08–$0.15 per second”. Broken down at
   * https://www.veed.io/tools/fabric-1.0-api — “480p = 8¢/s, 720p = 15¢/s” —
   * and stated exactly by the spec's `x-veed-pricing`:
   * `{"dimensions":[{"field":"resolution"}],
   *   "rates":[{"amount":0.08,"when":{"resolution":"480p"}},
   *            {"amount":0.15,"when":{"resolution":"720p"}}]}`
   *
   * The row carries the 720p rate — the top of the band — because `ModelCost`
   * holds one number and an upper bound is the right kind of wrong. Both are on
   * `VEED_PRICING`.
   */
  "fabric-1.0": {
    id: "fabric-1.0",
    name: "Fabric 1.0",
    family: "fabric",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: stillModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.15 },
    // `resolution` is REQUIRED and has no server-side default, which is this
    // route's one real trap: `{ image_url, audio_url }` alone is a 422. It is
    // also the field the price is conditioned on, so the omission is not
    // something VEED could reasonably default for you.
  },
} as const satisfies Record<string, ModelInfo>;

export type VeedCatalogModelId = keyof typeof models;

// The full rate table — including the 480p rate `ModelCost` has no room for —
// is `VEED_PRICING` in ./shared.ts, so that `unmodel/veed/values` can publish
// it to a picker without reaching this catalog.
