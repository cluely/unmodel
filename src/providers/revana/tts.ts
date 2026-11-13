/**
 * `revana.tts` — the speech models on
 * `POST https://api.revana.si/v1/generations`.
 *
 * # The input the OpenAPI document does not have
 *
 * Revana's published `ModelInput` declares no speech field at all — no `text`,
 * no `voice` — with `additionalProperties: false`, while each speech model's
 * own page sends `{ "text": …, "voice": … }` and the API accepts it. The full
 * set (`text`, `voice`, `dialogue`, `stability`, `similarity_boost`, `speed`,
 * `language_code`) is what the API's validator recognises and names in its own
 * refusals; which of them a given model takes is recorded, with the sentence
 * it was read from, in `data/revana/overlays.json`. See `./generation-wire.ts`.
 *
 * # Per model
 *
 * - `voice` is one of the model's `options.voices` ids — sixty-seven of them,
 *   listed with names and descriptions as `REVANA_VOICES` on
 *   `unmodel/revana/values`. Left out, the model's default voice reads.
 * - `dialogue` — "lines, each with its own voice" — exists on the models whose
 *   row has `dialogue: true`, and replaces `text` + `voice` rather than joining
 *   them.
 * - `language_code` is an enum where the model lists languages, refused where
 *   its list is empty ("picks the language from the text"), and free where it
 *   lists none.
 * - `text` is capped at the model's `max_characters`, and is what is billed:
 *   per 1,000 characters.
 *
 * The POST answers `202` with a queued `Generation`; the audio is
 * `output.urls[0]` once it succeeds. Auth is
 * `Authorization: Bearer <REVANA_API_KEY>`.
 *
 * ```ts
 * const params = revana.tts({
 *   model: "elevenlabs-v3",
 *   input: { text: "[whispers] Nobody tells you this.", voice: "EkK5I93UQWFDigLMpZcX" },
 * });
 * ```
 */

import { elsewhere } from "./addresses";
import { createGenerationValidator } from "./generation";
import type { RevanaTtsModelId } from "./gen/ids.gen";
import { ttsModels } from "./gen/models-tts.gen";
import { REVANA_TTS_PRICES } from "./gen/prices-tts.gen";
import { REVANA_TTS_SHAPES } from "./gen/shapes-tts.gen";

export const tts = createGenerationValidator<RevanaTtsModelId>({
  endpoint: "revana.tts",
  catalog: ttsModels,
  shapes: REVANA_TTS_SHAPES,
  prices: REVANA_TTS_PRICES,
  elsewhere: elsewhere("revana.tts"),
});
