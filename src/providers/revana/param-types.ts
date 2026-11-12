/**
 * The types of the per-model UNIFIED rows `scripts/codegen-revana.ts` emits —
 * `gen/<category>-params.gen.ts`, one per category pack that addresses
 * `revana/<model>`.
 *
 * Type-only, and a separate file from `./shape-types.ts` on purpose: those are
 * the WIRE rows (what a model takes on `POST /v1/generations`) and
 * `unmodel/revana/types` republishes them, while these are the rows the
 * canonical vocabulary reads and they name the kernel's own row types. Keeping
 * the two apart keeps the kernel's vocabulary out of the provider's types
 * entry.
 *
 * Six of the eight categories need nothing here: their generated tables are
 * the kernel's own row types (`TtsModelParams`, `UpscaleModelParams`, …)
 * verbatim. The two below each add one key — the map from a canonical size
 * word to the spelling Revana's catalog lists.
 */

import type { ResolutionTier, VideoResolution } from "../../core/unified/vocabulary/common";
import type { ModelParams, VideoModelParams } from "../../core/unified/vocabulary/model-params";

/**
 * One video model's row.
 *
 * `resolutionWire` is ABSENT when the catalog lists no `resolutions` for the
 * model — "<id> takes no input.resolution." — and may be EMPTY when it lists
 * some and none is a canonical tier (`draft`, `hd`, `fhd`).
 */
export interface RevanaVideoParamRow extends VideoModelParams {
  /** Canonical tier → the catalog's spelling of it (`"4k"` → `"4K"`). */
  readonly resolutionWire?: Readonly<Partial<Record<VideoResolution, string>>>;
}

/** One picture model's row. `tierWire` follows {@link RevanaVideoParamRow.resolutionWire}'s two rules. */
export interface RevanaImageParamRow extends ModelParams {
  /** Canonical tier → the catalog's spelling of it (`"2k"` → `"2K"`). */
  readonly tierWire?: Readonly<Partial<Record<ResolutionTier, string>>>;
}
