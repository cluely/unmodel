/**
 * Shared wire pieces for Tripo's v3 API (`https://openapi.tripo3d.ai/v3/...`),
 * transcribed from the endpoint reference pages at developers.tripo3d.ai —
 * `/en/docs/generation-text-to-model/standard` and `/p`,
 * `/en/docs/generation-image-to-model/standard` and `/p`,
 * `/en/docs/introduction`, `/en/docs/authentication`, `/en/docs/billing` —
 * verified 2026-08-25, and re-read with `/en/docs/changelog`, `/en/docs/sdk`
 * and `/en/docs/models-and-versions` on 2026-11-12. Those pages also serve raw
 * Markdown at `<route>.md`, which is what was read.
 *
 * ## v3, not v2
 *
 * Tripo's v2 API (`api.tripo3d.ai/v2/openapi`) multiplexes everything through
 * a single `POST /task` with a `type` discriminator, and is on its way out:
 * "The v2 API is scheduled to shut down on 2026-10-31, after which Python SDK
 * 0.x will stop working." (/en/docs/sdk, read 2026-11-12). v3 gives each
 * operation its own path, which is the shape the rest of this library is built
 * on, and it is the only generation unmodel models. Note that the MODEL id
 * `v2.5-20250123` is a v3-API model version, not the v2 API — the two version
 * numbers are unrelated.
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
 * `success`, `failed` and `cancelled` are terminal. Tripo says only that
 * `cancelled` is "cancelled by user" and lists no cancel route among the v3
 * endpoints (/en/docs/introduction). Polling loops should also stop on two
 * legacy values outside this list — https://developers.tripo3d.ai/en/docs/task-query.md,
 * read 2026-11-12: "Internally banned or expired tasks are usually
 * represented as `failed`. If a legacy response returns `banned` or
 * `expired`, treat either as terminal. Other values, such as `unknown`, may
 * occur: use a bounded wait and investigate if the status persists; do not
 * assume it is successful or terminal."
 */
export const TRIPO3D_TASK_STATUSES = ["queued", "running", "success", "failed", "cancelled"] as const;
export type Tripo3dTaskStatus = (typeof TRIPO3D_TASK_STATUSES)[number];

/**
 * The `model` values Tripo publishes — the DATED ids that every endpoint
 * reference page, every `curl` example and the `/en/docs/models-and-versions`
 * roster use (read 2026-11-12: "| `v3.1-20260211` | H3.1, latest
 * high-precision model | …"). No page publishes a short alias such as
 * `tripo-v3.1`, so none is typed.
 */
export const TRIPO3D_MODELS = [
  "v3.1-20260211",
  "v3.0-20250812",
  "v2.5-20250123",
  "P1-20260311",
  // https://developers.tripo3d.ai/en/docs/changelog.md, read 2026-11-12:
  // "`POST /v3/generation/text-to-model`, `image-to-model`, and
  // `multiview-to-model` now accept `model=P2-20260801` (an upgrade of P1)."
  "P2-20260801",
] as const;
export type Tripo3dModelId = (typeof TRIPO3D_MODELS)[number];

/**
 * `texture_quality` — `extreme` is 8K and costs extra credits; `fast` needs
 * `texture_version: "v3.5-20260815"` and costs the same as `standard`.
 *
 * /en/docs/generation-text-to-model/standard.md, read 2026-11-12: "`fast` —
 * the fastest generation, trading texture detail for speed. Output texture
 * size is identical to `standard`. Requires texture `v3.5-20260815`; costs the
 * same as `standard`."
 */
export const TEXTURE_QUALITIES = ["fast", "standard", "detailed", "extreme"] as const;
export type Tripo3dTextureQuality = (typeof TEXTURE_QUALITIES)[number];

/**
 * `texture_version` — pins the texture model independently of the geometry
 * `model`. Typed open, like `model`, so a texture version newer than this list
 * is not refused.
 *
 * /en/docs/changelog.md, read 2026-11-12: "Supported values are
 * `v3.5-20260815`, `v3.0-20250812`, and `v2.5-20250123`; if omitted it is
 * derived from the geometry version (v2.5 geometry → `v2.5-20250123`,
 * otherwise `v3.0-20250812`)."
 */
export const TEXTURE_VERSIONS = ["v3.5-20260815", "v3.0-20250812", "v2.5-20250123"] as const;
export type Tripo3dTextureVersion = (typeof TEXTURE_VERSIONS)[number];

/** The one texture version that reads `texture_quality: "fast"` and `delight`. */
const TEXTURE_V3_5 = "v3.5-20260815";

/**
 * `export_orientation` — the forward axis of the exported mesh; `+x` is the
 * default. /en/docs/generation-image-to-model/standard.md, read 2026-11-12:
 * "Export orientation (forward axis). - `+x` — default, X-forward. - `-x` —
 * negative X-forward. - `-y` — negative Y-forward. - `+y` — Y-forward." It
 * applies to this generation only: "post-processing the model may produce a
 * wrongly-oriented result while the task still reports `status: success`".
 */
export const EXPORT_ORIENTATIONS = ["+x", "-x", "+y", "-y"] as const;
export type Tripo3dExportOrientation = (typeof EXPORT_ORIENTATIONS)[number];

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
 * P-series pages unchanged. The P endpoint reference, as read 2026-08-25,
 * declares `texture_quality`, `auto_size` and `compress` and does NOT declare
 * `geometry_quality`, `quad`, `smart_low_poly` or `generate_parts` — so the
 * per-route parameter list is what this table follows, not the copied
 * sentence.
 *
 * P2 follows the same P pages and adds `quad`, which they mark "**P2-20260801
 * only.**" (/en/docs/generation-text-to-model/p.md, read 2026-11-12); the
 * changelog states the converse for P1: "Sending `quad=true` with P1 returns
 * `400`; switch to P2 or remove the field." `compress` is not on the P pages as
 * read 2026-11-12 and no page documents a refusal of it, so P2 keeps it for
 * parity with P1 rather than refusing a request the API may fulfil.
 *
 * `texture_version`, `delight` and `export_orientation` are not in the gate:
 * the sentence names exactly the seven below, and the changelog documents
 * `texture_version` on every generation endpoint "including P1 / P2". Every
 * model takes all three.
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
  "P2-20260801": ["texture_quality", "auto_size", "quad", "compress"],
};

export const QUAD_FACE_LIMIT = 150_000;

/**
 * The polycount ceiling per model, triangles unless `quad` is set.
 *
 * Ultra mode (`geometry_quality: "detailed"`) raises the H-series ceilings to
 * 2,000,000; the numbers here are the standard-mode ones, and a request above
 * them is refused naming the model. `quad` is the cap a quad mesh gets on the
 * models that take `quad` — 150,000 whichever H model asked, 25,000 on P2 —
 * and `smart_low_poly` overrides everything with a fixed 500–20,000
 * (500–10,000 for quads) "regardless of model version".
 */
export const FACE_LIMITS: Readonly<
  Record<string, { min: number; max: number; ultra?: number; quad?: number }>
> = {
  "v3.1-20260211": { min: 1, max: 1_500_000, ultra: 2_000_000, quad: QUAD_FACE_LIMIT },
  "v3.0-20250812": { min: 1, max: 1_000_000, ultra: 2_000_000, quad: QUAD_FACE_LIMIT },
  "v2.5-20250123": { min: 1, max: 500_000 },
  "P1-20260311": { min: 50, max: 20_000 },
  // https://developers.tripo3d.ai/en/docs/generation-text-to-model/p.md, read
  // 2026-11-12: "`P2-20260801` triangle: **48 – 50,000**; with `quad=true`:
  // **48 – 25,000**". The changelog repeats it: "triangle 48–50,000; with
  // `quad=true`, 48–25,000. Omitted = adaptive."
  "P2-20260801": { min: 48, max: 50_000, quad: 25_000 },
};
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
  texture_version: z.string().optional(),
  delight: z.boolean().optional(),
  export_orientation: z.enum(EXPORT_ORIENTATIONS).optional(),
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
  texture_version?: string;
  delight?: boolean;
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
 * `generate_parts` and the four switches it does not combine with.
 *
 * The endpoint page (/en/docs/generation-text-to-model/standard.md, read
 * 2026-11-12) gives each its own outcome, and only two of them are a refusal:
 *
 * > - `texture=true` or `pbr=true` — including omitting `texture`, which
 * >   defaults to `true` — the request is rejected with error code `1004`.
 * > - `quad=true` — quad is ignored; the returned parts are triangle meshes.
 * > - `smart_low_poly=true` — smart_low_poly takes precedence and parts are
 * >   NOT produced.
 *
 * So `texture` and `pbr` are errors, and the trap is that both DEFAULT to
 * true: `generate_parts: true` alone is already an invalid request, which is
 * why the message names the defaults rather than only the fields the caller
 * set. `quad` and `smart_low_poly` are warnings — Tripo accepts the body, but
 * one of the two switches will not do what was asked.
 */
export function checkGenerateParts(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.generate_parts !== true) return;
    const conflicts: string[] = [];
    for (const name of ["texture", "pbr"] as const) {
      const value = params[name];
      // Both default to `true`, so ABSENT is a conflict.
      if (value === undefined) conflicts.push(`${name} (defaults to true)`);
      else if (value) conflicts.push(name);
    }
    if (conflicts.length > 0) {
      ctx.report({
        code: "unsupported_capability",
        path: ["generate_parts"],
        model: params.model,
        message:
          "`generate_parts: true` returns editable segmented parts, and Tripo rejects it (code 1004) " +
          `with ${conflicts.join(", ")} — set texture and pbr both to false, explicitly.`,
        meta: { source, conflicts },
      });
    }
    if (params.quad === true) {
      ctx.report({
        code: "unknown_param",
        path: ["quad"],
        model: params.model,
        message:
          "`quad: true` is ignored with `generate_parts: true` — Tripo returns the parts as triangle " +
          "meshes. Drop `quad`, or drop `generate_parts` for a quad mesh in one piece.",
        meta: { source },
      });
    }
    if (params.smart_low_poly === true) {
      ctx.report({
        code: "unknown_param",
        path: ["generate_parts"],
        model: params.model,
        message:
          "`smart_low_poly: true` takes precedence over `generate_parts: true` at Tripo, and parts " +
          "are NOT produced. Drop `smart_low_poly` to get segmented parts.",
        meta: { source },
      });
    }
  };
}

/**
 * The two parameters only texture `v3.5-20260815` reads.
 *
 * `texture_quality: "fast"` on any other texture version is a `1004` — "Any
 * other texture version returns `1004` rather than silently falling back to
 * `standard`" (/en/docs/generation-text-to-model/standard.md, read
 * 2026-11-12). `delight` on any other is ignored — "Only the `v3.5-20260815`
 * texture model reads this; older texture versions ignore it"
 * (/en/docs/generation-image-to-model/standard.md) — so that one is a warning.
 *
 * The trap is the default: omitting `texture_version` derives `v2.5-20250123`
 * from v2.5 geometry and `v3.0-20250812` from everything else, never v3.5, so
 * `fast` needs `texture_version` set explicitly. The check stands down when the
 * texture version is not one it can name — a value newer than
 * {@link TEXTURE_VERSIONS}, or an omitted one on a model this catalog does not
 * know — rather than refusing what a newer texture model may take.
 */
export function checkTextureVersion(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.texture_quality !== "fast" && params.delight === undefined) return;
    const version = effectiveTextureVersion(params);
    if (version === undefined || version === TEXTURE_V3_5) return;
    const why =
      params.texture_version === undefined
        ? `\`texture_version\` is omitted, so "${params.model}" derives "${version}"`
        : `\`texture_version\` is "${version}"`;
    if (params.texture_quality === "fast") {
      ctx.report({
        code: "unsupported_capability",
        path: ["texture_quality"],
        model: params.model,
        message:
          `\`texture_quality: "fast"\` needs \`texture_version: "${TEXTURE_V3_5}"\`, and ${why} — ` +
          "Tripo rejects that with code 1004 rather than falling back to `standard`.",
        meta: { source, textureVersion: version },
      });
    }
    if (params.delight !== undefined) {
      ctx.report({
        code: "unknown_param",
        path: ["delight"],
        model: params.model,
        message:
          `\`delight\` is read only by \`texture_version: "${TEXTURE_V3_5}"\`, and ${why}, which ` +
          "ignores it.",
        meta: { source, textureVersion: version },
      });
    }
  };
}

/**
 * The texture version a request will run, or `undefined` when it cannot be
 * named: an explicit value outside {@link TEXTURE_VERSIONS}, or an omitted one
 * on a model outside {@link TRIPO3D_MODELS}.
 */
function effectiveTextureVersion(params: GenerationParams): string | undefined {
  const explicit = params.texture_version;
  if (explicit !== undefined) {
    return (TEXTURE_VERSIONS as readonly string[]).includes(explicit) ? explicit : undefined;
  }
  if (!(TRIPO3D_MODELS as readonly string[]).includes(params.model)) return undefined;
  return params.model === "v2.5-20250123" ? "v2.5-20250123" : "v3.0-20250812";
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
 * model version", `quad` caps the mesh at the model's own quad ceiling (150,000
 * on the H series, 25,000 on P2), and Ultra mode (`geometry_quality:
 * "detailed"`) raises the H ceilings to 2,000,000 — so the effective bound is
 * computed rather than looked up. Precedence is the order the docs state the
 * overrides in: `smart_low_poly` wins over everything, `quad` over the plain
 * ceiling.
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
    } else if (params.quad === true && model.quad !== undefined && ceiling > model.quad) {
      bound = { min: model.min, max: model.quad };
      why = `\`quad: true\` on "${params.model}", which caps the mesh at ${model.quad} quads`;
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
 * `file_...` token from `POST /v3/files`, a public https URL, or the task id of
 * an earlier image-generation task — a bare UUID, per the endpoint page
 * (/en/docs/generation-image-to-model/standard.md, read 2026-11-12): "task_id —
 * The task ID from a previous image generation task (`text_to_image` or
 * `image_to_image`). … Example: `550e8400-e29b-41d4-a716-446655440000`". The
 * docs say "choose exactly one", so validation here can only be heuristic — a
 * string matching none of the three shapes is almost certainly a local path or
 * a bare filename, and saying so beats a 4xx.
 *
 * A `task_` prefix appears on no Tripo page; it is let through because this
 * heuristic exists to catch local paths, not to police id formats.
 */
export function checkImageInput(source: string) {
  return (params: GenerationParams, _info: unknown, ctx: PipelineContext): void => {
    const value = params.input;
    if (typeof value !== "string") return;
    if (/^(file_|task_)/.test(value) || /^https?:\/\//i.test(value) || TASK_ID.test(value)) return;
    ctx.report({
      code: "invalid_shape",
      path: ["input"],
      model: params.model,
      message:
        "`input` must be exactly one of: a `file_…` token from POST /v3/files, a public http(s) URL, " +
        "or the task id (a UUID such as `550e8400-e29b-41d4-a716-446655440000`) of an earlier " +
        `image-generation task. Got ${JSON.stringify(value.slice(0, 40))}, which is none of the ` +
        "three — Tripo does not accept local paths or raw bytes here.",
      meta: { source },
    });
  };
}

/** A Tripo task id: a bare 8-4-4-4-12 hex UUID, as every example in the docs shows. */
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
