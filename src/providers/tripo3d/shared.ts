/**
 * Shared wire pieces for Tripo's v3 API (`https://openapi.tripo3d.ai/v3/...`),
 * transcribed from the endpoint reference pages at developers.tripo3d.ai —
 * `/en/docs/generation-text-to-model/standard` and `/p`,
 * `/en/docs/generation-image-to-model/standard` and `/p`,
 * `/en/docs/introduction`, `/en/docs/authentication`, `/en/docs/billing` —
 * verified 2026-08-25. Those pages also serve raw Markdown at `<route>.md`,
 * which is what was read.
 *
 * ## v3, not v2
 *
 * Tripo runs two API generations side by side. v2 (`api.tripo3d.ai/v2/openapi`)
 * multiplexes everything through a single `POST /task` with a `type`
 * discriminator; v3 gives each operation its own path. unmodel models v3 only,
 * because one endpoint per operation is the shape the rest of this library is
 * built on and because Tripo publishes a v2→v3 migration guide rather than the
 * other way round. Note that the MODEL id `v2.5-20250123` is a v3-API model
 * version, not the v2 API — the two version numbers are unrelated.
 *
 * ## Auth is a bearer token
 *
 * `Authorization: Bearer <TRIPO_API_KEY>` on every request, per
 * /en/docs/authentication. unmodel never touches credentials, so it is yours to
 * add — `.request.headers` carries the content type and nothing else.
 *
 * ## Every generation is a task
 *
 * A submit answers `{ code: 0, data: { task_id } }` and you poll
 * `GET /v3/tasks/{task_id}` until `status` is `success` or `failed`. Two traps
 * worth knowing before you write the polling loop:
 *
 * 1. **`code` carries the error, not the HTTP status.** A success is
 *    `{"code": 0, "data": …}`; anything non-zero is a failure with a `message`
 *    and a `suggestion`, and an auth failure arrives as HTTP 401 AND
 *    `{"code": 2}`. A mapper that reads only the status will miss the ones that
 *    answer 200.
 * 2. **The output URLs expire.** `data.output.model_url` is short-lived — fetch
 *    the mesh when the task completes rather than storing the link.
 *
 * Credits are FROZEN when the task is created and deducted on success; a failed
 * or cancelled task is not charged (/en/docs/billing).
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";
import { JSON_HEADERS } from "../../core/request";

export const TRIPO3D_BASE_URL = "https://openapi.tripo3d.ai/v3";

export const TRIPO3D_HEADERS: Record<string, string> = JSON_HEADERS;

export const DOCS_BASE = "https://developers.tripo3d.ai/en/docs";

/** `POST /v3/generation/text-to-model` — describe the object. */
export const TEXT_TO_MODEL_URL = `${TRIPO3D_BASE_URL}/generation/text-to-model`;

/** `POST /v3/generation/image-to-model` — show it. */
export const IMAGE_TO_MODEL_URL = `${TRIPO3D_BASE_URL}/generation/image-to-model`;

/** `GET /v3/tasks/{task_id}` — poll a submitted generation. */
export function taskUrl(taskId: string): string {
  return `${TRIPO3D_BASE_URL}/tasks/${taskId}`;
}

/** `POST /v3/files` — upload an image and get back a `file_...` token. */
export const FILES_URL = `${TRIPO3D_BASE_URL}/files`;

/** `GET /v3/account/balance` — credits available and credits frozen. */
export const BALANCE_URL = `${TRIPO3D_BASE_URL}/account/balance`;

/**
 * The task states `GET /v3/tasks/{task_id}` reports.
 *
 * `success` and `failed` are terminal; `cancelled` is terminal too and is
 * reached through the dashboard rather than through this API.
 */
export const TRIPO3D_TASK_STATUSES = ["queued", "running", "success", "failed", "cancelled"] as const;
export type Tripo3dTaskStatus = (typeof TRIPO3D_TASK_STATUSES)[number];

/**
 * The `model` values Tripo's ENDPOINT pages publish.
 *
 * ⚠️ Tripo's docs disagree with themselves here, and this list picks a side.
 * `/en/docs/models-and-versions` names the models `tripo-v3.1`, `tripo-v3.0`,
 * `tripo-v2.5` and `tripo-p1`; every endpoint reference page and every `curl`
 * example on them uses the DATED form below. The endpoint page is the per-route
 * specification and is what the parameter's own enum is written on, so it wins.
 * The short aliases are plausibly accepted too — that is not verified, and
 * unmodel does not type what it has not read.
 */
export const TRIPO3D_MODELS = [
  "v3.1-20260211",
  "v3.0-20250812",
  "v2.5-20250123",
  "P1-20260311",
] as const;
export type Tripo3dModelId = (typeof TRIPO3D_MODELS)[number];

/** `texture_quality` — `extreme` is 8K and costs extra credits. */
export const TEXTURE_QUALITIES = ["standard", "detailed", "extreme"] as const;
export type Tripo3dTextureQuality = (typeof TEXTURE_QUALITIES)[number];

/** `geometry_quality` — `detailed` is Ultra mode. H series ≥ v3.0 only. */
export const GEOMETRY_QUALITIES = ["standard", "detailed"] as const;
export type Tripo3dGeometryQuality = (typeof GEOMETRY_QUALITIES)[number];

/** `texture_alignment` — match the picture's colours, or the geometry. */
export const TEXTURE_ALIGNMENTS = ["original_image", "geometry"] as const;
export type Tripo3dTextureAlignment = (typeof TEXTURE_ALIGNMENTS)[number];

/** `orientation` — only effective when `texture` is true. */
export const ORIENTATIONS = ["default", "align_image"] as const;
export type Tripo3dOrientation = (typeof ORIENTATIONS)[number];

/** `compress` — one documented value: meshopt geometry compression. */
export const COMPRESSIONS = ["geometry"] as const;
export type Tripo3dCompression = (typeof COMPRESSIONS)[number];

/** Documented prompt ceilings. */
export const PROMPT_MAX_CHARS = 1024;
export const NEGATIVE_PROMPT_MAX_CHARS = 255;

/**
 * The parameters Tripo gates on the model version, and which models take each.
 *
 * The text-to-model page states the rule in one sentence: "The following
 * parameters are only valid when `model ≥ v3.0-20250812`: texture_quality,
 * geometry_quality, auto_size, quad, smart_low_poly, generate_parts, compress."
 * `v2.5-20250123` therefore takes none of them, and the page repeats the
 * warning for `geometry_quality` specifically ("Do NOT use this parameter with
 * v2.5").
 *
 * P1 is the case the sentence does not describe, because it was copied onto the
 * P-series pages unchanged. The P endpoint reference declares `texture_quality`,
 * `auto_size` and `compress` and does NOT declare `geometry_quality`, `quad`,
 * `smart_low_poly` or `generate_parts` — so the per-route parameter list is
 * what this table follows, not the copied sentence.
 */
export const VERSION_GATED_PARAMS = [
  "texture_quality",
  "geometry_quality",
  "auto_size",
  "quad",
  "smart_low_poly",
  "generate_parts",
  "compress",
] as const;

/** Which of {@link VERSION_GATED_PARAMS} each model accepts. */
export const GATED_PARAMS_BY_MODEL: Readonly<Record<string, readonly string[]>> = {
  "v3.1-20260211": VERSION_GATED_PARAMS,
  "v3.0-20250812": VERSION_GATED_PARAMS,
  "v2.5-20250123": [],
  "P1-20260311": ["texture_quality", "auto_size", "compress"],
};

/**
 * The polycount ceiling per model, triangles unless `quad` is set.
 *
 * Ultra mode (`geometry_quality: "detailed"`) raises the H-series ceilings to
 * 2,000,000; the numbers here are the standard-mode ones, and a request above
 * them is refused naming the model. Quad meshes cap at 150,000 whichever H
 * model asked, and `smart_low_poly` overrides everything with a fixed 500–20,000
 * (500–10,000 for quads) "regardless of model version".
 */
export const FACE_LIMITS: Readonly<Record<string, { min: number; max: number; ultra?: number }>> = {
  "v3.1-20260211": { min: 1, max: 1_500_000, ultra: 2_000_000 },
  "v3.0-20250812": { min: 1, max: 1_000_000, ultra: 2_000_000 },
  "v2.5-20250123": { min: 1, max: 500_000 },
  "P1-20260311": { min: 50, max: 20_000 },
};

export const QUAD_FACE_LIMIT = 150_000;
export const SMART_LOW_POLY_FACE_LIMIT = { min: 500, max: 20_000 } as const;
export const SMART_LOW_POLY_QUAD_FACE_LIMIT = { min: 500, max: 10_000 } as const;

export const promptSchema = z.string().max(PROMPT_MAX_CHARS);
export const negativePromptSchema = z.string().max(NEGATIVE_PROMPT_MAX_CHARS);
export const seedSchema = z.number().int();

/** The parameters both generation routes share, as one zod fragment. */
export const generationCommonSchema = {
  model: z.string(),
  model_seed: seedSchema.optional(),
  texture_seed: seedSchema.optional(),
  face_limit: z.number().int().optional(),
  texture: z.boolean().optional(),
  pbr: z.boolean().optional(),
  texture_quality: z.enum(TEXTURE_QUALITIES).optional(),
  geometry_quality: z.enum(GEOMETRY_QUALITIES).optional(),
  auto_size: z.boolean().optional(),
  quad: z.boolean().optional(),
  smart_low_poly: z.boolean().optional(),
  generate_parts: z.boolean().optional(),
  compress: z.enum(COMPRESSIONS).optional(),
  export_uv: z.boolean().optional(),
};

/**
 * The shape the shared checks read — the union of both routes' fields, with
 * everything but `model` optional.
 *
 * Written out rather than `Record<string, unknown>` because an interface has no
 * implicit index signature, so a check typed against the record would not be
 * assignable to `createValidator`'s `checks` for either route. Every field is
 * widened to its base type (`string` rather than the enum) so both arms satisfy
 * it; the enums are enforced by each route's own zod schema.
 */
interface GenerationParams {
  model: string;
  prompt?: string;
  input?: string;
  face_limit?: number;
  texture?: boolean;
  pbr?: boolean;
  texture_quality?: string;
  geometry_quality?: string;
  auto_size?: boolean;
  quad?: boolean;
  smart_low_poly?: boolean;
  generate_parts?: boolean;
  compress?: string;
}

/**
 * The version gate, made a check.
 *
 * This is the failure class Tripo's docs warn about twice and the one a caller
 * is most likely to hit: `geometry_quality: "detailed"` is the obvious way to
 * ask for a better mesh, and sending it with `v2.5-20250123` is a 4xx. Naming
 * the model and the models that DO take the parameter is the whole value of
 * checking it here rather than at the API.
 */
export function checkVersionGatedParams(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const allowed = GATED_PARAMS_BY_MODEL[params.model];
    if (allowed === undefined) return;
    for (const name of VERSION_GATED_PARAMS) {
      if (params[name] === undefined || allowed.includes(name)) continue;
      const takers = Object.keys(GATED_PARAMS_BY_MODEL)
        .filter((id) => GATED_PARAMS_BY_MODEL[id]?.includes(name) === true)
        .sort();
      ctx.report({
        code: "unsupported_param",
        path: [name],
        model: params.model,
        message:
          `\`${name}\` is not valid for model "${params.model}". Tripo gates it on the model version — ` +
          `${takers.length === 0 ? "no model in this catalog takes it" : `${takers.map((id) => `"${id}"`).join(", ")} take${takers.length === 1 ? "s" : ""} it`}.`,
        meta: { source, allowed: [...allowed] },
      });
    }
  };
}

/**
 * `generate_parts` and the three switches it forbids.
 *
 * Verbatim from the endpoint page: "Not compatible with `texture=true`,
 * `pbr=true`, or `quad=true`. To use this, set all three to `false`." The trap
 * is that `texture` and `pbr` both DEFAULT to true, so `generate_parts: true`
 * alone is already an invalid request — which is why the message names the
 * defaults rather than only the fields the caller set.
 */
export function checkGenerateParts(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.generate_parts !== true) return;
    const conflicts: string[] = [];
    for (const name of ["texture", "pbr", "quad"] as const) {
      const value = params[name];
      // `texture` and `pbr` default to `true`, so ABSENT is a conflict for
      // those two and only `quad` is safe when unset.
      const on = value === undefined ? name !== "quad" : value === true;
      if (on) conflicts.push(value === undefined ? `${name} (defaults to true)` : name);
    }
    if (conflicts.length === 0) return;
    ctx.report({
      code: "unsupported_capability",
      path: ["generate_parts"],
      model: params.model,
      message:
        "`generate_parts: true` returns editable segmented parts and is not compatible with " +
        `${conflicts.join(", ")} — set texture, pbr and quad all to false, explicitly.`,
      meta: { source, conflicts },
    });
  };
}

/**
 * `pbr: true` forces `texture: true`, whatever the request said.
 *
 * A warning rather than an error: Tripo accepts the body and generates
 * textures, so refusing it would reject a request the API honours. The warning
 * exists because the caller who wrote `texture: false` was asking for the
 * CHEAPER tier and will be billed for the dearer one.
 */
export function checkPbrForcesTexture(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.pbr !== true || params.texture !== false) return;
    ctx.report({
      code: "unknown_param",
      path: ["texture"],
      model: params.model,
      message:
        "`pbr: true` forces `texture: true` at Tripo, so `texture: false` will be ignored and the " +
        "request billed at the textured rate. Set `pbr: false` too if a bare mesh is what you want.",
      meta: { source },
    });
  };
}

/**
 * The polycount ceiling, which depends on the model AND on three switches.
 *
 * `smart_low_poly` replaces the model's range with a fixed one "regardless of
 * model version", `quad` caps the H series at 150,000, and Ultra mode
 * (`geometry_quality: "detailed"`) raises the H ceilings to 2,000,000 — so the
 * effective bound is computed rather than looked up. Precedence is the order
 * the docs state the overrides in: `smart_low_poly` wins over everything,
 * `quad` over the plain ceiling.
 */
export function checkFaceLimit(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const value = params.face_limit;
    if (typeof value !== "number") return;
    const model = FACE_LIMITS[params.model];
    if (model === undefined) return;

    const ceiling =
      params.geometry_quality === "detailed" && model.ultra !== undefined ? model.ultra : model.max;
    let bound: { min: number; max: number } = { min: model.min, max: ceiling };
    let why =
      ceiling === model.max
        ? `"${params.model}"`
        : `"${params.model}" in Ultra mode (\`geometry_quality: "detailed"\`)`;
    if (params.smart_low_poly === true) {
      bound = params.quad === true ? SMART_LOW_POLY_QUAD_FACE_LIMIT : SMART_LOW_POLY_FACE_LIMIT;
      why = "`smart_low_poly: true`, which fixes the range regardless of model version";
    } else if (params.quad === true && ceiling > QUAD_FACE_LIMIT) {
      bound = { min: model.min, max: QUAD_FACE_LIMIT };
      why = "`quad: true`, which caps the mesh at 150,000 quads";
    }

    if (value >= bound.min && value <= bound.max) return;
    ctx.report({
      code: "invalid_shape",
      path: ["face_limit"],
      model: params.model,
      message:
        `\`face_limit\` must be between ${bound.min} and ${bound.max} for ${why}; got ${value}. ` +
        "Omit it entirely to let Tripo choose an adaptive topology.",
      meta: { source, min: bound.min, max: bound.max, value },
    });
  };
}

/**
 * The three things `input` can be, and how to tell them apart.
 *
 * `POST /v3/generation/image-to-model` takes ONE polymorphic string: a
 * `file_...` token from `POST /v3/files`, a public https URL, or a `task_...`
 * id from an earlier image-generation task. The API disambiguates by prefix and
 * the docs say "choose exactly one", so validation here can only be heuristic —
 * a string matching none of the three shapes is almost certainly a local path
 * or a bare filename, and saying so beats a 4xx.
 */
export function checkImageInput(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const value = params.input;
    if (typeof value !== "string") return;
    if (/^(file_|task_)/.test(value) || /^https?:\/\//i.test(value)) return;
    ctx.report({
      code: "invalid_shape",
      path: ["input"],
      model: params.model,
      message:
        "`input` must be exactly one of: a `file_…` token from POST /v3/files, a public http(s) URL, " +
        `or a \`task_…\` id from an earlier image-generation task. Got ${JSON.stringify(value.slice(0, 40))}, ` +
        "which is none of the three — Tripo does not accept local paths or raw bytes here.",
      meta: { source },
    });
  };
}
