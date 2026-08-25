/**
 * The facts both HeyGen adapters need, in one import-light module.
 *
 * Separate from `./shared.ts` because that file imports zod and the pipeline —
 * an adapter leaf is what a category PACK reaches, and `test/bundle-budget.test.ts`
 * measures those packs.
 */

/** The reference page most refusals in these adapters cite. */
export const SOURCE_URL = "https://developers.heygen.com/reference/create-video";

/** The lipsync route's own reference page. */
export const LIPSYNC_SOURCE_URL = "https://developers.heygen.com/reference/create-lipsync";

/**
 * What to do instead, when a caller hands the LIPSYNC adapter inline bytes.
 *
 * `CreateLipsyncRequest.video` and `.audio` are a two-arm `oneOf` — `AssetUrl`
 * or `AssetId` — and the third arm HeyGen has elsewhere (`AssetBase64`, on the
 * video route's `image`) is deliberately absent here. So bytes are refused
 * naming the upload flow rather than compiled into something the route has no
 * field for.
 */
export const LIPSYNC_UPLOAD_HINT =
  "HeyGen's lipsync route takes a clip and a track as `{ type: \"url\", url }` or " +
  '`{ type: "asset_id", asset_id }` only — its `oneOf` has no inline arm. Host the file, or upload ' +
  "it with POST https://api.heygen.com/v3/assets and pass the id through `providerOptions`.";

/**
 * What to do instead, when a caller hands the AVATAR adapter inline AUDIO.
 *
 * The asymmetry is real and it is HeyGen's, not unmodel's: on `POST /v3/videos`
 * the still (`image`) has a `base64` arm and the track does not — `audio_url`
 * and `audio_asset_id` are both plain strings. So one media field on one route
 * accepts bytes and its neighbour does not.
 */
export const AUDIO_UPLOAD_HINT =
  "On `POST /v3/videos` the still takes inline bytes and the track does not: `audio_url` is a URL " +
  "HeyGen fetches and `audio_asset_id` is an id from POST https://api.heygen.com/v3/assets. " +
  "(`image` does have a `base64` arm — the asymmetry is HeyGen's.)";
