/**
 * The `revana/…` speech adapter's **data**: the roster, the per-model
 * narrowing table, and how the audio comes back.
 *
 * A leaf, import-free apart from the one generated table it re-exports and the
 * type its delivery descriptor is written against (A10b in
 * `test/import-graph.test.ts`), so `unmodel/revana/values` can publish these
 * rows without the validator, the zod schema or the unified kernel behind them.
 * The adapter beside it reads the very same objects. See `./video-params.ts`
 * for the argument in full, and `scripts/codegen-revana.ts` for each lowering.
 *
 * `voices` is each model's own `options.voices` ids — the names and
 * descriptions behind them are `REVANA_VOICES` on `unmodel/revana/values`.
 */

import type { TtsDeliverySpec } from "../../core/unified/vocabulary/common";

export {
  REVANA_TTS_UNIFIED_PARAMS as REVANA_TTS_MODEL_PARAMS,
  REVANA_TTS_UNIFIED_MODELS as MODELS,
} from "./gen/tts-params.gen";

/**
 * A URL — and the path is relative to the `Generation` a POLL answers, not to
 * the create.
 *
 * `POST /v1/generations` answers `202` with a queued `Generation` whose
 * `output` is `null`; there is no audio anywhere in it. `["output", "urls", 0]`
 * names a path in the document `GET /v1/generations/{id}` serves once `status`
 * is `succeeded` ("the audio is `output.urls[0]`"), so a caller who reads this
 * descriptor follows the poll first — `generationUrl` in `./urls.ts`. Each
 * entry is `GET /v1/generations/{id}/content`, which redirects to the file.
 */
export const REVANA_TTS_DELIVERY = {
  kind: "url",
  path: ["output", "urls", 0],
} as const satisfies TtsDeliverySpec;
