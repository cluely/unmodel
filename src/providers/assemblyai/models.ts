// Hand-maintained — AssemblyAI is not in models.dev; refresh from
// https://www.assemblyai.com/docs/getting-started/models and
// https://www.assemblyai.com/pricing (last checked 2026-08-13).
//
// STREAMING: the realtime WebSocket API reuses the SAME `speech_model` id as
// batch (the streaming docs show `speech_model: "universal-3-5-pro"`), so
// there is no separate id to catalogue; it is billed differently
// ($0.45/hr for Universal-3.5 Pro Realtime, $0.15/hr for the
// Universal-Streaming English/Multilingual tiers). unmodel does not validate
// that API, and the per-minute costs below are the PRE-RECORDED rates.
//
// NOT LISTED (deliberate): the suffixed realtime ids that appear on
// third-party leaderboards — universal-3-5-pro-max-accuracy,
// universal-3-5-pro-min-latency, u3-rt-pro — and a bare `universal` batch id
// appear nowhere in AssemblyAI's current docs or pricing page, so no id,
// status or rate can be sourced for them.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "assemblyai",
  name: "AssemblyAI",
  env: ["ASSEMBLYAI_API_KEY"],
  doc: "https://www.assemblyai.com/docs",
} as const satisfies ProviderInfo;

/**
 * Unit conversions (assemblyai.com/pricing quotes per HOUR, checked
 * 2026-08-13; ModelCost.perAudioMinute is USD per MINUTE):
 * - Universal-3.5 Pro pre-recorded: $0.21/hr ÷ 60 = $0.0035/min.
 * - Universal-2 pre-recorded: $0.15/hr ÷ 60 = $0.0025/min.
 * Add-ons (diarization +$0.02/hr, medical mode +$0.15/hr, PII redaction
 * +$0.08/hr, …) are NOT folded into estimates.
 */
const U35_PRO_USD_PER_MINUTE = 0.21 / 60;
const U2_USD_PER_MINUTE = 0.15 / 60;

/** Shared shape of every AssemblyAI STT catalog entry. */
const STT = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  openWeights: false,
  modalities: { input: ["audio"], output: ["text"] },
  // limit.context 0: STT is not token-windowed; the pipeline skips context checks.
  limit: { context: 0 },
} as const;

export const models = {
  "universal-3-5-pro": {
    id: "universal-3-5-pro",
    name: "Universal-3.5 Pro",
    family: "universal",
    ...STT,
    cost: { perAudioMinute: U35_PRO_USD_PER_MINUTE },
  },
  "universal-2": {
    id: "universal-2",
    name: "Universal-2",
    family: "universal",
    ...STT,
    cost: { perAudioMinute: U2_USD_PER_MINUTE },
  },
  // Superseded by universal-3-5-pro: the API still accepts it but responds
  // with an informational warning suggesting the newer model
  // (assemblyai.com/changelog). No current price is published, so no cost.
  "universal-3-pro": {
    id: "universal-3-pro",
    name: "Universal-3 Pro",
    family: "universal",
    ...STT,
  },
  // Deprecated per assemblyai.com/pricing ("migrate to `universal-3-pro`");
  // no current price is published, so no cost.
  "slam-1": {
    id: "slam-1",
    name: "Slam-1",
    family: "slam",
    ...STT,
    status: "deprecated",
  },
} as const satisfies Record<string, ModelInfo>;

export type AssemblyaiModelId = keyof typeof models;
