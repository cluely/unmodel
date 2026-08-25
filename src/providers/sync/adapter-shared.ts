/**
 * The two facts both sync. adapters need, in one import-light module.
 *
 * Separate from `./shared.ts` because that file imports zod and the pipeline —
 * an adapter leaf is what a category PACK reaches, and `test/bundle-budget.test.ts`
 * measures those packs. These three constants are strings and a lookup table,
 * and they belong to the unified surface rather than to the wire surface.
 */

/** The reference page every refusal in these adapters cites. */
export const SOURCE_URL = "https://sync.so/docs/api-reference/api/generate-api/create";

/**
 * What to do instead, when a caller hands an adapter inline bytes.
 *
 * sync.'s JSON body carries references rather than payloads: each media item
 * takes a `url` it fetches or an `assetId` from your library. Bytes go up
 * through `POST /v2/assets/upload` (which mints a presigned URL) and are
 * registered with `POST /v2/assets`, or through the separate multipart form on
 * `POST /v2/generate`. Neither is a request unmodel makes, so the refusal names
 * both.
 */
export const ASSET_UPLOAD_HINT =
  "sync. fetches its inputs rather than reading them out of the body: pass a publicly reachable " +
  "https URL, or upload the bytes with POST https://api.sync.so/v2/assets/upload and pass the " +
  "`assetId` through `providerOptions`.";

/**
 * The extras that live under `options` on the wire and are declared flat on the
 * rows.
 *
 * `applyExtras`'s per-key `nest` map — the Kling mechanism, used here for the
 * reason it exists: one `applyExtras` call has to serve the whole table so that
 * the "`temperature` is not a parameter sync-3 accepts" refusal reads every
 * row, and half of sync.'s extras (`segments`, `dubParams`, `outputFileName`,
 * `webhookUrl`, `projectId`) are body-root fields while the other half are not.
 *
 * They are declared FLAT on the rows because that is how the same six dials are
 * spelled at fal, which resells these very models with sync.'s `options`
 * flattened into its own schema. Agreeing on the name is what makes the two
 * routes to one model comparable.
 */
export const OPTION_EXTRAS: Readonly<Record<string, readonly string[]>> = {
  sync_mode: ["options"],
  model_mode: ["options"],
  prompt: ["options"],
  temperature: ["options"],
  occlusion_detection_enabled: ["options"],
  active_speaker_detection: ["options"],
};
