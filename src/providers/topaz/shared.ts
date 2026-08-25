/**
 * Shared wire pieces for Topaz Labs' Image API
 * (`https://api.topazlabs.com/image/v1/...`), transcribed from the published
 * OpenAPI 3.1.2 document
 * (https://openapi.gitbook.com/o/HctdcUHRfIWXBVA1egPp/spec/image-yaml-feb-2026.yaml,
 * `Image API` v1.2.0, linked from
 * https://developer.topazlabs.com/reference/openapi-specs/readme) and from the
 * per-model reference pages under https://developer.topazlabs.com/image-models/
 * — verified 2026-08-25. Every docs route also serves raw Markdown at
 * `<route>.md`, which is what was read.
 *
 * ## The spec gives the envelope; the docs give the dials
 *
 * This is the unusual shape of this provider and the reason a hand provider is
 * worth more here than a generated one. Every request schema in the spec ends:
 *
 * ```yaml
 * additionalProperties:
 *   type: string
 *   description: Additional key-value pairs to be used as model settings.
 *     Only pairs relevant for your chosen model are used.
 * ```
 *
 * So the machine-readable schema knows `model`, `output_width`,
 * `output_height`, `crop_to_fill`, `output_format` and `webhook_url` — and
 * nothing at all about `creativity`, `texture`, `faceEnhancement`, `denoise`,
 * `prompt` or the twenty other dials that decide what the output looks like.
 * Those are documented ONLY in prose, per model, and Topaz says plainly that
 * "Extra parameters provided that are not supported are **ignored**" — a typo
 * is a silent no-op rather than a 4xx. {@link TOPAZ_SETTINGS_BY_MODEL} is that
 * prose, hand-transcribed, which is what lets a wrong dial be a compile error
 * here instead of a nothing at the API.
 *
 * ## Two casings, and the docs disagree with themselves
 *
 * The envelope is snake_case (`output_width`, `crop_to_fill`,
 * `output_format`); the settings are camelCase (`faceEnhancement`,
 * `subjectDetection`, `fixCompression`) on fourteen of the fifteen model pages.
 * The fifteenth — Text & Shapes — lists the same endpoint-level settings
 * snake_cased (`face_enhancement`, `subject_detection`, `fix_compression`).
 * unmodel types the camelCase spelling everywhere, because it is what the other
 * fourteen pages say and because those pages are the ones a caller is reading
 * when they set the field; the snake_case listing looks like a stale copy.
 * If Topaz turns out to want the other spelling on that one model, `sharpen`
 * and `denoise` are spelled identically either way and the rest reaches the
 * wire through `providerOptions`.
 *
 * ## Everything is form-encoded, even a URL-only request
 *
 * `requestBody.content` on every submit path declares `multipart/form-data`
 * and nothing else — there is no JSON arm, so even a request whose only input
 * is `source_url` goes out as a form. That is why `.request.headers` is empty
 * (fetch has to derive the multipart boundary itself) and why the body comes
 * from {@link toFormData} rather than from `JSON.stringify`. Numbers and
 * booleans cross as strings; the spec's `additionalProperties: {type: string}`
 * says so and `toFormData` does it.
 *
 * ## Async, three calls minimum
 *
 * `POST …/async` answers `{ process_id, source_id, eta }` (also mirrored in the
 * `X-Process-ID`, `X-Source-ID` and `X-ETA` response headers), then
 * `GET /status/{process_id}` until `status` is `Completed`, then
 * `GET /download/{process_id}` for a presigned URL that expires after an hour.
 * `webhook_url` short-circuits the polling: Topaz POSTs JSON on every status
 * change, retries 5xx with exponential backoff from 5s to a 15-minute cap, and
 * discards on 4xx.
 *
 * ## Auth
 *
 * `X-API-Key: <TOPAZ_API_KEY>`, an `apiKey`-in-header scheme applied globally.
 * The quickstart's Python sample writes `X-API-KEY`; HTTP header names are
 * case-insensitive so both work, and unmodel states the spec's casing. Keys are
 * self-serve from a Topaz account — no sales gate. unmodel never touches
 * credentials, so the header is yours to add.
 */

import { z } from "zod";
import type { PipelineContext } from "../../core/pipeline";

/** The Image API's base. The Video API is a different host path — see `./index.ts`. */
export const TOPAZ_IMAGE_BASE_URL = "https://api.topazlabs.com/image/v1";

export const DOCS_BASE = "https://developer.topazlabs.com";

/** `POST /image/v1/enhance/async` — the classic (GAN) precision upscalers. */
export const ENHANCE_URL = `${TOPAZ_IMAGE_BASE_URL}/enhance/async`;

/** `POST /image/v1/enhance-gen/async` — the generative and creative upscalers. */
export const ENHANCE_GEN_URL = `${TOPAZ_IMAGE_BASE_URL}/enhance-gen/async`;

/** `GET /image/v1/status/{process_id}` — poll a submitted job. */
export function statusUrl(processId: string): string {
  return `${TOPAZ_IMAGE_BASE_URL}/status/${processId}`;
}

/** `GET /image/v1/download/{process_id}` — a presigned URL, valid one hour. */
export function downloadUrl(processId: string): string {
  return `${TOPAZ_IMAGE_BASE_URL}/download/${processId}`;
}

/** `DELETE /image/v1/cancel/{process_id}` — stop a job that is still running. */
export function cancelUrl(processId: string): string {
  return `${TOPAZ_IMAGE_BASE_URL}/cancel/${processId}`;
}

/**
 * `POST /image/v1/estimate` and `/estimate-gen` — Topaz's own credit quote.
 *
 * unmodel never calls them; `topazCredits` in `./pricing.ts` computes the same
 * number locally from the published MP-per-credit rate, exactly, whenever the
 * request states an output size. These are here for the cases it cannot —
 * chiefly a request that lets Topaz choose the output size.
 */
export const ESTIMATE_URL = `${TOPAZ_IMAGE_BASE_URL}/estimate`;
export const ESTIMATE_GEN_URL = `${TOPAZ_IMAGE_BASE_URL}/estimate-gen`;

/** The states `GET /status/{process_id}` reports. `Completed` is where the output is. */
export const TOPAZ_STATUSES = ["Pending", "Processing", "Completed", "Cancelled", "Failed"] as const;
export type TopazStatus = (typeof TOPAZ_STATUSES)[number];

/** `output_format` — the containers Topaz writes. Default `jpeg`. */
export const TOPAZ_OUTPUT_FORMATS = ["jpeg", "jpg", "png", "tiff", "tif"] as const;
export type TopazOutputFormat = (typeof TOPAZ_OUTPUT_FORMATS)[number];

/** The formats Topaz reads, per the `image` field's own description. */
export const TOPAZ_INPUT_FORMATS = ["jpeg", "jpg", "png", "tiff", "tif"] as const;

/** `output_width` / `output_height` bounds, from the spec's own min/max. */
export const OUTPUT_DIMENSION_MIN = 1;
export const OUTPUT_DIMENSION_MAX = 32_000;

/** `prompt` ceiling on the generative route, per every model page that has one. */
export const PROMPT_MAX_CHARS = 1024;

/**
 * The `/enhance/async` model enum — the Gigapixel family.
 *
 * ⚠️ A UNION OF TWO SOURCES, and they disagree by addition. The published
 * OpenAPI document (dated `image-yaml-feb-2026`) enumerates five:
 * `["Standard V2", "Low Resolution V2", "CGI", "High Fidelity V2", "Text Refine"]`.
 * The live per-model pages under /image-models/gigapixel/ document those five
 * AND `"Upscale High Fidelity V3"` (the High Fidelity 3 page), each naming this
 * endpoint and its own `model` string. The spec is a dated snapshot and the
 * model pages are the per-route reference, so the pages win where they add —
 * the same call `unmodel/tripo3d` makes when Tripo's endpoint pages disagree
 * with its model index. Nothing is typed that was not read on a page.
 *
 * The values are Topaz's own, verbatim, spaces and all. They are product names
 * rather than slugs, which is unusual and is why a ref reads
 * `"topaz/Standard V2"`; slugging them would invent a vocabulary and then need
 * a table to undo it.
 */
export const TOPAZ_ENHANCE_MODELS = [
  "Standard V2",
  "High Fidelity V2",
  "Upscale High Fidelity V3",
  "Low Resolution V2",
  "CGI",
  "Text Refine",
] as const;
export type TopazEnhanceModel = (typeof TOPAZ_ENHANCE_MODELS)[number];

/**
 * The `/enhance-gen/async` model enum — the Wonder and Bloom families.
 *
 * ⚠️ The same two-source union, and here the drift is much wider. The spec
 * enumerates four: `["Standard MAX", "Recovery V2", "Wonder", "Redefine"]`.
 * The live pages under /image-models/wonder/ and /image-models/bloom/ document
 * nine on this endpoint — the four minus `"Recovery V2"`, plus `"Wonder 2"`,
 * `"Wonder 3"`, `"Wonder 3.5"`, `"Recover 3"`, `"Bloom 2"` and
 * `"Bloom Realism"`.
 *
 * `"Recovery V2"` is the one value that goes the other way: it is in the spec
 * and on no page, has no published credit table, and reads like the earlier
 * name of what is now `"Recover 3"` (whose page adds "or `\"Natural Enhance\"`"
 * as a second accepted string). unmodel does not type it, for the reason it
 * does not type sync.'s undocumented models: a string with no reference page is
 * a string nobody can look up.
 *
 * `"Bloom 1 Creative"` is documented as a product and its page does not state a
 * `model` string, so it is absent here too — the id is the one thing that
 * cannot be inferred.
 */
export const TOPAZ_ENHANCE_GEN_MODELS = [
  "Redefine",
  "Wonder",
  "Wonder 2",
  "Wonder 3",
  "Wonder 3.5",
  "Standard MAX",
  "Recover 3",
  "Bloom 2",
  "Bloom Realism",
] as const;
export type TopazEnhanceGenModel = (typeof TOPAZ_ENHANCE_GEN_MODELS)[number];

/** Every upscale model this provider serves, across both routes. */
export const TOPAZ_MODELS = [...TOPAZ_ENHANCE_MODELS, ...TOPAZ_ENHANCE_GEN_MODELS] as const;
export type TopazModelId = (typeof TOPAZ_MODELS)[number];

/** `subjectDetection` — where an enhancement is applied. */
export const TOPAZ_SUBJECT_DETECTION = ["foreground", "background", "all"] as const;
export type TopazSubjectDetection = (typeof TOPAZ_SUBJECT_DETECTION)[number];

/** `enhancementStrength` — Wonder 3 and Wonder 3.5. */
export const TOPAZ_ENHANCEMENT_STRENGTHS = ["high", "medium", "low"] as const;
export type TopazEnhancementStrength = (typeof TOPAZ_ENHANCEMENT_STRENGTHS)[number];

/** `grainModel` — the film-grain simulation, on Wonder 3.5 and Bloom 2. */
export const TOPAZ_GRAIN_MODELS = ["silver", "gaussian", "grey"] as const;
export type TopazGrainModel = (typeof TOPAZ_GRAIN_MODELS)[number];

// ---------------------------------------------------------------------------
// Model settings — the half the OpenAPI document does not describe
// ---------------------------------------------------------------------------

/**
 * The dials both routes share, documented on every model page's
 * "Endpoint-Specific Parameters" block.
 *
 * They are ENDPOINT-specific by their own heading, so they belong to the route
 * rather than to the model — which is what settles the two newest pages
 * (`Wonder 3.5` and `Bloom 2`) omitting the block entirely: an omission on a
 * terser page is not a statement that the endpoint stopped taking them.
 */
export interface TopazFaceSettings {
  /** Run the face-recovery model over detected faces. */
  faceEnhancement?: boolean;
  /** 0–1. **Required when `faceEnhancement` is true.** */
  faceEnhancementStrength?: number;
  /** 0–1. **Required when `faceEnhancement` is true.** Realistic ↔ creative. */
  faceEnhancementCreativity?: number;
  /** Where enhancements are applied. */
  subjectDetection?: TopazSubjectDetection;
}

/** The `/enhance/async` dials, beyond {@link TopazFaceSettings}. */
export interface TopazEnhanceSettings extends TopazFaceSettings {
  /** 0–1. A light sharpening pass. */
  sharpen?: number;
  /** 0–1. Noise reduction. */
  denoise?: number;
  /** 0–1. Reduces compression artefacts. */
  fixCompression?: number;
  /** 0.01–1. Overall model strength; too high looks unreal. */
  strength?: number;
}

/** The `/enhance-gen/async` dials, beyond {@link TopazFaceSettings}. */
export interface TopazEnhanceGenSettings extends TopazFaceSettings {
  /**
   * Up to 1024 characters, and DESCRIPTIVE rather than imperative — Topaz's own
   * guidance: write "girl with red hair and blue eyes", not "change the girl's
   * hair to red". This is the field `unmodel/upscale`'s canonical `prompt` maps
   * to, and the second witness that made that word canonical.
   */
  prompt?: string;
  /** Generate the prompt automatically. Ignores whatever `prompt` said. */
  autoprompt?: boolean;
  /** Integer 1–9 (1–4 on `Bloom Realism`), default 3. How far it may stray. */
  creativity?: number;
  /** Integer 1–5. 1 at low creativity, 3 at high, per Topaz's recommendation. */
  texture?: number;
  /** 0–1. */
  sharpen?: number;
  /** 0–1. */
  denoise?: number;
  /** Add detail after rendering. Default false. */
  detail?: boolean;
  /** 0–10. **Required when `detail` is true.** */
  detailStrength?: number;
}

/** Everything any rostered model takes that the envelope does not declare. */
export interface TopazModelSettings extends TopazEnhanceSettings, TopazEnhanceGenSettings {
  /** `Upscale High Fidelity V3`, `Text Refine`. 0–1, default 1.0. */
  opacity?: number;
  /** `Upscale High Fidelity V3`. 0–1, default 1.0. */
  recoveryStrength?: number;
  /** `CGI`, `Text Refine`. 0–1, default 0.5. */
  deblurStrength?: number;
  /** `Text Refine`. 0–1, default 0.5. */
  denoiseStrength?: number;
  /** `Text Refine`. 0–1, default 0.5. */
  decompressionStrength?: number;
  /** `Wonder 3`, `Wonder 3.5`. */
  enhancementStrength?: TopazEnhancementStrength;
  /** `Wonder 3.5`, `Bloom 2`. Film-grain simulation. */
  grain?: boolean;
  grainDensity?: number;
  grainModel?: TopazGrainModel;
  grainSize?: number;
  grainStrength?: number;
  /** `Wonder 3.5`, `Bloom 2`. Declare the input's pixel dimensions. */
  inputWidth?: number;
  inputHeight?: number;
  /**
   * `Wonder 3.5`, `Bloom 2`. A SECOND spelling of the output size, camelCased,
   * alongside the envelope's own `output_width` / `output_height`. Topaz
   * documents both on those two pages and says nothing about precedence, so
   * unmodel types both and states the collision rather than picking a winner.
   */
  outputWidth?: number;
  outputHeight?: number;
  /** `Bloom 2`. Keep the source's colours while new detail is introduced. */
  colorPreservation?: boolean;
  /** `Bloom 2` (default 2), `Bloom Realism` (1–2000, default 1). */
  seed?: number;
}

/** The settings the classic route documents for every model on it. */
const ENHANCE_COMMON = [
  "faceEnhancement",
  "faceEnhancementStrength",
  "faceEnhancementCreativity",
  "subjectDetection",
  "sharpen",
  "denoise",
  "fixCompression",
  "strength",
] as const;

/** The settings the generative route documents for every model on it. */
const ENHANCE_GEN_COMMON = [
  "faceEnhancement",
  "faceEnhancementStrength",
  "faceEnhancementCreativity",
  "subjectDetection",
  "prompt",
  "autoprompt",
  "creativity",
  "texture",
  "sharpen",
  "denoise",
  "detail",
  "detailStrength",
] as const;

const GRAIN = ["grain", "grainDensity", "grainModel", "grainSize", "grainStrength"] as const;
const DIMENSIONS = ["inputWidth", "inputHeight", "outputWidth", "outputHeight"] as const;

/**
 * Which settings each model takes — the whole point of hand-writing this
 * provider.
 *
 * Transcribed from the "Endpoint-Specific Parameters" and "Model-Specific
 * Parameters" blocks on each model's own page under
 * https://developer.topazlabs.com/image-models/, verified 2026-08-25. None of
 * it is in the OpenAPI document, which types the whole space as
 * `additionalProperties: { type: string }`.
 *
 * It matters because Topaz IGNORES a setting a model does not take: send
 * `creativity` to `Standard V2` and the request succeeds, costs the same, and
 * comes back exactly as if you had not. {@link checkModelSettings} is the only
 * place that failure is visible.
 */
export const TOPAZ_SETTINGS_BY_MODEL: Readonly<Record<string, readonly string[]>> = {
  // --- /enhance/async ------------------------------------------------------
  "Standard V2": ENHANCE_COMMON,
  "High Fidelity V2": ENHANCE_COMMON,
  "Upscale High Fidelity V3": [...ENHANCE_COMMON, "recoveryStrength", "opacity"],
  "Low Resolution V2": ENHANCE_COMMON,
  CGI: [...ENHANCE_COMMON, "deblurStrength"],
  "Text Refine": [
    ...ENHANCE_COMMON,
    "denoiseStrength",
    "deblurStrength",
    "decompressionStrength",
    "opacity",
  ],
  // --- /enhance-gen/async --------------------------------------------------
  Redefine: ENHANCE_GEN_COMMON,
  Wonder: ENHANCE_GEN_COMMON,
  "Wonder 2": ENHANCE_GEN_COMMON,
  "Wonder 3": [...ENHANCE_GEN_COMMON, "enhancementStrength"],
  "Wonder 3.5": [...ENHANCE_GEN_COMMON, "enhancementStrength", ...GRAIN, ...DIMENSIONS],
  "Standard MAX": ENHANCE_GEN_COMMON,
  "Recover 3": ENHANCE_GEN_COMMON,
  "Bloom 2": [...ENHANCE_GEN_COMMON, "colorPreservation", "seed", ...GRAIN, ...DIMENSIONS],
  "Bloom Realism": [...ENHANCE_GEN_COMMON, "seed"],
};

/**
 * The published input and output ceilings, in megapixels, where a model page
 * states them.
 *
 * `Redefine` at 256 MP in and out, `Wonder` at 128, `Standard MAX` and
 * `Recover 3` at 24 in / 384 out, the classic upscalers at 512 in / 1024 out.
 * A request states its OUTPUT size directly, so the output ceiling is checkable
 * — {@link checkOutputMegapixels} does it — while the input's is a property of
 * a file behind a URL and is not.
 */
export const TOPAZ_MEGAPIXEL_LIMITS: Readonly<
  Record<string, { readonly input?: number; readonly output: number }>
> = {
  "Standard V2": { input: 512, output: 1024 },
  "High Fidelity V2": { input: 512, output: 1024 },
  "Low Resolution V2": { input: 512, output: 1024 },
  CGI: { input: 512, output: 1024 },
  "Text Refine": { input: 512, output: 1024 },
  Redefine: { input: 256, output: 256 },
  Wonder: { input: 128, output: 128 },
  "Standard MAX": { input: 24, output: 384 },
  "Recover 3": { input: 24, output: 384 },
};

// ---------------------------------------------------------------------------
// Shared zod fragments
// ---------------------------------------------------------------------------

const unitInterval = z.number().min(0).max(1);

export const faceSettingsSchema = {
  faceEnhancement: z.boolean().optional(),
  faceEnhancementStrength: unitInterval.optional(),
  faceEnhancementCreativity: unitInterval.optional(),
  subjectDetection: z.enum(TOPAZ_SUBJECT_DETECTION).optional(),
};

/** The envelope every submit path declares, as one zod fragment. */
export const envelopeSchema = {
  source_id: z.string().optional(),
  source_url: z.string().optional(),
  output_height: z.number().int().min(OUTPUT_DIMENSION_MIN).max(OUTPUT_DIMENSION_MAX).optional(),
  output_width: z.number().int().min(OUTPUT_DIMENSION_MIN).max(OUTPUT_DIMENSION_MAX).optional(),
  crop_to_fill: z.boolean().optional(),
  output_format: z.enum(TOPAZ_OUTPUT_FORMATS).optional(),
  webhook_url: z.string().optional(),
};

/**
 * Builds the `multipart/form-data` body for a Topaz image request.
 *
 * A `Blob` becomes a file part; everything else is stringified, which is what
 * the wire wants — the spec types the whole settings space as
 * `additionalProperties: { type: string }`, so `creativity: 5` crosses as
 * `"5"` and `detail: true` as `"true"`. `null` and `undefined` are omitted.
 *
 * ```ts
 * const params = topaz.upscale({ source_url: url, model: "Standard V2", output_width: 4096 });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { "X-API-Key": process.env.TOPAZ_API_KEY! },
 *   body: topaz.toFormData(params),
 * });
 * ```
 *
 * Do NOT set `content-type` yourself — `fetch` derives the multipart boundary
 * from the `FormData`, which is why `.request.headers` is empty.
 */
export function toFormData(params: object): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (value instanceof Blob) form.append(key, value);
    else form.append(key, String(value));
  }
  return form;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * The shape every check below reads — the union of both routes' fields, with
 * everything widened to its base type.
 *
 * Written out rather than `Record<string, unknown>` for `tripo3d`'s reason: an
 * interface has no implicit index signature, so a check typed against the
 * record would not be assignable to `createValidator`'s `checks` for either
 * route.
 */
interface EnhanceParams {
  model?: string;
  image?: unknown;
  source_id?: string;
  source_url?: string;
  output_width?: number;
  output_height?: number;
  faceEnhancement?: boolean;
  faceEnhancementStrength?: number;
  faceEnhancementCreativity?: number;
  detail?: boolean;
  detailStrength?: number;
}

/** The three ways to name the picture, of which a request needs exactly one. */
const SOURCE_FIELDS = ["image", "source_id", "source_url"] as const;

/**
 * A request has to say WHICH picture, and the schema does not.
 *
 * `image`, `source_id` and `source_url` are three independent optional
 * properties in the spec with no `required` and no `oneOf` between them, so
 * `{ model: "Standard V2" }` type-checks and 400s, and a request naming two of
 * them is ambiguous rather than redundant.
 */
export function checkSource(source: string) {
  return (params: EnhanceParams, _info: unknown, ctx: PipelineContext): void => {
    const given = SOURCE_FIELDS.filter((field) => params[field] !== undefined);
    if (given.length === 1) return;
    ctx.report({
      code: "invalid_shape",
      path: [given[0] ?? "source_url"],
      ...(params.model === undefined ? {} : { model: params.model }),
      message:
        given.length === 0
          ? "A Topaz request needs a picture: pass `image` (a Blob, sent as the multipart file " +
            "part), `source_url` (a URL Topaz fetches) or `source_id` (a source it already holds " +
            "from an earlier job — every submit answers one)."
          : `\`${given.join("` and `")}\` were both given and Topaz takes exactly one. ` +
            "They are three ways to name the same thing: the bytes, a URL, or a source id from an " +
            "earlier job.",
      meta: { source, given: [...given] },
    });
  };
}

/**
 * Two dials that are mandatory only when a third is on.
 *
 * "`faceEnhancementStrength` — decimal between 0 and 1 *(required if
 * `faceEnhancement=true`)*" and the same sentence for
 * `faceEnhancementCreativity` and for `detailStrength`. A conditional
 * requirement is invisible in a type where all three fields are optional, and
 * it is not in the OpenAPI document at all — these live in the prose the
 * `additionalProperties` escape hatch hides.
 */
export function checkConditionalStrengths(source: string) {
  return (params: EnhanceParams, _info: unknown, ctx: PipelineContext): void => {
    if (params.faceEnhancement === true) {
      for (const key of ["faceEnhancementStrength", "faceEnhancementCreativity"] as const) {
        if (params[key] !== undefined) continue;
        ctx.report({
          code: "invalid_shape",
          path: [key],
          ...(params.model === undefined ? {} : { model: params.model }),
          message:
            `\`faceEnhancement: true\` requires \`${key}\` — Topaz documents both strength dials as ` +
            "required once face recovery is switched on, and neither has a server-side default.",
          meta: { source },
        });
      }
    }
    if (params.detail === true && params.detailStrength === undefined) {
      ctx.report({
        code: "invalid_shape",
        path: ["detailStrength"],
        ...(params.model === undefined ? {} : { model: params.model }),
        message:
          "`detail: true` requires `detailStrength` (0–10) — the switch turns the pass on and the " +
          "strength is what it does.",
        meta: { source },
      });
    }
  };
}

/**
 * A setting the chosen model does not take, reported as a warning.
 *
 * A warning and not an error, because Topaz says what happens: "Extra
 * parameters provided that are not supported are ignored." The request
 * succeeds, is billed identically, and comes back as though the dial had not
 * been set — which is precisely the failure a caller cannot see, and precisely
 * why this provider is hand-written. The message names the models that DO take
 * it, so the fix is a model change rather than a deletion.
 */
export function checkModelSettings(source: string, allSettings: readonly string[]) {
  return (params: EnhanceParams, _info: unknown, ctx: PipelineContext): void => {
    const model = params.model;
    if (model === undefined) return;
    const allowed = TOPAZ_SETTINGS_BY_MODEL[model];
    if (allowed === undefined) return;
    const body = params as unknown as Record<string, unknown>;
    for (const key of allSettings) {
      if (body[key] === undefined || allowed.includes(key)) continue;
      const takers = Object.keys(TOPAZ_SETTINGS_BY_MODEL)
        .filter((id) => TOPAZ_SETTINGS_BY_MODEL[id]?.includes(key) === true)
        .sort();
      ctx.report({
        code: "unknown_param",
        path: [key],
        model,
        message:
          `\`${key}\` is not a setting "${model}" reads, and Topaz IGNORES a setting a model does not ` +
          `take rather than refusing it — the job will run, bill the same and come back as if the dial ` +
          `were unset. ${
            takers.length === 0
              ? "No model in this catalog documents it."
              : `${takers.map((id) => `"${id}"`).join(", ")} read it.`
          }`,
        meta: { source, allowed: [...allowed] },
      });
    }
  };
}

/**
 * The output ceiling, where the model page publishes one.
 *
 * Checkable in a way the INPUT ceiling is not: the request states the output's
 * dimensions, while the input is a file behind a URL. `Wonder` caps at 128 MP
 * and `Redefine` at 256, so a 8000×8000 request (64 MP) is fine at both and a
 * 20000×20000 one (400 MP) is not — and the difference between the models is
 * three-fold, which no single number in the envelope's `maximum: 32000` says.
 */
export function checkOutputMegapixels(source: string) {
  return (params: EnhanceParams, _info: unknown, ctx: PipelineContext): void => {
    const { model, output_width: width, output_height: height } = params;
    if (model === undefined || width === undefined || height === undefined) return;
    const limit = TOPAZ_MEGAPIXEL_LIMITS[model];
    if (limit === undefined) return;
    const megapixels = (width * height) / 1_000_000;
    if (megapixels <= limit.output) return;
    ctx.report({
      code: "media_dimensions_exceeded",
      path: ["output_width"],
      model,
      message:
        `${width}×${height} is ${megapixels.toFixed(1)} MP and "${model}" caps its output at ` +
        `${limit.output} MP. The ceilings differ sharply between models — the classic upscalers reach ` +
        "1024 MP where the generative ones stop at 128 or 256 — so this is a model choice rather than " +
        "a size to round down.",
      meta: { source, megapixels, max: limit.output },
    });
  };
}
