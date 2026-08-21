/**
 * unmodel/azure — Azure OpenAI (Microsoft Foundry Models) Chat Completions.
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
import { resolveModelInfo } from "../../core/catalog-lookup";
import type { ModelInfo } from "../../core/catalog-types";
import { models, provider } from "../../catalog/azure.gen";
import type { AzureTextModelId } from "../../catalog/azure.gen";

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

/** The standard validator surface, bound to one Azure resource endpoint. */
export type AzureProvider = OpenAICompatibleProvider<AzureTextModelId>;

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
 * would miss e.g. "gpt-4o-2024-08-06" or "gpt-5-prod". This proxy routes
 * every lookup through core's shared `resolveModelInfo` semantics ("models/"
 * strip, exact match, date-suffix strip, longest "-"/"." boundary prefix);
 * names that still don't resolve surface as `unknown_model` warnings.
 */
const deploymentCatalog: Record<string, ModelInfo> = new Proxy(
  models as Record<string, ModelInfo>,
  {
    get: (target, prop, receiver) =>
      typeof prop === "string" ? resolveModelInfo(target, prop) : Reflect.get(target, prop, receiver),
    // The pipeline guards lookups with Object.hasOwn (prototype-pollution
    // safety), so ownership must be claimed for every resolvable deployment
    // name. resolveModelInfo itself hasOwn-guards, so ids like "constructor"
    // still report absent.
    has: (target, prop) =>
      typeof prop === "string" ? resolveModelInfo(target, prop) !== undefined : Reflect.has(target, prop),
    getOwnPropertyDescriptor: (target, prop) => {
      if (typeof prop !== "string") return Reflect.getOwnPropertyDescriptor(target, prop);
      const info = resolveModelInfo(target, prop);
      if (info === undefined) return undefined;
      return { value: info, enumerable: true, configurable: true, writable: false };
    },
  },
);

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
  return createOpenAICompatible<AzureTextModelId, never, "azure">({
    id: provider.id,
    chatUrl: azureChatCompletionsUrl(config.endpoint, config.apiVersion),
    catalog: deploymentCatalog,
  });
}

export { models, provider };
export type {
  AzureModelId,
  AzureTextModelId,
  AzureImageModelId,
  AzureAudioModelId,
  AzureVideoModelId,
} from "../../catalog/azure.gen";
