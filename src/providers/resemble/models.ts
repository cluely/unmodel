// Hand-maintained — Resemble AI is not in models.dev; refresh from
//   https://docs.resemble.ai/voice-archive                                  (where the voice docs live, and their status)
//   https://docs.resemble.ai/getting-started/model-versions                 (model ids, EOL list, how a model is selected)
//   https://docs.resemble.ai/api-reference/text-to-speech/synthesize        (synthesis host, /synthesize character cap)
//   https://docs.resemble.ai/api-reference/text-to-speech/stream-synthesize (/stream character cap)
//   https://docs.resemble.ai/voice-generation/text-to-speech/synchronous    (params, the guide's character cap)
//   https://app.resemble.ai/billing/api/v1/plans                            (per-second voice rates)
// Verified 2026-11-12.
//
// CLOSED TO NEW CUSTOMERS. Resemble stopped selling voice generation on
// 2026-08-13 (https://www.resemble.ai/resources/why-a-former-voice-ai-company-went-all-in-on-deepfake-detection:
// "Voice generation as a paid product We're supporting our existing customers
// but not taking new ones."). The voice docs now sit under the archive, which
// says they "describe the former hosted voice platform; they do not imply
// continued availability of commercial voice services." The routes still
// serve existing customers: model-versions lists `resemble-ultra` as "Current
// and default", https://status.resemble.ai lists "Resemble Ultra (HTTP)", and
// both synthesis routes answered a credential-less probe with a JSON error
// envelope on 2026-11-12. A new account should not expect to be served.
//
// MODEL SELECTION IS IMPLICIT: "The synthesis API automatically uses the
// model associated with your `voice_uuid`, so you do not need to select a
// model in the request." and "`resemble-ultra` identifies the voice model
// version. Do not pass it as a `model` field when making text-to-speech
// requests." The synthesis validators therefore resolve no model id and run
// no catalog gate — this catalog is reference data (capabilities,
// provenance), not a request-time allow-list.
//
// PRICING: no entry carries `cost`, so `estimate.costUSD` stays undefined.
// Rates are published — the plans endpoint ("This endpoint is public",
// https://docs.resemble.ai/api-reference/billing-plans/list-billing-plans)
// lists Text-To-Speech, "Billed per second of audio generated", at
// `rate_per_unit_dollars` 0.00067 on Flex and 0.0005 on Team and Business —
// but none of them is the price of a request: the rate depends on the
// caller's plan, a subscription keeps "the subscription item's locked-in
// rate" (https://docs.resemble.ai/platform-management/billing/subscriptions),
// and no new customer can buy it at all (above).
//
// LIMITS: the cap on `data` differs by route, and for /synthesize Resemble's
// own pages disagree.
// - /stream: "max 2000 characters" (API reference) and "≤ 2,000 characters;
//   partial SSML support" (guide) — enforced as an error above 2,000.
// - /synthesize: "max 3,000 characters" (API reference) but "≤ 2,000
//   characters" (guide), each wording already on its page's Wayback capture
//   (2026-06-12 and 2026-05-19), and the server checks the credential before
//   the body, so it cannot be asked. Above 3,000 both pages refuse — an
//   error; 2,001–3,000 is a warning naming both pages, so the validator never
//   refuses a request the reference says is served.
// `limit.characters` carries 2,000: the figure every page of both routes
// accepts. `limit.context: 0` disables token-window checks; this is not a
// token model.
//
// NOT IN THIS CATALOG: the Chatterbox family and every earlier TTS version.
// model-versions: "All previous Resemble text-to-speech models have reached
// end of life. Voices that still use one of these versions can no longer
// generate audio and must be upgraded to Resemble Ultra." Its table lists
// Chatterbox and Chatterbox Multilingual (`tts-v4`), Chatterbox-Turbo
// (`tts-v4-turbo`), Enhanced TTS v3/v2/v1 (`tts-v3`/`tts-v2`/`tts-v1`) and
// Legacy TTS (`tts-legacy`) — "for reference only. They are not valid model
// selections for synthesis requests." Chatterbox weights remain available on
// Hugging Face and through third-party hosts, but that is not Resemble's API.
// Nor DramaBox (excluded 2026-11-12): an open-source research model
// (https://resemble.ai/learn/models/dramabox: "Open source and ready for its
// close-up."), never a synthesis model id — model-versions lists only
// `resemble-ultra` — and the in-app Voice Design feature that ran it is gone
// (https://www.resemble.ai/changelog: "Sep 28, 2026 Voice Design removed").

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "resemble",
  name: "Resemble AI",
  env: ["RESEMBLE_API_KEY"],
  doc: "https://docs.resemble.ai",
} as const satisfies ProviderInfo;

/**
 * "Text or SSML to synthesize (≤ 2,000 characters)" — the cap on `/stream`,
 * and the figure every page of both routes accepts (see LIMITS above).
 */
export const RESEMBLE_MAX_CHARACTERS = 2000;

/**
 * "Text or SSML to synthesize (max 3,000 characters)" — the `/synthesize` API
 * reference, and the hard ceiling `resemble.tts` enforces. Its guide says
 * 2,000; requests between the two draw a warning (see LIMITS above).
 */
export const RESEMBLE_SYNTHESIZE_MAX_CHARACTERS = 3000;

/** Text-to-speech models the synthesis endpoints can produce. */
const ttsModels = {
  // "Resemble Ultra is the current text-to-speech model for new and upgraded
  // voices." — status "Current and default", and "available through
  // synchronous synthesis, HTTP streaming, and WebSocket streaming"
  // (model-versions, 2026-11-12).
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
 * (https://docs.resemble.ai/api-reference/text-to-speech/synthesize,
 * 2026-11-12: "The model associated with the voice is selected
 * automatically."), so these three are properties of a voice rather than
 * request values; they are catalogued for completeness and must never appear
 * in a body.
 *
 * NO COST. The plans endpoint (https://app.resemble.ai/billing/api/v1/plans,
 * fetched 2026-11-12) prices AI Voice Changer, "Billed per second of audio
 * processed", at `rate_per_unit_dollars` 0.0005 on Flex and 0.00042 on Team
 * and Business. That is a plan-dependent rate sold to existing customers only,
 * as for TTS above, and these ids ride on a voice rather than on the request,
 * so no request can name the model it is billed under. `cost` is omitted.
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
