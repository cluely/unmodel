/**
 * Per-route constraint tables for the FLUX.2 endpoint. The BFL API is one
 * route per model, and the routes take different Pydantic input schemas
 * (Flux2Inputs for pro/max, Flux2FlexInputs for flex, Flux2KleinInputs for
 * klein). These deny rules encode which schema each route uses, so a param
 * that only exists on a sibling route fails loudly instead of being silently
 * ignored server-side. Ground truth: https://api.bfl.ai/openapi.json
 * (verified 2026-08-13).
 */

import type { DenyRule, EndpointConstraints } from "../../core/constraint-types";

const OPENAPI_URL = "https://api.bfl.ai/openapi.json";

/** Deny rules for the pro/max routes (Flux2Inputs schema). */
const flux2ProMaxDeny: Record<string, DenyRule> = {
  prompt_upsampling: {
    reason:
      "the pro/max routes upsample prompts by default and expose `disable_pup` to turn it off; `prompt_upsampling` only exists on flux-2-flex and the kontext routes",
    source: `${OPENAPI_URL}#/components/schemas/Flux2Inputs`,
  },
  guidance: {
    reason: "only flux-2-flex exposes a guidance control (Flux2FlexInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2Inputs`,
  },
  steps: {
    reason: "only flux-2-flex exposes a steps control (Flux2FlexInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2Inputs`,
  },
  input_image_blob_path: {
    reason: "only flux-2-flex documents `input_image_blob_path` (Flux2FlexInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2Inputs`,
  },
};

/** Deny rules for the flex route (Flux2FlexInputs schema). */
const flux2FlexDeny: Record<string, DenyRule> = {
  disable_pup: {
    reason:
      "flux-2-flex controls prompt upsampling via `prompt_upsampling` (default true); `disable_pup` only exists on the flux-2-pro/max routes",
    source: `${OPENAPI_URL}#/components/schemas/Flux2FlexInputs`,
  },
};

/** Deny rules for the klein routes (Flux2KleinInputs schema). */
const flux2KleinDeny: Record<string, DenyRule> = {
  disable_pup: {
    reason: "the klein routes have no prompt-upsampling control (Flux2KleinInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2KleinInputs`,
  },
  prompt_upsampling: {
    reason: "the klein routes have no prompt-upsampling control (Flux2KleinInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2KleinInputs`,
  },
  guidance: {
    reason: "only flux-2-flex exposes a guidance control (Flux2FlexInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2KleinInputs`,
  },
  steps: {
    reason: "only flux-2-flex exposes a steps control (Flux2FlexInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2KleinInputs`,
  },
  input_image_blob_path: {
    reason: "only flux-2-flex documents `input_image_blob_path` (Flux2FlexInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2KleinInputs`,
  },
  input_image_5: {
    reason: "the klein routes accept at most 4 input images (Flux2KleinInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2KleinInputs`,
  },
  input_image_6: {
    reason: "the klein routes accept at most 4 input images (Flux2KleinInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2KleinInputs`,
  },
  input_image_7: {
    reason: "the klein routes accept at most 4 input images (Flux2KleinInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2KleinInputs`,
  },
  input_image_8: {
    reason: "the klein routes accept at most 4 input images (Flux2KleinInputs)",
    source: `${OPENAPI_URL}#/components/schemas/Flux2KleinInputs`,
  },
};

export const imageConstraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "flux-2-pro": { deny: flux2ProMaxDeny },
  "flux-2-max": { deny: flux2ProMaxDeny },
  "flux-2-pro-preview": { deny: flux2ProMaxDeny },
  "flux-2-flex": { deny: flux2FlexDeny },
  "flux-2-klein-9b": { deny: flux2KleinDeny },
  "flux-2-klein-9b-preview": { deny: flux2KleinDeny },
  "flux-2-klein-4b": { deny: flux2KleinDeny },
};

// ---------------------------------------------------------------------------
// FLUX.1 (previous generation) — three schemas across four routes.
// ---------------------------------------------------------------------------

/** Params only the ultra routes (FluxUltraInput) declare. */
const ULTRA_ONLY = {
  aspect_ratio: "only the flux-pro-1.1-ultra routes size by aspect ratio (FluxUltraInput); the width/height routes take pixel dimensions",
  raw: "`raw` (candid-photography mode) only exists on the flux-pro-1.1-ultra routes (FluxUltraInput)",
  image_prompt_strength:
    "`image_prompt_strength` only exists on the flux-pro-1.1-ultra routes (FluxUltraInput)",
} as const;

/** Params only the `-finetuned` routes declare. */
const FINETUNE_ONLY = {
  finetune_id: "LoRA params only exist on the `-finetuned` routes (FinetuneFluxUltraInput)",
  finetune_strength: "LoRA params only exist on the `-finetuned` routes (FinetuneFluxUltraInput)",
} as const;

function denyTable(
  entries: Readonly<Record<string, string>>,
  schema: string,
): Record<string, DenyRule> {
  const out: Record<string, DenyRule> = {};
  for (const [param, reason] of Object.entries(entries)) {
    out[param] = { reason, source: `${OPENAPI_URL}#/components/schemas/${schema}` };
  }
  return out;
}

/** flux-pro-1.1 (FluxPro11Inputs): width/height only — no steps, no guidance. */
const fluxPro11Deny: Record<string, DenyRule> = {
  ...denyTable(ULTRA_ONLY, "FluxPro11Inputs"),
  ...denyTable(FINETUNE_ONLY, "FluxPro11Inputs"),
  steps: {
    reason: "FLUX1.1 [pro] exposes no steps control (FluxPro11Inputs); use flux-dev for step control",
    source: `${OPENAPI_URL}#/components/schemas/FluxPro11Inputs`,
  },
  guidance: {
    reason:
      "FLUX1.1 [pro] exposes no guidance control (FluxPro11Inputs); use flux-dev for guidance control",
    source: `${OPENAPI_URL}#/components/schemas/FluxPro11Inputs`,
  },
};

/** flux-dev (FluxDevInputs): width/height + steps + guidance (1.5–5). */
const fluxDevDeny: Record<string, DenyRule> = {
  ...denyTable(ULTRA_ONLY, "FluxDevInputs"),
  ...denyTable(FINETUNE_ONLY, "FluxDevInputs"),
};

/** flux-pro-1.1-ultra (FluxUltraInput): aspect_ratio sizing — no pixels. */
const fluxUltraDeny: Record<string, DenyRule> = {
  ...denyTable(FINETUNE_ONLY, "FluxUltraInput"),
  width: {
    reason:
      "the ultra routes size by `aspect_ratio` (FluxUltraInput) and declare no width/height fields",
    source: `${OPENAPI_URL}#/components/schemas/FluxUltraInput`,
  },
  height: {
    reason:
      "the ultra routes size by `aspect_ratio` (FluxUltraInput) and declare no width/height fields",
    source: `${OPENAPI_URL}#/components/schemas/FluxUltraInput`,
  },
  steps: {
    reason: "the ultra routes expose no steps control (FluxUltraInput)",
    source: `${OPENAPI_URL}#/components/schemas/FluxUltraInput`,
  },
  guidance: {
    reason: "the ultra routes expose no guidance control (FluxUltraInput)",
    source: `${OPENAPI_URL}#/components/schemas/FluxUltraInput`,
  },
};

/** The finetuned ultra route is FluxUltraInput + finetune_id/strength. */
const fluxUltraFinetunedDeny: Record<string, DenyRule> = {
  width: fluxUltraDeny.width as DenyRule,
  height: fluxUltraDeny.height as DenyRule,
  steps: fluxUltraDeny.steps as DenyRule,
  guidance: fluxUltraDeny.guidance as DenyRule,
};

export const imageFlux1Constraints: Readonly<Partial<Record<string, EndpointConstraints>>> = {
  "flux-pro-1.1": { deny: fluxPro11Deny },
  "flux-dev": { deny: fluxDevDeny },
  "flux-pro-1.1-ultra": { deny: fluxUltraDeny },
  "flux-pro-1.1-ultra-finetuned": { deny: fluxUltraFinetunedDeny },
};
