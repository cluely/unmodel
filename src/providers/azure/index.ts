/**
 * unmodel/azure — Azure OpenAI (Microsoft Foundry Models) Chat Completions,
 * plus Microsoft Foundry's MAI image surface (`azure.image` /
 * `azure.imageEdit` on `POST {endpoint}/mai/v1/images/...` — see ./image.ts
 * and ./image-edit.ts for those wire notes).
 *
 * The wire body is the standard OpenAI Chat Completions dialect; what differs
 * from other OpenAI-compatible providers is the URL and the meaning of
 * `model`:
 *
 * - URL — there is no provider-wide static URL: every Azure resource has its
 *   own endpoint. This module targets the **v1 API** (GA since August 2025):
 *   `POST {endpoint}/openai/v1/chat/completions`, where `{endpoint}` is
 *   `https://{resource}.openai.azure.com` or
 *   `https://{resource}.services.ai.azure.com`. No `api-version` query
 *   parameter is required on the v1 GA surface.
 *   Source: https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle
 *   (checked 2026-08-13).
 *
 *   The older deployment-scoped route
 *   `POST {endpoint}/openai/deployments/{deployment}/chat/completions?api-version=YYYY-MM-DD`
 *   (last dated GA data-plane release: `2024-10-21`;
 *   https://learn.microsoft.com/en-us/azure/foundry/openai/reference) still
 *   works but is superseded by the v1 route and is not modeled here — on v1
 *   the deployment name rides in the body's `model` field instead of the path.
 *
 * - `model` — on Azure this is the **user-chosen deployment name**, not a
 *   canonical model id. Catalog matching is therefore best-effort via
 *   `resolveModelInfo`: deployments named after the underlying model
 *   ("gpt-4o", "gpt-5-prod", "o3-mini-2025-01-31") resolve to catalog info
 *   and get the full model-dependent checks; deployments with unrelated
 *   custom names get an `unknown_model` warning and model-dependent checks
 *   are skipped.
 *
 * Auth is your job (unmodel never touches keys): add an
 * `api-key: <AZURE_OPENAI_API_KEY>` header, or `authorization: Bearer <token>`
 * with a Microsoft Entra ID token.
 *
 * ```ts
 * const azure = createAzure({ endpoint: "https://my-resource.openai.azure.com" });
 * const params = azure.chat({ model: "my-gpt5-deployment", messages: [{ role: "user", content: "hi" }] });
 * await fetch(params.request.url, {
 *   method: params.request.method,
 *   headers: { ...params.request.headers, "api-key": process.env.AZURE_OPENAI_API_KEY! },
 *   body: JSON.stringify(params),
 * });
 * ```
 */
import { createOpenAICompatible, type OpenAICompatibleProvider } from "../openai-compatible";
import { models, provider } from "../../catalog/azure.gen";
import type { AzureTextModelId } from "../../catalog/azure.gen";
import { createDeploymentCatalog } from "./deployment-catalog";
import { azureMaiImagesGenerationsUrl, createMaiImage, type AzureMaiImage } from "./image";
import { azureMaiImagesEditsUrl, createMaiImageEdit, type AzureMaiImageEdit } from "./image-edit";

export interface AzureConfig {
  /**
   * The resource endpoint (protocol + hostname), e.g.
   * "https://my-resource.openai.azure.com" or
   * "https://my-resource.services.ai.azure.com". A trailing slash is
   * tolerated.
   */
  endpoint: string;
  /**
   * Optional `api-version` query parameter. Not required on the v1 GA
   * surface; omit it unless you need a specific value.
   */
  apiVersion?: string;
}

/**
 * The standard validator surface, bound to one Azure resource endpoint: the
 * OpenAI-compatible chat overlay, plus the Microsoft Foundry **MAI image**
 * surface (`POST {endpoint}/mai/v1/images/generations` and
 * `POST {endpoint}/mai/v1/images/edits` — see ./image.ts and ./image-edit.ts).
 * `model` on every surface is the user-chosen deployment name.
 */
export interface AzureProvider extends OpenAICompatibleProvider<AzureTextModelId> {
  /**
   * Validates params for POST {endpoint}/mai/v1/images/generations (the MAI
   * image models: MAI-Image-2.5 family and MAI-Image-2e). JSON endpoint.
   */
  image: AzureMaiImage;
  /** {endpoint}/mai/v1/images/generations. */
  imageUrl: string;
  /**
   * Validates params for POST {endpoint}/mai/v1/images/edits (2.5 family
   * only — MAI-Image-2e is text-to-image only). Multipart endpoint: send
   * `toMaiEditFormData(validated)` as the fetch body, never JSON.
   */
  imageEdit: AzureMaiImageEdit;
  /** {endpoint}/mai/v1/images/edits. */
  imageEditUrl: string;
}

/**
 * v1-route chat completions URL for an Azure resource endpoint:
 * `{endpoint}/openai/v1/chat/completions[?api-version=...]`.
 */
export function azureChatCompletionsUrl(endpoint: string, apiVersion?: string): string {
  const url = `${endpoint.replace(/\/+$/, "")}/openai/v1/chat/completions`;
  return apiVersion === undefined ? url : `${url}?api-version=${encodeURIComponent(apiVersion)}`;
}

/**
 * Azure deployments are user-named, so the pipeline's exact catalog lookup
 * would miss e.g. "gpt-4o-2024-08-06" or "gpt-5-prod". The proxy (shared with
 * the MAI image surfaces — see ./deployment-catalog.ts) routes every lookup
 * through core's shared `resolveModelInfo` semantics ("models/" strip, exact
 * match, date-suffix strip, longest "-"/"." boundary prefix); names that
 * still don't resolve surface as `unknown_model` warnings.
 */
const deploymentCatalog = createDeploymentCatalog(models);

/**
 * Creates a validator surface bound to one Azure resource. See the module
 * JSDoc for URL/auth/deployment-name semantics.
 *
 * No hand-written constraint tables are wired in: Azure constraint rules
 * would have to be keyed by model id, but requests carry user-chosen
 * deployment names, so no doc-verifiable per-model quirk table can apply
 * reliably. Catalog-driven checks (capabilities, modalities, output limits,
 * context, cost) still run whenever the deployment name resolves.
 *
 * For the same reason there is **no `.toApi(provider)` here**, even though
 * `src/catalog/availability/azure.gen.ts` exists: cross-provider availability
 * is keyed by catalog model id, and `model` on Azure is a deployment name the
 * generated table cannot know. (Azure is also excluded as a `.toApi`
 * *destination* — it has no provider-wide URL.) `.toSdk("openai")` is
 * available, since the wire body is the standard chat-completions dialect.
 */
export function createAzure(config: AzureConfig): AzureProvider {
  const chat = createOpenAICompatible<AzureTextModelId, never, "azure">({
    id: provider.id,
    chatUrl: azureChatCompletionsUrl(config.endpoint, config.apiVersion),
    catalog: deploymentCatalog,
  });
  // The MAI image surfaces take no api-version: the /mai/v1 docs show none
  // (config.apiVersion applies to the /openai/v1 chat route only).
  return {
    ...chat,
    image: createMaiImage(config.endpoint),
    imageUrl: azureMaiImagesGenerationsUrl(config.endpoint),
    imageEdit: createMaiImageEdit(config.endpoint),
    imageEditUrl: azureMaiImagesEditsUrl(config.endpoint),
  };
}

export { models, provider };
export { azureMaiImagesGenerationsUrl, createMaiImage } from "./image";
export { azureMaiImagesEditsUrl, createMaiImageEdit, toMaiEditFormData } from "./image-edit";
export {
  maiImageModels,
  MAI_IMAGE_MODEL_IDS,
  MAI_IMAGE_EDIT_MODEL_IDS,
  MAI_IMAGE_MIN_DIMENSION,
  MAI_IMAGE_MAX_TOTAL_PIXELS,
  MAI_IMAGE_PROMPT_MAX_TOKENS,
} from "./mai-image-models";
export type { AzureMaiImageModelId, AzureMaiImageEditModelId } from "./mai-image-models";
export type { MaiImagesGenerationsBody, AzureMaiImage } from "./image";
export type { MaiImagesEditsBody, AzureMaiImageEdit } from "./image-edit";
export type {
  AzureModelId,
  AzureTextModelId,
  AzureImageModelId,
  AzureAudioModelId,
  AzureVideoModelId,
} from "../../catalog/azure.gen";
