/**
 * VEED Lipsync 2.0 — POST https://api.veed.io/v1/lipsync-2.0
 *
 * Re-render a clip with the speaker's mouth matched to a new track: dubbing,
 * voice replacement, or a cleaner take.
 *
 * Wire notes (verified against https://api.veed.io/openapi.json and the model
 * page at https://api.veed.io/models/lipsync-2.0 on 2026-08-25):
 *
 * - **Two fields, both required, and no others.** `video_url` and `audio_url`,
 *   each a public `http(s)` URL 1–8192 characters long. `Lipsync20Input` is
 *   `additionalProperties: false`, so a third key is a 422 rather than a field
 *   VEED ignores — {@link checkKnownParams} is the guard, and it reports an
 *   ERROR for that reason.
 * - **No dials at all.** No `sync_mode`, no `loop_mode`, no fps, no resolution,
 *   no seed. What VEED does when the track outlasts the clip is not a question
 *   this API takes an answer to.
 * - `application/json`. There is no multipart arm and no base64 arm anywhere in
 *   VEED's document: inputs are URLs VEED fetches, full stop.
 * - Async: responds **202** with `{ data: { job_id, status: "PROCESSING" } }`;
 *   poll `GET /v1/lipsync-2.0/{job_id}` about every ten seconds until
 *   `COMPLETED` or `FAILED`, then read `data.result.video.url`. There are no
 *   webhooks.
 * - Headers: add `Authorization: Bearer <VEED_API_KEY>` yourself — unmodel
 *   never touches credentials. `X-Veed-Store-IO: "0"` keeps the bodies out of
 *   your request logs and `X-Veed-Media-Expiration-Seconds` sets how long the
 *   signed result URL lives; both are on {@link VEED_REQUEST_HEADERS}.
 *
 * ## Why this address and `veed.avatar` are two addresses
 *
 * Two paths, two schemas, two prices. `POST /v1/lipsync-2.0` requires
 * `video_url`; `POST /v1/fabric-1.0` requires `image_url` AND `resolution`, and
 * declares no `video_url` at all. That is a fork in the URL and in the required
 * fields at once — the least ambiguous kind there is — and it is the same split
 * `unmodel/lipsync` and `unmodel/avatar` make one layer up.
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
  LIPSYNC_URL,
  VEED_HEADERS,
  checkKnownParams,
  checkMediaUrls,
  mediaUrlSchema,
  schemaEchoSchema,
} from "./shared";

export { LIPSYNC_URL } from "./shared";

const SOURCE = `${DOCS_BASE}/models/lipsync-2.0`;

/** The id this address serves — one, and the path says so. */
export const LIPSYNC_MODEL = "lipsync-2.0";

/** Every field `Lipsync20Input` declares, in the spec's own order. */
const DECLARED = ["video_url", "audio_url"] as const;

export interface VeedLipsyncParams {
  /**
   * Required. A public `http(s)` URL of the source video to dub, 1–8192
   * characters. VEED fetches it; there is no upload arm.
   */
  video_url: string;
  /** Required. A public `http(s)` URL of the new audio track, same limits. */
  audio_url: string;
  /**
   * The read-only `$schema` echo VEED puts on its own payloads.
   *
   * Declared because the input schema declares it: with
   * `additionalProperties: false`, a caller round-tripping a response body back
   * into a request would otherwise be refused for a field VEED itself wrote.
   */
  $schema?: string;
}

const lipsyncSchema = z.looseObject({
  video_url: mediaUrlSchema,
  audio_url: mediaUrlSchema,
  $schema: schemaEchoSchema,
});

/**
 * One model, and the table exists to declare the roster to the pipeline.
 *
 * An EMPTY row, and that is the finding rather than an omission:
 * `Lipsync20Input` has two fields, both required and both URLs, so there is no
 * enum to narrow, no param to deny and no media rule to state — VEED documents
 * no format list, no duration ceiling and no size ceiling for either input. The
 * one published limit is `audio_too_long`, a failure code with no number
 * attached to it.
 */
export const lipsyncConstraints = {
  "lipsync-2.0": {},
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

/**
 * `.toSdk("veed")` hands back the same flat object.
 *
 * VEED ships no client library in any language — the docs' three tabs are
 * curl, Node `fetch` and Go `net/http` — so this target exists for the shape
 * the rest of the library has rather than for a package to consume. Derived
 * from the `sdk` literal in `finalize`; it must stay an object type with no
 * index signature, or `toSdk` would accept any string.
 */
type VeedSdkTargets<B> = { veed: () => B };

function finalize(params: VeedLipsyncParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: LIPSYNC_URL, method: "POST", headers: VEED_HEADERS },
    { sdk: { veed: () => body } },
  );
}

/**
 * No `estimate`, and VEED publishes an exact rate — $0.07 per second of output,
 * `rounding: "exact"`, right there in the spec's `x-veed-pricing`.
 *
 * The rate is per second of GENERATED video and the generated video's length is
 * the input's, behind a URL unmodel never fetches. Multiplying by a guessed
 * duration would produce a number that looks authoritative and is not. VEED
 * publishes no pre-flight quote endpoint either, so the honest answer is the
 * rate on the catalog row and nothing more.
 */
const validator = createValidator<VeedLipsyncParams, unknown>({
  endpoint: "veed.lipsync",
  schema: lipsyncSchema,
  modelId: () => LIPSYNC_MODEL,
  catalog: models,
  constraints: lipsyncConstraints,
  checks: [checkMediaUrls(SOURCE), checkKnownParams(SOURCE, DECLARED)],
  finalize,
});

/**
 * Validates raw wire params for VEED `POST /v1/lipsync-2.0`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("veed")` returns it unchanged. Auth is yours to add:
 * `Authorization: Bearer <VEED_API_KEY>`.
 *
 * ```ts
 * const params = veed.lipsync({
 *   video_url: "https://media.example.com/take.mp4",
 *   audio_url: "https://media.example.com/vo-french.mp3",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.VEED_API_KEY}` },
 *   body: JSON.stringify(params),
 * });
 * const { data } = await res.json();   // 202, data.status === "PROCESSING"
 * ```
 *
 * Then poll `jobUrl("lipsync-2.0", data.job_id)` until `data.status` is
 * `COMPLETED` and read `data.result.video.url`. Two things to know before
 * writing that loop: the result URL is SIGNED and expires (a day by default —
 * raise it with `X-Veed-Media-Expiration-Seconds`), and a job that reached
 * `FAILED` carries a `VEED_JOB_ERROR_CODES` code that is a different vocabulary
 * from the `VEED_ERROR_CODES` an HTTP rejection uses. Checking `res.ok` sees
 * only half the failures.
 */
export const lipsync = validator as unknown as {
  <T extends VeedLipsyncParams>(
    params: T & ExactKeys<T, VeedLipsyncParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, VeedSdkTargets<T>>;
  safe<T extends VeedLipsyncParams>(
    params: T & ExactKeys<T, VeedLipsyncParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, VeedSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
