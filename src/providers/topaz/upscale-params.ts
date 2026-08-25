/**
 * The upscale adapter's **data**: the model list and the per-model narrowing
 * table, across both of Topaz's image routes.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/topaz/values` publishes these for client-side pickers and the
 * adapter imports this provider's two validators, their zod schemas and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 *
 * ## Every row says `factors: []`, and that is the interesting part
 *
 * `factor` is `unmodel/upscale`'s one cross-vendor word, and Topaz does not
 * have it. Its envelope states an ABSOLUTE output size — `output_width` and
 * `output_height`, 1 to 32000 — and there is no multiplier anywhere on either
 * route. `factors: []` is the vocabulary's way of typing that as `never`, so
 * `factor: 2` at a Topaz ref is a compile error naming the two fields that do
 * exist rather than a silently dropped number.
 *
 * Which is a genuinely different reason from the category's other `never`:
 * `fal-ai/recraft/upscale/crisp` refuses `factor` because it CHOOSES its own
 * output size, and Topaz refuses it because it takes an absolute one. Two ways
 * to have no multiplier, and the adapter's refusals say which is which.
 *
 * A multiplier is not derivable here either — `factor: 2` would need the
 * input's dimensions to become an output size, and the input arrives as a URL.
 *
 * ## `prompt` is the word Topaz DID bring
 *
 * Nine of the fifteen models take one, up to 1024 characters, and Topaz asks
 * for it descriptive rather than imperative. That is the second independent
 * witness for `unmodel/upscale`'s `prompt` — `fal-ai/clarity-upscaler` and
 * `topaz/upscale/image/generative` at fal were the first, and one of those two
 * is this very model behind a reseller.
 *
 * ## The route is a fact about the model
 *
 * Six models are on `/enhance/async` and nine on `/enhance-gen/async`, and the
 * enums are disjoint — so `unified.ts` picks the URL from the ref rather than
 * from a parameter, the way `unmodel/tripo3d` picks its URL from the input.
 * Which route a model is on shows up here as the shape of its extras: the
 * classic six take `strength` and `fixCompression`, the generative nine take
 * `creativity`, `texture`, `detail` and `autoprompt`, and nothing takes both.
 */

import { EXTRA } from "../../core/unified/derive";
import type { UpscaleModelParamTable } from "../../core/unified/vocabulary/upscale";
import type {
  TopazEnhancementStrength,
  TopazGrainModel,
  TopazOutputFormat,
  TopazSubjectDetection,
} from "./shared";

/** Every id `unmodel/upscale` can name at Topaz — the `topaz/…` ref union. */
export const MODELS = [
  "Standard V2",
  "High Fidelity V2",
  "Upscale High Fidelity V3",
  "Low Resolution V2",
  "CGI",
  "Text Refine",
  "Redefine",
  "Wonder",
  "Wonder 2",
  "Wonder 3",
  "Wonder 3.5",
  "Standard MAX",
  "Recover 3",
  "Bloom 2",
  "Bloom Realism",
] as const;

/** A still, at every model. Topaz's clip surface is a different API — see `./models.ts`. */
const SOURCES = ["image"] as const;

/** No multiplier anywhere on either route: `factor` types as `never`. */
const FACTORS = [] as const;

/** The envelope, which both routes share and which the vocabulary has no words for. */
const ENVELOPE_EXTRAS = {
  /** 1–32000. This and `output_height` are what Topaz has instead of `factor`. */
  output_width: EXTRA as number,
  /** 1–32000. Naming only one scales the other proportionally. */
  output_height: EXTRA as number,
  /** Crop rather than letterbox when the target ratio differs. Default false. */
  crop_to_fill: EXTRA as boolean,
  /** Default `"jpeg"`. */
  output_format: EXTRA as TopazOutputFormat,
  /** JSON callback on every status change; replaces polling. */
  webhook_url: EXTRA as string,
  /** A source Topaz already holds, from an earlier job's `source_id`. */
  source_id: EXTRA as string,
} as const;

/** The dials both routes document for every model on them. */
const SHARED_FACE = {
  /** Run the face-recovery model over detected faces. */
  faceEnhancement: EXTRA as boolean,
  /** 0–1. Required once `faceEnhancement` is true. */
  faceEnhancementStrength: EXTRA as number,
  /** 0–1. Required once `faceEnhancement` is true. Realistic ↔ creative. */
  faceEnhancementCreativity: EXTRA as number,
  /** Where enhancements are applied. */
  subjectDetection: EXTRA as TopazSubjectDetection,
} as const;

/** `/enhance/async` — the classic dials. */
const ENHANCE_EXTRAS = {
  ...ENVELOPE_EXTRAS,
  ...SHARED_FACE,
  /** 0–1. */
  sharpen: EXTRA as number,
  /** 0–1. */
  denoise: EXTRA as number,
  /** 0–1. Reduces compression artefacts. */
  fixCompression: EXTRA as number,
  /** 0.01–1. Overall model strength; too high looks unreal. */
  strength: EXTRA as number,
} as const;

/** `/enhance-gen/async` — the generative dials. `prompt` is canonical, so absent. */
const ENHANCE_GEN_EXTRAS = {
  ...ENVELOPE_EXTRAS,
  ...SHARED_FACE,
  /** Write the prompt automatically, ignoring whatever `prompt` said. */
  autoprompt: EXTRA as boolean,
  /** Integer 1–9, default 3. How far the model may stray from the source. */
  creativity: EXTRA as number,
  /** Integer 1–5. Topaz recommends 1 at low creativity, 3 at high. */
  texture: EXTRA as number,
  /** 0–1. */
  sharpen: EXTRA as number,
  /** 0–1. */
  denoise: EXTRA as number,
  /** Add detail after rendering. Default false. */
  detail: EXTRA as boolean,
  /** 0–10. Required once `detail` is true. */
  detailStrength: EXTRA as number,
} as const;

/** Film grain, on the two newest generative models. */
const GRAIN_EXTRAS = {
  grain: EXTRA as boolean,
  grainDensity: EXTRA as number,
  grainModel: EXTRA as TopazGrainModel,
  grainSize: EXTRA as number,
  grainStrength: EXTRA as number,
} as const;

/**
 * A SECOND, camelCased spelling of the sizes, on the two newest generative
 * models only, alongside the envelope's own snake_cased pair.
 *
 * Topaz documents both on those pages and states no precedence. Both are typed,
 * neither is preferred, and `unified.ts` never writes either — it is `factor`'s
 * absence that sends a caller here.
 */
const DIMENSION_EXTRAS = {
  inputWidth: EXTRA as number,
  inputHeight: EXTRA as number,
  outputWidth: EXTRA as number,
  outputHeight: EXTRA as number,
} as const;

const ENHANCE_ROW = { sources: SOURCES, factors: FACTORS, extras: ENHANCE_EXTRAS } as const;
const ENHANCE_GEN_ROW = { sources: SOURCES, factors: FACTORS, extras: ENHANCE_GEN_EXTRAS } as const;

export const TOPAZ_UPSCALE_MODEL_PARAMS = {
  // --- POST /image/v1/enhance/async ----------------------------------------
  "Standard V2": ENHANCE_ROW,
  "High Fidelity V2": ENHANCE_ROW,
  "Upscale High Fidelity V3": {
    sources: SOURCES,
    factors: FACTORS,
    extras: {
      ...ENHANCE_EXTRAS,
      /** 0–1, default 1.0. How much of the recovered detail to keep. */
      recoveryStrength: EXTRA as number,
      /** 0–1, default 1.0. Blend the result back toward the source. */
      opacity: EXTRA as number,
    },
  },
  "Low Resolution V2": ENHANCE_ROW,
  CGI: {
    sources: SOURCES,
    factors: FACTORS,
    extras: {
      ...ENHANCE_EXTRAS,
      /** 0–1, default 0.5. */
      deblurStrength: EXTRA as number,
    },
  },
  "Text Refine": {
    sources: SOURCES,
    factors: FACTORS,
    extras: {
      ...ENHANCE_EXTRAS,
      /** 0–1, default 0.5. */
      denoiseStrength: EXTRA as number,
      /** 0–1, default 0.5. */
      deblurStrength: EXTRA as number,
      /** 0–1, default 0.5. */
      decompressionStrength: EXTRA as number,
      /** 0–1, default 1.0. */
      opacity: EXTRA as number,
    },
  },

  // --- POST /image/v1/enhance-gen/async -------------------------------------
  Redefine: ENHANCE_GEN_ROW,
  Wonder: ENHANCE_GEN_ROW,
  "Wonder 2": ENHANCE_GEN_ROW,
  "Wonder 3": {
    sources: SOURCES,
    factors: FACTORS,
    extras: {
      ...ENHANCE_GEN_EXTRAS,
      /** Coarser than `creativity`: it moves the whole result. */
      enhancementStrength: EXTRA as TopazEnhancementStrength,
    },
  },
  "Wonder 3.5": {
    sources: SOURCES,
    factors: FACTORS,
    extras: {
      ...ENHANCE_GEN_EXTRAS,
      enhancementStrength: EXTRA as TopazEnhancementStrength,
      ...GRAIN_EXTRAS,
      ...DIMENSION_EXTRAS,
    },
  },
  "Standard MAX": ENHANCE_GEN_ROW,
  "Recover 3": ENHANCE_GEN_ROW,
  "Bloom 2": {
    sources: SOURCES,
    factors: FACTORS,
    extras: {
      ...ENHANCE_GEN_EXTRAS,
      /** Keep the source's colours while new detail is introduced. */
      colorPreservation: EXTRA as boolean,
      /** Default 2. The only reproducibility handle in this catalog. */
      seed: EXTRA as number,
      ...GRAIN_EXTRAS,
      ...DIMENSION_EXTRAS,
    },
  },
  "Bloom Realism": {
    sources: SOURCES,
    factors: FACTORS,
    extras: {
      ...ENHANCE_GEN_EXTRAS,
      /** 1–2000, default 1. */
      seed: EXTRA as number,
    },
  },
} as const satisfies UpscaleModelParamTable;
