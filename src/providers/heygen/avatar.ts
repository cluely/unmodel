/**
 * HeyGen avatar video — POST https://api.heygen.com/v3/videos
 *
 * Wire notes (verified against https://developers.heygen.com/openapi/external-api.json
 * and https://developers.heygen.com/reference/create-video on 2026-08-25; note
 * that the OLD host's slug for this page, `docs.heygen.com/reference/create-an-avatar-video-v2`,
 * 404s at the new host — see `./shared.ts`):
 *
 * - **`type` is a discriminator and it decides what else is required.**
 *   `CreateVideoV3RequestBody` is a `oneOf` on `type` with four arms; unmodel
 *   serves two of them. `"avatar"` requires `avatar_id` (a look from your
 *   workspace) and declares no `image`; `"image"` requires `image` (url, asset
 *   id or inline base64) and declares no `avatar_id`. Both are
 *   `additionalProperties: false`, so the wrong field for the arm is a 400 —
 *   {@link checkVisualSource} is the guard, and HeyGen's own documented example
 *   error is exactly that mistake.
 * - **There is no `model` field.** `engine` is a second discriminated union
 *   (`avatar_iii`, `avatar_iv`, `avatar_v`) and it is OPTIONAL, defaulting to
 *   `avatar_iv`. Those three are what unmodel catalogs, because they are three
 *   products with three pages and a four-fold price spread — so `modelId` reads
 *   `engine.type` and falls back to the documented default rather than to
 *   `unknown_model`.
 * - **The speech is a script OR a track, never both**, `voice_id` is required
 *   with a script unless `avatar_id` supplies a default voice, and
 *   `voice_settings` is silently ignored when the audio is uploaded.
 *   {@link checkSpeechSource} carries all four rules; only the last is a
 *   warning, because only the last is a no-op rather than a refusal.
 * - **Two fields are engine-gated and HeyGen REJECTS them** rather than
 *   ignoring them: `expressiveness` (Avatar IV only) and `motion_prompt`
 *   (Avatar IV and V). See {@link checkEngineGatedFields}.
 * - **`output_format: "webm"` rejects `background`** and applies background
 *   removal itself. See {@link checkTransparentOutput}.
 * - Async: **200** with `{ data: { video_id, status: "waiting" } }`; poll
 *   `GET /v3/videos/{video_id}` until `completed` or `failed`, then read
 *   `video_url` (plus `subtitle_url`, `captioned_video_url`, `thumbnail_url`,
 *   `gif_url`, and the `duration` you were billed for). `callback_url` replaces
 *   the polling.
 * - **`Idempotency-Key` is worth setting.** Optional header, 24-hour replay
 *   window, 409 `request_in_progress` on an overlapping retry. Renders are
 *   billed by the second; a duplicate submission is money.
 * - Headers: add `x-api-key: <HEYGEN_API_KEY>` yourself — unmodel never touches
 *   credentials.
 *
 * ## Why the two arms are one address and `heygen.lipsync` is another
 *
 * `type: "avatar"` and `type: "image"` are one URL, one response shape, one
 * price table and one `oneOf` — the fork is in a discriminator HeyGen itself
 * publishes on the body, and both arms produce the same thing: a performance
 * invented for a face that was not performing. `POST /v3/lipsyncs` is a
 * different URL with a different response shape, a different status enum and a
 * different price table, and it PRESERVES a performance rather than inventing
 * one. That is the same split `unmodel/avatar` and `unmodel/lipsync` make one
 * layer up.
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
  HEYGEN_ASPECT_RATIOS,
  HEYGEN_BACKGROUND_TYPES,
  HEYGEN_DEFAULT_ENGINE,
  HEYGEN_EXPRESSIVENESS,
  HEYGEN_FITS,
  HEYGEN_HEADERS,
  HEYGEN_OUTPUT_FORMATS,
  HEYGEN_RESOLUTIONS,
  HEYGEN_VIDEO_TYPES,
  VIDEOS_URL,
  assetRefSchema,
  backgroundSchema,
  captionSchema,
  checkEngineArm,
  checkEngineGatedFields,
  checkSpeechSource,
  checkTransparentOutput,
  checkVisualSource,
  engineOf,
  engineSchema,
  voiceSettingsSchema,
  watermarkSchema,
  type HeygenAspectRatio,
  type HeygenAssetRef,
  type HeygenBackground,
  type HeygenCaption,
  type HeygenEngineConfig,
  type HeygenExpressiveness,
  type HeygenFit,
  type HeygenOutputFormat,
  type HeygenResolution,
  type HeygenVideoType,
  type HeygenVoiceSettings,
  type HeygenWatermark,
} from "./shared";

export { VIDEOS_URL, HEYGEN_VIDEO_TYPES } from "./shared";
export type { HeygenVideoType } from "./shared";

const SOURCE = `${DOCS_BASE}/reference/create-video`;

export interface HeygenAvatarParams {
  /**
   * Required. The discriminator, and what decides which visual source the
   * request must carry.
   *
   * `"avatar"` animates a look from your workspace (`avatar_id`); `"image"`
   * animates a picture you supply (`image`). The other two arms of HeyGen's
   * union — `"cinematic_avatar"` and `"studio"` — are deliberately not served;
   * see `./models.ts`.
   */
  type: HeygenVideoType;
  /**
   * Required on the `"avatar"` arm, refused on the `"image"` arm. A look id
   * from `GET /v3/avatars/looks` — video avatar or photo avatar.
   *
   * A plain `string` and not an enum on purpose: the roster is per-ACCOUNT
   * (a Digital Twin is $1.00 to create), and HeyGen publishes no global list.
   */
  avatar_id?: string;
  /** Required on the `"image"` arm, refused on the `"avatar"` arm. */
  image?: HeygenAssetRef;
  /**
   * Which engine renders. **Optional, and omitting it means `avatar_iv`** —
   * which is also a price decision, so unmodel's unified adapter always writes
   * it out.
   */
  engine?: HeygenEngineConfig;
  /** Text for the avatar to speak. Mutually exclusive with the audio fields. */
  script?: string;
  /** Required with `script`, unless `avatar_id` supplies its default voice. */
  voice_id?: string;
  /** A public URL of audio to lip-sync. Mutually exclusive with `script`. */
  audio_url?: string;
  /** An uploaded audio asset. Mutually exclusive with `script`. */
  audio_asset_id?: string;
  /** Speed, pitch, volume, locale and engine tuning. Ignored for uploaded audio. */
  voice_settings?: HeygenVoiceSettings;
  /** Display title in the HeyGen dashboard. */
  title?: string;
  /** Destination folder. Omit, `null` or `""` puts the video at the workspace root. */
  folder_id?: string;
  /** `"720p" | "1080p" | "4k"`. 4K is not available on every engine and look. */
  resolution?: HeygenResolution;
  /** Default `"16:9"`. `"auto"` preserves the source's ratio. */
  aspect_ratio?: HeygenAspectRatio;
  /** How the subject meets the canvas. Omitted lets HeyGen decide. */
  fit?: HeygenFit;
  /** A solid colour or an image. **Rejected when `output_format` is `"webm"`.** */
  background?: HeygenBackground;
  /** Video avatars must have been trained with matting enabled. */
  remove_background?: boolean;
  /** HeyGen POSTs the finished video here. */
  callback_url?: string;
  /** Echoed back in the webhook payload. */
  callback_id?: string;
  /** Enterprise-gated overlay. */
  watermark?: HeygenWatermark;
  /** A sidecar subtitle file is always produced; `style` burns captions in too. */
  caption?: HeygenCaption;
  /** Default `"mp4"`. `"webm"` returns an alpha channel and rejects `background`. */
  output_format?: HeygenOutputFormat;
  /** Pronunciation overrides for synthesized speech. `GET /v3/brand-glossaries`. */
  brand_glossary_id?: string;
  /** Body motion and gestures, in words. Avatar IV and V; photo-avatar rules apply. */
  motion_prompt?: string;
  /** Avatar IV only, photo avatars only. Defaults to `"low"`. */
  expressiveness?: HeygenExpressiveness;
}

const avatarSchema = z.looseObject({
  type: z.enum(HEYGEN_VIDEO_TYPES),
  avatar_id: z.string().optional(),
  image: assetRefSchema.optional(),
  engine: engineSchema.optional(),
  script: z.string().min(1).optional(),
  voice_id: z.string().optional(),
  audio_url: z.string().optional(),
  audio_asset_id: z.string().optional(),
  voice_settings: voiceSettingsSchema.optional(),
  title: z.string().optional(),
  folder_id: z.string().optional(),
  resolution: z.enum(HEYGEN_RESOLUTIONS).optional(),
  aspect_ratio: z.enum(HEYGEN_ASPECT_RATIOS).optional(),
  fit: z.enum(HEYGEN_FITS).optional(),
  background: backgroundSchema.optional(),
  remove_background: z.boolean().optional(),
  callback_url: z.string().optional(),
  callback_id: z.string().optional(),
  watermark: watermarkSchema.optional(),
  caption: captionSchema.optional(),
  output_format: z.enum(HEYGEN_OUTPUT_FORMATS).optional(),
  brand_glossary_id: z.string().min(1).optional(),
  motion_prompt: z.string().optional(),
  expressiveness: z.enum(HEYGEN_EXPRESSIVENESS).optional(),
});

/**
 * The enums each engine narrows — which is all three of them equally, because
 * `resolution`, `aspect_ratio`, `fit`, `output_format` and `background.type`
 * are declared once on the arm rather than per engine.
 *
 * The per-ENGINE narrowing that does exist — `expressiveness` at Avatar IV
 * only, `motion_prompt` not at Avatar III, raw image input not at Avatar III —
 * is a `deny`-shaped rule whose useful message is "which engines DO take this",
 * which a deny table has nowhere to put. So it lives in
 * {@link checkEngineGatedFields} and {@link checkEngineArm}, and this table
 * declares the roster to the pipeline and the enums to `constraintsFor`.
 */
const ENGINE_ENUMS = {
  resolution: HEYGEN_RESOLUTIONS,
  aspect_ratio: HEYGEN_ASPECT_RATIOS,
  fit: HEYGEN_FITS,
  output_format: HEYGEN_OUTPUT_FORMATS,
  expressiveness: HEYGEN_EXPRESSIVENESS,
} as Readonly<Record<string, readonly string[]>>;

const ENGINE_ENUMS_NO_EXPRESSIVENESS = {
  resolution: HEYGEN_RESOLUTIONS,
  aspect_ratio: HEYGEN_ASPECT_RATIOS,
  fit: HEYGEN_FITS,
  output_format: HEYGEN_OUTPUT_FORMATS,
} as Readonly<Record<string, readonly string[]>>;

export const avatarConstraints = {
  avatar_iii: { enums: ENGINE_ENUMS_NO_EXPRESSIVENESS },
  avatar_iv: { enums: ENGINE_ENUMS },
  avatar_v: { enums: ENGINE_ENUMS_NO_EXPRESSIVENESS },
} as const satisfies Readonly<Partial<Record<string, EndpointConstraints>>>;

/**
 * `.toSdk("heygen")` hands back the same flat object.
 *
 * HeyGen ships no first-party JavaScript client — its own quick-start is
 * `fetch` and curl — so this target exists for the shape the rest of the
 * library has rather than for a package to consume. Derived from the `sdk`
 * literal in `finalize`; it must stay an object type with no index signature,
 * or `toSdk` would accept any string.
 */
type HeygenSdkTargets<B> = { heygen: () => B };

function finalize(params: HeygenAvatarParams): unknown {
  const body = { ...params };
  return toValidated(
    body,
    { url: VIDEOS_URL, method: "POST", headers: HEYGEN_HEADERS },
    { sdk: { heygen: () => body } },
  );
}

/**
 * No `estimate`, and HeyGen publishes a clean per-second USD table.
 *
 * Two things stop it. The rate is per second of OUTPUT and the output's length
 * is the audio's (or the script's, once spoken) — behind a URL, or behind a
 * synthesis unmodel does not run. And two of the three engine rates are BANDS
 * keyed by avatar type, which is a property of the `avatar_id`'s look rather
 * than of the request. HeyGen reports the billed `duration` on the finished
 * job; `GET /v3/users/me` reports the wallet.
 */
const validator = createValidator<HeygenAvatarParams, unknown>({
  endpoint: "heygen.avatar",
  schema: avatarSchema,
  modelId: (params) => engineOf(params),
  catalog: models,
  constraints: avatarConstraints,
  checks: [
    checkVisualSource(SOURCE),
    checkEngineArm(`${DOCS_BASE}/avatar-iii`),
    checkEngineGatedFields(SOURCE),
    checkSpeechSource(SOURCE),
    checkTransparentOutput(SOURCE),
  ],
  finalize,
});

/**
 * Validates raw wire params for HeyGen `POST /v3/videos`.
 *
 * The returned object's enumerable props are the exact fetch JSON body.
 * `.toSdk("heygen")` returns it unchanged. Auth is yours to add:
 * `x-api-key: <HEYGEN_API_KEY>`.
 *
 * ```ts
 * const params = heygen.avatar({
 *   type: "avatar",
 *   avatar_id: "abc123",
 *   audio_url: "https://media.example.com/vo.mp3",
 *   engine: { type: "avatar_v" },
 *   resolution: "1080p",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: {
 *     ...params.request.headers,
 *     "x-api-key": process.env.HEYGEN_API_KEY!,
 *     "Idempotency-Key": crypto.randomUUID(),
 *   },
 *   body: JSON.stringify(params),
 * });
 * const { data } = await res.json();   // { video_id, status: "waiting" }
 * ```
 *
 * Then poll `videoUrl(data.video_id)` until `status` is `completed` and read
 * `video_url`. Three things to know before writing that loop: the poll route's
 * status enum is NOT the lipsync route's (`processing` here, `running` there),
 * the URLs it hands back expire, and `duration` on the finished job is the
 * quantity you were billed for — it is the only place that number is real.
 */
export const avatar = validator as unknown as {
  <T extends HeygenAvatarParams>(
    params: T & ExactKeys<T, HeygenAvatarParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, HeygenSdkTargets<T>>;
  safe<T extends HeygenAvatarParams>(
    params: T & ExactKeys<T, HeygenAvatarParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, HeygenSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/** The engine an omitted `engine` resolves to, re-exported for the adapter. */
export { HEYGEN_DEFAULT_ENGINE };
