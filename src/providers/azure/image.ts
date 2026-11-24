/**
 * Azure MAI image generation — POST {endpoint}/mai/v1/images/generations
 *
 * This is Microsoft Foundry's `/mai/` surface, NOT the /openai/ images
 * dialect. Wire notes (verified 2026-08-24 against
 * https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image
 * — endpoint form, request-parameter table, pixel rules — cross-checked with
 * https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
 * whose per-model rows list the parameters verbatim: `width`, `height`,
 * `prompt`):
 *
 * - The documented body is `model`, `prompt`, `width`, `height`, and
 *   `background` for transparent output on the MAI Image 2.7 family.
 *   There is NO `n` ("Output: One image"), no `size`/`quality`/`style`, and no
 *   `output_format`/`response_format` — "The output format is always PNG",
 *   returned as base64 in `data[0].b64_json`.
 * - `model` is the **user-chosen deployment name** ("The deployment name you
 *   assigned when you deployed the model"), not a canonical model id — same
 *   as azure chat. Catalog matching is best-effort via the deployment-catalog
 *   proxy; unrelated custom names get an `unknown_model` warning.
 * - `width` and `height` are integers, with a minimum of 768 per side and a
 *   per-model pixel cap. The docs
 *   mark no default and no required flag; every example passes both, so they
 *   are typed optional here and range-checked when present.
 * - No `api-version` query parameter appears anywhere in the MAI docs, so the
 *   URL takes none (unlike the /openai/ chat route, where it is optional).
 * - Auth is your job (unmodel never touches keys): an `api-key: <key>` header,
 *   or `authorization: Bearer <token>` with a Microsoft Entra ID token scoped
 *   to `https://cognitiveservices.azure.com/.default`.
 *
 * ```ts
 * const azure = createAzure({ endpoint: "https://my-resource.services.ai.azure.com" });
 * const params = azure.image({ model: "my-mai-deployment", prompt: "a poster", width: 1024, height: 1024 });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "api-key": process.env.AZURE_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * ```
 */

import { z } from "zod";
import { createValidator, type PipelineContext } from "../../core/pipeline";
import { toValidated, JSON_HEADERS, trimTrailingSlashes, type Validated, type ExactKeys } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { ModelInfo } from "../../core/catalog-types";
import type { EndpointConstraints } from "../../core/constraint-types";
import { createDeploymentCatalog } from "./deployment-catalog";
import {
  MAI_IMAGE_DOCS,
  MAI_IMAGE_MIN_DIMENSION,
  MAI_IMAGE_MAX_TOTAL_PIXELS,
  MAI_IMAGE_2_7_MAX_TOTAL_PIXELS,
  maiImageModels,
  type AzureMaiImageModelId,
} from "./mai-image-models";

/**
 * `{endpoint}/mai/v1/images/generations` for an Azure resource endpoint
 * (`https://<resource>.services.ai.azure.com`). The MAI surface documents no
 * `api-version` query parameter, so none is taken.
 */
export function azureMaiImagesGenerationsUrl(endpoint: string): string {
  return `${trimTrailingSlashes(endpoint)}/mai/v1/images/generations`;
}

/**
 * The documented body of `POST /mai/v1/images/generations` — see the module
 * JSDoc for why there is no `n`, `size`, `quality` or `response_format`.
 */
export interface MaiImagesGenerationsBody {
  /**
   * The **deployment name** you assigned when you deployed the model — the
   * canonical MAI names autocomplete, but any deployment name is legal.
   */
  model: AzureMaiImageModelId | (string & {});
  /**
   * "The text prompt that describes the image to generate ... Maximum context
   * length: 32,000 tokens." (a token cap — not pre-checked, see
   * MAI_IMAGE_PROMPT_MAX_TOKENS).
   */
  prompt: string;
  /**
   * Width of the output image in pixels. Integer, minimum 768;
   * The product cap depends on the deployed model.
   */
  width?: number;
  /**
   * Height of the output image in pixels. Integer, minimum 768;
   * The product cap depends on the deployed model.
   */
  height?: number;
  /** Foundry documents transparent background generation for MAI Image 2.7. */
  background?: "transparent" | (string & {});
}

const imageSchema = z.looseObject({
  model: z.string(),
  prompt: z.string(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  background: z.string().optional(),
});

/**
 * Check each present dimension. Check the product when both dimensions and
 * the deployment model are known.
 */
export function checkMaiDimensions(
  params: { model?: string; width?: unknown; height?: unknown },
  info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = typeof params.model === "string" ? params.model : undefined;
  const report = (path: string[], message: string, meta: Record<string, unknown>): void => {
    ctx.report({
      code: "invalid_shape",
      path,
      ...(model !== undefined && { model }),
      message,
      meta: { ...meta, source: MAI_IMAGE_DOCS },
    });
  };

  for (const key of ["width", "height"] as const) {
    const value = params[key];
    if (typeof value !== "number" || !Number.isInteger(value)) continue; // layer 1's job
    if (value < MAI_IMAGE_MIN_DIMENSION) {
      report(
        [key],
        `\`${key}\` is ${value}; the MAI image APIs require at least ${MAI_IMAGE_MIN_DIMENSION} pixels per dimension.`,
        { value, min: MAI_IMAGE_MIN_DIMENSION },
      );
    }
  }

  const { width, height } = params;
  if (
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isInteger(width) &&
    Number.isInteger(height)
  ) {
    const pixels = width * height;
    const maxPixels = info?.id === "MAI-Image-2.7" || info?.id === "MAI-Image-2.7-Flash"
      ? MAI_IMAGE_2_7_MAX_TOTAL_PIXELS
      : MAI_IMAGE_MAX_TOTAL_PIXELS;
    if (info !== undefined && pixels > maxPixels) {
      report(
        ["width"],
        `\`width\` × \`height\` is ${pixels.toLocaleString("en-US")} pixels; the MAI image APIs cap the total at ${maxPixels.toLocaleString("en-US")} for this model.`,
        { width, height, pixels, maxPixels },
      );
    }
  }
}

/**
 * The one `.toSdk("azure")` target for this endpoint — Microsoft documents the
 * /mai/ surface as raw REST (no official SDK models it), so this is the wire
 * body. Derived from the `sdk` literal in `finalize`; it must stay an object
 * type with no index signature, or `toSdk` would accept any string.
 */
type AzureMaiSdkTargets<B> = { azure: () => B };

/** The validator surface `createAzure` binds to one resource endpoint. */
export interface AzureMaiImage {
  <T extends MaiImagesGenerationsBody>(
    params: T & ExactKeys<T, MaiImagesGenerationsBody>,
    options?: ValidateOptions<T>,
  ): Validated<T, AzureMaiSdkTargets<T>>;
  safe<T extends MaiImagesGenerationsBody>(
    params: T & ExactKeys<T, MaiImagesGenerationsBody>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, AzureMaiSdkTargets<T>>>;
  constraintsFor(modelId: string): EndpointConstraints[];
}

/**
 * Builds the MAI image-generations validator for one Azure resource endpoint.
 * `createAzure` calls this; it is exported for callers who want the image
 * surface without the chat one.
 *
 * No cost estimate: MAI image billing is token-based with no published
 * per-image USD rate on learn.microsoft.com (see mai-image-models.ts), so an
 * estimate would be a guess.
 */
export function createMaiImage(endpoint: string): AzureMaiImage {
  const url = azureMaiImagesGenerationsUrl(endpoint);
  const validator = createValidator<MaiImagesGenerationsBody, unknown>({
    endpoint: "azure.image",
    schema: imageSchema,
    modelId: (params) => params.model,
    catalog: createDeploymentCatalog(maiImageModels),
    checks: [checkMaiDimensions],
    finalize: (params) => {
      const body = { ...params };
      return toValidated(body, { url, method: "POST", headers: JSON_HEADERS }, {
        sdk: { azure: () => body },
      });
    },
  });
  return validator as unknown as AzureMaiImage;
}
