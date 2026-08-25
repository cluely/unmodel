/**
 * The `fal.music` adapter's **data**: the endpoint roster and the per-model
 * narrowing table.
 *
 * The leaf rule (A10b in `test/import-graph.test.ts`): import-free apart from
 * the one generated table it re-exports, so `unmodel/fal/values` can publish
 * these rows without dragging zod or the unified kernel behind them.
 *
 * Three fields carry this category. `textWire` says which parameter the words
 * go in — `prompt` at seven endpoints, `tags` at ACE-Step, `lyrics` at
 * DiffRhythm, where the lyrics ARE the request. `lengthWire` says which of four
 * spellings the length uses, and `lengthUnit: "ms"` marks the one that counts
 * milliseconds. `codecs` says `[]` at eight of the ten, because most of these
 * endpoints answer a fixed encoding and have no field to change it.
 */

export {
  FAL_MUSIC_PARAM_SHAPES as FAL_MUSIC_MODEL_PARAMS,
  FAL_MUSIC_MODELS as MODELS,
} from "./gen/music-params.gen";
