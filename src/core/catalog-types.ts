/**
 * Input/output modality of a model.
 *
 * The first five are models.dev's own vocabulary and `scripts/availability.ts`
 * parses exactly those. `"3d"` is unmodel's, added with `unmodel/3d`: a mesh is
 * not a picture of one, and filing a GLB under `"image"` because the response
 * also carries a preview render would make `modalities.output` lie about what
 * the request bought. models.dev tracks no 3D models, so the member only ever
 * appears on hand and fal-generated rows.
 */
export type Modality = "text" | "image" | "audio" | "video" | "pdf" | "3d";

/**
 * The model-id slot for an explicit future-model arm.
 *
 * `Candidate` defaults to `never` at each public body alias, which keeps that
 * alias closed over its known discriminated arms. Supplying a future literal
 * opens only that literal; accidentally supplying a known id stays
 * uninhabitable so it cannot bypass the known arm's narrower fields.
 *
 * A deliberately widened `string` remains supported for callers whose model
 * ids truly arrive at runtime. That loss of narrowing is explicit at the body
 * alias (`SomeBody<string>`), rather than silently infecting its default form.
 */
export type FutureModelId<Candidate extends string, Known extends string> =
  Candidate extends Known ? never : Candidate;

/**
 * The ids in a generated catalog whose capability flag `K` is the literal
 * `false` — the Tier-A keying mechanism, written once.
 *
 * The point is that no hand-copied id list exists to drift: a model whose
 * `temperature: false` flag flips in the next `bun run codegen` moves in or out
 * of the union by itself. That is also the hazard, which is why every use of
 * this type is paired with a test that pins the resolved union: a catalog regen
 * that changes a flag has to surface as a test diff, never as a silent break in
 * a caller's code.
 *
 * `Models` is the `as const satisfies Record<string, ModelInfo>` table itself,
 * not `ModelInfo` — the literal `false` is exactly what the annotation would
 * have discarded.
 */
export type ModelsWhereFalse<Models, K extends keyof ModelInfo> = Extract<
  {
    [M in keyof Models]: Models[M] extends Record<K, false> ? M : never;
  }[keyof Models],
  string
>;

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
