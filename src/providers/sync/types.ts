/**
 * `unmodel/sync/types` — every `sync` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That is
 * pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — with `fetch`, with
 * `@sync.so/sdk`, or through your own client:
 *
 * ```ts
 * import type { LipsyncBody } from "unmodel/sync/types";
 *
 * const body = {
 *   model: "lipsync-2",
 *   input: [
 *     { type: "video", url: "https://example.com/take.mp4" },
 *     { type: "audio", url: "https://example.com/vo.wav" },
 *   ],
 * } satisfies LipsyncBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`SyncLipsyncParams`, `SyncAvatarParams`) — re-exported
 *   verbatim, because they are how you find the endpoint in sync.'s own
 *   documentation;
 * - the **uniform category aliases** (`LipsyncBody`, `AvatarBody`) — one per
 *   endpoint address this provider serves, named after the word you already
 *   type at `unmodel/sync` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames.
 *
 * Runtime values — the validators, the `check*` helpers, the URL constants, the
 * published enums, the models table — stay on `unmodel/sync`, which tree-shakes
 * to the few bytes a URL constant costs.
 *
 * Endpoints:
 *
 * - `sync.lipsync` → `LipsyncBody`
 * - `sync.avatar` → `AvatarBody`
 */

import type { SyncLipsyncParams } from "./lipsync";
import type { SyncAvatarParams } from "./avatar";

export type { SyncLipsyncInputItem, SyncLipsyncParams } from "./lipsync";

export type { SyncAvatarInputItem, SyncAvatarParams } from "./avatar";

export type {
  SyncActiveSpeaker,
  SyncAudioInput,
  SyncAudioLikeInput,
  SyncDubLanguage,
  SyncDubParams,
  SyncDubSourceLanguage,
  SyncEmotion,
  SyncErrorCode,
  SyncGenerationOptions,
  SyncGenerationSegment,
  SyncGenerationStatus,
  SyncImageInput,
  SyncImageModelId,
  SyncMediaRef,
  SyncModelId,
  SyncModelMode,
  SyncModelType,
  SyncSegmentAudioInput,
  SyncSegmentOptionsOverride,
  SyncSyncMode,
  SyncTtsInput,
  SyncTtsProvider,
  SyncTtsProviderConfig,
  SyncVideoInput,
} from "./shared";

export type { SyncCatalogModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type LipsyncBody = SyncLipsyncParams;
export type AvatarBody = SyncAvatarParams;
