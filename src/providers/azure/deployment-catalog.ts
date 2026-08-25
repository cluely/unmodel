/**
 * Deployment-name → catalog-row resolution, shared by every azure surface.
 *
 * Azure deployments are user-named, so the pipeline's exact catalog lookup
 * would miss e.g. "gpt-4o-2024-08-06", "gpt-5-prod" or "MAI-Image-2.5-eu".
 * This proxy routes every lookup through core's shared `resolveModelInfo`
 * semantics ("models/" strip, exact match, date-suffix strip, longest
 * "-"/"." boundary prefix); names that still don't resolve surface as
 * `unknown_model` warnings and model-dependent checks are skipped.
 */
import { resolveModelInfo } from "../../core/catalog-lookup";
import type { ModelInfo } from "../../core/catalog-types";

/**
 * Wraps a catalog keyed by canonical model ids so that user-chosen deployment
 * names resolve best-effort against it.
 */
export function createDeploymentCatalog(
  models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
  return new Proxy(models, {
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
  });
}
