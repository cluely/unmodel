/**
 * `unmodel/deepgram/types` — every `deepgram` type, and nothing else.
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
 * import type { FluxConfigureBody } from "unmodel/deepgram/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies FluxConfigureBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`ListenParams`, `ListenLiveParams`,
 *   `ListenFluxParams`, …) — re-exported verbatim, because they are how you
 *   find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`FluxConfigureBody`, `ListenFluxBody`,
 *   `ListenLiveBody`, …) — one per endpoint address this provider serves,
 *   named after the word you already type at `unmodel/deepgram` and on the
 *   CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/deepgram`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `deepgram.fluxConfigure` → `FluxConfigureBody`
 * - `deepgram.listenFlux` → `ListenFluxBody`
 * - `deepgram.listenLive` → `ListenLiveBody`
 * - `deepgram.speakLive` → `SpeakLiveBody`
 * - `deepgram.stt` → `SttBody`
 * - `deepgram.tts` → `TtsBody`
 */

import type {
  FluxConfigureMessage,
  ListenFluxParams,
  ListenLiveParams,
  SpeakLiveParams,
} from "./realtime";
import type { ListenParams } from "./stt";
import type { SpeakParams } from "./tts";

export type { ListenParams, DeepgramRedact, DeepgramListenEncoding } from "./stt";

export type {
  ListenLiveParams,
  ListenFluxParams,
  FluxConfigureMessage,
  FluxConfigureThresholds,
  SpeakLiveParams,
  DeepgramLiveEncoding,
  DeepgramLiveCallbackMethod,
  DeepgramLiveDiarizeModel,
  DeepgramFluxModelId,
  DeepgramFluxEncoding,
  DeepgramFluxRedact,
  DeepgramSpeakLiveEncoding,
  DeepgramSpeakLiveSampleRate,
} from "./realtime";

export type {
  SpeakParams,
  DeepgramSpeakEncoding,
  DeepgramSpeakContainer,
  DeepgramSpeakSampleRate,
} from "./tts";

export type { ListenResponseLike } from "./check";

export type { DeepgramModelId, DeepgramSttModelId, DeepgramTtsModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
//
// `Body` is the uniform suffix even for the socket surfaces
// (`FluxConfigureBody`, `ListenFluxBody`, `ListenLiveBody`, `SpeakLiveBody`),
// whose params are a connection query set or a first configuration message
// rather than an HTTP body. The alias follows the ADDRESS; the wire name
// beside it is what says which bytes go where.
// ---------------------------------------------------------------------------

export type FluxConfigureBody = FluxConfigureMessage;
export type ListenFluxBody = ListenFluxParams;
export type ListenLiveBody = ListenLiveParams;
export type SpeakLiveBody = SpeakLiveParams;
export type SttBody = ListenParams;
export type TtsBody = SpeakParams;
