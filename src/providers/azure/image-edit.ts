/**
 * Azure MAI image editing — POST {endpoint}/mai/v1/images/edits (multipart)
 *
 * This is Microsoft Foundry's `/mai/` surface, NOT the /openai/ images
 * dialect. Wire notes (verified 2026-08-24 against
 * https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image
 * — "Requests for image-to-image edits use **multipart form data**", the
 * request-parameter table, and both the Python and curl examples — cross-checked
 * with the per-model capability rows on
 * https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure):
 *
 * - The documented multipart fields are exactly `model`, `prompt` and `image`
 *   — ONE image part, singular (`-F "image=@/path/to/your/image.png"`), "Must
 *   be in JPEG or PNG format". There is NO `mask`, no repeated `image[]`
 *   parts, no `n`, and no `width`/`height` (the parameter table scopes those
 *   to "Image generations" only). Output is always a PNG, returned as base64
 *   in `data[0].b64_json`.
 * - `model` is the **user-chosen deployment name**, same as azure chat and
 *   `azure.image`; catalog matching is best-effort via the deployment proxy.
 * - Edits are a 2.5-family capability: `MAI-Image-2.5`, `MAI-Image-2.5-Pro`
 *   and `MAI-Image-2.5-Flash` support them; `MAI-Image-2e` is text-to-image
 *   only, so a deployment that resolves to it is refused here.
 * - This is a multipart endpoint: the validated output's enumerable props are
 *   the validated params (including the image Blob) — do NOT JSON.stringify
 *   them. The raw-fetch path is `.request.url` + `toMaiEditFormData(validated)`
 *   as the body; fetch derives the multipart content-type (with boundary) from
 *   the FormData, which is why `.request.headers` is empty.
 * - Auth is your job: an `api-key: <key>` header, or `authorization: Bearer
 *   <token>` with a Microsoft Entra ID token.
 *
 * ```ts
 * const azure = createAzure({ endpoint: "https://my-resource.services.ai.azure.com" });
 * const params = azure.imageEdit({
 *   model: "my-mai-deployment",
 *   prompt: "Turn this into a clean product shot",
 *   image: new Blob([bytes], { type: "image/png" }),
 * });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { "api-key": process.env.AZURE_API_KEY! },
 *   body: toMaiEditFormData(params),
 * });
 * ```
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, type ValidatedForm, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { createDeploymentCatalog } from "./deployment-catalog";
import {
  MAI_IMAGE_DOCS,
  MAI_IMAGE_EDIT_MODEL_IDS,
  maiImageModels,
  type AzureMaiImageEditModelId,
} from "./mai-image-models";

/**
 * `{endpoint}/mai/v1/images/edits` for an Azure resource endpoint
 * (`https://<resource>.services.ai.azure.com`). The MAI surface documents no
 * `api-version` query parameter, so none is taken.
 */
export function azureMaiImagesEditsUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/mai/v1/images/edits`;
}

/** "Must be in JPEG or PNG format." — the edits `image` field. */
export const MAI_IMAGE_EDIT_FORMATS = ["jpeg", "png"] as const;

/**
 * The documented multipart fields of `POST /mai/v1/images/edits` — see the
 * module JSDoc for why there is no `mask`, `image[]`, `n` or `width`/`height`.
 */
export interface MaiImagesEditsBody {
  /**
   * The **deployment name** you assigned when you deployed the model. The
   * edit-capable canonical names (the 2.5 family) autocomplete; any deployment
   * name is legal, but one that resolves to `MAI-Image-2e` is refused —
   * that model is text-to-image only.
   */
  model: AzureMaiImageEditModelId | (string & {});
  /** "The text prompt that describes the ... edits to make." Max 32,000 tokens. */
  prompt: string;
  /**
   * The image to edit — ONE part, "Must be in JPEG or PNG format". Rides as
   * the multipart `image` field.
   */
  image: Blob;
}

const imageEditSchema = z.looseObject({
  model: z.string(),
  prompt: z.string(),
  image: z.instanceof(Blob),
});

/**
 * Edits are documented for the 2.5 family only; a deployment resolving to
 * `MAI-Image-2e` (whose type is "Text-to-image generation", with no
 * image-to-image row) gets a hard refusal here rather than the service's 400.
 */
function checkEditCapableModel(
  params: MaiImagesEditsBody,
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  if (info === undefined) return; // unknown deployment name — already warned
  if ((MAI_IMAGE_EDIT_MODEL_IDS as readonly string[]).includes(info.id)) return;
  ctx.report({
    code: "unsupported_capability",
    path: ["model"],
    model: params.model,
    message: `deployment "${params.model}" resolves to "${info.id}", which is text-to-image only — the MAI docs list image-to-image edits for ${MAI_IMAGE_EDIT_MODEL_IDS.join(", ")} but not for it. Use \`azure.image\` (POST /mai/v1/images/generations) with this deployment, or deploy a 2.5-family model for edits.`,
    meta: { resolved: info.id, editCapable: [...MAI_IMAGE_EDIT_MODEL_IDS], source: MAI_IMAGE_DOCS },
  });
}

/** image/png → "png", image/jpeg → "jpeg". Returns undefined for unlabeled Blobs. */
function formatOf(blob: Blob): string | undefined {
  const type = blob.type.toLowerCase().split(";")[0]?.trim();
  if (type === undefined || !type.startsWith("image/")) return undefined;
  const sub = type.slice("image/".length);
  return sub === "jpg" ? "jpeg" : sub;
}

/**
 * "Must be in JPEG or PNG format." Blob bytes cannot be read synchronously,
 * so the format claim comes from the Blob's content type when it carries one
 * (never from sniffed bytes); an unlabeled Blob makes no claim and passes.
 */
function checkImageFormat(
  params: MaiImagesEditsBody,
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const image = (params as { image?: unknown }).image;
  if (!(image instanceof Blob)) return; // layer 1's job
  const format = formatOf(image);
  if (format === undefined || (MAI_IMAGE_EDIT_FORMATS as readonly string[]).includes(format)) return;
  ctx.report({
    code: "media_unsupported_format",
    path: ["image"],
    model: params.model,
    message: `image is labeled "${image.type}"; the MAI image edits API accepts ${MAI_IMAGE_EDIT_FORMATS.join(", ")}.`,
    meta: { format, allowed: [...MAI_IMAGE_EDIT_FORMATS], source: MAI_IMAGE_DOCS },
  });
}

/**
 * Builds the multipart body for `POST /mai/v1/images/edits`: `model` and
 * `prompt` as string parts, the image Blob as the single `image` part (per the
 * reference's curl example). Nullish values are dropped — omission is how
 * multipart spells "use the provider default".
 */
export function toMaiEditFormData(params: MaiImagesEditsBody): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (value instanceof Blob) {
      form.append(key, value);
      continue;
    }
    form.append(key, String(value));
  }
  return form;
}

/**
 * The one `.toSdk("azure")` target for this endpoint — Microsoft documents the
 * /mai/ surface as raw REST (no official SDK models it), so this is the wire
 * params object. Derived from the `sdk` literal in `finalize`; it must stay an
 * object type with no index signature, or `toSdk` would accept any string.
 */
type AzureMaiSdkTargets<B> = { azure: () => B };

/** The validator surface `createAzure` binds to one resource endpoint. */
export interface AzureMaiImageEdit {
  <T extends MaiImagesEditsBody>(
    params: T & ExactKeys<T, MaiImagesEditsBody>,
    options?: ValidateOptions<T>,
  ): ValidatedForm<T, AzureMaiSdkTargets<T>>;
  safe<T extends MaiImagesEditsBody>(
    params: T & ExactKeys<T, MaiImagesEditsBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<ValidatedForm<T, AzureMaiSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * Builds the MAI image-edits validator for one Azure resource endpoint.
 * `createAzure` calls this; it is exported for callers who want the edit
 * surface alone.
 *
 * No cost estimate, for the reason `createMaiImage` documents.
 */
export function createMaiImageEdit(endpoint: string): AzureMaiImageEdit {
  const url = azureMaiImagesEditsUrl(endpoint);
  const validator = createValidator<MaiImagesEditsBody, unknown>({
    endpoint: "azure.imageEdit",
    schema: imageEditSchema,
    modelId: (params) => params.model,
    catalog: createDeploymentCatalog(maiImageModels),
    checks: [checkEditCapableModel, checkImageFormat],
    finalize: (params) => {
      const body = { ...params };
      return toValidated(body, {
        url,
        method: "POST",
        // Deliberately NOT application/json: fetch must derive the multipart
        // boundary from the FormData body itself.
        headers: {},
        body: "form",
      }, {
        sdk: { azure: () => body },
      });
    },
  });
  return validator as unknown as AzureMaiImageEdit;
}
