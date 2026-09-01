// Hand-maintained — Resemble AI is not in models.dev; refresh from
//   https://docs.resemble.ai/getting-started/model-versions            (model ids, EOL list, how a model is selected)
//   https://docs.resemble.ai/voice-generation/text-to-speech/synchronous (per-request character cap, params)
//   https://docs.resemble.ai/getting-started/authentication            (base URLs)
// Verified 2026-08-13.
//
// MODEL SELECTION IS IMPLICIT: "The synthesis API automatically uses the
// model associated with your `voice_uuid`, so you do not need to select a
// model in the request. … Do not pass it as a `model` field when making
// text-to-speech requests." The synthesis validators therefore resolve no
// model id and run no catalog gate — this catalog is reference data
// (capabilities, provenance), not a request-time allow-list.
//
// PRICING: Resemble publishes no public per-character or per-second USD rate
// for voice generation — resemble.ai/pricing prices only the Detect /
// Intelligence / Identity / Watermarker products, and the Billing API
// documents units without rates. Every entry therefore omits `cost` rather
// than guess, so `estimate.costUSD` stays undefined for these endpoints.
//
// LIMITS: "Text or SSML to synthesize (≤ 2,000 characters)" on both the
// synchronous and streaming routes — encoded as `limit.characters`.
// `limit.context: 0` disables token-window checks; this is not a token model.
//
// NOT IN THIS CATALOG: the Chatterbox family. model-versions lists
// "Chatterbox variants and earlier TTS versions (tts-v4, tts-v4-turbo,
// tts-v3, tts-v2, tts-v1, tts-legacy)" as end-of-life and "no longer
// functional", so no Resemble endpoint can serve them. Chatterbox weights
// remain available on Hugging Face and through third-party hosts, but that
// is not Resemble's API.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "resemble",
  name: "Resemble AI",
  env: ["RESEMBLE_API_KEY"],
  doc: "https://docs.resemble.ai",
} as const satisfies ProviderInfo;

/** "Text or SSML to synthesize (≤ 2,000 characters)". */
export const RESEMBLE_MAX_CHARACTERS = 2000;

/** Text-to-speech models the synthesis endpoints can produce. */
const ttsModels = {
  // "New and upgraded voices use Resemble Ultra by default"; listed as the
  // current default TTS model and the only one supporting all three
  // synthesis modes (synchronous, HTTP streaming, WebSocket streaming).
  "resemble-ultra": {
    id: "resemble-ultra",
    name: "Resemble Ultra",
    family: "ultra",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: RESEMBLE_MAX_CHARACTERS },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Speech-to-speech models — and the reason there is no `resemble.sts` address.
 *
 * Resemble's speech-to-speech is NOT its own endpoint. It is the SAME
 * synthesis route `resemble.tts` already validates, switched into conversion
 * mode by the payload:
 * https://docs.resemble.ai/voice-generation/speech-to-speech (fetched
 * 2026-08-31), verbatim — "Speech-to-speech uses the same synthesis endpoint as
 * synchronous TTS, but you pass SSML that references a source recording." The
 * `data` field carries `<resemble:convert src="…">` naming an **HTTPS URL to a
 * WAV file** ("Files over 50 MB or 300 seconds are trimmed"), and `voice_uuid`
 * is the target voice — both already typed on `resemble.tts`. So the operation
 * is reachable today, and a second address for one wire is exactly what
 * `docs/decisions.md` §2 forbids.
 *
 * It is also why Resemble is not an `unmodel/sts` witness: that category's
 * canonical `audio` is a required multipart `Blob` at both witnesses, and this
 * route has no file part at all — the source is a URL inside a markup string.
 * Compiling `{ file: Blob }` into an SSML `src` would mean unmodel hosting the
 * caller's audio somewhere, which it cannot and will not do.
 *
 * SYNTHETIC-ADJACENT IDS. The endpoint has NO `model` field
 * (https://docs.resemble.ai/getting-started/model-versions, 2026-08-31: "The
 * model associated with the voice is selected automatically"), so these three
 * are properties of a voice rather than request values; they are catalogued for
 * completeness and must never appear in a body.
 *
 * NO COST. https://www.resemble.ai/pricing/ (fetched 2026-08-31) has a
 * "Processing rates" table covering Detect, Intelligence, Identity search and
 * Watermarker only — no TTS or STS line item — and the plans are credit-based
 * ("load credits into your account and pay based on actual usage"). No
 * defensible USD rate exists, so `cost` is omitted.
 */
const speechToSpeechModels = {
  "sts-v2": {
    id: "sts-v2",
    name: "Resemble Core STS v2",
    family: "sts",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sts-v1": {
    id: "sts-v1",
    name: "Resemble Core STS v1",
    family: "sts",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0 },
  },
  "sts-legacy": {
    id: "sts-legacy",
    name: "Resemble Legacy STS",
    family: "sts",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...ttsModels,
  ...speechToSpeechModels,
} as const satisfies Record<string, ModelInfo>;

/** Models the text-to-speech synthesis endpoints produce. */
export type ResembleTtsModelId = keyof typeof ttsModels;
/** Models the speech-to-speech API produces (not validated by unmodel). */
export type ResembleStsModelId = keyof typeof speechToSpeechModels;
export type ResembleModelId = keyof typeof models;

export const TTS_MODEL_IDS: readonly string[] = Object.keys(ttsModels);
export const STS_MODEL_IDS: readonly string[] = Object.keys(speechToSpeechModels);
