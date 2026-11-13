/**
 * `revana.lipsync` — the video models that re-voice an existing clip.
 *
 * A narrower VIEW of `revana.video` over the same route and the same check
 * battery (`docs/decisions.md` §4), for `unmodel/lipsync`. Revana's catalog
 * files these under `kind: "video"` with `tasks: ["video_to_video"]`, which is
 * also what a motion-control model looks like, so the roster is curated by
 * hand in `data/revana/curation.json` (`views.lipsync`) with a reason per id.
 *
 * A lip-sync request is a clip and a sound: `input.video_url` and
 * `input.audio_url` ("A sound to drive the video"). The API refuses the clip
 * alone with "needs input.audio_url: the voice or sound it animates to."
 *
 * ```ts
 * const params = revana.lipsync({
 *   model: "bytedance-lipsync",
 *   input: {
 *     prompt: "The presenter speaks to camera",
 *     video_url: "https://example.com/take.mp4",
 *     audio_url: "https://example.com/voice.mp3",
 *   },
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import { createGenerationValidator } from "./generation";
import { REVANA_LIPSYNC_MODELS, type RevanaLipsyncModelId } from "./gen/ids.gen";
import { videoModels } from "./gen/models-video.gen";
import { REVANA_VIDEO_PRICES } from "./gen/prices-video.gen";
import { REVANA_VIDEO_SHAPES } from "./gen/shapes-video.gen";

export const lipsync = createGenerationValidator<RevanaLipsyncModelId>({
  endpoint: "revana.lipsync",
  catalog: videoModels,
  shapes: REVANA_VIDEO_SHAPES,
  prices: REVANA_VIDEO_PRICES,
  view: {
    ids: REVANA_LIPSYNC_MODELS,
    does: "re-voice a clip to a sound",
    wide: "revana.video",
  },
  elsewhere: elsewhere("revana.video"),
});
