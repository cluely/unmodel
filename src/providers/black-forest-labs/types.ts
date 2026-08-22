/**
 * `unmodel/black-forest-labs/types` — every `black-forest-labs` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That
 * is pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — with `fetch`, with the
 * vendor SDK, or through your own client:
 *
 * ```ts
 * import type { ImageBody } from "unmodel/black-forest-labs/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies ImageBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`Flux2Body`, `Flux2ProBody`, `Flux2MaxBody`, …) —
 *   re-exported verbatim, because they are how you find the endpoint in the
 *   provider's own documentation;
 * - the **uniform category aliases** (`ImageBody`, `ImageEditBody`,
 *   `ImageEditDeblurBody`, …) — one per endpoint address this provider
 *   serves, named after the word you already type at
 *   `unmodel/black-forest-labs` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/black-forest-labs`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `black-forest-labs.image` → `ImageBody`
 * - `black-forest-labs.imageEdit` → `ImageEditBody`
 * - `black-forest-labs.imageEditDeblur` → `ImageEditDeblurBody`
 * - `black-forest-labs.imageEditErase` → `ImageEditEraseBody`
 * - `black-forest-labs.imageEditExpand` → `ImageEditExpandBody`
 * - `black-forest-labs.imageEditFill` → `ImageEditFillBody`
 * - `black-forest-labs.imageEditOutpainting` → `ImageEditOutpaintingBody`
 * - `black-forest-labs.imageEditVto` → `ImageEditVtoBody`
 * - `black-forest-labs.imageFlux1` → `ImageFlux1Body`
 */

import type { Flux2Body } from "./image";
import type { FluxKontextParams } from "./image-edit";
import type {
  FluxDeblurParams,
  FluxEraseParams,
  FluxOutpaintingParams,
  FluxVtoParams,
} from "./image-edit-tools";
import type { FluxExpandParams, FluxFillParams } from "./image-edit-flux1";
import type { Flux1Body } from "./image-flux1";

export type {
  Flux2Body,
  Flux2ProBody,
  Flux2MaxBody,
  Flux2ProPreviewBody,
  Flux2FlexBody,
  Flux2Klein9bBody,
  Flux2Klein9bPreviewBody,
  Flux2Klein4bBody,
  UnknownFlux2ModelBody,
  BflOutputFormat,
} from "./image";

export type { FluxKontextParams } from "./image-edit";

export type { BflAspectRatio } from "./aspect";

export type {
  Flux1Body,
  FluxPro11Body,
  FluxDevBody,
  FluxUltraBody,
  FluxUltraFinetunedBody,
  UnknownFlux1ModelBody,
} from "./image-flux1";

export type {
  FluxFillParams,
  FluxFillBody,
  FluxFillFinetunedBody,
  UnknownFluxFillBody,
  FluxExpandParams,
} from "./image-edit-flux1";

export type {
  FluxOutpaintingParams,
  FluxOutpaintingMode,
  FluxEraseParams,
  FluxDeblurParams,
  FluxVtoParams,
} from "./image-edit-tools";

export type {
  BflModelId,
  BflFlux2ModelId,
  BflKontextModelId,
  BflFlux1ModelId,
  BflFlux1EditModelId,
  BflFluxToolsModelId,
} from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageBody<FutureModel extends string = never> = Flux2Body<FutureModel>;
export type ImageEditBody = FluxKontextParams;
export type ImageEditDeblurBody = FluxDeblurParams;
export type ImageEditEraseBody = FluxEraseParams;
export type ImageEditExpandBody = FluxExpandParams;
export type ImageEditFillBody<FutureModel extends string = never> = FluxFillParams<FutureModel>;
export type ImageEditOutpaintingBody = FluxOutpaintingParams;
export type ImageEditVtoBody = FluxVtoParams;
export type ImageFlux1Body<FutureModel extends string = never> = Flux1Body<FutureModel>;
