/**
 * The two facts both VEED adapters need, in one import-light module.
 *
 * Separate from `./shared.ts` because that file imports zod and the pipeline —
 * an adapter leaf is what a category PACK reaches, and `test/bundle-budget.test.ts`
 * measures those packs. These are two strings and they belong to the unified
 * surface rather than to the wire surface.
 */

/** The reference page every refusal in these adapters cites. */
export const SOURCE_URL = "https://api.veed.io/docs";

/**
 * What to do instead, when a caller hands an adapter inline bytes.
 *
 * VEED has **no upload arm at all**: no multipart, no base64, no asset ids, no
 * presigned-upload endpoint. Every media field in the whole ten-operation
 * document is a URL with the pattern `^[Hh][Tt][Tt][Pp][Ss]?://` on it, which
 * VEED fetches. So a `{ data }` ref is refused here naming the only thing that
 * works, rather than compiled into a `data:` URI VEED would reject with a 422
 * before creating a job.
 *
 * (fal's resale of the same models DOES accept a data URI, because fal's own
 * queue accepts one and transloads. That is a real difference between the two
 * routes to one model, and it is stated on both adapters rather than in prose.)
 */
export const UPLOAD_HINT =
  "VEED fetches its inputs rather than reading them out of the body, and publishes no upload " +
  "endpoint of any kind: pass a publicly reachable http(s) URL of at most 8192 characters. " +
  "`fal/veed/lipsync/v2` is the same model behind a queue that does accept inline bytes.";
