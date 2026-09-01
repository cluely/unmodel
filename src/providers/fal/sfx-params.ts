/**
 * The `fal.sfx` adapter's **data**: the endpoint roster and the per-model
 * narrowing table.
 *
 * The leaf rule (A10b in `test/import-graph.test.ts`): import-free apart from
 * the one generated table it re-exports, so `unmodel/fal/values` can publish
 * these rows without dragging zod or the unified kernel behind them.
 *
 * Six fields carry this category, and four of them are about the length.
 * `textWire` says which parameter the words go in — `prompt` at three vendors,
 * `text` at ElevenLabs, `text_prompt` at Mirelo. `lengthWire` says which of the
 * two length spellings the route uses, and `durationRange`, `durationInt`,
 * `durationDefault` and `durationRequired` say what it will and will not accept
 * — including, at CassetteAI, that omitting it is not an option.
 * `formatWire` picks between three encoding spellings and `bitrateWire` names
 * the one route that publishes a separate bitrate.
 */

export {
  FAL_SFX_PARAM_SHAPES as FAL_SFX_MODEL_PARAMS,
  FAL_SFX_MODELS as MODELS,
} from "./gen/sfx-params.gen";
