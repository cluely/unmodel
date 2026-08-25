/**
 * The target table for **media** retargeting — the `.toApi("fal")` half of the
 * library.
 *
 * A sibling of `./endpoints.ts` rather than a widening of it, for the same
 * reason `DialectId` has four arms and not five: that table answers "which of
 * the four chat wire dialects does this provider speak, and at what URL", and
 * every consumer of it — `resolveEndpoint`, `DEFAULT_ENDPOINT_ID`,
 * `endpointStreamUrl`, the per-row invariants in `endpoints.test.ts` — is
 * chat-shaped. A media row filed there would be a row every one of those
 * readers has to special-case. So the *type* that both tables share
 * ({@link EndpointAuth}, the header-name-and-scheme pair that says where the
 * caller's credential goes) is imported, and nothing else is.
 *
 * **This module imports nothing at run time, deliberately** — literal strings
 * and one pure URL builder, exactly like `./endpoints.ts`, so any module may
 * reach it without dragging a graph behind it.
 *
 * ## Why the URL is built here and not read off `providers/fal/urls.ts`
 *
 * `src/core/**` may never import `src/providers/**` (import-graph rule 2), and
 * that rule is what keeps the translation layer free of provider bundles. The
 * table is therefore hand-written on both sides, and `endpoints.test.ts`
 * asserts the two agree — the same arrangement, and the same backstop, that
 * every chat row already has against its provider module's own URL constant.
 */

import type { EndpointAuth } from "./endpoints";

/**
 * Where a retargeted media body goes.
 *
 * Deliberately narrower than {@link import("./endpoints").TargetEndpoint}: no
 * `dialect` (media has no shared wire dialect — every provider's body is its
 * own shape, which is precisely why the mapping is a hand table per family and
 * not a codec pair), no `streamUrl` (nothing here streams), and no `config`
 * (fal has a provider-wide URL, so there is no factory arm to exclude).
 */
export interface MediaTargetEndpoint {
  /** The `.toApi` id, e.g. `"fal"`. */
  readonly id: string;
  /** Static non-auth headers. Auth is always the caller's job. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The header the caller's own credential goes in — a name and a scheme word,
   * never a value. Present for the reason `EndpointAuth` documents: retargeting
   * *invalidates* it. A body that moves from Kling to fal needs
   * `authorization: Key` where it had `authorization: Bearer`, and this table
   * is the only place that knows both halves of that swap.
   */
  readonly auth: EndpointAuth;
  /** The POST URL for one of the target's routes. */
  readonly url: (routeId: string) => string;
}

/** Queue host — mirrors `FAL_QUEUE_BASE_URL` in `src/providers/fal/urls.ts`. */
const FAL_QUEUE_BASE_URL = "https://queue.fal.run";

/**
 * Percent-encodes a fal endpoint id **per path segment**.
 *
 * The separators must survive: `fal-ai/flux/dev` is three path segments, not
 * one segment containing slashes, so `encodeURIComponent` over the whole id
 * would produce `fal-ai%2Fflux%2Fdev` and a 404. Byte-for-byte the same rule as
 * `falQueueUrl`, which `endpoints.test.ts` asserts against.
 */
function falQueuePath(endpointId: string): string {
  return endpointId.split("/").map(encodeURIComponent).join("/");
}

/**
 * fal.ai — `POST https://queue.fal.run/{endpoint_id}`, flat JSON body, and the
 * endpoint id IS the URL path at arbitrary depth. There is no `model` field on
 * a fal body, so the "model id" a media retarget resolves to is fal's endpoint
 * id, and the URL builder takes it directly.
 */
export const FAL_MEDIA_TARGET: MediaTargetEndpoint = Object.freeze({
  id: "fal",
  headers: Object.freeze({ "content-type": "application/json" }),
  // `Key`, not `Bearer` — see `EndpointAuth.scheme`.
  auth: Object.freeze({ header: "authorization", scheme: "Key" } as const),
  url: (endpointId: string) => `${FAL_QUEUE_BASE_URL}/${falQueuePath(endpointId)}`,
});

/**
 * Every media retarget destination, keyed by its `.toApi` id.
 *
 * One row today. It is a table rather than a constant because the shape of the
 * seam is "which target did the caller name", and a one-arm switch written as
 * an `if` is the thing that gets copied when the second target lands.
 */
export const MEDIA_TARGETS: Readonly<Record<string, MediaTargetEndpoint>> = Object.freeze({
  fal: FAL_MEDIA_TARGET,
});
