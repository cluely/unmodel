import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { imagesModels } from "./images-models";
import { imagesConstraints } from "./constraints";
import { checkPromptCharacterLimit, checkGptImage2Size } from "./images-shared";

export const IMAGES_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per model, each carrying exactly the params
// and enum values that model supports. Audited param-by-param on 2026-08-13
// against the create API reference
// (https://developers.openai.com/api/docs/api-reference/images/create) and
// the image-generation guide
// (https://developers.openai.com/api/docs/guides/image-generation), with the
// openai@7.4.0 OpenAPI-generated types as a cross-check only. Params a model
// rejects are typed `never` so they fail at compile time.
// ---------------------------------------------------------------------------

interface GptImageBaseBody {
  prompt: string;
  background?: "transparent" | "opaque" | "auto" | null;
  moderation?: "low" | "auto" | null;
  n?: number | null;
  output_compression?: number | null;
  output_format?: "png" | "jpeg" | "webp" | null;
  partial_images?: number | null;
  quality?: "auto" | "low" | "medium" | "high" | null;
  size?: "auto" | "1024x1024" | "1536x1024" | "1024x1536" | null;
  stream?: boolean | null;
  user?: string;
  /** dall-e only — GPT image models always return base64. */
  response_format?: never;
  /** dall-e-3 only. */
  style?: never;
}

export interface GptImage1Body extends GptImageBaseBody {
  model: "gpt-image-1";
}

export interface GptImage1MiniBody extends GptImageBaseBody {
  model: "gpt-image-1-mini";
}

export interface GptImage15Body extends GptImageBaseBody {
  model: "gpt-image-1.5";
}

// NOTE: chatgpt-image-latest deliberately has no Tier-A arm here: the
// documented generations model list is "One of `dall-e-2`, `dall-e-3`, or a
// GPT image model (`gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`,
// `gpt-image-2`, or `gpt-image-2-2026-04-21`)" — chatgpt-image-latest appears
// only on /v1/images/edits (see images-edit.ts). At the type level it falls
// into the escape-hatch arm, but the catalog is shared with the edits
// endpoint, where the id IS documented, so no `unknown_model` warning can
// fire for it. checkEditsOnlyModel below is what makes the restriction
// visible at runtime.
//
// NOTE: the create reference's `model` enum widget currently lists only
// dall-e-2/dall-e-3/gpt-image-1/gpt-image-1-mini/gpt-image-1.5, but the SAME
// page's `size` text documents `gpt-image-2` and `gpt-image-2-2026-04-21`
// behavior, and the image-generation guide calls gpt-image-2 the current
// generation model. The gpt-image-2 arms therefore stay (checked 2026-08-13).

export interface GptImage2Body extends Omit<GptImageBaseBody, "background" | "size"> {
  model: "gpt-image-2";
  /**
   * gpt-image-2 additionally accepts arbitrary "WIDTHxHEIGHT" sizes: both
   * edges divisible by 16, long:short ratio at most 3:1, maximum edge 3840px,
   * and 655,360–8,294,400 total pixels (image-generation guide). The bounds
   * are enforced at runtime by checkGptImage2Size.
   */
  size?: GptImage2Size | null;
  /**
   * gpt-image-2 does NOT support transparent backgrounds: "Requests with
   * `background` set to `transparent` will return an error for these models;
   * use `opaque` or `auto` instead." The `transparent` arm the SDK allows is
   * removed here so the mistake is a compile error (recorded 400:
   * test/fixtures/provider-errors/openai/images-gpt-image-2-background.json).
   */
  background?: "opaque" | "auto" | null;
}

/**
 * gpt-image-2 sizes. The named presets are autocomplete for the documented
 * rule space — every one satisfies checkGptImage2Size (edges ÷16, ratio
 * ≤3:1, max edge 3840, 655,360–8,294,400 total pixels) — and any other
 * "WIDTHxHEIGHT" within those bounds validates too (`${number}x${number}`
 * keeps free-form legal while making non-size strings a compile error).
 * 1920x1080 is deliberately absent: 1080 is not divisible by 16 — use
 * 2560x1440 or 3840x2160 for 16:9.
 */
export type GptImage2Size =
  | "auto"
  // 1:1
  | "1024x1024"
  | "1536x1536"
  | "2048x2048"
  | "2880x2880"
  // 3:2 / 2:3
  | "1536x1024"
  | "1024x1536"
  // 4:3 / 3:4
  | "2048x1536"
  | "1536x2048"
  // 16:9 / 9:16 (720p, 1440p, 4K)
  | "1280x720"
  | "2560x1440"
  | "3840x2160"
  | "720x1280"
  | "1440x2560"
  | "2160x3840"
  // 2:1 / 1:2
  | "2048x1024"
  | "3840x1920"
  | "1024x2048"
  | "1920x3840"
  // 21:9 / 9:21 (cinematic)
  | "3360x1440"
  | "1440x3360"
  // 3:1 / 1:3 (the documented ratio limit)
  | "3840x1280"
  | "1280x3840"
  | (`${number}x${number}` & {});

export interface GptImage2SnapshotBody extends Omit<GptImage2Body, "model"> {
  model: "gpt-image-2-2026-04-21";
}

export interface DallE2Body {
  model: "dall-e-2";
  prompt: string;
  n?: number | null;
  quality?: "auto" | "standard" | null;
  response_format?: "url" | "b64_json" | null;
  size?: "256x256" | "512x512" | "1024x1024" | null;
  user?: string;
  /** GPT image models only. */
  background?: never;
  moderation?: never;
  output_compression?: never;
  output_format?: never;
  partial_images?: never;
  stream?: never;
  /** dall-e-3 only. */
  style?: never;
}

export interface DallE3Body {
  model: "dall-e-3";
  prompt: string;
  /** dall-e-3 only generates one image per request. */
  n?: 1 | null;
  quality?: "auto" | "standard" | "hd" | null;
  response_format?: "url" | "b64_json" | null;
  size?: "1024x1024" | "1792x1024" | "1024x1792" | null;
  style?: "vivid" | "natural" | null;
  user?: string;
  /** GPT image models only. */
  background?: never;
  moderation?: never;
  output_compression?: never;
  output_format?: never;
  partial_images?: never;
  stream?: never;
}

/** Escape hatch for models unmodel doesn't know yet (unknown_model warning). */
export interface UnknownImageModelBody {
  model: string & {};
  prompt: string;
  [key: string]: unknown;
}

export type ImagesBody =
  | GptImage1Body
  | GptImage1MiniBody
  | GptImage15Body
  | GptImage2Body
  | GptImage2SnapshotBody
  | DallE2Body
  | DallE3Body
  | UnknownImageModelBody;

interface ImagesBodyByModel {
  "gpt-image-1": GptImage1Body;
  "gpt-image-1-mini": GptImage1MiniBody;
  "gpt-image-1.5": GptImage15Body;
  "gpt-image-2": GptImage2Body;
  "gpt-image-2-2026-04-21": GptImage2SnapshotBody;
  "dall-e-2": DallE2Body;
  "dall-e-3": DallE3Body;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type ImagesArm<M extends string> = M extends keyof ImagesBodyByModel
  ? ImagesBodyByModel[M]
  : UnknownImageModelBody;

// ---------------------------------------------------------------------------
// Schema — the loose union of every param any model accepts; per-model
// narrowing happens in constraints.ts (runtime) and the Tier-A arms (types).
//
// `model` is REQUIRED by unmodel even though the wire defaults it ("Defaults
// to `dall-e-2` unless a parameter specific to the GPT image models is used"
// — images/create): every per-model check here (prompt caps, size enums,
// deny rules, the edits-only gate) keys on the model id, and silently
// validating a request against dall-e-2 that OpenAI may route to a GPT image
// model would be worse than asking for the id. Documented deviation, same
// policy as cartesia.speech.
// ---------------------------------------------------------------------------

const imagesSchema = z.looseObject({
  model: z.string(),
  prompt: z.string(),
  background: z.enum(["transparent", "opaque", "auto"]).nullable().optional(),
  moderation: z.string().nullable().optional(),
  n: z.number().int().min(1).max(10).nullable().optional(),
  output_compression: z.number().min(0).max(100).nullable().optional(),
  output_format: z.string().nullable().optional(),
  partial_images: z.number().int().min(0).max(3).nullable().optional(),
  quality: z.string().nullable().optional(),
  response_format: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  stream: z.boolean().nullable().optional(),
  style: z.string().nullable().optional(),
  user: z.string().optional(),
});

const IMAGES_CREATE_DOCS = "https://developers.openai.com/api/docs/api-reference/images/create";

/**
 * Model ids the images catalog carries because /v1/images/edits documents
 * them, but which the create reference's `model` list does not name. They
 * cannot warn as `unknown_model` (the catalog is shared with the edits
 * endpoint), so the endpoint restriction is reported here instead.
 */
const EDITS_ONLY_MODEL_IDS: ReadonlySet<string> = new Set(["chatgpt-image-latest"]);

/** The create reference's `model` list, verbatim. */
const GENERATIONS_MODEL_IDS = [
  "dall-e-2",
  "dall-e-3",
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
] as const;

function checkEditsOnlyModel(
  params: ImagesBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if (typeof model !== "string" || !EDITS_ONLY_MODEL_IDS.has(model)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model,
    message: `"${model}" is not a documented model for POST /v1/images/generations — the create reference lists ${GENERATIONS_MODEL_IDS.join(", ")}, and names "${model}" only under /v1/images/edits. Use \`imageEdit\` from "unmodel/openai" for it, or pick a generations model.`,
    meta: { source: IMAGES_CREATE_DOCS, allowed: [...GENERATIONS_MODEL_IDS] },
  });
}

/**
 * The one `.toSdk("openai")` target for this endpoint — the official
 * `openai` SDK's params are wire-shaped. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type OpenAISdkTargets<B> = { openai: () => B };

function finalize(params: ImagesBody): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMAGES_GENERATIONS_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { openai: () => body },
  });
}

const validator = createValidator<ImagesBody, unknown>({
  endpoint: "openai.images",
  schema: imagesSchema,
  modelId: (params) => params.model,
  catalog: imagesModels,
  constraints: imagesConstraints,
  checks: [checkEditsOnlyModel, checkGptImage2Size, checkPromptCharacterLimit],
  // No token/cost estimate: image cost depends on generated output tokens,
  // which are unknown before the call.
  finalize,
});

/**
 * Validates params for POST /v1/images/generations. Known models get their
 * exact per-model param surface at compile time (e.g. `background` is a
 * compile error for gpt-image-2); unknown models fall back to a loose arm
 * with a runtime unknown_model warning. `.toSdk("openai")` returns the wire body
 * unchanged in shape — OpenAI's SDK params are wire-shaped.
 */
export const images = validator as unknown as {
  <M extends ImagesBody["model"], T extends ImagesArm<M>>(
    params: T & ImagesArm<M> & { model: M } & ExactKeys<T, ImagesArm<M>>,
    options?: ValidateOptions,
  ): Validated<T & { model: M }, OpenAISdkTargets<T & { model: M }>>;
  safe<M extends ImagesBody["model"], T extends ImagesArm<M>>(
    params: T & ImagesArm<M> & { model: M } & ExactKeys<T, ImagesArm<M>>,
    options?: ValidateOptions,
  ): ValidateResult<Validated<T & { model: M }, OpenAISdkTargets<T & { model: M }>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
