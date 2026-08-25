/**
 * VEED Fabric 1.0 — POST https://api.veed.io/v1/fabric-1.0
 *
 * A still with a face plus an audio track in; a lip-synced talking video out.
 * VEED's own tag calls it "talking-avatar creation", and it is the whole reason
 * this provider reaches `unmodel/avatar` as well as `unmodel/lipsync`.
 *
 * Wire notes (verified against https://api.veed.io/openapi.json and the model
 * page at https://api.veed.io/models/fabric-1.0 on 2026-08-25):
 *
 * - **Three fields, all three required.** `image_url`, `audio_url` and
 *   `resolution`. The first two are public `http(s)` URLs, 1–8192 characters;
 *   the third is `"720p" | "480p"`.
 * - **`resolution` has NO server-side default.** It is in `required` and it
 *   carries no `default`, so `{ image_url, audio_url }` is a 422 — the one
 *   thing about this route that is easy to get wrong and impossible to see in
 *   the two obvious fields. It is also what the PRICE is conditioned on
 *   (`$0.08/sec` at 480p, `$0.15/sec` at 720p), which is presumably why VEED
 *   declines to choose for you.
 * - `FabricInput` is `additionalProperties: false`, so a fourth key is a 422
 *   rather than an ignored field — {@link checkKnownParams} says so, as an
 *   error.
 * - Async and 202-then-poll, exactly as the clip route, with its own job path:
 *   `GET /v1/fabric-1.0/{job_id}`. A `fabric-1.0` job id is not readable at the
 *   `lipsync-2.0` path.
 * - Headers: `Authorization: Bearer <VEED_API_KEY>` is yours to add.
 *
 * ## What VEED does not have, and it matters for the retarget story
 *
 * fal resells three VEED products: `veed/lipsync` (this provider's
 * `lipsync-2.0`), a Fabric-backed route, and `veed/avatars/audio-to-video` — a
 * library of ~28 trained presenters you name by `avatar_id`. **The third has no
 * native endpoint.** `POST /v1/avatars` answers a real JSON 404
 * (`{"error":{"code":"not_found",…}}`, probed 2026-08-25), and the OpenAPI
 * document declares no avatar roster, no `avatar_id` field and no way to reach
 * a catalogued performer. So VEED natively animates a picture you supply and
 * nothing else — this row says `sources: ["image"]` where the fal row for the
 * presenter library says `sources: []`, and the two are different products that
 * happen to share a vendor.
 */

import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import { toValidated, type ExactKeys, type Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "./models";
import {
  DOCS_BASE,
  FABRIC_URL,
  VEED_HEADERS,
  VEED_RESOLUTIONS,
  checkKnownParams,
  checkMediaUrls,
  mediaUrlSchema,
  schemaEchoSchema,
  type VeedResolution,
} from "./shared";

export { FABRIC_URL } from "./shared";

const SOURCE = `${DOCS_BASE}/models/fabric-1.0`;

/** The id this address serves — one, and the path says so. */
export const AVATAR_MODEL = "fabric-1.0";

/** Every field `FabricInput` declares, in the spec's own order. */
const DECLARED = ["image_url", "audio_url", "resolution"] as const;

export interface VeedAvatarParams {
  /**
   * Required. A public `http(s)` URL of the still to animate, 1–8192
   * characters. VEED fetches it; there is no upload arm.
   */
  image_url: string;
  /** Required. A public `http(s)` URL of the track to lip-sync to. */
  audio_url: string;
  /**
   * **Required, with no default.** `"720p"` or `"480p"`, and the difference is
   * roughly 2× on the bill.
   */
  resolution: VeedResolution;
  /** The read-only `$schema` echo — see `./lipsync.ts`. */
  $schema?: string;
}

const avatarSchema = z.looseObject({
  image_url: mediaUrlSchema,
  audio_url: mediaUrlSchema,
  resolution: z.enum(VEED_RESOLUTIONS),
  $schema: schemaEchoSchema,
});

/**
 * One model, one enum.
 *
 * `resolution` is the only closed vocabulary VEED publishes on any generation
 * route, so it is the only thing on this table — and it is here as well as in
 * the zod schema because `constraintsFor("fabric-1.0")` is what a CLI or a
 * form reads to draw the choice.
 */
export const avatarConstraints = {
  "fabric-1.0": {
    enums: { resolution: [...VEED_RESOLUTIONS] },
  },
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

/** See `./lipsync.ts` — one target, and VEED ships no client to hand it to. */
type VeedSdkTargets<B> = { veed: () => B };

function finalize(params: VeedAvatarParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: FABRIC_URL, method: "POST", headers: VEED_HEADERS },
    { sdk: { veed: () => body } },
  );
}

/**
 * No `estimate`, for the clip route's reason and one more.
 *
 * The rate is per second of GENERATED video; the generated video's length is
 * the audio's, behind a URL. Here the RATE itself is at least fully determined
 * — `resolution` is required, so `VEED_PRICING["fabric-1.0"]` resolves to a
 * single number for any valid request — which makes this the one place in the
 * provider where the only missing input is the duration.
 */
const validator = createValidator<VeedAvatarParams, unknown>({
  endpoint: "veed.avatar",
  schema: avatarSchema,
  modelId: () => AVATAR_MODEL,
  catalog: models,
  constraints: avatarConstraints,
  checks: [checkMediaUrls(SOURCE), checkKnownParams(SOURCE, DECLARED)],
  finalize,
});

/**
 * Validates raw wire params for VEED `POST /v1/fabric-1.0`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("veed")` returns it unchanged. Auth is yours to add:
 * `Authorization: Bearer <VEED_API_KEY>`.
 *
 * ```ts
 * const params = veed.avatar({
 *   image_url: "https://media.example.com/headshot.png",
 *   audio_url: "https://media.example.com/vo.mp3",
 *   resolution: "720p",
 * });
 * ```
 *
 * The output's length is the audio's — there is no `duration` here and nothing
 * that could set one, because a still has no length of its own to reconcile.
 * Poll `jobUrl("fabric-1.0", data.job_id)` exactly as for the clip route.
 */
export const avatar = validator as unknown as {
  <T extends VeedAvatarParams>(
    params: T & ExactKeys<T, VeedAvatarParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, VeedSdkTargets<T>>;
  safe<T extends VeedAvatarParams>(
    params: T & ExactKeys<T, VeedAvatarParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, VeedSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
