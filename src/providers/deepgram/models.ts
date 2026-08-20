// Hand-maintained — Deepgram is not in models.dev; refresh from
// https://developers.deepgram.com/docs/models-languages-overview (STT ids),
// https://developers.deepgram.com/docs/tts-models (Aura voice ids),
// https://developers.deepgram.com/reference/text-to-speech/speak-request
//   (the `model` enum POST /v1/speak accepts — authoritative for TTS) and
// https://deepgram.com/pricing (last checked 2026-08-13).
//
// PRICING (pay-as-you-go, read off the pricing page's speech-to-text table;
// already USD per minute, no unit conversion needed). The table has SEPARATE
// streaming and pre-recorded columns — this catalog and `transcribe` are the
// PRE-RECORDED (POST /v1/listen) surface, so the pre-recorded column is what
// is encoded here:
// - Nova-3 monolingual: $0.0077/min pre-recorded ($0.0048/min streaming).
// - Nova-3 multilingual (`language=multi`): $0.0092/min pre-recorded
//   ($0.0058/min streaming) — applied in transcribe.ts, since it is a request
//   property, not a distinct model id.
// - Flux (STREAMING-ONLY, /v2/listen WebSocket): $0.0065/min English,
//   $0.0078/min multilingual. Kept in the catalog for completeness; the
//   pre-recorded validator rejects flux-* models.
// - Nova-2, Nova, Enhanced, Base, Whisper Cloud and nova-3-medical are no
//   longer listed in the pricing table (it points at "Contact Sales" for
//   them), so they carry NO cost and estimates return undefined rather than
//   quoting a rate Deepgram no longer publishes.
// Add-ons (diarization $0.0020/min, redaction $0.0020/min, entity detection
// $0.0017/min, keyterm prompting $0.0013/min) are NOT folded into estimates.
//
// TTS PRICING (the pricing page's text-to-speech table, quoted per 1,000
// characters — converted to ModelCost.perMillionCharacters by x1000):
// - Aura-2: $0.030/1k characters → $30 per 1M characters.
// - Aura-1: $0.0150/1k characters → $15 per 1M characters.
// - Flux TTS ($0.0450/1k characters after its 2026-09-12 free period) is a
//   SEPARATE /v2/speak surface with its own `flux-{voice}-en` model strings;
//   it is not accepted by /v1/speak, so those voices are deliberately absent
//   from this catalog (the flux-general-* entries below are the STT models of
//   the same name, served by the /v2/listen WebSocket).

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "deepgram",
  name: "Deepgram",
  env: ["DEEPGRAM_API_KEY"],
  doc: "https://developers.deepgram.com/docs",
} as const satisfies ProviderInfo;

/** Shared shape of every Deepgram STT catalog entry. */
const STT = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["audio"], output: ["text"] },
  // limit.context 0: STT is not token-windowed; the pipeline skips context checks.
  limit: { context: 0 },
} as const;

/** Nova-3 pre-recorded pay-as-you-go rate (deepgram.com/pricing). */
export const NOVA_3_USD_PER_MINUTE = 0.0077;

/** Speech-to-text models — POST /v1/listen (pre-recorded) and /v2/listen (Flux). */
const sttModels = {
  "nova-3": {
    id: "nova-3",
    name: "Nova-3",
    family: "nova-3",
    ...STT,
    cost: { perAudioMinute: NOVA_3_USD_PER_MINUTE },
  },
  "nova-3-general": {
    id: "nova-3-general",
    name: "Nova-3 General",
    family: "nova-3",
    ...STT,
    cost: { perAudioMinute: NOVA_3_USD_PER_MINUTE },
  },
  // English-only variant (en, en-US, en-AU, en-CA, en-GB, en-IE, en-IN, en-NZ).
  "nova-3-medical": {
    id: "nova-3-medical",
    name: "Nova-3 Medical",
    family: "nova-3",
    ...STT,
  },
  "nova-2": { id: "nova-2", name: "Nova-2", family: "nova-2", ...STT },
  "nova-2-general": { id: "nova-2-general", name: "Nova-2 General", family: "nova-2", ...STT },
  "nova-2-meeting": { id: "nova-2-meeting", name: "Nova-2 Meeting", family: "nova-2", ...STT },
  "nova-2-phonecall": { id: "nova-2-phonecall", name: "Nova-2 Phonecall", family: "nova-2", ...STT },
  "nova-2-finance": { id: "nova-2-finance", name: "Nova-2 Finance", family: "nova-2", ...STT },
  "nova-2-conversationalai": {
    id: "nova-2-conversationalai",
    name: "Nova-2 Conversational AI",
    family: "nova-2",
    ...STT,
  },
  "nova-2-voicemail": { id: "nova-2-voicemail", name: "Nova-2 Voicemail", family: "nova-2", ...STT },
  "nova-2-video": { id: "nova-2-video", name: "Nova-2 Video", family: "nova-2", ...STT },
  "nova-2-medical": { id: "nova-2-medical", name: "Nova-2 Medical", family: "nova-2", ...STT },
  "nova-2-drivethru": { id: "nova-2-drivethru", name: "Nova-2 Drivethru", family: "nova-2", ...STT },
  "nova-2-automotive": {
    id: "nova-2-automotive",
    name: "Nova-2 Automotive",
    family: "nova-2",
    ...STT,
  },
  "nova-2-atc": { id: "nova-2-atc", name: "Nova-2 ATC", family: "nova-2", ...STT },
  // First-generation Nova. Still listed on models-languages-overview for both
  // pre-recorded and streaming; no published rate.
  nova: { id: "nova", name: "Nova", family: "nova", ...STT },
  "nova-general": { id: "nova-general", name: "Nova General", family: "nova", ...STT },
  "nova-phonecall": { id: "nova-phonecall", name: "Nova Phonecall", family: "nova", ...STT },
  "nova-medical": { id: "nova-medical", name: "Nova Medical", family: "nova", ...STT },
  // Legacy tiers, still documented for both pre-recorded and streaming.
  enhanced: { id: "enhanced", name: "Enhanced", family: "enhanced", ...STT },
  "enhanced-general": {
    id: "enhanced-general",
    name: "Enhanced General",
    family: "enhanced",
    ...STT,
  },
  "enhanced-meeting": {
    id: "enhanced-meeting",
    name: "Enhanced Meeting",
    family: "enhanced",
    ...STT,
  },
  "enhanced-phonecall": {
    id: "enhanced-phonecall",
    name: "Enhanced Phonecall",
    family: "enhanced",
    ...STT,
  },
  "enhanced-finance": {
    id: "enhanced-finance",
    name: "Enhanced Finance",
    family: "enhanced",
    ...STT,
  },
  base: { id: "base", name: "Base", family: "base", ...STT },
  "base-general": { id: "base-general", name: "Base General", family: "base", ...STT },
  "base-meeting": { id: "base-meeting", name: "Base Meeting", family: "base", ...STT },
  "base-phonecall": { id: "base-phonecall", name: "Base Phonecall", family: "base", ...STT },
  "base-finance": { id: "base-finance", name: "Base Finance", family: "base", ...STT },
  "base-conversationalai": {
    id: "base-conversationalai",
    name: "Base Conversational AI",
    family: "base",
    ...STT,
  },
  "base-voicemail": { id: "base-voicemail", name: "Base Voicemail", family: "base", ...STT },
  "base-video": { id: "base-video", name: "Base Video", family: "base", ...STT },
  // Whisper Cloud. "Requests to Whisper are limited to 15 concurrent requests
  // with a paid plan and 5 concurrent requests with the pay-as-you-go plan."
  // `whisper` is documented as an alias of whisper-medium.
  whisper: { id: "whisper", name: "Whisper Cloud (medium alias)", family: "whisper", ...STT },
  "whisper-tiny": { id: "whisper-tiny", name: "Whisper Cloud Tiny", family: "whisper", ...STT },
  "whisper-base": { id: "whisper-base", name: "Whisper Cloud Base", family: "whisper", ...STT },
  "whisper-small": { id: "whisper-small", name: "Whisper Cloud Small", family: "whisper", ...STT },
  "whisper-medium": {
    id: "whisper-medium",
    name: "Whisper Cloud Medium",
    family: "whisper",
    ...STT,
  },
  "whisper-large": { id: "whisper-large", name: "Whisper Cloud Large", family: "whisper", ...STT },
  // Flux models are STREAMING-ONLY: they serve the /v2/listen WebSocket
  // ("The Flux model is accessed by the WebSocket protocol only"), not
  // pre-recorded /v1/listen. Costs are the streaming pay-as-you-go rates.
  "flux-general-en": {
    id: "flux-general-en",
    name: "Flux General (English)",
    family: "flux",
    ...STT,
    cost: { perAudioMinute: 0.0065 },
  },
  "flux-general-multi": {
    id: "flux-general-multi",
    name: "Flux General (Multilingual)",
    family: "flux",
    ...STT,
    cost: { perAudioMinute: 0.0078 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Aura-2 pay-as-you-go rate: $0.030 per 1,000 characters
 * (deepgram.com/pricing) → USD per 1M characters.
 */
export const AURA_2_USD_PER_MILLION_CHARACTERS = 30;
/** Aura-1 pay-as-you-go rate: $0.0150 per 1,000 characters → USD per 1M. */
export const AURA_1_USD_PER_MILLION_CHARACTERS = 15;

/**
 * "Model | Max Characters — Aura-2, Aura-1 | 2000"
 * (https://developers.deepgram.com/docs/text-to-speech, "Input Text Limit").
 * Rides on `limit.characters`; POST /v1/speak answers 413 above it.
 */
export const SPEAK_MAX_CHARACTERS = 2000;

/** Shared shape of every Deepgram TTS (Aura) catalog entry. */
const TTS = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["text"], output: ["audio"] },
  // limit.context 0: TTS is not token-windowed (HAND_CATALOGS.md); the
  // per-request cap is characters, which ./speak checks.
  limit: { context: 0, characters: SPEAK_MAX_CHARACTERS },
} as const;

function aura1(id: string, name: string): ModelInfo {
  return {
    id,
    name,
    family: "aura",
    ...TTS,
    cost: { perMillionCharacters: AURA_1_USD_PER_MILLION_CHARACTERS },
  };
}

function aura2(id: string, name: string): ModelInfo {
  return {
    id,
    name,
    family: "aura-2",
    ...TTS,
    cost: { perMillionCharacters: AURA_2_USD_PER_MILLION_CHARACTERS },
  };
}

/**
 * Text-to-speech voices accepted by POST /v1/speak. Every id here is one of
 * the `model` enum values published by
 * https://developers.deepgram.com/reference/text-to-speech/speak-request —
 * one entry per voice, because on this API the voice IS the model.
 */
const ttsModels = {
// --- AURA-1 -------------------------------------------------------------
  "aura-angus-en": aura1("aura-angus-en", "Aura Angus (English)"),
  "aura-arcas-en": aura1("aura-arcas-en", "Aura Arcas (English)"),
  "aura-asteria-en": aura1("aura-asteria-en", "Aura Asteria (English)"),
  "aura-athena-en": aura1("aura-athena-en", "Aura Athena (English)"),
  "aura-helios-en": aura1("aura-helios-en", "Aura Helios (English)"),
  "aura-hera-en": aura1("aura-hera-en", "Aura Hera (English)"),
  "aura-luna-en": aura1("aura-luna-en", "Aura Luna (English)"),
  "aura-orion-en": aura1("aura-orion-en", "Aura Orion (English)"),
  "aura-orpheus-en": aura1("aura-orpheus-en", "Aura Orpheus (English)"),
  "aura-perseus-en": aura1("aura-perseus-en", "Aura Perseus (English)"),
  "aura-stella-en": aura1("aura-stella-en", "Aura Stella (English)"),
  "aura-zeus-en": aura1("aura-zeus-en", "Aura Zeus (English)"),
// --- AURA-2 -------------------------------------------------------------
  // English (en)
  "aura-2-amalthea-en": aura2("aura-2-amalthea-en", "Aura-2 Amalthea (English)"),
  "aura-2-andromeda-en": aura2("aura-2-andromeda-en", "Aura-2 Andromeda (English)"),
  "aura-2-apollo-en": aura2("aura-2-apollo-en", "Aura-2 Apollo (English)"),
  "aura-2-arcas-en": aura2("aura-2-arcas-en", "Aura-2 Arcas (English)"),
  "aura-2-aries-en": aura2("aura-2-aries-en", "Aura-2 Aries (English)"),
  "aura-2-asteria-en": aura2("aura-2-asteria-en", "Aura-2 Asteria (English)"),
  "aura-2-athena-en": aura2("aura-2-athena-en", "Aura-2 Athena (English)"),
  "aura-2-atlas-en": aura2("aura-2-atlas-en", "Aura-2 Atlas (English)"),
  "aura-2-aurora-en": aura2("aura-2-aurora-en", "Aura-2 Aurora (English)"),
  "aura-2-callista-en": aura2("aura-2-callista-en", "Aura-2 Callista (English)"),
  "aura-2-cora-en": aura2("aura-2-cora-en", "Aura-2 Cora (English)"),
  "aura-2-cordelia-en": aura2("aura-2-cordelia-en", "Aura-2 Cordelia (English)"),
  "aura-2-delia-en": aura2("aura-2-delia-en", "Aura-2 Delia (English)"),
  "aura-2-draco-en": aura2("aura-2-draco-en", "Aura-2 Draco (English)"),
  "aura-2-electra-en": aura2("aura-2-electra-en", "Aura-2 Electra (English)"),
  "aura-2-harmonia-en": aura2("aura-2-harmonia-en", "Aura-2 Harmonia (English)"),
  "aura-2-helena-en": aura2("aura-2-helena-en", "Aura-2 Helena (English)"),
  "aura-2-hera-en": aura2("aura-2-hera-en", "Aura-2 Hera (English)"),
  "aura-2-hermes-en": aura2("aura-2-hermes-en", "Aura-2 Hermes (English)"),
  "aura-2-hyperion-en": aura2("aura-2-hyperion-en", "Aura-2 Hyperion (English)"),
  "aura-2-iris-en": aura2("aura-2-iris-en", "Aura-2 Iris (English)"),
  "aura-2-janus-en": aura2("aura-2-janus-en", "Aura-2 Janus (English)"),
  "aura-2-juno-en": aura2("aura-2-juno-en", "Aura-2 Juno (English)"),
  "aura-2-jupiter-en": aura2("aura-2-jupiter-en", "Aura-2 Jupiter (English)"),
  "aura-2-luna-en": aura2("aura-2-luna-en", "Aura-2 Luna (English)"),
  "aura-2-mars-en": aura2("aura-2-mars-en", "Aura-2 Mars (English)"),
  "aura-2-minerva-en": aura2("aura-2-minerva-en", "Aura-2 Minerva (English)"),
  "aura-2-neptune-en": aura2("aura-2-neptune-en", "Aura-2 Neptune (English)"),
  "aura-2-odysseus-en": aura2("aura-2-odysseus-en", "Aura-2 Odysseus (English)"),
  "aura-2-ophelia-en": aura2("aura-2-ophelia-en", "Aura-2 Ophelia (English)"),
  "aura-2-orion-en": aura2("aura-2-orion-en", "Aura-2 Orion (English)"),
  "aura-2-orpheus-en": aura2("aura-2-orpheus-en", "Aura-2 Orpheus (English)"),
  "aura-2-pandora-en": aura2("aura-2-pandora-en", "Aura-2 Pandora (English)"),
  "aura-2-phoebe-en": aura2("aura-2-phoebe-en", "Aura-2 Phoebe (English)"),
  "aura-2-pluto-en": aura2("aura-2-pluto-en", "Aura-2 Pluto (English)"),
  "aura-2-saturn-en": aura2("aura-2-saturn-en", "Aura-2 Saturn (English)"),
  "aura-2-selene-en": aura2("aura-2-selene-en", "Aura-2 Selene (English)"),
  "aura-2-thalia-en": aura2("aura-2-thalia-en", "Aura-2 Thalia (English)"),
  "aura-2-theia-en": aura2("aura-2-theia-en", "Aura-2 Theia (English)"),
  "aura-2-vesta-en": aura2("aura-2-vesta-en", "Aura-2 Vesta (English)"),
  "aura-2-zeus-en": aura2("aura-2-zeus-en", "Aura-2 Zeus (English)"),
  // Spanish (es)
  "aura-2-agustina-es": aura2("aura-2-agustina-es", "Aura-2 Agustina (Spanish)"),
  "aura-2-alvaro-es": aura2("aura-2-alvaro-es", "Aura-2 Alvaro (Spanish)"),
  "aura-2-antonia-es": aura2("aura-2-antonia-es", "Aura-2 Antonia (Spanish)"),
  "aura-2-aquila-es": aura2("aura-2-aquila-es", "Aura-2 Aquila (Spanish)"),
  "aura-2-carina-es": aura2("aura-2-carina-es", "Aura-2 Carina (Spanish)"),
  "aura-2-celeste-es": aura2("aura-2-celeste-es", "Aura-2 Celeste (Spanish)"),
  "aura-2-diana-es": aura2("aura-2-diana-es", "Aura-2 Diana (Spanish)"),
  "aura-2-estrella-es": aura2("aura-2-estrella-es", "Aura-2 Estrella (Spanish)"),
  "aura-2-gloria-es": aura2("aura-2-gloria-es", "Aura-2 Gloria (Spanish)"),
  "aura-2-javier-es": aura2("aura-2-javier-es", "Aura-2 Javier (Spanish)"),
  "aura-2-luciano-es": aura2("aura-2-luciano-es", "Aura-2 Luciano (Spanish)"),
  "aura-2-nestor-es": aura2("aura-2-nestor-es", "Aura-2 Nestor (Spanish)"),
  "aura-2-olivia-es": aura2("aura-2-olivia-es", "Aura-2 Olivia (Spanish)"),
  "aura-2-selena-es": aura2("aura-2-selena-es", "Aura-2 Selena (Spanish)"),
  "aura-2-silvia-es": aura2("aura-2-silvia-es", "Aura-2 Silvia (Spanish)"),
  "aura-2-sirio-es": aura2("aura-2-sirio-es", "Aura-2 Sirio (Spanish)"),
  "aura-2-valerio-es": aura2("aura-2-valerio-es", "Aura-2 Valerio (Spanish)"),
  // German (de)
  "aura-2-aurelia-de": aura2("aura-2-aurelia-de", "Aura-2 Aurelia (German)"),
  "aura-2-elara-de": aura2("aura-2-elara-de", "Aura-2 Elara (German)"),
  "aura-2-fabian-de": aura2("aura-2-fabian-de", "Aura-2 Fabian (German)"),
  "aura-2-julius-de": aura2("aura-2-julius-de", "Aura-2 Julius (German)"),
  "aura-2-kara-de": aura2("aura-2-kara-de", "Aura-2 Kara (German)"),
  "aura-2-lara-de": aura2("aura-2-lara-de", "Aura-2 Lara (German)"),
  "aura-2-viktoria-de": aura2("aura-2-viktoria-de", "Aura-2 Viktoria (German)"),
  // Dutch (nl)
  "aura-2-beatrix-nl": aura2("aura-2-beatrix-nl", "Aura-2 Beatrix (Dutch)"),
  "aura-2-cornelia-nl": aura2("aura-2-cornelia-nl", "Aura-2 Cornelia (Dutch)"),
  "aura-2-daphne-nl": aura2("aura-2-daphne-nl", "Aura-2 Daphne (Dutch)"),
  "aura-2-hestia-nl": aura2("aura-2-hestia-nl", "Aura-2 Hestia (Dutch)"),
  "aura-2-lars-nl": aura2("aura-2-lars-nl", "Aura-2 Lars (Dutch)"),
  "aura-2-leda-nl": aura2("aura-2-leda-nl", "Aura-2 Leda (Dutch)"),
  "aura-2-rhea-nl": aura2("aura-2-rhea-nl", "Aura-2 Rhea (Dutch)"),
  "aura-2-roman-nl": aura2("aura-2-roman-nl", "Aura-2 Roman (Dutch)"),
  "aura-2-sander-nl": aura2("aura-2-sander-nl", "Aura-2 Sander (Dutch)"),
  // French (fr)
  "aura-2-agathe-fr": aura2("aura-2-agathe-fr", "Aura-2 Agathe (French)"),
  "aura-2-hector-fr": aura2("aura-2-hector-fr", "Aura-2 Hector (French)"),
  // Italian (it)
  "aura-2-cesare-it": aura2("aura-2-cesare-it", "Aura-2 Cesare (Italian)"),
  "aura-2-cinzia-it": aura2("aura-2-cinzia-it", "Aura-2 Cinzia (Italian)"),
  "aura-2-demetra-it": aura2("aura-2-demetra-it", "Aura-2 Demetra (Italian)"),
  "aura-2-dionisio-it": aura2("aura-2-dionisio-it", "Aura-2 Dionisio (Italian)"),
  "aura-2-elio-it": aura2("aura-2-elio-it", "Aura-2 Elio (Italian)"),
  "aura-2-flavio-it": aura2("aura-2-flavio-it", "Aura-2 Flavio (Italian)"),
  "aura-2-livia-it": aura2("aura-2-livia-it", "Aura-2 Livia (Italian)"),
  "aura-2-maia-it": aura2("aura-2-maia-it", "Aura-2 Maia (Italian)"),
  "aura-2-melia-it": aura2("aura-2-melia-it", "Aura-2 Melia (Italian)"),
  "aura-2-perseo-it": aura2("aura-2-perseo-it", "Aura-2 Perseo (Italian)"),
  // Japanese (ja)
  "aura-2-ama-ja": aura2("aura-2-ama-ja", "Aura-2 Ama (Japanese)"),
  "aura-2-ebisu-ja": aura2("aura-2-ebisu-ja", "Aura-2 Ebisu (Japanese)"),
  "aura-2-fujin-ja": aura2("aura-2-fujin-ja", "Aura-2 Fujin (Japanese)"),
  "aura-2-izanami-ja": aura2("aura-2-izanami-ja", "Aura-2 Izanami (Japanese)"),
  "aura-2-uzume-ja": aura2("aura-2-uzume-ja", "Aura-2 Uzume (Japanese)"),
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...sttModels,
  ...ttsModels,
} as const satisfies Record<string, ModelInfo>;

/**
 * Route-scoped catalogs. `models` is the whole provider (what the CLI and
 * catalog consumers want); an endpoint that must not resolve the other
 * modality's ids can validate against one of these instead — ./speak gates on
 * TTS_MODEL_IDS and reports an STT id as unsupported_capability.
 */
export { sttModels, ttsModels };

/** Model ids POST /v1/listen (and the Flux /v2/listen WebSocket) serve. */
export type DeepgramSttModelId = keyof typeof sttModels;
/** Voice ids POST /v1/speak accepts. */
export type DeepgramTtsModelId = keyof typeof ttsModels;
export type DeepgramModelId = keyof typeof models;

/** Runtime allow-list backing the speak endpoint's model gate. */
export const TTS_MODEL_IDS: readonly string[] = Object.keys(ttsModels);
