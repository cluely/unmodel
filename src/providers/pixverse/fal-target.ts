/**
 * `pixverse.video` → fal: the overlap table and the mapping.
 *
 * **Reached only from `./index.ts`.** `unmodel/video` imports this provider
 * through `./unified-video.ts`, which imports `./video` directly, so nothing in
 * this module — not the table, not the engine behind it — is in a pack's
 * graph. See `core/translate/media-retarget.ts` for why the seam is placed
 * where it is.
 *
 * ## What fal serves
 *
 * One PixVerse endpoint, `fal-ai/pixverse/v6/text-to-video`, verified against
 * fal's curated roster on 2026-08-25 (`data/fal/curation.json`; the drift guard
 * in `fal-target.test.ts` re-asserts every id here against
 * `FAL_VIDEO_ENDPOINTS`). Source page:
 * https://fal.ai/models/fal-ai/pixverse/v6/text-to-video/api
 *
 * So `model: "v6"` is the only mapped id, and `pixverse.videoFromImage` maps
 * nowhere at all — not merely because fal publishes no PixVerse i2v endpoint,
 * but because it could not be honoured if it did: `img_id` is a PixVerse
 * account-scoped handle from `POST /openapi/v2/image/upload`, and turning one
 * into fal's `image_url` would mean fetching and re-uploading bytes this
 * library never sees.
 *
 * ## Why this is the cleanest family in the set
 *
 * Seven params map name-for-name and literal-for-literal:
 * `WIDE_ASPECT_RATIOS` is byte-identical to fal's `aspect_ratio` enum, and
 * `PIXVERSE_QUALITIES` is byte-identical to fal's `resolution` enum — the only
 * difference being what PixVerse calls the field (`quality`). A rename is not
 * a loss, so a plain `pixverse.video({ model: "v6", … }).toApi("fal")` carries
 * **zero warnings**, which is the contract: empty means exact.
 */
import type { ApiRetargeter } from "../../core/request";
import {
  createMediaToApi,
  refuseParam,
  requireByteLength,
  type MediaMapContext,
} from "../../core/translate/media-retarget";
import { FAL_MEDIA_TARGET } from "../../core/translate/media-endpoints";
import type { FalVideoBodyById } from "../fal/interop";
import type { TextToVideoParams } from "./video";

/** fal documents 2048 UTF-8 bytes for this endpoint's prompt; its schema does not. */
const PROMPT_MAX_BYTES = 2048;

const ENDPOINT = "fal-ai/pixverse/v6/text-to-video";

type FalPixverseV6 = FalVideoBodyById["fal-ai/pixverse/v6/text-to-video"];

/**
 * `pixverse.video` params → `fal-ai/pixverse/v6/text-to-video`.
 *
 * Three hard refusals, and none of them is droppable:
 *
 * - **`motion_mode`** — PixVerse's normal/fast motion tier. fal publishes no
 *   equivalent, and it is a *priced* tier on v4.5 and below, so silently
 *   losing it changes both the motion and the bill.
 * - **`camera_movement`** — a camera preset. fal's PixVerse row has no camera
 *   field at all (contrast `lightricks/ltx-2.5`, which does), and a dropped
 *   camera move produces a different video, not a lossier one.
 * - **`template_id`** — an id in *your* PixVerse account's activated-template
 *   list. It has no meaning on fal's account, so there is nothing to translate.
 *
 * `sound_effect_*` and `lip_sync_tts_*` never arrive: `checkModelGatedFields`
 * already refuses them on `v6` (they are "v5 and below"), so a mapping arm for
 * them would be dead code dressed as a guarantee.
 *
 * The one check that is not a rename: fal documents a **2048-byte** cap on
 * `prompt` and `negative_prompt` while PixVerse's own cap is 5000 *characters*,
 * and fal's generated schema does not carry the byte cap — so unmodel measures
 * it here rather than letting a visually short prompt full of emoji 422 on the
 * wire. Truncating would be the other option and is not on the table: a
 * silently shortened prompt is a different request.
 */
function mapV6(params: TextToVideoParams, ctx: MediaMapContext): FalPixverseV6 {
  requireByteLength(ctx, ["prompt"], params.prompt, PROMPT_MAX_BYTES, ENDPOINT);
  if (params.motion_mode !== undefined) {
    refuseParam(
      ctx,
      ["motion_mode"],
      ENDPOINT,
      "publishes no motion-tier field — and on PixVerse the motion mode is a priced tier, so losing it would change the motion and the bill",
    );
  }
  if (params.camera_movement !== undefined) {
    refuseParam(ctx, ["camera_movement"], ENDPOINT, "publishes no camera field");
  }
  if (params.template_id !== undefined) {
    refuseParam(
      ctx,
      ["template_id"],
      ENDPOINT,
      "has no template list — `template_id` names an activated template in your own PixVerse account and carries no meaning on fal's",
    );
  }
  return {
    prompt: params.prompt,
    // PixVerse spells the resolution `quality`; the four literals are the same
    // four, in the same order, so the rename is the whole translation.
    resolution: params.quality,
    aspect_ratio: params.aspect_ratio,
    duration: params.duration,
    ...(params.seed !== undefined && { seed: params.seed }),
    ...(params.generate_audio_switch !== undefined && {
      generate_audio_switch: params.generate_audio_switch,
    }),
    ...(params.generate_multi_clip_switch !== undefined && {
      generate_multi_clip_switch: params.generate_multi_clip_switch,
    }),
  };
}

/**
 * PixVerse model id → the fal endpoint that serves it.
 *
 * `as const` on `endpoints` is load-bearing twice over: the drift guard reads
 * the literal, and {@link PixverseVideoFalOverlap} derives the declared
 * `.toApi` body from `ReturnType<map>` — so the table cannot promise a shape
 * the mapping does not build.
 */
export const PIXVERSE_VIDEO_FAL_OVERLAP = {
  v6: { endpoints: ["fal-ai/pixverse/v6/text-to-video"], map: mapV6 },
} as const;

/**
 * The seven PixVerse ids fal does not serve, with the reason, so a caller who
 * reaches for one is told *why* rather than told the model is unknown.
 *
 * `c1` is the one worth spelling out: it shares v6's per-second duration model
 * and wide ratio set, so it looks mappable — but fal serves no `c1` endpoint,
 * and routing a `c1` request to the v6 URL would swap the model, not the
 * transport.
 */
export const PIXVERSE_VIDEO_FAL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  c1: "fal serves no PixVerse C1 endpoint; routing a C1 request to the v6 URL would swap the model rather than the transport.",
  "v5.6": "fal's curated PixVerse roster is v6 only.",
  "v5.5": "fal's curated PixVerse roster is v6 only.",
  v5: "fal's curated PixVerse roster is v6 only.",
  "v4.5": "fal's curated PixVerse roster is v6 only.",
  v4: "fal's curated PixVerse roster is v6 only.",
  "v3.5": "fal's curated PixVerse roster is v6 only.",
});

/** The type half of {@link PIXVERSE_VIDEO_FAL_OVERLAP}, derived from it. */
export type PixverseVideoFalOverlap = {
  [K in keyof typeof PIXVERSE_VIDEO_FAL_OVERLAP]: ReturnType<
    (typeof PIXVERSE_VIDEO_FAL_OVERLAP)[K]["map"]
  >;
};

/** The `.toApi("fal")` retargeter `./index.ts` hangs on `pixverse.video`. */
export const pixverseVideoToFal: (params: TextToVideoParams) => ApiRetargeter = createMediaToApi({
  endpoint: "pixverse.video",
  target: FAL_MEDIA_TARGET,
  modelId: (params: TextToVideoParams) => params.model,
  overlap: PIXVERSE_VIDEO_FAL_OVERLAP,
  refusals: PIXVERSE_VIDEO_FAL_REFUSALS,
});
