/** Input/output modality of a model, as tracked by models.dev. */
export type Modality = "text" | "image" | "audio" | "video" | "pdf";

/** USD per 1M tokens (or per-unit for media rates). */
export interface ModelCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  inputAudio?: number;
  outputAudio?: number;
  /** USD per 1M input characters — TTS models billed by text length. */
  perMillionCharacters?: number;
  /** USD per minute of audio processed — STT models billed by duration. */
  perAudioMinute?: number;
  /** USD per generated image — image models with flat per-image pricing. */
  perImage?: number;
  /** USD per second of generated video — video models billed by duration. */
  perVideoSecond?: number;
}

export interface ModelLimit {
  context: number;
  output?: number;
  input?: number;
  /** Max input characters per request — TTS models. */
  characters?: number;
}

/**
 * Normalized per-model metadata generated from models.dev into each
 * provider's `models.gen.ts`. This is the contract the codegen targets —
 * generated files declare `satisfies Record<string, ModelInfo>` so a codegen
 * bug fails `tsc` instead of shipping.
 */
export interface ModelInfo {
  id: string;
  name: string;
  family?: string;
  attachment: boolean;
  reasoning: boolean;
  toolCall: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
  openWeights: boolean;
  releaseDate?: string;
  lastUpdated?: string;
  /** Knowledge cutoff date, when known. */
  knowledge?: string;
  /** Absent means stable. */
  status?: "alpha" | "beta" | "deprecated";
  modalities: { input: readonly Modality[]; output: readonly Modality[] };
  limit: ModelLimit;
  cost?: ModelCost;
}

export interface ProviderInfo {
  id: string;
  name: string;
  /** Env var names the provider's API key is conventionally read from. */
  env: readonly string[];
  doc?: string;
  /** OpenAI-compatible base URL, when the provider has one. */
  api?: string;
}
