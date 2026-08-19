import type { ModelInfo } from "./catalog-types";

/**
 * Resolves a model id against a provider catalog with one unified set of
 * semantics (shared by every provider — request-side validation and
 * response-side reporting alike):
 *
 * 1. a leading `"models/"` prefix is stripped (google's REST form);
 * 2. exact catalog match;
 * 3. a trailing date suffix (`-YYYY-MM-DD` or `-YYYYMMDD`) is stripped and
 *    the exact match retried (dated snapshots like "gpt-5.2-2026-01-15" or
 *    "claude-opus-4-6-20260204");
 * 4. fall back to the LONGEST catalog id `p` such that the id is `p` or
 *    extends it across a `"-"` or `"."` boundary (covers previews like
 *    "gemini-2.5-flash-preview-05-20" and dotted snapshots).
 *
 * Returns undefined when nothing in the catalog plausibly matches.
 */
export function resolveModelInfo(
  catalog: Record<string, ModelInfo>,
  modelId: string,
): ModelInfo | undefined {
  const id = modelId.startsWith("models/") ? modelId.slice("models/".length) : modelId;

  // Object.hasOwn: ids like "constructor" must not resolve to inherited
  // Object.prototype members.
  if (Object.hasOwn(catalog, id)) return catalog[id];

  const dateless = id.replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, "");
  if (dateless !== id && Object.hasOwn(catalog, dateless)) {
    return catalog[dateless];
  }

  let bestKey: string | undefined;
  for (const key of Object.keys(catalog)) {
    if (id !== key && !id.startsWith(`${key}-`) && !id.startsWith(`${key}.`)) continue;
    if (bestKey === undefined || key.length > bestKey.length) bestKey = key;
  }
  return bestKey === undefined ? undefined : catalog[bestKey];
}
