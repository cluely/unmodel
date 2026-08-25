/**
 * The lipsync adapter's **data**: two model ids that are one wire field, and
 * the extra that made the promotion rule fire and then not fire.
 *
 * A leaf rather than a section of the adapter beside it, for `sync`'s reason:
 * `unmodel/heygen/values` publishes these for client-side pickers and the
 * adapter reads the very same objects.
 *
 * ## The two ids are `mode`, spelled the way HeyGen's own pages spell it
 *
 * `POST /v3/lipsyncs` has no model field. It has `mode: "speed" | "precision"`
 * (default `"speed"`), and those are two products with two documentation pages
 * (`/lipsync-speed`, `/lipsync-precision`), two rows in HeyGen's public price
 * table and a 2× price difference. So they are two rows here and the adapter
 * writes `mode` back from the ref — the mirror of Topaz, where the model picks
 * the URL, and of sync., where `model` is a real body field that survives.
 *
 * Both rows carry the same extras: `mode` changes the price and the pipeline,
 * not the request surface.
 *
 * ## `enable_dynamic_duration` is the duration-mismatch word, and it stays an
 * extra
 *
 * This is the third vendor in the category to have an opinion about what
 * happens when the track and the clip are different lengths, and the third
 * spelling of it:
 *
 * | provider | field | shape |
 * | --- | --- | --- |
 * | sync. (native, and resold at fal) | `sync_mode` | 5-arm enum: `bounce`, `loop`, `cut_off`, `silence`, `remap` |
 * | fal · `fal-ai/latentsync` | `loop_mode` | 2-arm enum |
 * | HeyGen | `enable_dynamic_duration` | boolean, default `true` |
 * | VEED | — | the route has no such field at all |
 *
 * The promotion rule asks for **two independent vendors carrying the word
 * compatibly**. Three vendors carry an idea; none of them carries a compatible
 * WORD. A boolean and a five-strategy enum have no shared value space, so a
 * canonical `durationMismatch` would have to pick one shape and then lie at the
 * other two — and the fourth vendor in the category has no field to map at all.
 * So it stays a per-model extra, typed from each endpoint's own wire, exactly
 * as `sync_mode` does. `core/unified/vocabulary/lipsync.ts` records the
 * decision; this table is the evidence for it.
 *
 * ## `enable_caption` is not here, and it IS on the wire
 *
 * It is `deprecated: true` and, in HeyGen's own words, "Deprecated and ignored:
 * captions are always generated". A row that declared it would let an editor
 * offer a switch that does nothing to a request that is billed identically.
 * `heygen.lipsync` still types it — a raw caller can send it and gets a warning
 * — but nothing in the unified surface will suggest it.
 */

import { EXTRA } from "../../core/unified/derive";
import type { LipsyncModelParamTable } from "../../core/unified/vocabulary/lipsync";
import type { HeygenFpsMode } from "./shared";

/** Every id `heygen.lipsync` accepts — the two quality modes. */
export const MODELS = ["lipsync-speed", "lipsync-precision"] as const;

/** A clip, at both modes. HeyGen's still-driven route is a different URL. */
const INPUTS = ["video"] as const;

/** Identical at both modes: `mode` changes the price, not the request surface. */
const EXTRAS = {
  /**
   * Default `true`. HeyGen's answer to the duration mismatch — an on/off
   * switch where sync. has a five-arm enum and VEED has nothing. Kept as an
   * extra for exactly that reason; see the module header.
   */
  enable_dynamic_duration: EXTRA as boolean,
  /** Preserve the source's encoding specs (resolution, bitrate). */
  keep_the_same_format: EXTRA as boolean,
  /** Strip background music from the output. Default `false`. */
  disable_music_track: EXTRA as boolean,
  /** Clean up the replacement track before syncing to it. Default `false`. */
  enable_speech_enhancement: EXTRA as boolean,
  /** Burn a watermark into the output. Default `false`. */
  enable_watermark: EXTRA as boolean,
  /** Seconds — the start of a partial-lipsync window. */
  start_time: EXTRA as number,
  /** Seconds — the end of it. Must be greater than `start_time`. */
  end_time: EXTRA as number,
  /**
   * `"vfr" | "cfr" | "passthrough"` — and the tail is OPEN, because HeyGen's
   * schema types this field as a plain string and the three values live only in
   * its description. An unrecognised value warns rather than failing.
   */
  fps_mode: EXTRA as HeygenFpsMode | (string & {}),
  /** Title for the job in the dashboard. */
  title: EXTRA as string,
  /** Destination folder in the workspace. */
  folder_id: EXTRA as string,
  /** HeyGen POSTs the finished job here instead of making you poll. */
  callback_url: EXTRA as string,
  /** Echoed back in the webhook payload. */
  callback_id: EXTRA as string,
} as const;

export const HEYGEN_LIPSYNC_MODEL_PARAMS = {
  "lipsync-speed": { sources: INPUTS, extras: EXTRAS },
  "lipsync-precision": { sources: INPUTS, extras: EXTRAS },
} as const satisfies LipsyncModelParamTable;
