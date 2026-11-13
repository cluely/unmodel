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
 * P2 from https://developers.tripo3d.ai/en/docs/changelog.md, read 2026-11-12,
 * under the entry that opens "`POST /v3/generation/text-to-model`,
 * `image-to-model`, and `multiview-to-model` now accept `model=P2-20260801`":
 *
 * > **Credits**: 100 without texture; `standard` / `detailed` / `extreme` =
 * > 110 / 120 / 130 (same texture add-ons as P1).
 *
 * and per route from the pricing page's P-Series tab, whose figures ship in
 * https://developers.tripo3d.ai/assets/PricingPage-BWsTiO9s.js (read
 * 2026-11-12): `noTexP2:100,stdTexP2:110` on both `pricing.text_to_3d` and
 * `pricing.image_to_3d`.
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
 * and Splat-Series tables only in the browser, and no served doc page states
 * P1's base credits. Borrowing the H numbers would be a guess, and a visibly
 * wrong one: fal resells P1 at roughly twice the H rate. `undefined`.
 *
 * P2 with `quad: true`. The P-Series tab publishes no add-on list — the chunk
 * renders the H add-on callout (where "Quad Mesh +5" lives) only off the P tab,
 * `l!=="p1"?…add-ons…:…p_series_note…`, and the P note prices only the base and
 * the texture tiers. A quad mesh is P2's headline feature and its surcharge is
 * unpublished, so the estimate is `undefined` rather than the H series' +5.
 */

import { CREDIT_USD } from "./models";

/** Which task the credits are being counted for. */
export type Tripo3dTaskType = "text_to_model" | "image_to_model";

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

/** One of {@link ADD_ON_CREDITS}. */
export type Tripo3dAddOn = keyof typeof ADD_ON_CREDITS;

/** One model's published credit table. */
export interface Tripo3dCreditTable {
  /**
   * Base credits per task type, before add-ons. `textured` is the STANDARD
   * texture tier; the HD and 8K tiers are add-ons on top of it rather than
   * replacements for it.
   */
  readonly base: Readonly<
    Record<Tripo3dTaskType, { readonly bare: number; readonly textured: number }>
  >;
  /**
   * The add-ons this table publishes a rate for, at {@link ADD_ON_CREDITS}. A
   * request that switches on one missing here has no published price, and the
   * estimate is `undefined`.
   */
  readonly addOns: readonly Tripo3dAddOn[];
}

const H_SERIES: Tripo3dCreditTable = {
  base: {
    text_to_model: { bare: 10, textured: 20 },
    image_to_model: { bare: 20, textured: 30 },
  },
  addOns: ["hdTexture", "ultraTexture", "hdGeometry", "quad", "smartLowPoly", "generateParts"],
};

/**
 * The models whose credit table is published, keyed by model id.
 *
 * P1 is absent: its table exists on the same page behind a client-side tab and
 * no served doc page states it; see the module header.
 */
export const CREDIT_TABLES: Readonly<Record<string, Tripo3dCreditTable>> = {
  "v3.1-20260211": H_SERIES,
  "v3.0-20250812": H_SERIES,
  "v2.5-20250123": H_SERIES,
  "P2-20260801": {
    base: {
      text_to_model: { bare: 100, textured: 110 },
      image_to_model: { bare: 100, textured: 110 },
    },
    // "standard / detailed / extreme = 110 / 120 / 130" — +10 and +20, the
    // H series' HD and 8K rates. No other add-on is published for P2.
    addOns: ["hdTexture", "ultraTexture"],
  },
};

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

/**
 * Credits Tripo will freeze for this request, or `undefined` for an unpriced
 * model or an add-on the model's table does not publish.
 */
export function tripo3dCredits(inputs: Tripo3dCostInputs): number | undefined {
  const table = CREDIT_TABLES[inputs.model];
  if (table === undefined) return undefined;
  const base = table.base[inputs.task];

  // `texture` defaults to true, and `pbr: true` forces it true whatever the
  // request said — so the textured base applies unless the caller turned BOTH
  // off. Reading the default wrong here would under-quote on every request
  // that omits the field, which is most of them.
  const textured = inputs.pbr === true || inputs.texture !== false;
  let credits = textured ? base.textured : base.bare;

  for (const addOn of addOnsSwitchedOn(inputs, textured)) {
    if (!table.addOns.includes(addOn)) return undefined;
    credits += ADD_ON_CREDITS[addOn];
  }
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

/** The add-ons the request switched on; the texture tiers only bill on a textured mesh. */
function addOnsSwitchedOn(inputs: Tripo3dCostInputs, textured: boolean): Tripo3dAddOn[] {
  const on: Tripo3dAddOn[] = [];
  if (textured && inputs.textureQuality === "detailed") on.push("hdTexture");
  if (textured && inputs.textureQuality === "extreme") on.push("ultraTexture");
  if (inputs.geometryQuality === "detailed") on.push("hdGeometry");
  if (inputs.quad === true) on.push("quad");
  if (inputs.smartLowPoly === true) on.push("smartLowPoly");
  if (inputs.generateParts === true) on.push("generateParts");
  return on;
}
