// Hand-maintained — sync. is not in models.dev; refresh from
//   https://sync.so/docs/openapi.json                                  (curated OpenAPI 3.1, the supported surface)
//   https://sync.so/docs/api-reference/api/generate-api/create         (POST /v2/generate reference)
//   https://sync.so/docs/models/lipsync                                (the roster, the per-model options matrix, the rates)
//   https://sync.so/docs/models/sync-3                                 (image input, the sync-3-only capability)
//   https://sync.so/docs/api-reference/guides/authentication           (x-api-key)
//   https://sync.so/docs/api-reference/guides/rate-limits              (100/min create, 600/min poll, plan concurrency)
//   https://sync.so/pricing                                            (the per-tier discrete rates)
// Verified 2026-08-25. Every docs route also serves raw Markdown at `<route>.md`,
// which is what was read. A live roster is available at GET /v2/models.
//
// PRICING IS A RANGE, AND `ModelCost` HOLDS A NUMBER.
// sync. publishes each model's rate as a band — "$0.04 — $0.05/sec" for
// lipsync-2 — and the band is a volume discount, not an uncertainty: the
// /pricing page lists the discrete tier rates behind it ($0.04, $0.0475, $0.05
// for that model), and "Higher tiers receive usage discounts." So the number
// carried on each row is the TOP of the band, which is the undiscounted
// list rate every account pays before volume moves it, and the bottom of the
// band is quoted in the comment above the row. A cost estimate built from these
// rows is therefore an upper bound, which is the right direction for one.
//
// The rate is per SECOND OF OUTPUT at 25 fps, and the output's duration is the
// input's — which is why no endpoint here estimates. sync.'s own
// POST /v2/analyze/cost takes the same body and returns the exact figure; see
// `ANALYZE_COST_URL` in ./shared.ts.
//
// Model coverage: the five ids the curated spec's `Model` enum publishes, which
// is also exactly what `@sync.so/sdk@0.3.0`'s `Model.d.ts` declares. The full
// backend spec at https://sync.so/openapi.json adds `lipsync-2-mini` and
// `appearence-1`; neither has a docs page, a published rate or an SDK type, so
// unmodel does not type what it has not read.
//
// Deliberately NOT served: `POST /v2/tts` and the `/v2/voices` clone surface.
// They are an ElevenLabs passthrough — the request's own `provider.name` field
// has one legal value, `"elevenlabs"` — and unmodel already carries ElevenLabs
// natively at `unmodel/elevenlabs`, where the voice roster, the model ids and
// the format controls are the real ones rather than a two-field projection of
// them. A `sync.tts` would be a worse ElevenLabs under another vendor's name.
// (The `{ type: "text" }` INPUT item is a different thing and is served: there
// the synthesis is a stage of the lipsync generation, not a product.)
//
// Also not served: `/v2/assets`, `/v2/projects` and `/v2/batch`. Assets and
// projects are storage and organisation rather than generation — they mint the
// `assetId` an input item may carry, which unmodel types, and nothing else.
// Batch is a JSONL envelope around up to 500 copies of the body this provider
// already validates; validating the envelope adds nothing the line-level
// validator does not already say.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "sync",
  name: "sync.",
  // `x-api-key: <SYNC_API_KEY>` — https://sync.so/docs/api-reference/guides/authentication.
  // The env var is the one `@sync.so/sdk` itself reads (`process.env["SYNC_API_KEY"]`
  // in its generated clients) and the one its README names.
  env: ["SYNC_API_KEY"],
  doc: "https://sync.so/docs/api-reference/api/generate-api/create",
} as const satisfies ProviderInfo;

/** Clip in, track in, clip out. */
const clipModality = { input: ["audio", "video"], output: ["video"] } as const;

/**
 * The one model that also reads a still — which is what puts sync. in
 * `unmodel/avatar` as well as `unmodel/lipsync`.
 */
const clipOrStillModality = { input: ["audio", "image", "video"], output: ["video"] } as const;

export const models = {
  /**
   * $0.107 — $0.133 per second of output at 25 fps.
   *
   * Source: https://sync.so/docs/models/lipsync — verified 2026-08-25.
   * Quote: “| `sync-3` | $0.107 -- $0.133/sec | Fast (4/5) | Most powerful
   * model. 4K native output, built-in obstruction detection, extreme angles,
   * full-shot processing |”
   */
  "sync-3": {
    id: "sync-3",
    name: "sync-3",
    family: "sync-3",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: clipOrStillModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.133 },
    // The default model on the API overview, and the only one that reads an
    // image. Obstruction detection and expressiveness are native here, which
    // is why `occlusion_detection_enabled` and `temperature` are not on its
    // options row — there is no switch for something that is always on.
  },
  /**
   * $0.04 — $0.05 per second of output at 25 fps.
   *
   * Source: https://sync.so/docs/models/lipsync — verified 2026-08-25.
   * Quote: “| `lipsync-2` | $0.04 -- $0.05/sec | Fast (4/5) | Fast,
   * cost-efficient lipsync with solid quality |”
   */
  "lipsync-2": {
    id: "lipsync-2",
    name: "lipsync-2",
    family: "lipsync-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: clipModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.05 },
    // 512×512 face region. This is the model fal resells as
    // `fal-ai/sync-lipsync/v2` with `model: "lipsync-2"` on the wire — the same
    // weights reached two ways, and the comparison the `unmodel/lipsync`
    // golden tree pins.
  },
  /**
   * $0.067 — $0.083 per second of output at 25 fps.
   *
   * Source: https://sync.so/docs/models/lipsync — verified 2026-08-25.
   * Quote: “| `lipsync-2-pro` | $0.067 -- $0.083/sec | Moderate (3/5) | Premium
   * quality with diffusion-based super resolution, best for beards, teeth,
   * facial features |”
   */
  "lipsync-2-pro": {
    id: "lipsync-2-pro",
    name: "lipsync-2-pro",
    family: "lipsync-2",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: clipModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.083 },
    // lipsync-2 plus a diffusion super-resolution pass. 1.5–2× slower.
  },
  /**
   * $0.02 — $0.025 per second of output at 25 fps.
   *
   * Source: https://sync.so/docs/models/lipsync — verified 2026-08-25.
   * Quote: “| `lipsync-1.9.0-beta` | $0.02 -- $0.025/sec | Fastest (5/5) |
   * Legacy model. Fast lipsync for simple videos |”
   */
  "lipsync-1.9.0-beta": {
    id: "lipsync-1.9.0-beta",
    name: "lipsync-1.9.0-beta",
    family: "lipsync-1",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    // sync.'s own page calls it "Legacy model", and `GET /v2/models` carries a
    // `deprecatedAt` field it does not yet set for this id — so the row says
    // `beta` (its own name says so) rather than `deprecated`, which would make
    // every request that names it warn.
    status: "beta",
    modalities: clipModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.025 },
  },
  /**
   * $0.133 — $0.167 per second of output at 25 fps.
   *
   * Source: https://sync.so/docs/models/lipsync — verified 2026-08-25.
   * Quote: “react-1: $0.133 -- $0.167/sec (expressive emotions, requires paid
   * subscription)”
   */
  "react-1": {
    id: "react-1",
    name: "react-1",
    family: "react",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: clipModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.167 },
    // The only model whose `ModelInfo.type` on GET /v2/models is `"react"`
    // rather than `"lipsync"`, and the only one that reads `options.prompt`
    // (a one-word emotion) and `options.model_mode` (how much of the head may
    // move). It requires a paid subscription and the API overview caps it at
    // about 15 seconds — neither is discoverable from a request, so neither is
    // checked.
  },
} as const satisfies Record<string, ModelInfo>;

export type SyncCatalogModelId = keyof typeof models;
