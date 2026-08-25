/**
 * HeyGen lipsync — POST https://api.heygen.com/v3/lipsyncs
 *
 * Re-render a clip with the speaker's mouth matched to a new track. A different
 * URL from `heygen.avatar`, a different response shape, a different status enum
 * and a different price table — which is four reasons it is its own address and
 * not an arm of the video route.
 *
 * Wire notes (verified against https://developers.heygen.com/openapi/external-api.json
 * and https://developers.heygen.com/reference/create-lipsync on 2026-08-25):
 *
 * - **`video` and `audio` are OBJECTS, not URLs.** Each is a discriminated
 *   union on `type`: `{ type: "url", url }` or `{ type: "asset_id", asset_id }`.
 *   The inline `base64` arm the video route's `image` accepts is NOT here, so
 *   bytes have to be uploaded (`POST /v3/assets`) or hosted first.
 * - **There is no `model` field; there is `mode`.** `"speed"` (default) or
 *   `"precision"` — "higher quality, uses avatar inference" — and they are two
 *   products with two pages and a 2× price difference ($0.0333 vs $0.0667 per
 *   second). unmodel catalogs them as two ids, `lipsync-speed` and
 *   `lipsync-precision`, after HeyGen's own doc slugs, and `finalize` writes
 *   the wire value back.
 * - `enable_caption` is **deprecated and ignored** — captions are always
 *   generated and the finished job carries `caption_url` either way.
 *   {@link checkDeprecatedCaption} says so, as a warning, because the request
 *   succeeds and is billed identically.
 * - `fps_mode` is typed `string` in the schema with its three values only in
 *   the description, so {@link checkFpsMode} warns rather than refuses.
 * - `start_time` / `end_time` cut a partial-lipsync window;
 *   {@link checkLipsyncWindow} checks it runs forwards, which nothing in the
 *   schema does.
 * - Async: `{ data: { lipsync_id } }`, then `GET /v3/lipsyncs/{lipsync_id}`
 *   over `pending → running → completed | failed` — **`running`, not
 *   `processing`**; the video route's enum is a different one. `callback_url`
 *   replaces the polling.
 * - `Idempotency-Key` is accepted here too, with the same 24-hour replay window.
 * - Headers: `x-api-key: <HEYGEN_API_KEY>` is yours to add.
 *
 * ## `enable_dynamic_duration` is HeyGen's answer to the duration mismatch, and
 * it is a third spelling
 *
 * A boolean, default `true`, described only as "Allow dynamic duration
 * adjustment". sync. answers the same question with a five-arm enum
 * (`sync_mode`: bounce, loop, cut_off, silence, remap), fal's LatentSync with a
 * two-arm one (`loop_mode`), and VEED does not answer it at all — its lipsync
 * input is two URLs and nothing else. Three vendors, three shapes, no shared
 * value space: an on/off switch cannot be spelled compatibly with a
 * five-strategy enum. So it rides as a per-model extra here, exactly as
 * `sync_mode` does at sync., and `unmodel/lipsync` still has no canonical word
 * for it. See `./lipsync-params.ts`.
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
  HEYGEN_HEADERS,
  HEYGEN_LIPSYNC_MODES,
  HEYGEN_LIPSYNC_MODEL_BY_MODE,
  LIPSYNCS_URL,
  checkDeprecatedCaption,
  checkFpsMode,
  checkLipsyncWindow,
  mediaRefSchema,
  type HeygenFpsMode,
  type HeygenLipsyncMode,
  type HeygenMediaRef,
} from "./shared";

export { LIPSYNCS_URL } from "./shared";

const SOURCE = `${DOCS_BASE}/reference/create-lipsync`;

/** The `mode` an omitted `mode` means, and therefore the default catalog row. */
export const DEFAULT_LIPSYNC_MODE: HeygenLipsyncMode = "speed";

export interface HeygenLipsyncParams {
  /** Required. The source clip: `{ type: "url", url }` or `{ type: "asset_id", asset_id }`. */
  video: HeygenMediaRef;
  /** Required. The replacement track, in the same two shapes. */
  audio: HeygenMediaRef;
  /**
   * Quality mode; default `"speed"`. `"precision"` is higher quality, uses
   * avatar inference, and costs twice as much per second.
   *
   * This is the field unmodel's `lipsync-speed` / `lipsync-precision` catalog
   * ids compile to.
   */
  mode?: HeygenLipsyncMode;
  /** Title for the job in the dashboard. */
  title?: string;
  /** HeyGen POSTs the finished job here. */
  callback_url?: string;
  /** Echoed back in the webhook payload. */
  callback_id?: string;
  /**
   * @deprecated Ignored. Captions are always generated; whether to display them
   * is a download-side choice, and the finished job carries `caption_url`
   * regardless.
   */
  enable_caption?: boolean;
  /** Preserve the source's encoding specs (resolution, bitrate). */
  keep_the_same_format?: boolean;
  /** Default `true`. HeyGen's spelling of the duration-mismatch question. */
  enable_dynamic_duration?: boolean;
  /** Remove background music from the output. Default `false`. */
  disable_music_track?: boolean;
  /** Enhance speech quality. Default `false`. */
  enable_speech_enhancement?: boolean;
  /** Add a watermark. Default `false`. */
  enable_watermark?: boolean;
  /** Seconds. The start of a partial-lipsync window. */
  start_time?: number;
  /** Seconds. The end of it — must be greater than `start_time`. */
  end_time?: number;
  /**
   * `"vfr" | "cfr" | "passthrough"`, per the field's description — the SCHEMA
   * types it as a plain string, so the tail is open and an unrecognised value
   * is a warning rather than a refusal.
   */
  fps_mode?: HeygenFpsMode | (string & {});
  /** Destination folder in the workspace. */
  folder_id?: string;
}

const lipsyncSchema = z.looseObject({
  video: mediaRefSchema,
  audio: mediaRefSchema,
  mode: z.enum(HEYGEN_LIPSYNC_MODES).optional(),
  title: z.string().optional(),
  callback_url: z.string().optional(),
  callback_id: z.string().optional(),
  enable_caption: z.boolean().optional(),
  keep_the_same_format: z.boolean().optional(),
  enable_dynamic_duration: z.boolean().optional(),
  disable_music_track: z.boolean().optional(),
  enable_speech_enhancement: z.boolean().optional(),
  enable_watermark: z.boolean().optional(),
  start_time: z.number().optional(),
  end_time: z.number().optional(),
  fps_mode: z.string().optional(),
  folder_id: z.string().optional(),
});

/**
 * Two modes, and nothing to narrow between them.
 *
 * Every field on `CreateLipsyncRequest` is declared once for the whole route —
 * `mode` changes the price and the pipeline, not the request surface — so the
 * table exists to declare the roster to the pipeline and to make
 * `constraintsFor` answer for these ids.
 */
export const lipsyncConstraints = {
  "lipsync-speed": {},
  "lipsync-precision": {},
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

/** See `./avatar.ts` — one target, and HeyGen ships no client to hand it to. */
type HeygenSdkTargets<B> = { heygen: () => B };

function finalize(params: HeygenLipsyncParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: LIPSYNCS_URL, method: "POST", headers: HEYGEN_HEADERS },
    { sdk: { heygen: () => body } },
  );
}

/**
 * No `estimate`, and here the RATE is exact — $0.0333 per second at `"speed"`,
 * $0.0667 at `"precision"`, and `mode` is in the body.
 *
 * What is missing is only the duration, and a lipsync's duration is the
 * source clip's (or the window's, when `start_time`/`end_time` cut one) —
 * neither of which a URL reveals. This is the closest any address in this
 * provider comes to a computable estimate, and it still declines: the finished
 * job's `duration` is the billed quantity.
 */
const validator = createValidator<HeygenLipsyncParams, unknown>({
  endpoint: "heygen.lipsync",
  schema: lipsyncSchema,
  modelId: (params) => HEYGEN_LIPSYNC_MODEL_BY_MODE[params.mode ?? DEFAULT_LIPSYNC_MODE],
  catalog: models,
  constraints: lipsyncConstraints,
  checks: [checkLipsyncWindow(SOURCE), checkFpsMode(SOURCE), checkDeprecatedCaption(SOURCE)],
  finalize,
});

/**
 * Validates raw wire params for HeyGen `POST /v3/lipsyncs`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("heygen")` returns it unchanged. Auth is yours to add:
 * `x-api-key: <HEYGEN_API_KEY>`.
 *
 * ```ts
 * const params = heygen.lipsync({
 *   video: { type: "url", url: "https://media.example.com/take.mp4" },
 *   audio: { type: "url", url: "https://media.example.com/vo-french.mp3" },
 *   mode: "precision",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "x-api-key": process.env.HEYGEN_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * const { data } = await res.json();   // { lipsync_id }
 * ```
 *
 * Then poll `lipsyncUrl(data.lipsync_id)` until `status` is `completed` and
 * read `video_url`. The status enum here is `pending → running → completed |
 * failed` — **not** the video route's, which says `processing` where this one
 * says `running`. Two lifecycles at one vendor.
 */
export const lipsync = validator as unknown as {
  <T extends HeygenLipsyncParams>(
    params: T & ExactKeys<T, HeygenLipsyncParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, HeygenSdkTargets<T>>;
  safe<T extends HeygenLipsyncParams>(
    params: T & ExactKeys<T, HeygenLipsyncParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, HeygenSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
