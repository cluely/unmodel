/**
 * `unmodel/tripo3d/values` — the **runtime** lists behind this provider's
 * unified surface (3d).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (which moods each model
 * reads and which extras it takes), and Tripo's own published enums — the two
 * quality ladders, the texture-alignment and orientation choices, the one
 * compression value. It is the value half of `unmodel/tripo3d/types`, for the
 * client-side validation and the pickers a type cannot draw.
 *
 * The category table is **the same object the adapter compiles with** —
 * re-exported, never copied — so a picker built from `THREE_D_MODEL_PARAMS` and
 * the request the matching `unmodel/3d` builds cannot disagree. It is read from
 * the import-free `./three-d-params.ts` leaf rather than from the adapter, which
 * is what keeps this entry off this provider's validators, its zod schemas and
 * its catalog; `test/values-entries.test.ts` measures that against a real build.
 *
 * `GATED_PARAMS_BY_MODEL` is the one export here that is not a request-side
 * vocabulary: it is the version gate as data, so a form can grey out
 * `geometry_quality` when `v2.5-20250123` is selected rather than letting a user
 * build a request Tripo will refuse.
 *
 * The uniform alias is `THREE_D_MODEL_PARAMS` rather than `3D_MODEL_PARAMS`,
 * for the reason the verb is `threeD`: the category id is `"3d"` and `3D_…` is
 * not an identifier.
 */

export {
  TRIPO3D_THREE_D_MODEL_PARAMS as THREE_D_MODEL_PARAMS,
  MODELS as THREE_D_MODELS,
} from "./three-d-params";

export {
  COMPRESSIONS,
  FACE_LIMITS,
  GATED_PARAMS_BY_MODEL,
  GEOMETRY_QUALITIES,
  ORIENTATIONS,
  TEXTURE_ALIGNMENTS,
  TEXTURE_QUALITIES,
  TRIPO3D_MODELS,
  TRIPO3D_TASK_STATUSES,
  VERSION_GATED_PARAMS,
} from "./shared";
