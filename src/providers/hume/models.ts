// Hand-maintained — Hume AI is not in models.dev; refresh from
// https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json,
// https://dev.hume.ai/docs/text-to-speech-tts/overview and
// https://www.hume.ai/pricing (last checked 2026-08-13). As of 2026-11-12 all
// three answer HTTP 308 to Hume's Audio Decisions docs (or, for pricing, to
// www.hume.ai/); their last captures are
// https://web.archive.org/web/20260718001040/https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json,
// https://web.archive.org/web/20260814235823/https://dev.hume.ai/docs/text-to-speech-tts/overview
// and https://web.archive.org/web/20260930030232/https://www.hume.ai/pricing.
//
// SUNSET — every row below is `status: "deprecated"`, so each request warns
// `deprecated_model`. https://web.archive.org/web/20261003165626/https://dev.hume.ai/changelog
// (read 2026-11-12), under "October 2, 2026 / TTS and EVI API sunset notice":
// "Hume is sunsetting the TTS and EVI APIs. Access ends November 13, 2026 at
// 12:01 a.m. EST, and both APIs remain fully supported until then. Any data in
// your account is permanently deleted after November 13, 2026." (12:01 a.m.
// EST is 05:01 UTC.) RETIRED: probed on 2026-11-13, after the cutoff, a POST
// to /v0/tts, /v0/tts/file, /v0/tts/stream/json, /v0/tts/stream/file,
// /v0/tts/voice_conversion/file or /v0/tts/voice_conversion/json, and a GET
// to /v0/tts/voices, all answer HTTP 404 with `sunset: Fri, 13 Nov 2026 05:01:00
// GMT`, `deprecation: @1790899200` (2026-10-02) and the body {"code":404,
// "message":"This API was retired on 2026-11-13 and is no longer available.
// For questions, contact assist@hume.ai."}. An unknown route answers a bare
// 404 with no body, so the message is the retirement. Every id below still
// validates, so a request that passes here is one Hume now refuses. Voice
// conversion is not named in the notice, but its route answers the same
// retirement 404; Hume shipped it as a "TTS API addition" under /v0/tts/.
//
// MODEL IDS: Hume's TTS API has NO `model` field. The Octave generation is
// selected with the `version` enum, whose documented values are the strings
// "1" and "2" ("If you omit this field, Hume automatically routes the request
// to the most appropriate model"). The ids below are unmodel's canonical
// names for those two documented versions — `octave` ⇄ version "1",
// `octave-2` ⇄ version "2" — and are NOT wire values. `src/providers/hume/tts.ts`
// maps between them; never put a catalog id in the request body.
//
// PRICING: Hume publishes usage-based character rates per subscription plan
// AND per Octave version — the pricing page's "Additional characters cost
// (Usage-based)" row has an Octave 1 and an Octave 2 view. Its embedded page
// JSON (https://web.archive.org/web/20260930030232/https://www.hume.ai/pricing,
// read 2026-11-12; plan columns Free, Starter, Creator, Pro, Scale, Business,
// Enterprise, the first two `{"isAvailable":false}`) reads, verbatim:
//   "octave_1": "$$0.15/1,000", "$$0.12/1,000", "$$0.10/1,000", "$$0.05/1,000", "Custom"
//   "octave_2": "$$0.075/1,000", "$$0.06/1,000", "$$0.05/1,000", "$$0.025/1,000", "Custom"
// beside "In Octave 2, characters are metered at half rate, so estimated
// minutes are doubled." (The JSON doubles the `$`.) The 2026-07-12 and
// 2026-09-01 captures carry the same cells. Each row's `perMillionCharacters`
// is its version's highest published rate, the Creator cell — $150/1M for
// `octave`, $75/1M for `octave-2` — the worst case a budget check should
// assume.
//
// LIMITS: "Maximum text length: 5,000 characters per Utterance" (API limits
// table, matching the schema's `maxLength: 5000` on `utterances[].text`),
// encoded as `limit.characters`. Note this is a PER-UTTERANCE cap, not a
// per-request one — a request may carry several utterances.
// `limit.context: 0` disables token-window checks — these are not token models.
//
// VOICE CONVERSION: POST /v0/tts/voice_conversion/file has no model field AND
// no version field, so its row is a synthetic id; see the block comment on
// `voiceConversionModels` for the id and for why it carries no `cost`
// (https://www.hume.ai/pricing, checked 2026-08-31).

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "hume",
  name: "Hume AI",
  env: ["HUME_API_KEY"],
  doc: "https://dev.hume.ai",
} as const satisfies ProviderInfo;

/** Model ids the TTS routes select with `version` — see the header. */
const ttsModels = {
  // Octave 2 (preview): 11 languages, ~100ms model latency, word/phoneme
  // timestamps. Requires an explicit `voice`. Deprecated per SUNSET; $75/1M
  // is the Octave 2 Creator cell, "$$0.075/1,000" (PRICING).
  "octave-2": {
    id: "octave-2",
    name: "Octave 2 (preview)",
    family: "octave",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 5000 },
    cost: { perMillionCharacters: 75 },
  },
  // Octave 1: English and Spanish, ~200ms model latency, acting instructions
  // and voice design. Deprecated per SUNSET; $150/1M is the Octave 1 Creator
  // cell, "$$0.15/1,000" (PRICING).
  octave: {
    id: "octave",
    name: "Octave 1",
    family: "octave",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 5000 },
    cost: { perMillionCharacters: 150 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Voice conversion — POST /v0/tts/voice_conversion/file, validated by ./sts.
 *
 * SYNTHETIC ID. That route has no `model` field and — unlike /v0/tts — no
 * `version` field either, so there is no wire value to catalogue and
 * `voice-conversion` is unmodel's name for the route (HAND_CATALOGS.md).
 *
 * NO COST. https://www.hume.ai/pricing (checked 2026-08-31) lists "Voice
 * conversion" only as a feature-availability row — available on all seven
 * plans, with no rate attached — and the page's only usage rates are TTS
 * per-character rates ("$0.15/1,000" down to "$0.025/1,000" across the Octave 1
 * and Octave 2 views) for a route that takes no text. How an audio-in request
 * draws down a character quota is documented nowhere, so `cost` is omitted
 * rather than guessed. (The page's separate "Speech-to-speech" row carries
 * `eviToggle: true` and belongs to EVI, the realtime product — not this route.)
 *
 * `limit.characters` is absent for the same reason: there is no text to cap.
 *
 * Deprecated per the SUNSET note in the header.
 */
const voiceConversionModels = {
  "voice-conversion": {
    id: "voice-conversion",
    name: "Octave Voice Conversion",
    family: "octave",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = { ...ttsModels, ...voiceConversionModels } as const satisfies Record<
  string,
  ModelInfo
>;

export type HumeModelId = keyof typeof models;
/** Both catalogued Octave versions serve the TTS routes. */
export type HumeTtsModelId = keyof typeof ttsModels;
/** The synthetic id addressing POST /v0/tts/voice_conversion/file. */
export type HumeStsModelId = keyof typeof voiceConversionModels;

export const HUME_MODEL_IDS = [
  "octave",
  "octave-2",
  "voice-conversion",
] as const satisfies readonly HumeModelId[];
