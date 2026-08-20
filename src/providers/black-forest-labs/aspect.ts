/**
 * Shared `aspect_ratio` validation for the BFL routes that size by ratio
 * instead of width/height (FLUX.1 Kontext and FLUX1.1 [pro] Ultra).
 *
 * Both schemas type the field as a bare `string` and document the bound only
 * in prose — "Aspect ratio of the image between 21:9 and 9:21"
 * (https://api.bfl.ai/openapi.json, FluxKontextProInputs / FluxUltraInput,
 * verified 2026-08-13) — so the bound is enforced at runtime here rather than
 * as a type-level enum. Values inside the documented range that BFL has not
 * enumerated (e.g. "5:4") stay permitted.
 */

import type { PipelineContext } from "../../core/pipeline";

/** Widest documented ratio: 21:9 (and its reciprocal 9:21 is the tallest). */
const MAX_ASPECT = 21 / 9;

/**
 * `aspect_ratio` values for the ratio-sized BFL routes. The named presets are
 * autocomplete for the documented rule space — every one satisfies
 * `checkAspectRatioRange` (a "W:H" pair between 21:9 and 9:21) — and any other
 * "W:H" inside those bounds validates too (`${number}:${number}` keeps
 * free-form legal while making non-ratio strings a compile error).
 *
 * The landscape half is BFL's own ratio vocabulary, enumerated verbatim by the
 * sibling video schemas in the same spec (Flux3VideoT2VInputs.aspect_ratio:
 * `["21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"]`,
 * https://api.bfl.ai/openapi.json, 2026-08-13); the extra photographic ratios
 * and the portrait reciprocals follow from the image routes' bound being
 * explicitly symmetric ("between 21:9 and 9:21").
 */
export const BFL_ASPECT_RATIOS = [
  // widest documented ratio → 1:1
  "21:9",
  "2:1",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  // 1:1 → tallest documented ratio
  "4:5",
  "3:4",
  "2:3",
  "9:16",
  "1:2",
  "9:21",
] as const;

export type BflAspectRatio = (typeof BFL_ASPECT_RATIOS)[number] | (`${number}:${number}` & {});

export interface AspectRatioCheckInput {
  /** The raw `aspect_ratio` value; null/undefined means "provider default". */
  ratio: string | null | undefined;
  /** Model id recorded on the issue, when the endpoint knows one. */
  model?: string;
  /** Doc URL recorded in `meta.source`. */
  source: string;
  ctx: PipelineContext;
}

/**
 * Reports `invalid_enum_value` when `aspect_ratio` is not a "W:H" pair inside
 * the documented 21:9 … 9:21 range. Never throws.
 */
export function checkAspectRatioRange({ ratio, model, source, ctx }: AspectRatioCheckInput): void {
  if (ratio == null) return;
  const report = (): void => {
    ctx.report({
      code: "invalid_enum_value",
      path: ["aspect_ratio"],
      ...(model !== undefined && { model }),
      message: `\`aspect_ratio\` ${JSON.stringify(ratio)} is not valid: must be "W:H" between 21:9 and 9:21.`,
      meta: { value: ratio, source },
    });
  };
  const match = /^(\d+):(\d+)$/.exec(ratio);
  if (match === null) {
    report();
    return;
  }
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (w === 0 || h === 0) {
    report();
    return;
  }
  const aspect = w / h;
  if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) report();
}
