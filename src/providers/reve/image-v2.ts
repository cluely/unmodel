/**
 * Reve v2 image generation — POST https://api.reve.com/v2/image/create
 *
 * Wire notes (verified against https://api.reve.com/console/docs on
 * 2026-08-13):
 * - v2 is Reve's current flagship route: prompt plus optional ordered raw
 *   reference images, returning an image AND the layout that describes it.
 *   Text-to-image and image editing are the same call — supply `references`
 *   and address them from the prompt with `<frame>N</frame>` (0-based).
 * - `references` entries are RAW image objects with exactly one of `data`
 *   (base64) or `ref` (`id:<uuid>` or `reference:@<name>`). The compound
 *   `{ image, layout }` shape belongs to the layout endpoints only ("Do not
 *   wrap these as { image, layout } objects") — unmodel reports that mistake.
 * - v2 takes the full aspect-ratio set including `auto` (the default), not the
 *   7-value v1 subset, and `prompt` is capped at 4000 characters (v1: 2560).
 * - Inference is synchronous and slow ("commonly take 40–80 seconds …
 *   configure request timeouts of at least 120 seconds") unless you pass
 *   `async`, which returns 202 with a `result_url` to poll. Polling is
 *   transport — out of unmodel's scope; `REVE_V2_RESPONSE_URL` is exported for
 *   convenience.
 * - Pricing: 150 credits ≈ $0.20 per image, scaled by `test_time_scaling`
 *   where accepted. "Billing is identical to a synchronous request" for async.
 * - NOT modeled: the experimental layout pipeline
 *   (`/v2/image/create_layout`, `/v2/image/render_layout`,
 *   `/v2/image/extract_layout`), whose `references` take the compound shape
 *   and whose layout schema is a large nested structure.
 * - Auth is an `Authorization: Bearer …` header — unmodel never touches keys.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import {
  models,
  REVE_V2_CREATE_VERSIONS,
  resolveReveVersion,
  type ReveV2CreateVersion,
} from "./models";
import {
  REVE_API_BASE_URL,
  REVE_DOCS_URL,
  REVE_V2_ASPECT_RATIOS,
  checkAspectRatio,
  checkImageBudget,
  checkPostprocessing,
  checkPromptLength,
  checkVersion,
  isRecord,
  reveEstimateUSD,
  type RevePostprocessingOperation,
  type ReveV2AspectRatio,
} from "./shared";

export const REVE_V2_CREATE_URL = `${REVE_API_BASE_URL}/v2/image/create`;

/** Async result endpoint (`GET ?request_id=…`) — transport, out of scope. */
export const REVE_V2_RESPONSE_URL = `${REVE_API_BASE_URL}/v2/image/response`;

/** "The maximum length is 4000 characters." — v2 create. */
export const REVE_V2_PROMPT_MAX_LENGTH = 4000;

/** `async.image_format` values. */
export const REVE_ASYNC_IMAGE_FORMATS = [
  "application/json",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type ReveAsyncImageFormat = (typeof REVE_ASYNC_IMAGE_FORMATS)[number];

/** An image input: exactly one of `data` or `ref`. */
export type ReveImageInput = { data: string; ref?: never } | { ref: string; data?: never };

/** Background-execution options; every /v2/image endpoint accepts them. */
export interface ReveAsyncOptions {
  /** https URL on a publicly routable host; POSTed once on completion. */
  callback_url?: string;
  /**
   * Result encoding. Default "application/json". CLOSED enum — the 4 documented
   * formats are the whole space.
   */
  image_format?: ReveAsyncImageFormat;
  /** Unauthenticated signed result URL — only with an `image/*` format. */
  public?: boolean;
}

export interface CreateV2Params {
  /**
   * Text description; `<frame>N</frame>` addresses the Nth `references` entry.
   * ≤ 4000 chars. REQUIRED.
   */
  prompt: string;
  /** Raw reference images — each exactly one of `data` (base64) or `ref`. */
  references?: ReveImageInput[];
  /**
   * Output aspect ratio (full v2 set). Default "auto". CLOSED enum — the 18
   * values (17 ratios plus `auto`) are the whole documented space.
   */
  aspect_ratio?: ReveV2AspectRatio;
  /** Post-generation operations, same shapes as the v1 routes. */
  postprocessing?: RevePostprocessingOperation[];
  /** Public model version alias. Default "latest". */
  version?: ReveV2CreateVersion | (string & {});
  /** Run in the background and return 202 with a `result_url`. */
  async?: ReveAsyncOptions;
}

const createV2Schema = z.looseObject({
  prompt: z.string(),
  references: z.array(z.unknown()).optional(),
  aspect_ratio: z.string().optional(),
  postprocessing: z.array(z.unknown()).optional(),
  version: z.string().optional(),
  async: z.looseObject({}).optional(),
});

function checkReferences(params: CreateV2Params, ctx: PipelineContext): void {
  const references = params.references;
  if (references == null) return;
  if (!Array.isArray(references)) {
    ctx.report({
      code: "invalid_shape",
      path: ["references"],
      message: "`references` must be an array of image objects.",
      meta: { source: REVE_DOCS_URL },
    });
    return;
  }
  const images: Array<{ path: Array<string | number>; data: unknown }> = [];
  references.forEach((reference, i) => {
    const path = ["references", i];
    if (!isRecord(reference)) {
      ctx.report({
        code: "invalid_shape",
        path,
        message:
          "each `references` entry must be an object with exactly one of `data` (base64 image bytes) or `ref` (\"id:<uuid>\" or \"reference:@<name>\").",
        meta: { source: REVE_DOCS_URL },
      });
      return;
    }
    if ("image" in reference || "layout" in reference) {
      ctx.report({
        code: "invalid_shape",
        path,
        message:
          "`v2/image/create` takes RAW image objects — do not wrap them as `{ image, layout }`; that compound reference shape is only for the layout endpoints (create_layout / render_layout).",
        meta: { source: REVE_DOCS_URL },
      });
      return;
    }
    const hasData = typeof reference.data === "string";
    const hasRef = typeof reference.ref === "string";
    if (hasData === hasRef) {
      ctx.report({
        code: "invalid_shape",
        path,
        message: `each \`references\` entry needs exactly one of \`data\` or \`ref\`; got ${hasData ? "both" : "neither"}.`,
        meta: { source: REVE_DOCS_URL },
      });
      return;
    }
    if (hasData) images.push({ path: [...path, "data"], data: reference.data });
  });
  checkImageBudget(ctx, images);
}

function checkAsync(params: CreateV2Params, ctx: PipelineContext): void {
  const options = params.async;
  if (options == null) return;
  if (!isRecord(options)) {
    ctx.report({
      code: "invalid_shape",
      path: ["async"],
      message: "`async` must be an object (`{ callback_url?, image_format?, public? }`).",
      meta: { source: REVE_DOCS_URL },
    });
    return;
  }
  const format = options.image_format;
  if (
    format != null &&
    (typeof format !== "string" || !(REVE_ASYNC_IMAGE_FORMATS as readonly string[]).includes(format))
  ) {
    ctx.report({
      code: "invalid_enum_value",
      path: ["async", "image_format"],
      message: `\`async.image_format\` must be one of ${REVE_ASYNC_IMAGE_FORMATS.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(format)}.`,
      meta: { allowed: [...REVE_ASYNC_IMAGE_FORMATS], value: format, source: REVE_DOCS_URL },
    });
  }
  if (options.public === true && !(typeof format === "string" && format.startsWith("image/"))) {
    ctx.report({
      code: "unsupported_param",
      path: ["async", "public"],
      message:
        '`async.public: true` is only accepted with an `image/*` `image_format` ("Set public: true only on create or render_layout with an image/* format").',
      meta: { source: REVE_DOCS_URL },
    });
  }
  const callback = options.callback_url;
  if (callback != null && (typeof callback !== "string" || !callback.startsWith("https://"))) {
    ctx.report({
      code: "invalid_shape",
      path: ["async", "callback_url"],
      message: `\`async.callback_url\` must be an https URL on a publicly routable host; got ${JSON.stringify(callback)}.`,
      meta: { value: callback, source: REVE_DOCS_URL },
    });
  }
}

function checkCreateV2(
  params: CreateV2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  checkPromptLength(ctx, ["prompt"], params.prompt, REVE_V2_PROMPT_MAX_LENGTH);
  checkAspectRatio(ctx, params.aspect_ratio, REVE_V2_ASPECT_RATIOS);
  checkVersion(ctx, params.version, REVE_V2_CREATE_VERSIONS);
  checkPostprocessing(ctx, params.postprocessing);
  checkReferences(params, ctx);
  checkAsync(params, ctx);
}

function estimate(_params: CreateV2Params, info: ModelInfo | undefined) {
  const costUSD = reveEstimateUSD(info?.cost?.perImage, undefined);
  return costUSD === undefined ? {} : { costUSD };
}

/**
 * The one `.toSdk("reve")` target for this endpoint — Reve ships no official
 * JS SDK, so this is the wire body. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type ReveSdkTargets<B> = { reve: () => B };

function finalize(params: CreateV2Params): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: REVE_V2_CREATE_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { reve: () => body },
  });
}

const validator = createValidator<CreateV2Params, unknown>({
  endpoint: "reve.imageV2",
  schema: createV2Schema,
  modelId: (params) => resolveReveVersion("v2-create", params.version),
  catalog: models,
  checks: [checkCreateV2],
  estimate,
  finalize,
});

/**
 * Validates params for `POST https://api.reve.com/v2/image/create` — Reve's
 * current flagship image route (text-to-image and reference-guided editing in
 * one call).
 *
 * The returned object's enumerable props are the exact fetch JSON body. The
 * call is synchronous by default and can run 40–80 seconds; pass `async` to
 * get a 202 plus a `result_url` to poll (`REVE_V2_RESPONSE_URL`). Auth is your
 * job: add an `Authorization: Bearer …` header when fetching.
 *
 * ```ts
 * const params = reve.imageV2({
 *   prompt: "the bottle from <frame>0</frame> on a terracotta tile",
 *   references: [{ data: base64Png }],
 *   aspect_ratio: "3:2",
 * });
 * ```
 */
export const imageV2 = validator as unknown as {
  <T extends CreateV2Params>(
    params: T & ExactKeys<T, CreateV2Params>,
    options?: ValidateOptions<T>,
  ): Validated<T, ReveSdkTargets<T>>;
  safe<T extends CreateV2Params>(
    params: T & ExactKeys<T, CreateV2Params>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, ReveSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
