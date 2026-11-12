// Hand-maintained — these Veo model ids are missing from models.dev's google
// catalog (src/catalog/google.gen.ts carries no Veo id at all); refresh from
//   https://ai.google.dev/gemini-api/docs/veo      (model ids, capabilities, status)
//   https://ai.google.dev/gemini-api/docs/pricing  (per-second video rates)
//   https://ai.google.dev/gemini-api/docs/deprecations
//
// Provenance note (2026-08-13, re-verified 2026-11-12): the Veo docs page's
// "Model versions" section lists explicit Gemini API model codes for the line,
// and the pricing page repeats them verbatim:
//   veo-3.0-generate-001 / veo-3.0-fast-generate-001            (Deprecated)
//   veo-2.0-generate-001                                        (Deprecated)
// All three carry `status: "deprecated"` so requests get a deprecated_model
// warning instead of the much vaguer unknown_model; the deprecations page
// dates every one's shutdown to June 30, 2026 (`veo-3.0-generate-001` —
// "September 9, 2025 — June 30, 2026"; `veo-2.0-generate-001` — "April 9,
// 2025 — June 30, 2026"). The Veo 3.1 preview ids are not here: the model
// pages state "`veo-3.1-generate-preview` and `veo-3.1-fast-generate-preview`
// were shut down on October 22, 2026" and "`veo-3.1-lite-generate-preview`
// was shut down on October 22, 2026", with `gemini-omni-1.2-flash` (an
// Interactions API model) as the deprecations page's replacement.
//
// Pricing (Gemini API pricing page, USD per second of generated video):
// - veo-2.0-generate-001: $0.35 flat.
// - veo-3.0-generate-001: $0.40 flat; veo-3.0-fast-generate-001: $0.10 at
//   720p (see VEO_RESOLUTION_RATE_OVERRIDES for its 1080p/4k rates).
//
// `limit.context: 0` — video models are not token-context models, so the
// pipeline's context-window checks are skipped (HAND_CATALOGS.md rule). The
// documented per-request PROMPT cap rides on `limit.input` instead: the docs'
// "Text input: 1,024 tokens" for the Veo 3 entries, which ./video checks. Veo 2
// documents "Text input: N/A", so it carries no `input` bound.

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/google.gen";

/**
 * "Text input: 1,024 tokens" — the Veo 3.x entries of the "Model versions"
 * section on https://ai.google.dev/gemini-api/docs/veo. Rides on
 * `limit.input`, which ./video checks against the prompt. Veo 2's
 * text input limit is documented as "N/A", so it carries no `input` bound.
 */
export const VEO_3_PROMPT_MAX_TOKENS = 1024;

/** Veo ids the generated google catalog lacks. */
export const veoSupplementModels = {
  "veo-2.0-generate-001": {
    id: "veo-2.0-generate-001",
    name: "Veo 2",
    family: "veo",
    attachment: true,
    reasoning: false,
    toolCall: false,
    temperature: false,
    openWeights: false,
    releaseDate: "2024-12-16",
    lastUpdated: "2025-04",
    // "Veo 2 (Deprecated)" on the Veo docs page; the deprecations page dates
    // the shutdown to 2026-06-30.
    status: "deprecated",
    // Text-to-video and image-to-video; silent output (no native audio).
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0 },
    cost: { perVideoSecond: 0.35 },
  },
  "veo-3.0-generate-001": {
    id: "veo-3.0-generate-001",
    name: "Veo 3",
    family: "veo",
    attachment: true,
    reasoning: false,
    toolCall: false,
    temperature: false,
    openWeights: false,
    releaseDate: "2025-07-01",
    lastUpdated: "2025-07",
    status: "deprecated",
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0, input: VEO_3_PROMPT_MAX_TOKENS },
    cost: { perVideoSecond: 0.4 },
  },
  "veo-3.0-fast-generate-001": {
    id: "veo-3.0-fast-generate-001",
    name: "Veo 3 Fast",
    family: "veo",
    attachment: true,
    reasoning: false,
    toolCall: false,
    temperature: false,
    openWeights: false,
    releaseDate: "2025-07-01",
    lastUpdated: "2025-07",
    status: "deprecated",
    modalities: { input: ["text", "image"], output: ["video"] },
    limit: { context: 0, input: VEO_3_PROMPT_MAX_TOKENS },
    cost: { perVideoSecond: 0.1 },
  },
} as const satisfies Record<string, ModelInfo>;

/**
 * Catalog used by the video validator: the full generated google catalog
 * (so a non-video id is refused by its row rather than reported unknown) plus
 * the hand entries above.
 */
export const videoModels: Record<string, ModelInfo> = {
  ...models,
  ...veoSupplementModels,
};

/** Hand-supplemented Veo ids. */
export type GoogleVeoSupplementModelId = keyof typeof veoSupplementModels;
