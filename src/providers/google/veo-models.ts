// Hand-maintained — these Veo model ids are missing from models.dev's google
// catalog (src/catalog/google.gen.ts carries only the veo-3.1 family); refresh from
//   https://ai.google.dev/gemini-api/docs/veo      (model ids, capabilities, status)
//   https://ai.google.dev/gemini-api/docs/pricing  (per-second video rates)
//
// Provenance note (2026-08-13, re-verified): the Veo docs page's "Model
// versions" section now lists explicit Gemini API model codes for the whole
// line, and the pricing page repeats them verbatim:
//   veo-3.1-generate-preview / veo-3.1-fast-generate-preview /
//   veo-3.1-lite-generate-preview  (Preview)
//   veo-3.0-generate-001 / veo-3.0-fast-generate-001            (Deprecated)
//   veo-2.0-generate-001                                        (Deprecated)
// The veo-3.0 ids were previously dropped from this file as unconfirmable;
// both first-party pages now state them, so they are back — carrying
// `status: "deprecated"` so requests get a deprecated_model warning instead of
// the much vaguer unknown_model.
//
// Pricing (Gemini API pricing page, USD per second of generated video):
// - veo-2.0-generate-001: $0.35 flat.
// - veo-3.0-generate-001: $0.40 flat; veo-3.0-fast-generate-001: $0.10 at
//   720p (see VEO_RESOLUTION_RATE_OVERRIDES for its 1080p/4k rates).
// - veo-3.1 family (generated entries carry no cost, so it is supplemented in
//   the merged catalog below): standard $0.40, fast $0.10, lite $0.05 at 720p.
//
// `limit.context: 0` — video models are not token-context models, so the
// pipeline's context-window checks are skipped (HAND_CATALOGS.md rule). The
// documented per-request PROMPT cap rides on `limit.input` instead: the docs'
// "Text input: 1,024 tokens" beats models.dev's stale 480 for the veo-3.1
// entries, and ./generate-videos checks it. Veo 2 documents "Text input: N/A",
// so it carries no `input` bound.

import type { ModelInfo } from "../../core/catalog-types";
import { models } from "../../catalog/google.gen";

/**
 * "Text input: 1,024 tokens" — the Veo 3.x entries of the "Model versions"
 * section on https://ai.google.dev/gemini-api/docs/veo. Rides on
 * `limit.input`, which ./generate-videos checks against the prompt. Veo 2's
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
    // "Veo 2 (Deprecated)" on the Veo docs page; the pricing page dates the
    // shutdown to 2026-06-30.
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

/** Doc-sourced limit shared by every veo-3.1 entry (see the header note). */
const VEO_3_1_LIMIT = { context: 0, input: VEO_3_PROMPT_MAX_TOKENS } as const;

/**
 * Catalog used by the generateVideos validator: the full generated google
 * catalog, plus the hand entries above, plus 720p per-second pricing and the
 * documented prompt limit supplemented onto the generated veo-3.1 entries
 * (models.dev carries no cost for them, and a stale 480-token context). If the
 * generated file ever grows real cost data, drop these overrides — they would
 * shadow it.
 */
export const generateVideosModels: Record<string, ModelInfo> = {
  ...models,
  "veo-3.1-generate-preview": {
    ...models["veo-3.1-generate-preview"],
    limit: VEO_3_1_LIMIT,
    cost: { perVideoSecond: 0.4 },
  },
  "veo-3.1-fast-generate-preview": {
    ...models["veo-3.1-fast-generate-preview"],
    limit: VEO_3_1_LIMIT,
    cost: { perVideoSecond: 0.1 },
  },
  "veo-3.1-lite-generate-preview": {
    ...models["veo-3.1-lite-generate-preview"],
    limit: VEO_3_1_LIMIT,
    cost: { perVideoSecond: 0.05 },
  },
  ...veoSupplementModels,
};

/** Hand-supplemented Veo ids (the generated union covers the veo-3.1 family). */
export type GoogleVeoSupplementModelId = keyof typeof veoSupplementModels;
