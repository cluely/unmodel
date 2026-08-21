/**
 * OpenAI Sora video generation — POST https://api.openai.com/v1/videos
 *
 * Wire notes (verified 2026-08-13 against the create API reference at
 * https://developers.openai.com/api/docs/api-reference/videos/create, the
 * video-generation guide at
 * https://developers.openai.com/api/docs/guides/video-generation, and the
 * OpenAPI-generated openai@7.4.0 `resources/videos.d.ts` types):
 * - This validates the SUBMIT body only. The endpoint returns a video job
 *   (`status: "queued" | "in_progress" | ...`); polling `GET /v1/videos/{id}`
 *   and downloading `/content` are transport, out of unmodel's scope.
 * - `seconds` and `size` are STRINGS on the wire (e.g. `"8"`, `"1280x720"`).
 * - The endpoint accepts both `application/json` and `multipart/form-data`.
 *   unmodel validates the JSON surface: `input_reference` is the reference
 *   object `{ file_id }` or `{ image_url }` ("Provide exactly one of
 *   `image_url` or `file_id`"). Uploading raw image bytes as
 *   `input_reference` requires a multipart request — upload via the Files
 *   API and pass `file_id`, or pass a URL / base64 data URL as `image_url`.
 * - The reference image must match the target video's resolution (`size`);
 *   unmodel cannot inspect image bytes, so that is not checked here.
 * - `seconds` "16"/"20" and the 1080p sizes come from the current guide; the
 *   create reference enum ("4"/"8"/"12", four sizes) lags it. See
 *   constraints.ts for the sourced per-model tables.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateEstimate, ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models } from "../../catalog/openai.gen";
import { SORA_MODELS, SORA_RATE_PER_SECOND, type SoraModelId } from "./videos-models";
import { videoConstraints } from "./constraints";

export const VIDEOS_URL = "https://api.openai.com/v1/videos";

/**
 * Server-side default when `model` is omitted — "Defaults to `sora-2`"
 * (create API reference). Model-dependent checks run against this id when
 * none is given.
 */
export const DEFAULT_VIDEO_MODEL_ID = "sora-2";

/** Server-side default for `seconds` — "Defaults to 4 seconds" (reference). */
export const DEFAULT_VIDEO_SECONDS = "4";

/** Server-side default for `size` — "Defaults to `720x1280`" (reference). */
export const DEFAULT_VIDEO_SIZE = "720x1280";

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per model id, each carrying exactly the sizes
// that model renders. sora-2 (and its dated snapshots) render 720p only;
// sora-2-pro adds 1024p and 1080p — see constraints.ts for sources.
// ---------------------------------------------------------------------------

/**
 * JSON form of the optional first-frame reference. "Provide exactly one of
 * `image_url` or `file_id`" (create API reference). `image_url` is a fully
 * qualified URL or a base64 data URL; `file_id` references a Files API
 * upload. Accepted image types: jpeg, png, webp (video-generation guide).
 */
export interface VideoInputReference {
  file_id?: string;
  /** A fully qualified URL or base64-encoded data URL. */
  image_url?: string;
}

/** Clip duration in seconds, as a string on the wire. */
export type SoraSeconds = "4" | "8" | "12" | "16" | "20";

/** Resolutions sora-2 (non-pro) renders. */
export type SoraBaseSize = "720x1280" | "1280x720";

/** Resolutions sora-2-pro renders (720p, 1024p, 1080p). */
export type SoraProSize = SoraBaseSize | "1024x1792" | "1792x1024" | "1920x1080" | "1080x1920";

interface SoraBodyCommon {
  /** Text prompt that describes the video to generate. */
  prompt: string;
  /** Optional first-frame reference; exactly one of file_id / image_url. */
  input_reference?: VideoInputReference;
  /** Clip duration in seconds. Defaults to "4". */
  seconds?: SoraSeconds;
}

export interface Sora2Body extends SoraBodyCommon {
  model: "sora-2";
  size?: SoraBaseSize;
}

export interface Sora2Snapshot20251006Body extends SoraBodyCommon {
  model: "sora-2-2025-10-06";
  size?: SoraBaseSize;
}

export interface Sora2Snapshot20251208Body extends SoraBodyCommon {
  model: "sora-2-2025-12-08";
  size?: SoraBaseSize;
}

export interface Sora2ProBody extends SoraBodyCommon {
  model: "sora-2-pro";
  size?: SoraProSize;
}

export interface Sora2ProSnapshot20251006Body extends SoraBodyCommon {
  model: "sora-2-pro-2025-10-06";
  size?: SoraProSize;
}

/** `model` omitted → the server defaults to sora-2, so base sizes apply. */
export interface DefaultVideoModelBody extends SoraBodyCommon {
  model?: never;
  size?: SoraBaseSize;
}

/** Escape hatch for models unmodel doesn't know yet (unknown_model warning). */
export interface UnknownVideoModelBody<Model extends string> {
  model: FutureModelId<Model, keyof VideosBodyByModel>;
  prompt: string;
  [key: string]: unknown;
}

/**
 * Closed over documented models by default. Supply a future model literal to
 * opt into the loose arm: `VideosBody<"sora-3">`.
 */
export type VideosBody<FutureModel extends string = never> =
  | Sora2Body
  | Sora2Snapshot20251006Body
  | Sora2Snapshot20251208Body
  | Sora2ProBody
  | Sora2ProSnapshot20251006Body
  | DefaultVideoModelBody
  | UnknownVideoModelBody<FutureModel>;

interface VideosBodyByModel {
  "sora-2": Sora2Body;
  "sora-2-2025-10-06": Sora2Snapshot20251006Body;
  "sora-2-2025-12-08": Sora2Snapshot20251208Body;
  "sora-2-pro": Sora2ProBody;
  "sora-2-pro-2025-10-06": Sora2ProSnapshot20251006Body;
}

/** Resolves a model id literal (or absence) to its exact Tier-A arm. */
type VideosArm<M> = M extends keyof VideosBodyByModel
  ? VideosBodyByModel[M]
  : M extends string
    ? UnknownVideoModelBody<M>
    : DefaultVideoModelBody;

type VideosModelInput = keyof VideosBodyByModel | (string & {});
/** Runtime implementation type; the public alias stays closed by default. */
type AnyVideosBody = VideosBody<string>;

// ---------------------------------------------------------------------------
// Schema — loose; per-model narrowing happens in constraints.ts (runtime)
// and the Tier-A arms (types).
// ---------------------------------------------------------------------------

const videosSchema = z.looseObject({
  prompt: z.string(),
  model: z.string().optional(),
  seconds: z.string().optional(),
  size: z.string().optional(),
  input_reference: z
    .looseObject({
      file_id: z.string().optional(),
      image_url: z.string().optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const VIDEOS_CREATE_DOCS_URL = "https://developers.openai.com/api/docs/api-reference/videos/create";

/** "Provide exactly one of `image_url` or `file_id`" (create API reference). */
function checkInputReference(
  params: AnyVideosBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const reference = (params as { input_reference?: VideoInputReference }).input_reference;
  if (reference === undefined) return;
  const provided = [reference.file_id, reference.image_url].filter((v) => v != null).length;
  if (provided === 1) return;
  ctx.report({
    code: "invalid_shape",
    path: ["input_reference"],
    message: `\`input_reference\` must carry exactly one of \`file_id\` or \`image_url\`; got ${provided === 0 ? "neither" : "both"}. To send raw image bytes instead, use a multipart request (out of unmodel's JSON surface) or upload via the Files API and pass \`file_id\`.`,
    meta: { source: VIDEOS_CREATE_DOCS_URL },
  });
}

/** Catalog-known models that cannot output video (e.g. a chat id) error out. */
function checkVideoOutputModality(
  params: AnyVideosBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined || info.modalities.output.includes("video")) return;
  const model = params.model ?? DEFAULT_VIDEO_MODEL_ID;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message: `Model "${model}" does not generate video (catalog output modalities: ${info.modalities.output.join(", ")}); POST /v1/videos requires a video model such as sora-2.`,
  });
}

// ---------------------------------------------------------------------------
// Estimation — video is billed per generated second at a per-resolution rate
// (videos-models.ts table); seconds and size are known up front, so the
// estimate is exact for known models.
// ---------------------------------------------------------------------------

function estimate(
  params: AnyVideosBody,
  info: ModelInfo | undefined,
  _ctx: PipelineContext,
): ValidateEstimate {
  const seconds = Number(params.seconds ?? DEFAULT_VIDEO_SECONDS);
  if (!Number.isFinite(seconds)) return {};
  const model = params.model ?? DEFAULT_VIDEO_MODEL_ID;
  const size = typeof params.size === "string" ? params.size : DEFAULT_VIDEO_SIZE;
  const rate =
    SORA_RATE_PER_SECOND[model as SoraModelId]?.[size] ?? info?.cost?.perVideoSecond;
  return rate === undefined ? {} : { costUSD: seconds * rate };
}

// ---------------------------------------------------------------------------
// Finalize — every param is a wire field; no path/query params.
// ---------------------------------------------------------------------------

/**
 * The one `.toSdk("openai")` target for this endpoint — the official
 * `openai` SDK's params are wire-shaped. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type OpenAISdkTargets<B> = { openai: () => B };

function finalize(params: AnyVideosBody): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: VIDEOS_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { openai: () => body },
  });
}

/**
 * The sora ids are absent from the generated models.dev catalog
 * (`OpenaiVideoModelId` is `never` today), so the validator runs against the
 * generated catalog merged with the hand-maintained SORA_MODELS overlay.
 */
const catalog = { ...models, ...SORA_MODELS };

const validator = createValidator<AnyVideosBody, unknown>({
  endpoint: "openai.video",
  schema: videosSchema,
  // `model` is optional on the wire; checks run against the documented
  // server-side default so base-model size/seconds rules apply when omitted.
  modelId: (params) => params.model ?? DEFAULT_VIDEO_MODEL_ID,
  catalog,
  constraints: videoConstraints,
  checks: [checkInputReference, checkVideoOutputModality],
  estimate,
  finalize,
});

/**
 * Validates the submit body for POST /v1/videos (Sora video generation
 * jobs). Known models get their exact per-model surface at compile time
 * (e.g. a 1080p `size` is a compile error for sora-2 — pro renders those);
 * unknown models fall back to a loose arm with a runtime unknown_model
 * warning. The result's enumerable props are the exact JSON fetch body;
 * `.toSdk("openai")` returns it unchanged in shape (the OpenAI SDK's
 * `videos.create` params are wire-shaped) and `.request` carries
 * url/method/static headers. The response is an async job — poll
 * `GET /v1/videos/{id}` and download `/content` yourself; that transport is
 * out of unmodel's scope.
 *
 * ```ts
 * const params = openai.video({
 *   model: "sora-2",
 *   prompt: "A calico cat pounces through tall grass at golden hour.",
 *   size: "1280x720",
 *   seconds: "8",
 * });
 * const job = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${key}` },
 *   body: JSON.stringify(params),
 * }).then((r) => r.json());
 * ```
 */
export const video = validator as unknown as {
  <M extends VideosModelInput | undefined = undefined, T extends VideosArm<M> = VideosArm<M>>(
    params: T & VideosArm<M> & { model?: M } & ExactKeys<T, VideosArm<M>>,
    options?: ValidateOptions,
  ): Validated<T, OpenAISdkTargets<T>>;
  safe<M extends VideosModelInput | undefined = undefined, T extends VideosArm<M> = VideosArm<M>>(
    params: T & VideosArm<M> & { model?: M } & ExactKeys<T, VideosArm<M>>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T, OpenAISdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
