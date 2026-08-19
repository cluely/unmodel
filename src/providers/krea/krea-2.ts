/**
 * Krea 2 image generation —
 * POST https://api.krea.ai/generate/image/krea/krea-2/{variant}
 *
 * Wire notes (verified against https://api.krea.ai/openapi.json — the spec the
 * API itself serves — and https://www.krea.ai/docs/developers/krea-2/overview
 * on 2026-08-13):
 * - There is no `model` body field: the model IS the route. unmodel takes
 *   `model` as a pseudo-param for catalog lookup, STRIPS it from the wire body
 *   and interpolates it into `.request.url`. One `krea2()` endpoint fn covers
 *   all three variants because medium, large and medium-turbo share one request
 *   schema byte-for-byte — only price differs.
 * - `prompt`, `aspect_ratio` and `resolution` are REQUIRED (schema `required`).
 * - CLOSED REQUEST SCHEMA — the one place unmodel deviates from its repo-wide
 *   loose-schema convention. The Krea 2 request body ends
 *   `"required": ["prompt","aspect_ratio","resolution"], "additionalProperties":
 *   false` (identically on all three variant routes), so an unknown top-level
 *   key is a CERTAIN 400, not the silent no-op most providers give it.
 *   Everywhere else unmodel keeps schemas loose and downgrades an unknown key
 *   to an `unknown_param` warning, on the reasoning that a param may simply be
 *   newer than the catalog; that reasoning does not hold against a closed
 *   schema, where passing the request on can only waste a round trip. The
 *   top-level object is therefore `z.strictObject`, and a typo'd key fails
 *   validation as `invalid_shape` (zod's `unrecognized_keys`, reported at the
 *   body root with the offending keys named in the message).
 *   NESTED objects stay loose on purpose: only the ROOT schema carries
 *   `additionalProperties: false`. The `styles`, `image_style_references` and
 *   `moodboards` item schemas leave `additionalProperties` unset — i.e. open —
 *   so unknown members there get the ordinary benefit of the doubt.
 * - ASYNC-JOB API: the POST returns `{ job_id, status, … }`, not image bytes.
 *   Poll `GET https://api.krea.ai/jobs/{job_id}` (transport — out of unmodel's
 *   scope; `KREA_JOBS_URL` is exported for convenience) or set the optional
 *   `X-Webhook-URL` request header.
 * - Pricing is per-request at one of three tiers (text-to-image / style
 *   references / moodboards) — see models.ts. The estimate picks the tier the
 *   params actually select; moodboards win when combined with style references
 *   ("Combining moodboards with style references does not increase the price
 *   per generation — you pay the moodboard rate").
 * - Krea's guides and its served OpenAPI disagree about two `strength` ranges:
 *   the style-transfer page documents −2…2 for `image_style_references` and the
 *   moodboards page −0.5…1.5 for `moodboards`, while the spec bounds both at
 *   0…1. unmodel errors only outside the wider (prose) range and warns in the
 *   band where the two disagree, naming both sources — picking a side would
 *   either reject requests the guides bless or wave through values the schema
 *   rejects. `creativity` is the same story without consequences: the spec
 *   defaults it to `"low"`, the overview table says `"medium"`; the default is
 *   not cost-relevant, so unmodel only validates the value set.
 * - Auth is an `Authorization: Bearer …` header — unmodel never touches keys.
 * - Krea publishes an official JS SDK (`@krea-ai/sdk`), but it takes the same
 *   body under `{ input }`; `.toSdk("krea")` returns the wire body unchanged.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { models, KREA_BILLING_TIERS, type KreaModelId } from "./models";

export const KREA_API_BASE_URL = "https://api.krea.ai";

/** Async-job polling endpoint (`GET /jobs/{job_id}`) — transport, out of scope. */
export const KREA_JOBS_URL = `${KREA_API_BASE_URL}/jobs`;

const OPENAPI_URL = "https://api.krea.ai/openapi.json";
const KREA_2_SCHEMA = `${OPENAPI_URL}#/paths/~1generate~1image~1krea~1krea-2~1medium/post`;

/** Submit URL for a Krea 2 variant — the model is the route, not a body field. */
export function krea2Url(model: string): string {
  const path = model.split("/").map(encodeURIComponent).join("/");
  return `${KREA_API_BASE_URL}/generate/image/krea/${path}`;
}

/** `aspect_ratio` enum — OpenAPI `aspect_ratio`. */
export const KREA_ASPECT_RATIOS = [
  "1:1",
  "4:3",
  "3:2",
  "16:9",
  "2.35:1",
  "4:5",
  "2:3",
  "9:16",
] as const;
export type KreaAspectRatio = (typeof KREA_ASPECT_RATIOS)[number];

/** `resolution` enum — "Resolution scale. One of: 1K." */
export const KREA_RESOLUTIONS = ["1K"] as const;
export type KreaResolution = (typeof KREA_RESOLUTIONS)[number];

/** `creativity` enum — prompt-expansion mode. */
export const KREA_CREATIVITY_MODES = ["raw", "low", "medium", "high"] as const;
export type KreaCreativity = (typeof KREA_CREATIVITY_MODES)[number];

/** K2 generative-slider bounds (`intensity`, `complexity`, `movement`). */
export const KREA_SLIDER_MIN = -100;
export const KREA_SLIDER_MAX = 100;

/** `image_style_references` accepts at most 10 entries (`maxItems`). */
export const KREA_MAX_STYLE_REFERENCES = 10;

/** `moodboards` is "currently limited to one moodboard" (`maxItems: 1`). */
export const KREA_MAX_MOODBOARDS = 1;

/** `maxLength` on every image URL field (`image_url`, style-reference `url`). */
export const KREA_MAX_IMAGE_URL_LENGTH = 1024;

// ---------------------------------------------------------------------------
// Wire types — mirror the Krea 2 request schema exactly.
// ---------------------------------------------------------------------------

/** A trained style (LoRA) applied to the generation. */
export interface KreaStyleRef {
  /** Style id. REQUIRED. */
  id: string;
  /** Style weight, −2…2. REQUIRED (no server-side default). */
  strength: number;
}

/** An image whose style is transferred onto the output. */
export interface KreaImageStyleReference {
  /** External URL, base64 data URI, or uploaded asset URL. REQUIRED, ≤ 1024 chars. */
  url: string;
  /** Style influence 0 (none) – 1 (maximum). Default 0.5. */
  strength?: number;
}

/** A moodboard built in the Krea webapp, referenced by id. */
export interface KreaMoodboardRef {
  /** Moodboard UUID (the `?share=<id>` value). REQUIRED. */
  id: string;
  /** Moodboard influence 0–1. Default 0.23. */
  strength?: number;
}

export interface Krea2Params {
  /**
   * Route selector — stripped from the wire body; `.request.url` becomes
   * `https://api.krea.ai/generate/image/krea/{model}`.
   */
  model: KreaModelId | (string & {});
  /** Text prompt. REQUIRED. */
  prompt: string;
  /**
   * Output aspect ratio. REQUIRED. CLOSED enum — the 8 values are the whole
   * documented space, and the body is `additionalProperties: false`, so
   * anything else is a certain 400 (no `(string & {})` escape hatch).
   */
  aspect_ratio: KreaAspectRatio;
  /**
   * Resolution scale. REQUIRED — CLOSED enum, and "1K" is the only scale Krea 2
   * ships today.
   */
  resolution: KreaResolution;
  /** Reproducibility seed. */
  seed?: number | null;
  /** Trained styles (LoRAs) to apply. */
  styles?: KreaStyleRef[];
  /** Style-transfer reference images (≤ 10). Selects the style-reference price tier. */
  image_style_references?: KreaImageStyleReference[];
  /**
   * Prompt-expansion mode; `raw` disables expansion. CLOSED enum — the 4 values
   * are the whole documented space, so anything else is a certain 400.
   */
  creativity?: KreaCreativity;
  /** K2 Intensity slider, −100…100. 0 = neutral. */
  intensity?: number;
  /** K2 Complexity slider, −100…100. 0 = neutral. */
  complexity?: number;
  /** K2 Movement slider, −100…100. 0 = neutral. */
  movement?: number;
  /** Moodboard references (≤ 1). Selects the moodboard price tier. */
  moodboards?: KreaMoodboardRef[];
  /** Source image for image-to-image; ≤ 1024 chars. */
  image_url?: string | null;
  /** Denoising strength 0–1 when `image_url` is set. Default 0.99. */
  strength?: number;
}

// ---------------------------------------------------------------------------
// Schema — STRICT at the top level (see the module JSDoc: the Krea 2 request
// schema is `additionalProperties: false`, so an unknown key is a guaranteed
// 400 and unmodel refuses it here rather than warning). Nested item objects
// stay loose: the spec leaves those open. Enum-ish fields stay z.string() so a
// bad value reports invalid_enum_value from the checks.
// ---------------------------------------------------------------------------

const krea2Schema = z.strictObject(
  {
    // `model` is unmodel's route selector, not a body field — it is stripped in
    // finalize() and never reaches Krea, so listing it here does not widen the
    // wire body.
    model: z.string(),
    prompt: z.string(),
    aspect_ratio: z.string(),
    resolution: z.string(),
    seed: z.number().nullable().optional(),
    styles: z.array(z.looseObject({})).optional(),
    image_style_references: z.array(z.looseObject({})).optional(),
    creativity: z.string().optional(),
    intensity: z.number().int().optional(),
    complexity: z.number().int().optional(),
    movement: z.number().int().optional(),
    moodboards: z.array(z.looseObject({})).optional(),
    image_url: z.string().nullable().optional(),
    strength: z.number().optional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `${issue.keys.map((key) => `\`${key}\``).join(", ")} ${issue.keys.length === 1 ? "is not a Krea 2 body param" : "are not Krea 2 body params"}. The request schema Krea serves at ${OPENAPI_URL} is \`additionalProperties: false\`, so the API rejects the whole request with a 400 rather than ignoring the key — check the spelling.`
        : undefined,
  },
);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function reportEnum(
  ctx: PipelineContext,
  param: string,
  value: string,
  allowed: readonly string[],
  extra = "",
): void {
  ctx.report({
    code: "invalid_enum_value",
    path: [param],
    message: `\`${param}\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}; got ${JSON.stringify(value)}.${extra}`,
    meta: { allowed: [...allowed], value, source: KREA_2_SCHEMA },
  });
}

function checkEnums(params: Krea2Params, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const { aspect_ratio, resolution, creativity } = params;
  if (
    typeof aspect_ratio === "string" &&
    !(KREA_ASPECT_RATIOS as readonly string[]).includes(aspect_ratio)
  ) {
    reportEnum(ctx, "aspect_ratio", aspect_ratio, KREA_ASPECT_RATIOS);
  }
  if (
    typeof resolution === "string" &&
    !(KREA_RESOLUTIONS as readonly string[]).includes(resolution)
  ) {
    reportEnum(
      ctx,
      "resolution",
      resolution,
      KREA_RESOLUTIONS,
      " Krea 2 only ships a 1K resolution scale today.",
    );
  }
  if (
    creativity != null &&
    typeof creativity === "string" &&
    !(KREA_CREATIVITY_MODES as readonly string[]).includes(creativity)
  ) {
    reportEnum(ctx, "creativity", creativity, KREA_CREATIVITY_MODES);
  }
}

function checkSliders(
  params: Krea2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  for (const slider of ["intensity", "complexity", "movement"] as const) {
    const value = params[slider];
    if (value == null) continue;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      ctx.report({
        code: "invalid_shape",
        path: [slider],
        message: `\`${slider}\` must be an integer between ${KREA_SLIDER_MIN} and ${KREA_SLIDER_MAX} (0 = neutral / no slider LoRA); got ${JSON.stringify(value)}.`,
        meta: { source: KREA_2_SCHEMA },
      });
      continue;
    }
    if (value < KREA_SLIDER_MIN || value > KREA_SLIDER_MAX) {
      ctx.report({
        code: "invalid_shape",
        path: [slider],
        message: `\`${slider}\` must be between ${KREA_SLIDER_MIN} and ${KREA_SLIDER_MAX}; got ${value}.`,
        meta: { min: KREA_SLIDER_MIN, max: KREA_SLIDER_MAX, value, source: KREA_2_SCHEMA },
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reports a numeric member outside its documented inclusive range. */
function checkRange(
  ctx: PipelineContext,
  path: Array<string | number>,
  value: unknown,
  min: number,
  max: number,
  note = "",
): void {
  if (value == null) return;
  if (typeof value !== "number" || Number.isNaN(value) || value < min || value > max) {
    ctx.report({
      code: "invalid_shape",
      path,
      message: `\`${path.join(".")}\` must be a number between ${min} and ${max}; got ${JSON.stringify(value)}.${note}`,
      meta: { min, max, value, source: KREA_2_SCHEMA },
    });
  }
}

/**
 * Krea's guides and its served OpenAPI disagree about two `strength` ranges.
 * Rather than pick a side and risk rejecting a request one of them blesses,
 * unmodel errors only outside the WIDER (prose) range and warns in the band
 * where the two disagree, naming both sources.
 */
function checkContestedStrength(
  ctx: PipelineContext,
  path: Array<string | number>,
  value: unknown,
  schema: { min: number; max: number },
  prose: { min: number; max: number; source: string },
): void {
  if (value == null) return;
  const label = path.join(".");
  if (typeof value !== "number" || Number.isNaN(value) || value < prose.min || value > prose.max) {
    ctx.report({
      code: "invalid_shape",
      path,
      message: `\`${label}\` must be a number between ${schema.min} and ${schema.max} (the ${prose.source} widens this to ${prose.min}…${prose.max}); got ${JSON.stringify(value)}.`,
      meta: { min: schema.min, max: schema.max, value, source: KREA_2_SCHEMA },
    });
    return;
  }
  if (value < schema.min || value > schema.max) {
    ctx.report({
      code: "invalid_shape",
      severity: "warning",
      path,
      message: `\`${label}\` is ${value}: the ${prose.source} documents ${prose.min}…${prose.max}, but the request schema Krea serves at ${OPENAPI_URL} bounds this field at ${schema.min}…${schema.max}, so the API may reject it.`,
      meta: { min: schema.min, max: schema.max, value, source: KREA_2_SCHEMA },
    });
  }
}

function checkStyles(params: Krea2Params, _info: ModelInfo | undefined, ctx: PipelineContext): void {
  const styles = params.styles;
  if (!Array.isArray(styles)) return;
  styles.forEach((style, i) => {
    if (!isRecord(style)) return;
    if (typeof style.id !== "string") {
      ctx.report({
        code: "invalid_shape",
        path: ["styles", i, "id"],
        message: "each `styles` entry requires an `id` string (the trained style / LoRA id).",
        meta: { source: KREA_2_SCHEMA },
      });
    }
    if (style.strength === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["styles", i, "strength"],
        message:
          "each `styles` entry requires a `strength` between -2 and 2 — the Krea 2 schema has no default for it.",
        meta: { source: KREA_2_SCHEMA },
      });
      return;
    }
    checkRange(ctx, ["styles", i, "strength"], style.strength, -2, 2);
  });
}

function checkStyleReferences(
  params: Krea2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const refs = params.image_style_references;
  if (!Array.isArray(refs)) return;
  if (refs.length > KREA_MAX_STYLE_REFERENCES) {
    ctx.report({
      code: "invalid_shape",
      path: ["image_style_references"],
      message: `\`image_style_references\` accepts at most ${KREA_MAX_STYLE_REFERENCES} entries; got ${refs.length}.`,
      meta: { limit: KREA_MAX_STYLE_REFERENCES, count: refs.length, source: KREA_2_SCHEMA },
    });
  }
  refs.forEach((ref, i) => {
    if (!isRecord(ref)) return;
    if (typeof ref.url !== "string") {
      ctx.report({
        code: "invalid_shape",
        path: ["image_style_references", i, "url"],
        message:
          "each `image_style_references` entry requires a `url` (external URL, base64 data URI, or uploaded asset URL).",
        meta: { source: KREA_2_SCHEMA },
      });
    } else if (ref.url.length > KREA_MAX_IMAGE_URL_LENGTH) {
      ctx.report({
        code: "invalid_shape",
        path: ["image_style_references", i, "url"],
        message: `\`image_style_references[${i}].url\` is ${ref.url.length} characters; the API caps it at ${KREA_MAX_IMAGE_URL_LENGTH}. Upload the image via POST /assets and pass the returned asset URL instead of an inline data URI.`,
        meta: { limit: KREA_MAX_IMAGE_URL_LENGTH, source: KREA_2_SCHEMA },
      });
    }
    checkContestedStrength(ctx, ["image_style_references", i, "strength"], ref.strength, {
      min: 0,
      max: 1,
    }, { min: -2, max: 2, source: "style-transfer guide" });
  });
}

function checkMoodboards(
  params: Krea2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const moodboards = params.moodboards;
  if (!Array.isArray(moodboards)) return;
  if (moodboards.length > KREA_MAX_MOODBOARDS) {
    ctx.report({
      code: "invalid_shape",
      path: ["moodboards"],
      message: `\`moodboards\` is currently limited to ${KREA_MAX_MOODBOARDS} moodboard; got ${moodboards.length}.`,
      meta: { limit: KREA_MAX_MOODBOARDS, count: moodboards.length, source: KREA_2_SCHEMA },
    });
  }
  moodboards.forEach((board, i) => {
    if (!isRecord(board)) return;
    if (typeof board.id !== "string") {
      ctx.report({
        code: "invalid_shape",
        path: ["moodboards", i, "id"],
        message:
          "each `moodboards` entry requires an `id` — the moodboard UUID from its share URL (https://www.krea.ai/moodboards?share=<id>).",
        meta: { source: KREA_2_SCHEMA },
      });
    }
    checkContestedStrength(ctx, ["moodboards", i, "strength"], board.strength, {
      min: 0,
      max: 1,
    }, { min: -0.5, max: 1.5, source: "moodboards guide" });
  });
}

function checkImageToImage(
  params: Krea2Params,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const { image_url, strength } = params;
  if (typeof image_url === "string" && image_url.length > KREA_MAX_IMAGE_URL_LENGTH) {
    ctx.report({
      code: "invalid_shape",
      path: ["image_url"],
      message: `\`image_url\` is ${image_url.length} characters; the API caps it at ${KREA_MAX_IMAGE_URL_LENGTH}. Upload the image via POST /assets and pass the returned asset URL instead of an inline data URI.`,
      meta: { limit: KREA_MAX_IMAGE_URL_LENGTH, source: KREA_2_SCHEMA },
    });
  }
  checkRange(ctx, ["strength"], strength, 0, 1);
  if (strength != null && image_url == null) {
    ctx.report({
      code: "unsupported_param",
      severity: "warning",
      path: ["strength"],
      message:
        "`strength` is the denoising strength for image-to-image and has no effect without `image_url`.",
      meta: { source: KREA_2_SCHEMA, ignored: true },
    });
  }
}

// ---------------------------------------------------------------------------
// Estimation — the billing tier the params select (see models.ts).
// ---------------------------------------------------------------------------

function hasEntries(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/** The tier a request bills at: moodboards > style references > text-to-image. */
export function krea2BillingTier(
  params: Pick<Krea2Params, "moodboards" | "image_style_references">,
): "moodboards" | "styleReferences" | "textToImage" {
  if (hasEntries(params.moodboards)) return "moodboards";
  if (hasEntries(params.image_style_references)) return "styleReferences";
  return "textToImage";
}

function estimate(params: Krea2Params, info: ModelInfo | undefined) {
  if (info === undefined) return {};
  const tiers = KREA_BILLING_TIERS[info.id as KreaModelId];
  if (tiers === undefined) {
    const perImage = info.cost?.perImage;
    return perImage === undefined ? {} : { costUSD: perImage };
  }
  return { costUSD: tiers[krea2BillingTier(params)] };
}

// ---------------------------------------------------------------------------
// Finalize: wire body (model stripped — it lives in the URL) + .request.
// ---------------------------------------------------------------------------

/**
 * The one `.toSdk("krea")` target for this endpoint — Krea ships no official
 * JS SDK, so this is the wire body. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type KreaSdkTargets<B> = { krea: () => B };

function finalize(params: Krea2Params): unknown {
  const { model, ...body } = params;
  return toValidated(body, {
    url: krea2Url(model),
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { krea: () => body },
  });
}

const validator = createValidator<Krea2Params, unknown>({
  endpoint: "krea.krea2",
  schema: krea2Schema,
  modelId: (params) => params.model,
  catalog: models,
  checks: [
    checkEnums,
    checkSliders,
    checkStyles,
    checkStyleReferences,
    checkMoodboards,
    checkImageToImage,
  ],
  estimate,
  finalize,
});

/**
 * Validates submit params for the Krea 2 route family
 * (`POST https://api.krea.ai/generate/image/krea/krea-2/{variant}`).
 *
 * The returned object's enumerable props are the exact fetch JSON body —
 * `model` is a route selector, stripped from the body and interpolated into
 * `.request.url`. The POST returns an async job (`{ job_id, status, … }`), not
 * image bytes: poll `KREA_JOBS_URL`/`{job_id}` or set an `X-Webhook-URL`
 * header (both transport, out of unmodel's scope). Auth is your job: add an
 * `Authorization: Bearer …` header when fetching.
 *
 * Unlike most unmodel endpoints, an unknown top-level key is an ERROR here, not
 * a warning: Krea's request schema is `additionalProperties: false`, so the API
 * would answer a typo with a 400 (see the module JSDoc).
 *
 * ```ts
 * const params = krea.krea2({
 *   model: "krea-2/medium",
 *   prompt: "a cinematic glass cabin beside a frozen lake at sunrise",
 *   aspect_ratio: "16:9",
 *   resolution: "1K",
 *   creativity: "medium",
 * });
 * const res = await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, authorization: `Bearer ${process.env.KREA_API_KEY}` },
 *   body: JSON.stringify(params),
 * });
 * const { job_id } = await res.json(); // then poll `${KREA_JOBS_URL}/${job_id}`
 * ```
 */
export const krea2 = validator as unknown as {
  <T extends Krea2Params>(
    params: T & ExactKeys<T, Krea2Params>,
    options?: ValidateOptions,
  ): Validated<Omit<T, "model">, KreaSdkTargets<Omit<T, "model">>>;
  safe<T extends Krea2Params>(
    params: T & ExactKeys<T, Krea2Params>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<Omit<T, "model">, KreaSdkTargets<Omit<T, "model">>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
