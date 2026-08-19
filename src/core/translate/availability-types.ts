/**
 * The contract the generated cross-provider availability tables target.
 *
 * These tables answer one question without loading any other provider's
 * catalog: *"which providers serve this model, and what do they call it?"* The
 * answer always includes the model's **home** provider as the identity target
 * — it serves its own models by definition, so `.toApi(home)` is a valid,
 * lossless retarget, and a model nobody else serves still gets a row rather
 * than degrading to the permissive `StaticApiTargetId` union.
 *
 * Model ids are not normalized across providers — the same Claude is
 * `claude-opus-5` on anthropic, `anthropic/claude-opus-5` on openrouter,
 * `anthropic.claude-opus-5` on amazon-bedrock and `claude-opus-5@default` on
 * google-vertex — so the value must be the *target's* spelling, never a
 * boolean.
 *
 * One file per provider is generated into `src/catalog/availability/<id>.gen.ts`
 * with **no aggregator index**: an index would defeat the tree-shaking that
 * motivates the per-provider layout (a consumer of `unmodel/anthropic` pays
 * ~4 KB, not the ~350 KB of the whole fleet).
 *
 * This module imports nothing from `src/providers/**` and must stay that way
 * (import-graph rule 1).
 */
import type { Modality } from "../catalog-types";

/**
 * Capabilities the target serves *less* of than the source, derived from
 * models.dev at codegen time. This is what lets `.toApi` warn about the two
 * failure modes that actually bite — a smaller context window and a lost
 * input modality — without importing the target provider's catalog.
 */
export interface AvailabilityNarrows {
  /** The target's context window. Present only when smaller than the source's. */
  context?: number;
  /** Source input modalities the target does not accept. Non-empty when present. */
  drops?: readonly Modality[];
}

/** The long form, emitted only when a bare id would lose information. */
export interface AvailabilityTarget {
  /** The target provider's own spelling of the model id. */
  id: string;
  /**
   * Endpoint id (`"<provider>.<endpoint>"`), emitted only when this model is
   * *not* on the target provider's default wire surface — e.g. google-vertex
   * serves Gemini on `generateContent` but its MaaS models on an
   * OpenAI-compatible chat surface.
   */
  endpoint?: string;
  narrows?: AvailabilityNarrows;
}

/** A bare `string` is shorthand for `{ id }` on the provider's default endpoint. */
export type AvailabilityEntry = string | AvailabilityTarget;

/** Source model id → target provider id → the target's entry. */
export type AvailabilityMap = Readonly<Record<string, Readonly<Record<string, AvailabilityEntry>>>>;

/** Normalizes either entry form to the long form. */
export function toAvailabilityTarget(entry: AvailabilityEntry): AvailabilityTarget {
  return typeof entry === "string" ? { id: entry } : entry;
}

/**
 * Looks up one (source model, target provider) pair. `Object.hasOwn` guards
 * against ids like `"constructor"` resolving to `Object.prototype` members.
 */
export function lookupAvailability(
  map: AvailabilityMap,
  modelId: string,
  target: string,
): AvailabilityTarget | undefined {
  if (!Object.hasOwn(map, modelId)) return undefined;
  const targets = map[modelId];
  if (targets === undefined || !Object.hasOwn(targets, target)) return undefined;
  const entry = targets[target];
  return entry === undefined ? undefined : toAvailabilityTarget(entry);
}
