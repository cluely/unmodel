import type { PixelRules } from "../../core/unified/derive";
import type { PipelineContext } from "../../core/pipeline";

const MIN_DIMENSION = 768;
const MAX_TOTAL_PIXELS = 4_194_304;
const DIMENSION_STEP = 16;
// The shared fal ImageSize schema supplies 512 for a missing dimension.
const DEFAULT_CUSTOM_DIMENSION = 512;

export function isMaiImage27(endpoint: string): boolean {
  return endpoint.startsWith("microsoft/mai-image-2.7/");
}

export function maiImage27PixelRules(endpoint: string): PixelRules {
  return {
    grid: DIMENSION_STEP,
    min: MIN_DIMENSION,
    scaleToMinimum: true,
    source: `https://fal.ai/models/${endpoint}/api`,
  };
}

/** The fal MAI Image 2.7 API documents rules outside its shared ImageSize schema. */
export function checkMaiImage27(
  endpoint: string,
  body: Readonly<Record<string, unknown>>,
  ctx: PipelineContext,
): void {
  if (!isMaiImage27(endpoint)) return;
  const source = `https://fal.ai/models/${endpoint}/api`;
  if (body.background === "transparent" && body.output_format === "jpeg") {
    ctx.report({
      code: "unsupported_param",
      path: ["output_format"],
      model: endpoint,
      message: "Transparent backgrounds require PNG or WebP output on MAI Image 2.7.",
      meta: { source },
    });
  }
  const size = body.image_size;
  if (typeof size !== "object" || size === null) return;
  const width = "width" in size && typeof size.width === "number" ? size.width : DEFAULT_CUSTOM_DIMENSION;
  const height = "height" in size && typeof size.height === "number" ? size.height : DEFAULT_CUSTOM_DIMENSION;
  // fal rounds custom dimensions down before rendering.
  const roundedWidth = Math.floor(width / DIMENSION_STEP) * DIMENSION_STEP;
  const roundedHeight = Math.floor(height / DIMENSION_STEP) * DIMENSION_STEP;
  for (const [dimension, rounded] of [["width", roundedWidth], ["height", roundedHeight]] as const) {
    if (rounded >= MIN_DIMENSION) continue;
    ctx.report({
      code: "invalid_shape",
      path: ["image_size", dimension],
      model: endpoint,
      message: `MAI Image 2.7 custom sizes require a ${dimension} of at least ${MIN_DIMENSION} pixels.`,
      meta: { source, width, height, minDimension: MIN_DIMENSION },
    });
  }
  if (roundedWidth * roundedHeight > MAX_TOTAL_PIXELS) {
    ctx.report({
      code: "invalid_shape",
      path: ["image_size"],
      model: endpoint,
      message: `MAI Image 2.7 custom sizes allow at most ${MAX_TOTAL_PIXELS} pixels total.`,
      meta: { source, width, height, maxTotalPixels: MAX_TOTAL_PIXELS },
    });
  }
}
