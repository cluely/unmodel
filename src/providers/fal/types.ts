/**
 * `unmodel/fal/types` — every `fal` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That is
 * pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's request shapes at compile time
 * and are sending the request yourself — with `fetch`, with `@fal-ai/client`,
 * or through your own queue worker.
 *
 * ## What is here today
 *
 * The transport contract (`FalQueueSubmitResponse`, `FalQueueStatus`) and the
 * endpoint-shape vocabulary (`FalEndpointShape`, `FalPropSpec`, …) that the
 * generated narrowing tables are written against.
 *
 * The per-endpoint request bodies are GENERATED from fal's own OpenAPI
 * documents into `./gen/<category>-wire.gen.ts`, and the uniform category
 * aliases (`ImageBody`, `VideoBody`, `LipsyncBody`, …) land here with each
 * category's validator in the following waves — one alias per endpoint address
 * `unmodel/fal` serves, named after the word you already type on the CLI.
 * Until a category has a validator it has no address, so it correctly has no
 * alias: `test/types-entries.test.ts` derives that list from the CLI registry
 * rather than from this file's good intentions.
 */

export type { FalQueueStatus, FalQueueSubmitResponse } from "./urls";

export type {
  FalDimensionSpec,
  FalEndpointShape,
  FalMediaKind,
  FalParamShape,
  FalPropSpec,
  FalPropType,
  FalShapeClass,
  FalSizeSpec,
} from "./shape-types";
