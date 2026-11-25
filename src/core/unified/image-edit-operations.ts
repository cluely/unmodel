/**
 * Which `unmodel/image-edit` operation a model serves, read at run time from
 * the same `modelParams` row the types read.
 *
 * Its own module rather than a section of `./derive.ts`, and the reason is
 * bytes: `derive.ts` is one chunk in the graph of all fourteen media packs, so
 * a helper there is paid for by `unmodel/tts` and `unmodel/voice-design`, which
 * can never call it. Measured: placed there, the two functions below cost
 * every pack 1.6 KiB; here they cost nothing outside the image-edit adapters
 * that import this file.
 */
import { resolveOperation, type DeriveContext } from "./derive";
import type { Derived } from "./types";
import type {
  ImageEditModelParamTable,
  ImageEditOperation,
  ImageEditOperationOf,
} from "./vocabulary/image-edit";

/** What an image-edit row means when it does not say: a prompted edit. */
const DEFAULT_IMAGE_EDIT_OPERATIONS: readonly ImageEditOperation[] = Object.freeze(["edit"]);

/**
 * The operations one model serves, read from its `modelParams` row.
 *
 * The runtime twin of `ImageEditOperationOf`, and the only place "absent means
 * `["edit"]`" is spelled as a value. A model the table does not list gets every
 * operation any row on the adapter serves: the kernel has already said
 * `unknown_model`, model-dependent checks are skipped, and a model released
 * after this snapshot must stay callable for whichever operation it does.
 * An adapter whose ids are unmodel's own handles for routes (Photoroom,
 * Stability) has no such model to wait for and refuses the id itself.
 */
export function imageEditOperations(
  table: ImageEditModelParamTable,
  model: string,
): readonly ImageEditOperation[] {
  const row = Object.hasOwn(table, model) ? table[model] : undefined;
  if (row !== undefined) return row.operations ?? DEFAULT_IMAGE_EDIT_OPERATIONS;
  const served = new Set<ImageEditOperation>();
  for (const each of Object.values(table)) {
    for (const operation of each.operations ?? DEFAULT_IMAGE_EDIT_OPERATIONS) served.add(operation);
  }
  return [...served];
}

/**
 * {@link resolveOperation} against the model's own row — for an adapter whose
 * models do not all serve the same operation, or do not serve `"edit"`.
 *
 * One table, two enforcement points, the way `imageInputs` works: the
 * `operations` a row declares type the caller's `operation` at that ref
 * (`ImageEditOperationArms`) and are what this refuses at run time, so the two
 * cannot disagree.
 */
export function resolveImageEditOperation<T extends ImageEditModelParamTable>(
  operation: unknown,
  table: T,
  model: string,
  ctx: DeriveContext,
  options: { hint?: string; source?: string } = {},
): Derived<ImageEditOperationOf<T[keyof T]>> {
  return resolveOperation(
    operation,
    imageEditOperations(table, model) as readonly ImageEditOperationOf<T[keyof T]>[],
    ctx,
    options,
  );
}
