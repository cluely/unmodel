/**
 * `revana.avatar` — the video models that animate a still to a sound.
 *
 * A narrower VIEW of `revana.video` over the same route and the same check
 * battery (`docs/decisions.md` §4), for `unmodel/avatar`. Revana's catalog
 * files these under `kind: "video"` with `tasks: ["image_to_video"]`, exactly
 * like an ordinary image-to-video model; what sets them apart is
 * `capabilities.audio_input`, and the roster is curated by hand in
 * `data/revana/curation.json` (`views.avatar`) with a reason per id.
 *
 * An avatar request is a picture and a sound: `input.image_url` and
 * `input.audio_url`. "one picture and a voice track (4 seconds to 5 minutes)
 * become a 720p video of that person speaking" (OmniHuman 2.0), and the API
 * refuses the picture alone with "needs input.audio_url: the voice or sound it
 * animates to." The clip's length follows the sound, and is what is billed.
 *
 * ```ts
 * const params = revana.avatar({
 *   model: "omnihuman-2.0",
 *   input: {
 *     prompt: "She speaks warmly to camera",
 *     image_url: "https://example.com/portrait.png",
 *     audio_url: "https://example.com/voice.mp3",
 *   },
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import { createGenerationValidator } from "./generation";
import { REVANA_AVATAR_MODELS, type RevanaAvatarModelId } from "./gen/ids.gen";
import { videoModels } from "./gen/models-video.gen";
import { REVANA_VIDEO_PRICES } from "./gen/prices-video.gen";
import { REVANA_VIDEO_SHAPES } from "./gen/shapes-video.gen";

export const avatar = createGenerationValidator<RevanaAvatarModelId>({
  endpoint: "revana.avatar",
  catalog: videoModels,
  shapes: REVANA_VIDEO_SHAPES,
  prices: REVANA_VIDEO_PRICES,
  view: {
    ids: REVANA_AVATAR_MODELS,
    does: "animate a still to a sound",
    wide: "revana.video",
  },
  elsewhere: elsewhere("revana.video"),
});
