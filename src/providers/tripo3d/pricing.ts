/**
 * Tripo's credit tables, and the estimate they support.
 *
 * Transcribed from https://developers.tripo3d.ai/en/pricing (H Series tab),
 * verified 2026-08-25:
 *
 * > 1 credit = $0.01 USD
 * > Text to 3D — No Texture 10, Standard Texture 20
 * > Image to 3D — No Texture 20, Standard Texture 30
 * > Multiview to 3D — No Texture 20, Standard Texture 30
 * > Add-ons (stacked on base credits): HD Texture +10 · 8K Ultra Texture +20 ·
 * > HD Geometry Quality +20 · Quad Mesh +5 · Smart Low-poly +10 ·
 * > Generate Parts +20
 *
 * ## Why the estimate is EXACT here
 *
 * This is the rare media provider whose price is a pure function of the request
 * body. There is no duration to guess (a mesh has none), no output pixel count
 * to infer from a URL (the fal upscale category's structural problem), and no
 * compute-second meter. The base is the task type, the add-ons are the booleans
 * and enums the caller set, and both are in front of us. So `tripo3dCostUSD`
 * returns a number rather than declining — and it is the number Tripo will
 * freeze against the account when the task is created.
 *
 * ## What it declines
 *
 * P1. The pricing page renders its H-Series table server-side and its P-Series
 * and Splat-Series tables only in the browser, so there is no published P
 * credit figure to read. Borrowing the H numbers would be a guess, and a
 * visibly wrong one: fal resells P1 at roughly twice the H rate. `undefined`.
 */

import { CREDIT_USD } from "./models";

/** Which task the credits are being counted for. */
export type Tripo3dTaskType = "text_to_model" | "image_to_model";

/**
 * Base credits per task type, before add-ons.
 *
 * `textured` is the STANDARD texture tier; the HD and 8K tiers are add-ons on
 * top of it rather than replacements for it, which is why they are in
 * {@link ADD_ON_CREDITS} and not a third column here.
 */
export const BASE_CREDITS: Readonly<
  Record<Tripo3dTaskType, { readonly bare: number; readonly textured: number }>
> = {
  text_to_model: { bare: 10, textured: 20 },
  image_to_model: { bare: 20, textured: 30 },
};

/** Add-on credits, stacked on the base. */
export const ADD_ON_CREDITS = {
  /** `texture_quality: "detailed"` — HD Texture. */
  hdTexture: 10,
  /** `texture_quality: "extreme"` — 8K Ultra Texture. */
  ultraTexture: 20,
  /** `geometry_quality: "detailed"` — HD Geometry Quality (Ultra mode). */
  hdGeometry: 20,
  /** `quad: true` — Quad Mesh. */
  quad: 5,
  /** `smart_low_poly: true` — Smart Low-poly. */
  smartLowPoly: 10,
  /** `generate_parts: true` — Generate Parts. */
  generateParts: 20,
} as const;

/**
 * The models whose credit table is published in a readable form.
 *
 * The H series. P1's table exists on the same page behind a client-side tab and
 * is not in the served HTML; see the module header.
 */
const PRICED_MODELS: ReadonlySet<string> = new Set([
  "v3.1-20260211",
  "v3.0-20250812",
  "v2.5-20250123",
]);

/** The request fields that move the price. */
export interface Tripo3dCostInputs {
  task: Tripo3dTaskType;
  model: string;
  /** Defaults to `true` at Tripo, which is why the parameter is optional here. */
  texture?: boolean;
  /** `true` forces `texture` true, and the bill with it. */
  pbr?: boolean;
  textureQuality?: string;
  geometryQuality?: string;
  quad?: boolean;
  smartLowPoly?: boolean;
  generateParts?: boolean;
}

/** Credits Tripo will freeze for this request, or `undefined` for an unpriced model. */
export function tripo3dCredits(inputs: Tripo3dCostInputs): number | undefined {
  if (!PRICED_MODELS.has(inputs.model)) return undefined;
  const base = BASE_CREDITS[inputs.task];

  // `texture` defaults to true, and `pbr: true` forces it true whatever the
  // request said — so the textured base applies unless the caller turned BOTH
  // off. Reading the default wrong here would under-quote by 10 credits on
  // every request that omits the field, which is most of them.
  const textured = inputs.pbr === true || inputs.texture !== false;
  let credits = textured ? base.textured : base.bare;

  if (textured && inputs.textureQuality === "detailed") credits += ADD_ON_CREDITS.hdTexture;
  if (textured && inputs.textureQuality === "extreme") credits += ADD_ON_CREDITS.ultraTexture;
  if (inputs.geometryQuality === "detailed") credits += ADD_ON_CREDITS.hdGeometry;
  if (inputs.quad === true) credits += ADD_ON_CREDITS.quad;
  if (inputs.smartLowPoly === true) credits += ADD_ON_CREDITS.smartLowPoly;
  if (inputs.generateParts === true) credits += ADD_ON_CREDITS.generateParts;
  return credits;
}

/** The same thing in dollars: credits × $0.01. */
export function tripo3dCostUSD(inputs: Tripo3dCostInputs): number | undefined {
  const credits = tripo3dCredits(inputs);
  if (credits === undefined) return undefined;
  // Rounded to the cent the credit price is quoted in, so 25 credits reads
  // 0.25 rather than 0.25000000000000006.
  return Math.round(credits * CREDIT_USD * 100) / 100;
}
