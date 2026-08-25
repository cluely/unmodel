/**
 * `unmodel/mureka/types` — every `mureka` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — with `fetch` or through
 * your own client (Mureka publishes no first-party SDK):
 *
 * ```ts
 * import type { SongGenerateBody } from "unmodel/mureka/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies SongGenerateBody;
 * ```
 *
 * Two families of name live here:
 *
 * - the **wire names** (`SongGenerateBody`, `InstrumentalGenerateBody`, the
 *   task shapes) — re-exported verbatim, because they are how you find the
 *   endpoint in the provider's own documentation (`SongGenerateReq`,
 *   `InstrumentalGenerateReq` on the spec);
 * - the **uniform category aliases** — one per endpoint address this provider
 *   serves, named after the word you already type at `unmodel/mureka` and on
 *   the CLI.
 *
 * Runtime values — validators, the poll-URL helpers, URL constants, the models
 * table — stay on `unmodel/mureka`.
 *
 * Endpoints:
 *
 * - `mureka.music` → `MusicBody` (alias of `SongGenerateBody`)
 * - `mureka.instrumental` → `InstrumentalBody` (alias of `InstrumentalGenerateBody`)
 */

export type {
  SongGenerateBody,
  InstrumentalGenerateBody,
  MurekaSongTask,
  MurekaInstrumentalTask,
  MurekaSong,
  MurekaInstrumental,
  MurekaLyricsSection,
  MurekaLyricsLine,
  MurekaWordTiming,
  MurekaGender,
  MurekaTaskStatus,
} from "./music";

export type {
  MurekaModelId,
  MurekaSongModelId,
  MurekaInstrumentalModelId,
} from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

import type { InstrumentalGenerateBody, SongGenerateBody } from "./music";

/** `mureka.music` — POST /v1/song/generate. */
export type MusicBody = SongGenerateBody;
/** `mureka.instrumental` — POST /v1/instrumental/generate. */
export type InstrumentalBody = InstrumentalGenerateBody;
