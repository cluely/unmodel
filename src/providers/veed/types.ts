/**
 * `unmodel/veed/types` — every `veed` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That is
 * pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — VEED ships no client
 * library, so `fetch` is what its own docs show too:
 *
 * ```ts
 * import type { LipsyncBody } from "unmodel/veed/types";
 *
 * const body = {
 *   video_url: "https://media.example.com/take.mp4",
 *   audio_url: "https://media.example.com/vo-french.mp3",
 * } satisfies LipsyncBody;
 * ```
 *
 * The response types are here too, which is less common in this library and is
 * earned: VEED's protocol has TWO error channels — an HTTP rejection
 * ({@link VeedErrorResponse}, no job created) and an accepted job that later
 * failed ({@link VeedJob} with `status: "FAILED"`) — and a client that models
 * only the first sees half its failures.
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`VeedLipsyncParams`, `VeedAvatarParams`) — re-exported
 *   verbatim, because they are how you find the endpoint in VEED's own
 *   documentation;
 * - the **uniform category aliases** (`LipsyncBody`, `AvatarBody`) — one per
 *   endpoint address this provider serves, named after the word you already
 *   type at `unmodel/veed` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames.
 *
 * Endpoints:
 *
 * - `veed.lipsync` → `LipsyncBody`
 * - `veed.avatar` → `AvatarBody`
 */

import type { VeedLipsyncParams } from "./lipsync";
import type { VeedAvatarParams } from "./avatar";

export type { VeedLipsyncParams } from "./lipsync";

export type { VeedAvatarParams } from "./avatar";

export type {
  VeedErrorCode,
  VeedErrorReason,
  VeedErrorResponse,
  VeedFile,
  VeedJob,
  VeedJobError,
  VeedJobErrorCode,
  VeedJobResponse,
  VeedJobStatus,
  VeedModelId,
  VeedRateLimitClass,
  VeedResolution,
  VeedVideoResult,
} from "./shared";

export type { VeedCatalogModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type LipsyncBody = VeedLipsyncParams;
export type AvatarBody = VeedAvatarParams;
