/**
 * `unmodel/heygen/types` — every `heygen` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That is
 * pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — HeyGen ships no
 * first-party JavaScript client, so `fetch` is what its own quick-start shows:
 *
 * ```ts
 * import type { LipsyncBody } from "unmodel/heygen/types";
 *
 * const body = {
 *   video: { type: "url", url: "https://media.example.com/take.mp4" },
 *   audio: { type: "url", url: "https://media.example.com/vo-french.mp3" },
 *   mode: "precision",
 * } satisfies LipsyncBody;
 * ```
 *
 * The response types are here too, and the pair worth naming is
 * {@link HeygenVideoDetail} / {@link HeygenLipsyncDetail}: they carry DIFFERENT
 * status enums (`processing` on the video route, `running` on the lipsync one),
 * which is the thing a shared polling helper gets wrong.
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`HeygenAvatarParams`, `HeygenLipsyncParams`) —
 *   re-exported verbatim, because they are how you find the endpoint in
 *   HeyGen's own documentation;
 * - the **uniform category aliases** (`AvatarBody`, `LipsyncBody`) — one per
 *   endpoint address this provider serves, named after the word you already
 *   type at `unmodel/heygen` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames.
 *
 * Endpoints:
 *
 * - `heygen.avatar` → `AvatarBody`
 * - `heygen.lipsync` → `LipsyncBody`
 */

import type { HeygenAvatarParams } from "./avatar";
import type { HeygenLipsyncParams } from "./lipsync";

export type { HeygenAvatarParams } from "./avatar";

export type { HeygenLipsyncParams } from "./lipsync";

export type {
  HeygenAspectRatio,
  HeygenAssetBase64,
  HeygenAssetId,
  HeygenAssetRef,
  HeygenAssetUrl,
  HeygenBackground,
  HeygenBackgroundType,
  HeygenCaption,
  HeygenCreateLipsyncResponse,
  HeygenCreateVideoResponse,
  HeygenElevenLabsEngineSettings,
  HeygenEngineConfig,
  HeygenEngineSettings,
  HeygenEngineType,
  HeygenErrorResponse,
  HeygenExpressiveness,
  HeygenFishEngineSettings,
  HeygenFit,
  HeygenFpsMode,
  HeygenLipsyncDetail,
  HeygenLipsyncMode,
  HeygenLipsyncModelId,
  HeygenLipsyncStatus,
  HeygenMediaRef,
  HeygenOutputFormat,
  HeygenResolution,
  HeygenStarfishEngineSettings,
  HeygenVideoDetail,
  HeygenVideoStatus,
  HeygenVideoType,
  HeygenVoiceEngine,
  HeygenVoiceSettings,
  HeygenWatermark,
  HeygenWatermarkPlacement,
  HeygenWatermarkPosition,
} from "./shared";

export type { HeygenCatalogModelId } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type AvatarBody = HeygenAvatarParams;
export type LipsyncBody = HeygenLipsyncParams;
