// Hand-maintained — Inworld is not in models.dev; refresh from
// https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech,
// https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket,
// https://docs.inworld.ai/tts/tts-models,
// https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe,
// https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket,
// https://docs.inworld.ai/stt/third-party (the routed-model roster and its
// per-model endpoint table), and https://inworld.ai/pricing
// (last checked 2026-11-12).
//
// PRICING: the published On-Demand (pay-as-you-go, no commitment) list prices
// from inworld.ai/pricing — committed plans (Creator/Builder/Developer/
// Growth/Enterprise) step down from there. TTS is quoted per 1M characters
// and lands on `perMillionCharacters` unconverted. STT is quoted PER HOUR
// ("STT 1 $0.15/hr") and `perAudioMinute` is per MINUTE, so it is the hourly
// rate / 60. Models without a published USD list price omit `cost` rather
// than guess — Inworld's pricing table has exactly one STT row ("STT 1"), so
// the routed third-party models (Groq/AssemblyAI/Soniox/Deepgram) carry no
// rate here even though the API accepts their ids. Its TTS rows are TTS-2 and
// TTS-2 Flash alone, so the deprecated 1.x generations carry none either.
//
// LIMITS: the TTS synthesize endpoint documents "`text` accepts up to **2,000
// UTF-16 code units** (JavaScript `text.length`)", encoded as
// `limit.characters`. `limit.context: 0`
// disables token-window checks — none of these are token models. STT has no
// character limit; its cap is a ~16 MB request-body cap, which is a property
// of the endpoint (see transcribe.ts), not of the model.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "inworld",
  name: "Inworld",
  env: ["INWORLD_API_KEY"],
  doc: "https://docs.inworld.ai",
} as const satisfies ProviderInfo;

// ---------------------------------------------------------------------------
// Text-to-speech — POST /tts/v1/voice and the voice:streamBidirectional
// WebSocket, which share one model-id namespace.
// ---------------------------------------------------------------------------

const ttsModels = {
  // "Our most powerful model with natural language steering and the
  // strongest multilingual capabilities" — 200+ languages, 100ms TTFB (P90).
  "inworld-tts-2": {
    id: "inworld-tts-2",
    name: "Realtime TTS-2",
    family: "inworld-tts-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 2000 },
    // On-Demand "TTS-2 $25/1M chars" (inworld.ai/pricing, 2026-11-12).
    cost: { perMillionCharacters: 25 },
  },
  // "Our fastest, most cost-efficient model" — 20ms TTFB (P90).
  "inworld-tts-2-flash": {
    id: "inworld-tts-2-flash",
    name: "Realtime TTS-2 Flash",
    family: "inworld-tts-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 2000 },
    // On-Demand "TTS-2 Flash $15/1M chars" (inworld.ai/pricing, 2026-11-12).
    cost: { perMillionCharacters: 15 },
  },
  // Previous generation — "Previous-generation models (`inworld-tts-1`,
  // `inworld-tts-1-max`, `inworld-tts-1.5-max`, `inworld-tts-1.5-mini`) are
  // deprecated and not recommended for new projects", but the 1.5 ids are
  // still accepted (docs.inworld.ai/tts/tts-models, 2026-11-12). No `cost`:
  // inworld.ai/pricing (2026-11-12) prints no 1.5 row, only TTS-2 and TTS-2
  // Flash.
  "inworld-tts-1.5-max": {
    id: "inworld-tts-1.5-max",
    name: "TTS 1.5 Max",
    family: "inworld-tts-1.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 2000 },
  },
  "inworld-tts-1.5-mini": {
    id: "inworld-tts-1.5-mini",
    name: "TTS 1.5 Mini",
    family: "inworld-tts-1.5",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 2000 },
  },
  // "`inworld-tts-1` and `inworld-tts-1-max` were discontinued on **June 15,
  // 2026**. Requests to those two models are automatically routed to newer
  // models." (docs.inworld.ai/tts/tts-models, 2026-11-12.) The ids still
  // resolve; the target model — and so the rate — is unnamed, so no `cost`.
  "inworld-tts-1": {
    id: "inworld-tts-1",
    name: "TTS 1",
    family: "inworld-tts-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 2000 },
  },
  "inworld-tts-1-max": {
    id: "inworld-tts-1-max",
    name: "TTS 1 Max",
    family: "inworld-tts-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    status: "deprecated",
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0, characters: 2000 },
  },
} as const satisfies Record<string, ModelInfo>;

// ---------------------------------------------------------------------------
// Speech-to-text — POST /stt/v1/transcribe (sync) and the
// transcribe:streamBidirectional WebSocket.
//
// Inworld's STT surface is a ROUTER: `modelId` is always `{provider}/{model}`
// and most ids are third-party models Inworld fronts. `family` therefore
// carries the ROUTED VENDOR (the `{provider}` half of the id) rather than a
// model family — that vendor is the axis every per-model rule on this API
// turns on: which endpoint serves the model, which provider-specific config
// block is legal, and which optional features are wired up.
// ---------------------------------------------------------------------------

/** Shared shape of every Inworld STT catalog entry. */
const STT = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["audio"], output: ["text"] },
  // limit.context 0: STT is not token-windowed; the pipeline skips context checks.
  limit: { context: 0 },
} as const;

/**
 * On-Demand "STT 1 $0.15/hr" (inworld.ai/pricing, 2026-11-12) expressed per
 * minute. The only STT row on Inworld's pricing page.
 */
export const STT_1_USD_PER_MINUTE = 0.15 / 60;

const sttModels = {
  // The only first-party STT model, and the only id served by BOTH endpoints.
  // "Voice Profile + 30 languages + configurable turn-taking"
  // (docs.inworld.ai/stt/overview).
  "inworld/inworld-stt-1": {
    id: "inworld/inworld-stt-1",
    name: "Realtime STT 1",
    family: "inworld",
    ...STT,
    cost: { perAudioMinute: STT_1_USD_PER_MINUTE },
  },
  // Routed vendors below, all without `cost`. docs.inworld.ai/stt/third-party
  // (2026-11-12) prints a per-hour row — "| Pricing (per hour) | [$0.10/hr]
  // (https://inworld.ai/pricing) | $0.111/hr | $0.21/hr | $0.45/hr | $0.12/hr
  // | $0.12/hr |" — but its inworld-stt-1 cell is $0.10/hr, which
  // inworld.ai/pricing shows as a committed-plan rate ("STT 1 $0.15
  // $0.10/hr"; On-Demand is $0.15/hr). The column's tier is unstated, so its
  // figures cannot be read as On-Demand list prices.
  //
  // Groq — "100+ languages, recorded audio"; SYNC ONLY.
  "groq/whisper-large-v3": {
    id: "groq/whisper-large-v3",
    name: "Whisper Large v3 (via Groq)",
    family: "groq",
    ...STT,
  },
  // AssemblyAI — WEBSOCKET ONLY.
  "assemblyai/universal-streaming-multilingual": {
    id: "assemblyai/universal-streaming-multilingual",
    name: "Universal Streaming Multilingual (via AssemblyAI)",
    family: "assemblyai",
    ...STT,
  },
  "assemblyai/universal-streaming-english": {
    id: "assemblyai/universal-streaming-english",
    name: "Universal Streaming English (via AssemblyAI)",
    family: "assemblyai",
    ...STT,
  },
  // docs.inworld.ai/stt/third-party (2026-11-12): "| **Feature** |
  // **inworld/inworld-stt-1** | **groq/whisper-large-v3** |
  // **assemblyai/universal-3-5-pro** | …", "| Endpoint | Sync API +
  // WebSocket | Sync API only | WebSocket only | …" and "| Languages | 30 … |
  // 100+ (Whisper) | 18 languages | …". Cost omitted — see above.
  "assemblyai/universal-3-5-pro": {
    id: "assemblyai/universal-3-5-pro",
    name: "Universal-3.5 Pro (via AssemblyAI)",
    family: "assemblyai",
    ...STT,
  },
  // "Sub-300ms latency multilingual"; the model Inworld's assemblyaiConfig
  // table names for `prompt` ("Universal-3 Pro Streaming only"). The same
  // page's Realtime AssemblyAI example also sends a `prompt` to
  // universal-3-5-pro (docs.inworld.ai/stt/third-party, 2026-11-13), so that
  // route takes it with a warning — see checkTranscribeConfig in ./stt.
  "assemblyai/u3-rt-pro": {
    id: "assemblyai/u3-rt-pro",
    name: "Universal-3 Realtime Pro (via AssemblyAI)",
    family: "assemblyai",
    ...STT,
  },
  "assemblyai/whisper-rt": {
    id: "assemblyai/whisper-rt",
    name: "Whisper Realtime (via AssemblyAI)",
    family: "assemblyai",
    ...STT,
  },
  // Soniox — WEBSOCKET ONLY. "60+ languages, speaker separation".
  "soniox/stt-rt-v4": {
    id: "soniox/stt-rt-v4",
    name: "Soniox Realtime v4 (via Soniox)",
    family: "soniox",
    ...STT,
  },
  "soniox/stt-rt-v5": {
    id: "soniox/stt-rt-v5",
    name: "Soniox Realtime v5 (via Soniox)",
    family: "soniox",
    ...STT,
  },
  // Deepgram — WEBSOCKET ONLY. Flux is Deepgram's conversational-agent STT.
  "deepgram/flux-general-en": {
    id: "deepgram/flux-general-en",
    name: "Flux General English (via Deepgram)",
    family: "deepgram",
    ...STT,
  },
  "deepgram/flux-general-multi": {
    id: "deepgram/flux-general-multi",
    name: "Flux General Multilingual (via Deepgram)",
    family: "deepgram",
    ...STT,
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Voice creation — POST /voices/v1/voices:clone (./voice-clone) and
 * POST /voices/v1/voices:design (./voice-design). Neither wire has a model
 * field: both ids are SYNTHETIC route nouns so the validators have catalog
 * addresses. inworld.ai/pricing publishes no per-request rate for either
 * (cloned-voice storage is subscription-gated; design is a research
 * preview), so `cost` is omitted.
 */
const voiceModels = {
  "voice-clone": {
    id: "voice-clone",
    name: "Inworld Voice Cloning",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["audio"], output: ["audio"] },
    limit: { context: 0 },
  },
  "voice-design": {
    id: "voice-design",
    name: "Inworld Voice Design",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["audio"] },
    limit: { context: 0 },
  },
} as const satisfies Record<string, ModelInfo>;

export const models = {
  ...ttsModels,
  ...sttModels,
  ...voiceModels,
} as const satisfies Record<string, ModelInfo>;

/**
 * Route-scoped catalogs. `models` is the whole provider (what the CLI and
 * catalog consumers want); an endpoint that must not resolve the other
 * modality's ids validates against one of these instead.
 */
export { ttsModels, sttModels, voiceModels };

export type InworldModelId = keyof typeof models;
/** Model ids POST /tts/v1/voice and the TTS WebSocket accept. */
export type InworldTtsModelId = keyof typeof ttsModels;
/** The synthetic ids addressing the voice-creation routes (no model fields on those wires). */
export type InworldVoiceModelId = keyof typeof voiceModels;
/** Model ids the STT router accepts, on either endpoint. */
export type InworldSttModelId = keyof typeof sttModels;

/**
 * The routed vendor half of an STT model id. Also what `ModelInfo.family`
 * holds for every STT entry.
 */
export type InworldSttVendor = "inworld" | "groq" | "assemblyai" | "soniox" | "deepgram";

/**
 * Which STT models each endpoint serves. Straight from the per-model table on
 * docs.inworld.ai/stt/third-party (2026-11-12): "| Endpoint | Sync API +
 * WebSocket | Sync API only | WebSocket only | WebSocket only | WebSocket only
 * | WebSocket only |" against inworld-stt-1, groq/whisper-large-v3 and the
 * AssemblyAI and Soniox ids. The sync validator reports a WebSocket-only id
 * rather than shipping a request that cannot be served.
 */
export const STT_SYNC_MODEL_IDS = [
  "inworld/inworld-stt-1",
  "groq/whisper-large-v3",
] as const satisfies readonly InworldSttModelId[];

export const STT_STREAM_MODEL_IDS = [
  "inworld/inworld-stt-1",
  "assemblyai/universal-streaming-multilingual",
  "assemblyai/universal-streaming-english",
  "assemblyai/universal-3-5-pro",
  "assemblyai/u3-rt-pro",
  "assemblyai/whisper-rt",
  "soniox/stt-rt-v4",
  "soniox/stt-rt-v5",
  "deepgram/flux-general-en",
  "deepgram/flux-general-multi",
] as const satisfies readonly InworldSttModelId[];
