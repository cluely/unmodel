import { z } from "zod";
import { createValidator } from "../../core/pipeline";
import type { FutureModelId } from "../../core/catalog-types";
import { toValidated, JSON_HEADERS, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { imagesModels } from "./images-models";
import { imageConstraints } from "./constraints";
import {
  checkPromptCharacterLimit,
  checkGifAndSvgOutput,
  checkGptImage2Size,
  checkTransparentOutputFormat,
} from "./images-shared";
import type {
  DALL_E_2_SIZE_VALUES,
  DALL_E_3_SIZE_VALUES,
  GPT_IMAGE_1_SIZE_VALUES,
  GptImage2Size,
} from "./images-shared";

// The `size` value lists live in `./images-shared` — the module both this
// endpoint and `./image-edit` already share — so that `unmodel/image-edit`'s
// per-model table can name them without dragging this endpoint's validator,
// schema and catalog into a pack that never calls it. Re-exported here because
// they were part of this module's public surface first.
export {
  DALL_E_2_SIZE_VALUES,
  DALL_E_3_SIZE_VALUES,
  GPT_IMAGE_1_SIZE_VALUES,
  GPT_IMAGE_2_SIZES,
  type GptImage2Size,
} from "./images-shared";

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
  /**
   * `transparent` is available on every GPT image model — in preview for
   * gpt-image-2 and its dated snapshot (images/create reference, checked
   * 2026-08-31) — and requires `output_format` `png` (the default) or `webp`,
   * enforced by checkTransparentOutputFormat.
   */
  background?: "transparent" | "opaque" | "auto" | null;
  moderation?: "low" | "auto" | null;
  n?: number | null;
  output_compression?: number | null;
  output_format?: "png" | "jpeg" | "webp" | null;
  partial_images?: number | null;
  quality?: "auto" | "low" | "medium" | "high" | null;
  size?: (typeof GPT_IMAGE_1_SIZE_VALUES)[number] | null;
  stream?: boolean | null;
  /**
   * @deprecated Use `safety_identifier` — "Deprecated: use `safety_identifier`
   * instead. This parameter remains accepted for backward compatibility and is
   * used when `safety_identifier` is omitted, null, or empty." (images/create
   * reference, 2026-11-13).
   */
  user?: string;
  /**
   * "A stable identifier for an end user in your organization, used for safety
   * monitoring and abuse detection. … A non-empty value takes precedence over
   * the deprecated `user` parameter." `maxLength: 128`. The reference scopes it
   * to no model, so every GPT image arm carries it (images/create reference,
   * 2026-11-13).
   */
  safety_identifier?: string | null;
  /** dall-e only — GPT image models always return base64. */
  response_format?: never;
  /** dall-e-3 only. */
  style?: never;
}

export interface GptImage1MiniBody extends GptImageBaseBody {
  model: "gpt-image-1-mini";
}

export interface GptImage15Body extends GptImageBaseBody {
  model: "gpt-image-1.5";
}

/**
 * The create reference's model list (2026-11-12) is `gpt-image-1-mini`,
 * `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2-2026-04-21`, the four
 * GPT-Image-2.5 ids, `gpt-image-2.6-sunburst`, `gpt-image-2.6-flare` "and
 * `chatgpt-image-latest`" — so this id is a generations model with the GPT
 * Image 1 surface, exactly as on edits.
 */
export interface ChatgptImageLatestBody extends GptImageBaseBody {
  model: "chatgpt-image-latest";
}

export interface GptImage2Body extends Omit<GptImageBaseBody, "size"> {
  model: "gpt-image-2";
  /**
   * gpt-image-2 additionally accepts arbitrary "WIDTHxHEIGHT" sizes: both
   * edges divisible by 16, long:short ratio at most 3:1, maximum edge 3840px,
   * and 655,360–8,294,400 total pixels (image-generation guide). The bounds
   * are enforced at runtime by checkGptImage2Size.
   */
  size?: GptImage2Size | null;
}


export interface GptImage2SnapshotBody extends Omit<GptImage2Body, "model"> {
  model: "gpt-image-2-2026-04-21";
}

/**
 * GPT-Image-2.5 Sunburst and Flare (released 2026-09-08): gpt-image-2's
 * surface — the create reference names them in the same free-form `size`
 * sentence — with a longer quality ladder: "`gpt-image-2.5-sunburst` and
 * `gpt-image-2.5-flare`, including their `2026-09-08` snapshots, also support
 * `xhigh` and `max`." (images/create reference, read 2026-11-12).
 */
interface GptImage25BaseBody extends Omit<GptImage2Body, "model" | "quality"> {
  quality?: "auto" | "low" | "medium" | "high" | "xhigh" | "max" | null;
}

export interface GptImage25SunburstBody extends GptImage25BaseBody {
  model: "gpt-image-2.5-sunburst";
}

export interface GptImage25SunburstSnapshotBody extends GptImage25BaseBody {
  model: "gpt-image-2.5-sunburst-2026-09-08";
}

export interface GptImage25FlareBody extends GptImage25BaseBody {
  model: "gpt-image-2.5-flare";
}

export interface GptImage25FlareSnapshotBody extends GptImage25BaseBody {
  model: "gpt-image-2.5-flare-2026-09-08";
}

/**
 * GPT-Image-2.6 Sunburst and Flare (released 2026-11-04): the 2.5 surface plus
 * the params the images/create reference and image-generation guide document
 * for them (read 2026-11-12). `size` keeps the 2.5 type for autocomplete but
 * is not held to the free-form bounds at runtime — no page states 2.6's size
 * rules (see GPT_IMAGE_2_MODELS in images-shared.ts).
 */
interface GptImage26BaseBody extends Omit<GptImage25BaseBody, "output_format"> {
  /**
   * `gif` and `svg` are 2.6 additions, both access-gated ("Requires access to
   * the GIF preview for the selected model." / "SVG output requires a supported
   * image model and project access."). Their pairings — GIF: no streaming,
   * partial images or custom compression; SVG: `n` must be 1, no streaming,
   * partial images or compression — are enforced by checkGifAndSvgOutput.
   */
  output_format?: "png" | "jpeg" | "webp" | "gif" | "svg" | null;
  /**
   * "The supported complexity levels for Sunburst and Flare are `low`,
   * `medium`, and `high`." / "If you omit `complexity`, both models use
   * `high`." — image-generation guide.
   */
  complexity?: "low" | "medium" | "high" | null;
  /**
   * "Number of frames for GIF output. Accepts integers from 2 through 16.
   * Defaults to 9 when omitted." Only with `output_format: "gif"`.
   */
  frame_count?: number | null;
  /** Milliseconds per GIF frame, at least 20 (default 200). Only with `output_format: "gif"`. */
  frame_duration_ms?: number | null;
  /**
   * SVG generation settings — the model that writes the markup and its
   * reasoning effort. `svg.reasoning` is "optional object { effort } or null"
   * and `effort` "optional "none" or "minimal" or "low" or 4 more or null" —
   * `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; "Supported
   * efforts depend on the selected author model." (images/create reference,
   * 2026-11-13).
   */
  svg?: {
    model?: string;
    reasoning?: { effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null } | null;
  } | null;
}

export interface GptImage26SunburstBody extends GptImage26BaseBody {
  model: "gpt-image-2.6-sunburst";
}

export interface GptImage26FlareBody extends GptImage26BaseBody {
  model: "gpt-image-2.6-flare";
}

export interface DallE2Body {
  model: "dall-e-2";
  prompt: string;
  n?: number | null;
  quality?: "auto" | "standard" | null;
  response_format?: "url" | "b64_json" | null;
  size?: (typeof DALL_E_2_SIZE_VALUES)[number] | null;
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
  size?: (typeof DALL_E_3_SIZE_VALUES)[number] | null;
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
export interface UnknownImageModelBody<Model extends string> {
  model: FutureModelId<Model, keyof ImagesBodyByModel>;
  prompt: string;
  [key: string]: unknown;
}

/**
 * Known-model bodies are closed by default. Pass a future model literal as the
 * type argument to opt into the loose escape arm, e.g. `ImagesBody<"gpt-image-9">`.
 * Use `ImagesBody<string>` only when the id is genuinely runtime-discovered.
 */
export type ImagesBody<FutureModel extends string = never> =
  | GptImage1MiniBody
  | GptImage15Body
  | ChatgptImageLatestBody
  | GptImage2Body
  | GptImage2SnapshotBody
  | GptImage25SunburstBody
  | GptImage25SunburstSnapshotBody
  | GptImage25FlareBody
  | GptImage25FlareSnapshotBody
  | GptImage26SunburstBody
  | GptImage26FlareBody
  | DallE2Body
  | DallE3Body
  | UnknownImageModelBody<FutureModel>;

export interface ImagesBodyByModel {
  "gpt-image-1-mini": GptImage1MiniBody;
  "gpt-image-1.5": GptImage15Body;
  "chatgpt-image-latest": ChatgptImageLatestBody;
  "gpt-image-2": GptImage2Body;
  "gpt-image-2-2026-04-21": GptImage2SnapshotBody;
  "gpt-image-2.5-sunburst": GptImage25SunburstBody;
  "gpt-image-2.5-sunburst-2026-09-08": GptImage25SunburstSnapshotBody;
  "gpt-image-2.5-flare": GptImage25FlareBody;
  "gpt-image-2.5-flare-2026-09-08": GptImage25FlareSnapshotBody;
  "gpt-image-2.6-sunburst": GptImage26SunburstBody;
  "gpt-image-2.6-flare": GptImage26FlareBody;
  "dall-e-2": DallE2Body;
  "dall-e-3": DallE3Body;
}

/** Resolves a model id literal to its exact Tier-A arm. */
type ImagesArm<M extends string> = M extends keyof ImagesBodyByModel
  ? ImagesBodyByModel[M]
  : UnknownImageModelBody<M>;

/** Runtime implementation type; the public alias stays closed by default. */
type AnyImagesBody = ImagesBody<string>;
type ImagesModelInput = keyof ImagesBodyByModel | (string & {});

// ---------------------------------------------------------------------------
// Schema — the loose union of every param any model accepts; per-model
// narrowing happens in constraints.ts (runtime) and the Tier-A arms (types).
//
// `model` is REQUIRED by unmodel, as the create reference itself now asks
// ("Specify a model explicitly.", 2026-11-12): every per-model check here
// (prompt caps, size enums, deny rules) keys on the model id, and validating
// a model-less request against a guessed default would be worse than asking
// for the id. Same policy as cartesia.tts.
// ---------------------------------------------------------------------------

const imageSchema = z.looseObject({
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
  safety_identifier: z.string().max(128).nullable().optional(),
  // GPT-Image-2.6 additions (images/create reference, 2026-11-12). The Tier-A
  // arms type them only on the 2.6 ids, where the guide and changelog document
  // them. At runtime `output_format: "gif" | "svg"` is enum-refused on the
  // pre-2.6 rows, so checkGifAndSvgOutput refuses `frame_count` /
  // `frame_duration_ms` there too (both need gif). `complexity` and `svg` pass
  // through on other models: no page scopes them to a model, so a runtime deny
  // would be an undocumented narrowing.
  complexity: z.string().nullable().optional(),
  frame_count: z.number().int().min(2).max(16).nullable().optional(),
  frame_duration_ms: z.number().int().min(20).nullable().optional(),
  svg: z
    .looseObject({
      model: z.string().optional(),
      reasoning: z.looseObject({ effort: z.string().nullable().optional() }).nullable().optional(),
    })
    .nullable()
    .optional(),
});

/**
 * The one `.toSdk("openai")` target for this endpoint — the official
 * `openai` SDK's params are wire-shaped. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type OpenAISdkTargets<B> = { openai: () => B };

function finalize(params: AnyImagesBody): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMAGES_GENERATIONS_URL,
    method: "POST",
    headers: JSON_HEADERS,
  }, {
    sdk: { openai: () => body },
  });
}

const validator = createValidator<AnyImagesBody, unknown>({
  endpoint: "openai.image",
  schema: imageSchema,
  modelId: (params) => params.model,
  catalog: imagesModels,
  constraints: imageConstraints,
  checks: [
    checkGptImage2Size,
    checkTransparentOutputFormat,
    checkGifAndSvgOutput,
    checkPromptCharacterLimit,
  ],
  // No token/cost estimate: image cost depends on generated output tokens,
  // which are unknown before the call.
  finalize,
});

/**
 * Validates params for POST /v1/images/generations. Known models get their
 * exact per-model param surface at compile time (e.g. `n: 4` is a compile
 * error for dall-e-3); unknown models fall back to a loose arm
 * with a runtime unknown_model warning. `.toSdk("openai")` returns the wire body
 * unchanged in shape — OpenAI's SDK params are wire-shaped.
 */
export const image = validator as unknown as {
  <M extends ImagesModelInput, T extends ImagesArm<M>>(
    params: T & ImagesArm<M> & { model: M } & ExactKeys<T, ImagesArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<T & { model: M }, OpenAISdkTargets<T & { model: M }>>;
  safe<M extends ImagesModelInput, T extends ImagesArm<M>>(
    params: T & ImagesArm<M> & { model: M } & ExactKeys<T, ImagesArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T & { model: M }, OpenAISdkTargets<T & { model: M }>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
