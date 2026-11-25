/**
 * `unmodel/photoroom/types` — every `photoroom` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That
 * is pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's request shapes at compile time
 * and are sending the request yourself:
 *
 * ```ts
 * import type { ImageEditBody } from "unmodel/photoroom/types";
 *
 * const fields = {
 *   imageFile,
 *   removeBackground: false,
 *   "lighting.mode": "ai.auto",
 * } satisfies ImageEditBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`EditParams`, `SegmentParams`) — Photoroom's own words
 *   for the two routes, `/v2/edit` and `/v1/segment`;
 * - the **uniform category aliases** (`ImageEditBody`,
 *   `ImageEditRemoveBackgroundBody`) — one per endpoint address, named after
 *   the word you already type at `unmodel/photoroom` and on the CLI.
 *
 * The aliases are additions, never renames. `ImageEditBody` is `EditParams`
 * WITHOUT the five `pr-*` keys: those are request headers
 * (`PhotoroomRequestHeaders`), and a type named "body" that let them in would
 * invite sending them as form fields.
 *
 * Runtime values — validators, `toFormData`, URL constants, the field tables,
 * the models table — stay on `unmodel/photoroom`.
 *
 * Endpoints:
 *
 * - `photoroom.imageEdit` → `ImageEditBody`
 * - `photoroom.imageEditRemoveBackground` → `ImageEditRemoveBackgroundBody`
 */

import type { PhotoroomRequestHeader } from "./constants";
import type { EditParams } from "./image-edit";
import type { SegmentParams } from "./image-edit-remove-background";

export type { EditParams } from "./image-edit";

export type { SegmentParams } from "./image-edit-remove-background";

export type {
  PhotoroomEditError,
  PhotoroomRequestHeader,
  PhotoroomRequestHeaders,
  PhotoroomResponseHeader,
  PhotoroomSegmentError,
} from "./constants";

export type {
  PhotoroomFamilyNotation,
  PhotoroomFamilySpec,
  PhotoroomFieldSpec,
  PhotoroomFieldType,
} from "./field-types";

export type {
  PhotoroomEditFamilyFields,
  PhotoroomEditFixedFields,
} from "./gen/image-edit-wire.gen";

export type { PhotoroomSegmentFixedFields } from "./gen/image-edit-remove-background-wire.gen";

export type { PhotoroomModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Type aliases only: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type ImageEditBody = Omit<EditParams, PhotoroomRequestHeader>;
export type ImageEditRemoveBackgroundBody = SegmentParams;
