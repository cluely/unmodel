/**
 * Checks shared by POST /v1/images/generations and POST /v1/images/edits —
 * both endpoints document the same `size` rules and the same per-model prompt
 * caps, so the rules live once here.
 */

import type { PipelineContext } from "../../core/pipeline";
import type { ModelInfo } from "../../core/catalog-types";

const IMAGE_GUIDE_DOCS = "https://developers.openai.com/api/docs/guides/image-generation";
const IMAGES_CREATE_DOCS = "https://developers.openai.com/api/docs/api-reference/images/create";

/**
 * gpt-image-2 sizes, as a value so the table `unmodel/image` narrows `size`
 * with and the type this endpoint checks against are the same list.
 *
 * The named presets are autocomplete for the documented
 * rule space — every one satisfies checkGptImage2Size (edges ÷16, ratio
 * ≤3:1, max edge 3840, 655,360–8,294,400 total pixels) — and any other
 * "WIDTHxHEIGHT" within those bounds validates too (`${number}x${number}`
 * keeps free-form legal while making non-size strings a compile error).
 * 1920x1080 is deliberately absent: 1080 is not divisible by 16 — use
 * 2560x1440 or 3840x2160 for 16:9.
 */
export const GPT_IMAGE_2_SIZES = [
  "auto",
  // 1:1
  "1024x1024",
  "1536x1536",
  "2048x2048",
  "2880x2880",
  // 3:2 / 2:3
  "1536x1024",
  "1024x1536",
  // 4:3 / 3:4
  "2048x1536",
  "1536x2048",
  // 16:9 / 9:16 (720p, 1440p, 4K)
  "1280x720",
  "2560x1440",
  "3840x2160",
  "720x1280",
  "1440x2560",
  "2160x3840",
  // 2:1 / 1:2
  "2048x1024",
  "3840x1920",
  "1024x2048",
  "1920x3840",
  // 21:9 / 9:21 (cinematic)
  "3360x1440",
  "1440x3360",
  // 3:1 / 1:3 (the documented ratio limit)
  "3840x1280",
  "1280x3840",
] as const;

export type GptImage2Size = (typeof GPT_IMAGE_2_SIZES)[number] | (`${number}x${number}` & {});

/** The `size` enum every GPT image model before gpt-image-2 shares. */
export const GPT_IMAGE_1_SIZE_VALUES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const;

/** dall-e-3's three, and dall-e-2's three. Neither takes `"auto"`. */
export const DALL_E_3_SIZE_VALUES = ["1024x1024", "1792x1024", "1024x1792"] as const;
export const DALL_E_2_SIZE_VALUES = ["256x256", "512x512", "1024x1024"] as const;

/** The ids that accept free-form `WIDTHxHEIGHT` sizes. */
export const GPT_IMAGE_2_MODELS: ReadonlySet<string> = new Set([
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
]);

// ---------------------------------------------------------------------------
// gpt-image-2 free-form size rules — quoted verbatim from the image-generation
// guide (checked 2026-08-13):
//   "Maximum edge length must be less than or equal to `3840px`"
//   "Both edges must be multiples of `16px`"
//   "Long edge to short edge ratio must not exceed `3:1`"
//   "Total pixels must be at least `655,360` and no more than `8,294,400`"
// The create reference adds: "Resolutions above `2560x1440` are
// experimental" — a caveat, not a rejection, so it is not enforced.
//
// NOTE (2026-08-13 correction): the previous rule capped the SHORT edge at
// 2160px, which false-positived documented sizes such as `3200x2560`
// (8,192,000 px, max edge 3200, ratio 1.25 — all within the documented
// bounds). The short-edge cap was never documented; the total-pixel band is.
// ---------------------------------------------------------------------------

const SIZE_DIVISOR = 16;
const MAX_EDGE = 3840;
const MAX_ASPECT = 3;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;

const SIZE_RULES =
  'must be "auto" or "WIDTHxHEIGHT" with both edges divisible by 16, a long-edge:short-edge ' +
  `ratio of at most ${MAX_ASPECT}:1, a maximum edge of ${MAX_EDGE}px, and between ` +
  `${MIN_PIXELS.toLocaleString("en-US")} and ${MAX_PIXELS.toLocaleString("en-US")} total pixels`;

/**
 * Enforces the free-form `size` rules for gpt-image-2 (and its dated
 * snapshot). The constraint table deliberately carries no `size` enum for
 * these models, so the documented bounds are enforced here instead.
 */
export function checkGptImage2Size(
  params: { model?: string },
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const model = params.model;
  if (model === undefined || !GPT_IMAGE_2_MODELS.has(model)) return;
  const size = (params as { size?: unknown }).size;
  if (typeof size !== "string" || size === "auto") return;

  const report = (violations: string[]): void => {
    ctx.report({
      code: "invalid_enum_value",
      path: ["size"],
      model,
      message: `\`size\` ${JSON.stringify(size)} is not valid for "${model}": ${SIZE_RULES}.`,
      meta: { value: size, violations, source: IMAGE_GUIDE_DOCS },
    });
  };

  const match = /^(\d+)x(\d+)$/.exec(size);
  if (match === null) {
    report(["format"]);
    return;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width === 0 || height === 0) {
    report(["format"]);
    return;
  }

  const violations: string[] = [];
  if (width % SIZE_DIVISOR !== 0 || height % SIZE_DIVISOR !== 0) violations.push("divisible_by_16");
  const aspect = Math.max(width, height) / Math.min(width, height);
  if (aspect > MAX_ASPECT) violations.push("aspect_ratio");
  if (Math.max(width, height) > MAX_EDGE) violations.push("max_edge");
  const pixels = width * height;
  if (pixels < MIN_PIXELS) violations.push("min_pixels");
  if (pixels > MAX_PIXELS) violations.push("max_pixels");
  if (violations.length > 0) report(violations);
}

/**
 * Enforces the `transparent`↔`output_format` coupling both image routes
 * document — "When using `transparent`, set the output format to `png` or
 * `webp`." (images/create and images/createEdit references) and "use `png`
 * (the default) or `webp`; `jpeg` isn't supported with transparent
 * backgrounds" (image-generation guide), checked 2026-08-31. `output_format`
 * defaults to `png`, so only an explicit `jpeg` conflicts.
 */
export function checkTransparentOutputFormat(
  params: { model?: string },
  _info: ModelInfo | undefined,
  ctx: PipelineContext,
): void {
  const { background, output_format } = params as { background?: unknown; output_format?: unknown };
  if (background !== "transparent" || output_format !== "jpeg") return;
  ctx.report({
    code: "unsupported_param",
    path: ["output_format"],
    ...(typeof params.model === "string" ? { model: params.model } : {}),
    message:
      '`output_format: "jpeg"` does not support `background: "transparent"` — jpeg has no alpha channel; use `png` (the default) or `webp`.',
    meta: { value: "jpeg", allowed: ["png", "webp"], source: IMAGES_CREATE_DOCS },
  });
}

/**
 * Enforces the documented per-model prompt cap ("The maximum length is 32000
 * characters for the GPT image models, 1000 characters for `dall-e-2` and
 * 4000 characters for `dall-e-3`" — images/create), carried on the catalog as
 * `limit.characters`. Reported as `over_output_limit` with a
 * characters-explicit message and meta, matching the TTS providers: there is
 * no character-specific issue code.
 */
export function createPromptLimitCheck(defaultModelId?: string) {
  return function checkPromptLimit(
    params: { model?: string; prompt?: unknown },
    info: ModelInfo | undefined,
    ctx: PipelineContext,
  ): void {
    const limit = info?.limit.characters;
    if (limit === undefined || typeof params.prompt !== "string") return;
    const actual = params.prompt.length;
    if (actual <= limit) return;
    const model = params.model ?? defaultModelId;
    ctx.report({
      code: "over_output_limit",
      path: ["prompt"],
      ...(model !== undefined && { model }),
      message: `\`prompt\` is ${actual} characters; ${
        model !== undefined ? `"${model}"` : ctx.endpoint
      } caps the prompt at ${limit} characters.`,
      meta: { limitCharacters: limit, actualCharacters: actual, source: IMAGES_CREATE_DOCS },
    });
  };
}

/**
 * Prompt-cap check for POST /v1/images/generations. No default id is passed:
 * `model` is required by openai.images (a documented deviation from the wire,
 * where it defaults to `dall-e-2` — see images.ts), so the fallback branch
 * would never run. /v1/images/edits, where `model` is optional, does pass one.
 */
export const checkPromptCharacterLimit = createPromptLimitCheck();
