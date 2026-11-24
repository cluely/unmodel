import type { PipelineContext } from "../../core/pipeline";

const MIN_DIMENSION = 768;
const MAX_TOTAL_PIXELS = 4_194_304;
const DIMENSION_STEP = 16;

/** The fal MAI Image 2.7 API documents rules outside its shared ImageSize schema. */
export function checkMaiImage27(
  endpoint: string,
  body: Readonly<Record<string, unknown>>,
  ctx: PipelineContext,
): void {
  if (!endpoint.startsWith("microsoft/mai-image-2.7/")) return;
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
  const width = "width" in size ? size.width : undefined;
  const height = "height" in size ? size.height : undefined;
  if (typeof width !== "number" || typeof height !== "number") return;
  // fal rounds custom dimensions down before rendering.
  const roundedWidth = Math.floor(width / DIMENSION_STEP) * DIMENSION_STEP;
  const roundedHeight = Math.floor(height / DIMENSION_STEP) * DIMENSION_STEP;
  if (roundedWidth < MIN_DIMENSION || roundedHeight < MIN_DIMENSION ||
      roundedWidth * roundedHeight > MAX_TOTAL_PIXELS) {
    ctx.report({
      code: "invalid_shape",
      path: ["image_size"],
      model: endpoint,
      message: `MAI Image 2.7 custom sizes require at least ${MIN_DIMENSION} pixels per side and at most ${MAX_TOTAL_PIXELS} pixels total.`,
      meta: { source, width, height, minDimension: MIN_DIMENSION, maxTotalPixels: MAX_TOTAL_PIXELS },
    });
  }
}
