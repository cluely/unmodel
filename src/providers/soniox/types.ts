/**
 * `unmodel/soniox/types` — every `soniox` type, and nothing else.
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
 * import type { RealtimeTranscriptionBody } from "unmodel/soniox/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies RealtimeTranscriptionBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`TranscriptionsBody`, `SonioxFileUploadParams`,
 *   `RealtimeTranscriptionConfig`, …) — re-exported verbatim, because they
 *   are how you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`RealtimeTranscriptionBody`, `SttBody`)
 *   — one per endpoint address this provider serves, named after the word you
 *   already type at `unmodel/soniox` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/soniox`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `soniox.realtimeTranscription` → `RealtimeTranscriptionBody`
 * - `soniox.stt` → `SttBody`
 */

import type { RealtimeTranscriptionConfig } from "./realtime";
import type { TranscriptionsBody } from "./stt";

export type {
  TranscriptionsBody,
  SonioxTranslation,
  SonioxTranslationOneWay,
  SonioxTranslationTwoWay,
  SonioxContextObject,
  SonioxFileUploadParams,
} from "./stt";

export type {
  RealtimeTranscriptionConfig,
  SonioxAudioFormat,
  SonioxContainerAudioFormat,
  SonioxRawAudioFormat,
} from "./realtime";

export type { SonioxTranscriptionStatus, TranscriptionResponseLike } from "./check";

export type { SonioxModelId, SonioxAsyncModelId, SonioxRealtimeModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
//
// `Body` is the uniform suffix even for the socket surfaces
// (`RealtimeTranscriptionBody`), whose params are a connection query set or a
// first configuration message rather than an HTTP body. The alias follows the
// ADDRESS; the wire name beside it is what says which bytes go where.
// ---------------------------------------------------------------------------

export type RealtimeTranscriptionBody = RealtimeTranscriptionConfig;
export type SttBody = TranscriptionsBody;
