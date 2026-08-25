/**
 * The `fal.tts` adapter's **data**: the endpoint roster, the per-model
 * narrowing table, and how the audio comes back.
 *
 * The leaf rule (A10b in `test/import-graph.test.ts`): import-free apart from
 * the one generated table it re-exports and the type this file's own delivery
 * descriptor is written against, so `unmodel/fal/values` can publish these rows
 * without dragging zod or the unified kernel behind them.
 *
 * The rows are the largest in the provider by vocabulary — 23 endpoints, and
 * every one of them publishes its own voice list, its own language enum and its
 * own idea of what `output_format` means. The nine Kokoro endpoints are the
 * clearest case: one shape, three parameters, nine different `voices` arrays,
 * and picking between them IS picking the language.
 */

import type { TtsDeliverySpec } from "../../core/unified/vocabulary/common";

export {
  FAL_TTS_PARAM_SHAPES as FAL_TTS_MODEL_PARAMS,
  FAL_TTS_MODELS as MODELS,
} from "./gen/tts-params.gen";

/**
 * A URL — and the path is relative to the queue RESULT document, not to the
 * submit response.
 *
 * That distinction is the whole reason this descriptor needs a comment. A
 * `POST https://queue.fal.run/{endpoint}` answers an ENVELOPE
 * (`{ request_id, response_url, status_url, cancel_url, queue_position }`) and
 * there is no audio anywhere in it. `["audio", "url"]` names a path in the
 * document the `response_url` eventually serves — so a caller who reads this
 * descriptor has to follow the queue first, and `./urls.ts` documents how.
 * Reading it against the submit response would find `undefined` and conclude,
 * wrongly, that the request produced nothing.
 *
 * Flat rather than `byRequestField`, across all 23 endpoints, because every one
 * of their OpenAPI response schemas declares `audio` as fal's `File` component
 * — a `{ url, content_type, file_name, file_size }` object. The one place that
 * might have forked is MiniMax, whose `output_format` is `"url" | "hex"`; fal's
 * published schema types its response identically either way, so unmodel states
 * what the schema states and the hex arm rides as a per-model extra whose effect
 * fal does not document in a machine-readable form.
 */
export const FAL_TTS_DELIVERY = {
  kind: "url",
  path: ["audio", "url"],
} as const satisfies TtsDeliverySpec;
