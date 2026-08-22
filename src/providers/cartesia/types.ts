/**
 * `unmodel/cartesia/types` — every `cartesia` type, and nothing else.
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
 * import type { SttBody } from "unmodel/cartesia/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies SttBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`TtsBytesBody`, `SttTranscribeParams`,
 *   `SttWebsocketParams`, …) — re-exported verbatim, because they are how you
 *   find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`SttBody`, `SttWebsocketBody`,
 *   `TtsBody`, …) — one per endpoint address this provider serves, named
 *   after the word you already type at `unmodel/cartesia` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/cartesia`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `cartesia.stt` → `SttBody`
 * - `cartesia.sttWebsocket` → `SttWebsocketBody`
 * - `cartesia.tts` → `TtsBody`
 * - `cartesia.ttsWebsocket` → `TtsWebsocketBody`
 * - `cartesia.voiceClone` → `VoiceCloneBody`
 */

import type { SttTranscribeParams } from "./stt";
import type { SttWebsocketParams } from "./stt-websocket";
import type { TtsBytesBody } from "./tts";
import type { TtsWebsocketMessage } from "./tts-websocket";
import type { VoicesCloneParams } from "./voice-clone";

export type {
  TtsBytesBody,
  CartesiaVoice,
  CartesiaOutputFormat,
  CartesiaWavOutputFormat,
  CartesiaMp3OutputFormat,
  CartesiaRawOutputFormat,
  CartesiaEncoding,
  CartesiaEmotion,
  CartesiaSampleRate,
  CartesiaMp3BitRate,
  CartesiaGenerationConfig,
  CartesiaTtsLanguage,
} from "./tts";

export type {
  TtsWebsocketMessage,
  CartesiaWebsocketOutputFormat,
  CartesiaWebsocketGenerationConfig,
} from "./tts-websocket";

export type { SttTranscribeParams, CartesiaSttEncoding, CartesiaSttLanguage } from "./stt";

export type { SttWebsocketParams, CartesiaSttWebsocketLanguage } from "./stt-websocket";

export type { SttTranscriptionLike } from "./check";

export type {
  VoicesCloneParams,
  CartesiaCloneLanguage,
  CartesiaVoiceAccess,
} from "./voice-clone";

export type {
  CartesiaModelId,
  CartesiaTtsModelId,
  CartesiaSttModelId,
  CartesiaVoiceCloneModelId,
} from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
//
// `Body` is the uniform suffix even for the socket surfaces
// (`SttWebsocketBody`, `TtsWebsocketBody`), whose params are a connection
// query set or a first configuration message rather than an HTTP body. The
// alias follows the ADDRESS; the wire name beside it is what says which bytes
// go where.
// ---------------------------------------------------------------------------

export type SttBody = SttTranscribeParams;
export type SttWebsocketBody = SttWebsocketParams;
export type TtsBody = TtsBytesBody;
export type TtsWebsocketBody = TtsWebsocketMessage;
export type VoiceCloneBody = VoicesCloneParams;
