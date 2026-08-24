/**
 * OpenAI image editing — POST https://api.openai.com/v1/images/edits
 *
 * Wire notes (audited 2026-08-13 against
 * https://developers.openai.com/api/docs/api-reference/images/createEdit and
 * https://developers.openai.com/api/docs/guides/image-generation, with the
 * OpenAPI-generated openai@7.4.0 `resources/images.d.ts` as a cross-check):
 * - This is a multipart/form-data endpoint. The validated output's enumerable
 *   props are the validated params (including the image Blobs) — do NOT
 *   JSON.stringify them. The raw-fetch path is `.request.url` +
 *   `toFormData(validated)` as the body; fetch derives the multipart
 *   content-type (with boundary) from the FormData, which is why
 *   `.request.headers` is empty.
 * - Multiple input images ride as repeated `image[]` parts (the reference's
 *   curl example sends `-F "image[]=@a.png" -F "image[]=@b.png"`); a single
 *   image rides as `image`. "For GPT image models ... You can provide up to
 *   16 images." / "For `dall-e-2`, you can only provide one image".
 * - `model` is optional: "Defaults to `gpt-image-1.5`" — model-dependent
 *   checks run against that id when none is given.
 * - `dall-e-3` is NOT an edit model ("One of `dall-e-2` or a GPT image
 *   model"), so it has no arm and only reaches the escape hatch.
 * - The endpoint's JSON variant (an `images` array of `{ file_id }` /
 *   `{ image_url }` references) is not modeled here — unmodel validates the
 *   documented multipart surface.
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ValidatedForm, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { FutureModelId, ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints, MediaRule } from "../../core/constraint-types";
import { findMediaDeclaration, reportMediaIssues } from "../../core/media/check";
import { imagesModels } from "./images-models";
import { imagesEditConstraints } from "./constraints";
import { checkGptImage2Size, createPromptLimitCheck, type GptImage2Size } from "./images-shared";

export const IMAGES_EDITS_URL = "https://api.openai.com/v1/images/edits";

const EDIT_DOCS = "https://developers.openai.com/api/docs/api-reference/images/createEdit";

/** "Defaults to `gpt-image-1.5`." — createEdit reference. */
export const DEFAULT_IMAGE_EDIT_MODEL_ID = "gpt-image-1.5";

/** "You can provide up to 16 images" (GPT image models). */
export const MAX_EDIT_IMAGES = 16;

/**
 * "An additional image whose fully transparent areas (e.g. where alpha is
 * zero) indicate where `image` should be edited. If there are multiple images
 * provided, the mask will be applied on the first image. Must be a valid PNG
 * file, less than 4MB, and have the same dimensions as `image`."
 */
export const MASK_RULE: MediaRule = { maxBytes: 4 * 1024 * 1024, formats: ["png"] };

// ---------------------------------------------------------------------------
// Wire types — Tier A: one arm per documented model id, carrying exactly the
// params and enum values that model supports. Params a model rejects are
// typed `never` so they fail at compile time.
// ---------------------------------------------------------------------------

interface GptImageEditBase {
  /**
   * The image(s) to edit — "each image should be a `png`, `webp`, or `jpg`
   * file less than 50MB. You can provide up to 16 images." An array is sent
   * as repeated `image[]` parts.
   */
  image: Blob | Blob[];
  prompt: string;
  /** PNG, < 4MB, same dimensions as `image`; applied to the first image. */
  mask?: Blob;
  background?: "transparent" | "opaque" | "auto" | null;
  input_fidelity?: "high" | "low" | null;
  moderation?: "low" | "auto" | null;
  n?: number | null;
  output_compression?: number | null;
  output_format?: "png" | "jpeg" | "webp" | null;
  partial_images?: number | null;
  quality?: "auto" | "low" | "medium" | "high" | null;
  size?: "auto" | "1024x1024" | "1536x1024" | "1024x1536" | null;
  stream?: boolean | null;
  user?: string;
  /** dall-e-2 only — GPT image models always return base64. */
  response_format?: never;
}

export interface GptImage1EditBody extends GptImageEditBase {
  model: "gpt-image-1";
}

export interface GptImage1MiniEditBody extends GptImageEditBase {
  model: "gpt-image-1-mini";
  /**
   * "This parameter is only supported for `gpt-image-1` and `gpt-image-1.5`
   * and later models, unsupported for `gpt-image-1-mini`."
   */
  input_fidelity?: never;
}

export interface GptImage15EditBody extends GptImageEditBase {
  model: "gpt-image-1.5";
}

/** `model` omitted → the server defaults to gpt-image-1.5. */
export interface DefaultImageEditBody extends GptImageEditBase {
  model?: never;
}

export interface ChatgptImageLatestEditBody extends GptImageEditBase {
  model: "chatgpt-image-latest";
}

export interface GptImage2EditBody extends Omit<GptImageEditBase, "background" | "size"> {
  model: "gpt-image-2";
  /**
   * Free-form "WIDTHxHEIGHT": both edges divisible by 16, long:short ratio at
   * most 3:1, maximum edge 3840px, 655,360–8,294,400 total pixels. The
   * GptImage2Size presets autocomplete the documented rule space.
   */
  size?: GptImage2Size | null;
  /**
   * "`gpt-image-2` and `gpt-image-2-2026-04-21` do not support transparent
   * backgrounds ... use `opaque` or `auto` instead."
   */
  background?: "opaque" | "auto" | null;
  /**
   * "For `gpt-image-2`, omit this parameter; the API doesn't allow changing
   * it because the model processes every image input at high fidelity
   * automatically." — image-generation guide.
   */
  input_fidelity?: never;
}

export interface GptImage2SnapshotEditBody extends Omit<GptImage2EditBody, "model"> {
  model: "gpt-image-2-2026-04-21";
}

export interface DallE2EditBody {
  model: "dall-e-2";
  /** "you can only provide one image, and it should be a square `png` file less than 4MB". */
  image: Blob;
  prompt: string;
  mask?: Blob;
  n?: number | null;
  quality?: "auto" | "standard" | null;
  response_format?: "url" | "b64_json" | null;
  size?: "256x256" | "512x512" | "1024x1024" | null;
  user?: string;
  /** GPT image models only. */
  background?: never;
  input_fidelity?: never;
  moderation?: never;
  output_compression?: never;
  output_format?: never;
  partial_images?: never;
  stream?: never;
}

/** Escape hatch for models unmodel doesn't know yet (unknown_model warning). */
export interface UnknownImageEditModelBody<Model extends string> {
  model: FutureModelId<Model, keyof ImageEditBodyByModel>;
  image: Blob | Blob[];
  prompt: string;
  [key: string]: unknown;
}

/**
 * Closed over documented models by default. Supply a future model literal to
 * opt into the loose arm: `ImageEditBody<"gpt-image-9">`.
 */
export type ImageEditBody<FutureModel extends string = never> =
  | GptImage1EditBody
  | GptImage1MiniEditBody
  | GptImage15EditBody
  | GptImage2EditBody
  | GptImage2SnapshotEditBody
  | ChatgptImageLatestEditBody
  | DefaultImageEditBody
  | DallE2EditBody
  | UnknownImageEditModelBody<FutureModel>;

interface ImageEditBodyByModel {
  "gpt-image-1": GptImage1EditBody;
  "gpt-image-1-mini": GptImage1MiniEditBody;
  "gpt-image-1.5": GptImage15EditBody;
  "gpt-image-2": GptImage2EditBody;
  "gpt-image-2-2026-04-21": GptImage2SnapshotEditBody;
  "chatgpt-image-latest": ChatgptImageLatestEditBody;
  "dall-e-2": DallE2EditBody;
}

/** Resolves a model id literal (or absence) to its exact Tier-A arm. */
type ImageEditArm<M> = M extends keyof ImageEditBodyByModel
  ? ImageEditBodyByModel[M]
  : M extends string
    ? UnknownImageEditModelBody<M>
    : DefaultImageEditBody;

type ImageEditModelInput = keyof ImageEditBodyByModel | (string & {});
/** Runtime implementation type; the public alias stays closed by default. */
type AnyImageEditBody = ImageEditBody<string>;

// ---------------------------------------------------------------------------
// Schema — the loose union of every param any model accepts; per-model
// narrowing happens in constraints.ts (runtime) and the Tier-A arms (types).
// ---------------------------------------------------------------------------

const blobSchema = z.instanceof(Blob);

const imageEditSchema = z.looseObject({
  model: z.string().optional(),
  image: z.union([blobSchema, z.array(blobSchema).min(1, "image must contain at least one file")]),
  prompt: z.string(),
  mask: blobSchema.optional(),
  background: z.enum(["transparent", "opaque", "auto"]).nullable().optional(),
  input_fidelity: z.string().nullable().optional(),
  moderation: z.string().nullable().optional(),
  n: z.number().int().min(1).max(10).nullable().optional(),
  output_compression: z.number().min(0).max(100).nullable().optional(),
  output_format: z.string().nullable().optional(),
  partial_images: z.number().int().min(0).max(3).nullable().optional(),
  quality: z.string().nullable().optional(),
  response_format: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  stream: z.boolean().nullable().optional(),
  user: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const asBlobs = (image: unknown): Blob[] =>
  Array.isArray(image) ? image.filter((b): b is Blob => b instanceof Blob) : image instanceof Blob ? [image] : [];

/**
 * "For GPT image models ... You can provide up to 16 images." / "For
 * `dall-e-2`, you can only provide one image".
 */
function checkImageCount(
  params: AnyImageEditBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model ?? DEFAULT_IMAGE_EDIT_MODEL_ID;
  const count = asBlobs((params as { image?: unknown }).image).length;
  const max = model === "dall-e-2" ? 1 : MAX_EDIT_IMAGES;
  if (count <= max) return;
  ctx.report({
    code: "invalid_shape",
    path: ["image"],
    model,
    message: `${count} input images were provided; "${model}" accepts at most ${max}.`,
    meta: { count, limit: max, source: EDIT_DOCS },
  });
}

/** image/png → "png", image/jpeg → "jpeg". Returns undefined for unlabeled Blobs. */
function formatOf(blob: Blob): string | undefined {
  const type = blob.type.toLowerCase().split(";")[0]?.trim();
  if (type === undefined || !type.startsWith("image/")) return undefined;
  const sub = type.slice("image/".length);
  return sub === "jpg" ? "jpeg" : sub;
}

function checkUpload(
  ctx: PipelineContext,
  blob: Blob,
  rule: MediaRule,
  path: Array<string | number>,
  model: string,
): void {
  const declaration = findMediaDeclaration(ctx.options.media, path);
  reportMediaIssues(ctx, {
    kind: "image",
    rule,
    path,
    model,
    encodedBytes: blob.size,
    ...(declaration !== undefined && { declaration }),
    source: EDIT_DOCS,
  });
  // Blob bytes cannot be read synchronously, so the format claim comes from
  // the Blob's content type when it carries one (never from sniffed bytes).
  const format = formatOf(blob);
  if (format !== undefined && rule.formats !== undefined && !rule.formats.includes(format)) {
    ctx.report({
      code: "media_unsupported_format",
      path,
      model,
      message: `image is labeled "${blob.type}"; "${model}" accepts ${rule.formats.join(", ")} for this field.`,
      meta: { format, allowed: [...rule.formats], source: EDIT_DOCS },
    });
  }
}

/** Enforces the per-model upload rules on `image[]` and the `mask` PNG. */
function checkUploads(
  params: AnyImageEditBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model ?? DEFAULT_IMAGE_EDIT_MODEL_ID;
  const table: Readonly<Partial<Record<string, EndpointConstraints>>> = imagesEditConstraints;
  // Object.hasOwn: a model id like "constructor" must not resolve to an
  // inherited Object.prototype member.
  const rule = Object.hasOwn(table, model) ? table[model]?.media?.image : undefined;
  const blobs = asBlobs((params as { image?: unknown }).image);
  const isArray = Array.isArray((params as { image?: unknown }).image);
  if (rule !== undefined) {
    blobs.forEach((blob, index) => {
      checkUpload(ctx, blob, rule, isArray ? ["image", index] : ["image"], model);
    });
  }
  const mask = (params as { mask?: unknown }).mask;
  if (mask instanceof Blob) checkUpload(ctx, mask, MASK_RULE, ["mask"], model);
}

const checkPromptLimit = createPromptLimitCheck(DEFAULT_IMAGE_EDIT_MODEL_ID);

// ---------------------------------------------------------------------------
// Multipart body
// ---------------------------------------------------------------------------

/**
 * Builds the multipart body for `POST /v1/images/edits`. Arrays of images ride
 * as repeated `image[]` parts (per the reference's curl example); a single
 * Blob rides as `image`. Null values are dropped — null means "use the
 * provider default", which multipart expresses by omission.
 */
export function toFormData(params: ImageEditBody<string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (key === "image") {
      if (Array.isArray(value)) {
        for (const blob of value) form.append("image[]", blob as Blob);
      } else {
        form.append("image", value as Blob);
      }
      continue;
    }
    if (value instanceof Blob) {
      form.append(key, value);
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/**
 * The one `.toSdk("openai")` target for this endpoint — the official
 * `openai` SDK's params are wire-shaped. Derived from the `sdk` literal in
 * `finalize`; it must stay an object type with no index signature, or
 * `toSdk` would accept any string.
 */
type OpenAISdkTargets<B> = { openai: () => B };

function finalize(params: AnyImageEditBody): unknown {
  const body = { ...params };
  return toValidated(body, {
    url: IMAGES_EDITS_URL,
    method: "POST",
    // Deliberately NOT application/json: fetch must derive the multipart
    // boundary from the FormData body itself.
    headers: {},
    body: "form",
  }, {
    sdk: { openai: () => body },
  });
}

const validator = createValidator<AnyImageEditBody, unknown>({
  endpoint: "openai.imageEdit",
  schema: imageEditSchema,
  modelId: (params) => params.model ?? DEFAULT_IMAGE_EDIT_MODEL_ID,
  catalog: imagesModels,
  constraints: imagesEditConstraints,
  checks: [checkImageCount, checkUploads, checkGptImage2Size, checkPromptLimit],
  // No token/cost estimate: image cost depends on generated output tokens,
  // which are unknown before the call.
  finalize,
});

/**
 * Validates params for POST /v1/images/edits. Known models get their exact
 * per-model param surface at compile time (e.g. `input_fidelity` is a compile
 * error for gpt-image-2 and gpt-image-1-mini, `background: "transparent"` is a
 * compile error for gpt-image-2); unknown models fall back to a loose arm with
 * a runtime unknown_model warning.
 *
 * This is a multipart endpoint: the validated output's enumerable props are
 * the validated params (including the image Blobs), and the raw-fetch path is
 * `.request.url` + `toFormData(validated)` as the body — never
 * `JSON.stringify`. `.toSdk("openai")` returns the same object: the official SDK's
 * `client.images.edit()` params are wire-shaped (it builds the multipart body
 * itself, taking `image` as a file or array of files).
 */
export const imageEdit = validator as unknown as {
  <M extends ImageEditModelInput | undefined = undefined, T extends ImageEditArm<M> = ImageEditArm<M>>(
    params: T & ImageEditArm<M> & { model?: M } & ExactKeys<T, ImageEditArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, OpenAISdkTargets<T>>;
  safe<
    M extends ImageEditModelInput | undefined = undefined,
    T extends ImageEditArm<M> = ImageEditArm<M>,
  >(
    params: T & ImageEditArm<M> & { model?: M } & ExactKeys<T, ImageEditArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, OpenAISdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};
