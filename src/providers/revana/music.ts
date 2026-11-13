/**
 * `revana.music` — the music models on
 * `POST https://api.revana.si/v1/generations`.
 *
 * Four fields and three rules, all the API's own:
 *
 * - "A music request needs style or lyrics; prompt (at most 3000 characters
 *   there) is the idea." A prompt alone is refused.
 * - `lyrics` are "the words to sing. Not with instrumental."
 * - `instrumental: true` is "no vocals. Not with lyrics."
 *
 * Nothing else applies: there is no `duration`, no `seed` and no count ("makes
 * music and does not take input.duration. It takes prompt, style, lyrics and
 * instrumental"). One job returns `options.outputs_per_job` files — two, for
 * `suno-v6` — and is billed per job, not per file.
 *
 * The POST answers `202` with a queued `Generation`; `output.urls` lists the
 * files and `output.durations_s` their lengths. Auth is
 * `Authorization: Bearer <REVANA_API_KEY>`.
 *
 * ```ts
 * const params = revana.music({
 *   model: "suno-v6",
 *   input: { prompt: "A song about first snow", style: "indie folk, warm vocals" },
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import { createGenerationValidator } from "./generation";
import type { RevanaMusicModelId } from "./gen/ids.gen";
import { musicModels } from "./gen/models-music.gen";
import { REVANA_MUSIC_PRICES } from "./gen/prices-music.gen";
import { REVANA_MUSIC_SHAPES } from "./gen/shapes-music.gen";

export const music = createGenerationValidator<RevanaMusicModelId>({
  endpoint: "revana.music",
  catalog: musicModels,
  shapes: REVANA_MUSIC_SHAPES,
  prices: REVANA_MUSIC_PRICES,
  elsewhere: elsewhere("revana.music"),
});
