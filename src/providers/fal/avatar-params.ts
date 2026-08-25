/**
 * The `fal.avatar` adapter's **data**: the endpoint roster and the per-model
 * narrowing table.
 *
 * The leaf rule (A10b in `test/import-graph.test.ts`): import-free apart from
 * the one generated table it re-exports.
 *
 * `sources` is the field to read. Six rows say `["image"]` and two —
 * `veed/avatars/audio-to-video` and `argil/avatars/audio-to-video` — say `[]`,
 * because their performer is a catalogued id rather than a picture. Those two
 * empty lists are what type `image` as `never` at the `unmodel/avatar` call
 * site, which is the compile-time half of a refusal the adapter also makes at
 * run time.
 */

export {
  FAL_AVATAR_PARAM_SHAPES as FAL_AVATAR_MODEL_PARAMS,
  FAL_AVATAR_MODELS as MODELS,
} from "./gen/avatar-params.gen";
