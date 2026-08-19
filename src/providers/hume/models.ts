// Hand-maintained — Hume AI is not in models.dev; refresh from
// https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json,
// https://dev.hume.ai/docs/text-to-speech-tts/overview and
// https://www.hume.ai/pricing (last checked 2026-08-13).
//
// MODEL IDS: Hume's TTS API has NO `model` field. The Octave generation is
// selected with the `version` enum, whose documented values are the strings
// "1" and "2" ("If you omit this field, Hume automatically routes the request
// to the most appropriate model"). The ids below are unmodel's canonical
// names for those two documented versions — `octave` ⇄ version "1",
// `octave-2` ⇄ version "2" — and are NOT wire values. `src/providers/hume/tts.ts`
// maps between them; never put a catalog id in the request body.
//
// PRICING: Hume publishes usage-based character rates per subscription plan,
// not per model, and both Octave versions share one rate row on the pricing
// page: $0.15/1,000 characters (Creator) stepping down to $0.12 (Pro), $0.10
// (Scale) and $0.05 (Business); Enterprise is custom. `perMillionCharacters`
// carries the highest published rate, $150/1M — the worst case a budget check
// should assume.
//
// LIMITS: "Maximum text length: 5,000 characters per Utterance" (API limits
// table, matching the schema's `maxLength: 5000` on `utterances[].text`),
// encoded as `limit.characters`. Note this is a PER-UTTERANCE cap, not a
// per-request one — a request may carry several utterances.
// `limit.context: 0` disables token-window checks — these are not token models.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "hume",
  name: "Hume AI",
  env: ["HUME_API_KEY"],
  doc: "https://dev.hume.ai",
} as const satisfies ProviderInfo;

export const models = {
  // Octave 2 (preview): 11 languages, ~100ms model latency, word/phoneme
  // timestamps. Requires an explicit `voice`.
  "octave-2": {
    id: "octave-2",
    name: "Octave 2 (preview)",
    family: "octave",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "beta",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 5000 },
    cost: { perMillionCharacters: 150 },
  },
  // Octave 1: English and Spanish, ~200ms model latency, acting instructions
  // and voice design.
  octave: {
    id: "octave",
    name: "Octave 1",
    family: "octave",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 5000 },
    cost: { perMillionCharacters: 150 },
  },
} as const satisfies Record<string, ModelInfo>;

export type HumeModelId = keyof typeof models;
/** Both catalogued Octave versions serve the TTS routes. */
export type HumeTtsModelId = HumeModelId;

export const HUME_MODEL_IDS = ["octave", "octave-2"] as const satisfies readonly HumeModelId[];
