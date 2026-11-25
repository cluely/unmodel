/**
 * `unmodel/image` → `higgsfield.image`
 * (POST https://api.higgsfield.ai/<route id>), across the text-to-image routes.
 *
 * # The row is the dispatch, and the route id is not
 *
 * A Higgsfield ref names a ROUTE (`higgsfield/higgsfield-ai/soul/standard`,
 * `higgsfield/recraft/v4.1/text-to-image`), and the roster moves weekly, so
 * nothing here switches on an id. Each canonical word is looked up in the
 * route's generated row (`./image-params.ts`): the parameters it declares, its
 * shapes, the tiers it can express, where a count lands. A word the route has
 * no parameter for is refused naming the route (`./compile-input.ts`).
 *
 * # Size is a shape, and separately a tier
 *
 * Every route sizes by `aspect_ratio` from a closed list; none takes pixels.
 * `dimensions` and a `WxH` `size` are sent as the listed shape they describe,
 * with a warning.
 *
 * `resolution` maps only where the route's own value is a canonical tier:
 * `1k` / `2k` / `4k` on the Marketing Studio, Seedream, Qwen, Kling Image,
 * Recraft, Grok and Z-Image routes. The three Soul routes list `720p | 1080p`,
 * a pixel class this vocabulary has no word for, so their row's `tiers` is
 * empty and `resolution` is refused there, pointing at
 * `providerOptions.higgsfield.resolution`. No tier is mapped onto a pixel
 * class: on Soul the resolution selects the price. Seedream's `1.5k` and Kling
 * Image's `8k` are reached the same way.
 *
 * # `n` is `batch_size` or `series_amount`, where the route has either
 *
 * Soul renders 1 or 4 and nothing between; Ads Studio 1 to 8; the Kling Image
 * series route REQUIRES 2 to 10. The adapter writes the number and declares
 * where it went; the route's validator holds the list, the range and the
 * requirement, and its finding arrives at `n`.
 *
 * # Delivery is a URL
 *
 * A completed request lists `images[].url`. `outputDelivery: "url"` therefore
 * compiles to nothing and loses nothing, and `"base64"` is refused.
 */

import { applyExtras, resolveSizing } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { ImageAdapterFor, ImageParams } from "../../core/unified/vocabulary/image";
import {
  applyPictureWords,
  docsOf,
  refuseWithoutRow,
  refuseWord,
  TIER_SPELLINGS,
  toPictureAspectRatio,
  type PictureWire,
  type RouteTable,
} from "./compile-input";
import { image as validator } from "./image";
import { HIGGSFIELD_IMAGE_MODEL_PARAMS, MODELS } from "./image-params";
import type { HiggsfieldImageParamRow } from "./param-types";
import type { HiggsfieldCompiledResult } from "./submit";

const ROWS: Readonly<Partial<Record<string, HiggsfieldImageParamRow>>> = HIGGSFIELD_IMAGE_MODEL_PARAMS;

const TABLE: RouteTable = { noun: "image", rows: HIGGSFIELD_IMAGE_MODEL_PARAMS };

/**
 * The wire body this adapter compiles to: the parameters the canonical
 * vocabulary reaches, and nothing else.
 *
 * No `[key: string]: unknown` tail. Per-route extras reach the body through
 * `applyExtras`'s own cast, and which of them a route takes is its row's
 * answer; an index signature here would make `ExactKeys` demand `never` for
 * every key of `higgsfield.image`.
 */
export interface HiggsfieldImageWire extends PictureWire {
  /** The route id, stripped into `.request.url` by `higgsfield.image`. */
  endpoint: string;
  prompt: string;
  negative_prompt?: string;
  resolution?: string;
}

/**
 * What a unified call to `higgsfield/…` returns: `higgsfield.image`'s
 * `Validated`, at a route id the type does not narrow by (`./submit.ts`).
 */
export type HiggsfieldImageResult = HiggsfieldCompiledResult<HiggsfieldImageWire>;

/**
 * `higgsfield.image.safe`, seen as the one-argument function `CompiledCall`
 * wants. The validator is generic in the route id so that a literal narrows
 * the body; the kernel has no literal to give it. Nothing is skipped at run
 * time.
 */
type HiggsfieldImageValidate = CompiledCall<HiggsfieldImageWire, HiggsfieldImageResult>["validate"];

export const image = {
  category: "image",
  provider: "higgsfield",
  models: MODELS,
  modelParams: HIGGSFIELD_IMAGE_MODEL_PARAMS,
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<HiggsfieldImageWire, HiggsfieldImageResult> {
    const row = ROWS[ctx.model];
    const body: HiggsfieldImageWire = { endpoint: ctx.model, prompt: input.prompt };
    ctx.from(["prompt"], "prompt");
    ctx.from(["negative_prompt"], "negativePrompt");
    ctx.from(["resolution"], "resolution");

    if (input.negativePrompt !== undefined) {
      if (row === undefined || row.keys.includes("negative_prompt")) body.negative_prompt = input.negativePrompt;
      else refuseWord(ctx, "negativePrompt", "negative_prompt", TABLE);
    }
    applyPictureWords(input, body, row, TABLE, ctx);
    applyResolution(input, body, row, ctx);

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing !== undefined) {
      const ratio = toPictureAspectRatio(sizing, row, TABLE, ctx);
      if (ratio !== undefined) body.aspect_ratio = ratio;
    }

    if (input.outputDelivery === "base64") {
      ctx.fail({
        code: "unsupported_param",
        path: ["outputDelivery"],
        message:
          '`outputDelivery: "base64"` has no equivalent here: a Higgsfield request is queued, and its completed ' +
          'status lists `images[].url`. No route returns inline bytes, so "url" is the only delivery there is.',
        meta: { value: input.outputDelivery, source: docsOf(ctx.model) },
      });
    }

    applyExtras(input, HIGGSFIELD_IMAGE_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as HiggsfieldImageValidate };
  },
} as const satisfies ImageAdapterFor<typeof HIGGSFIELD_IMAGE_MODEL_PARAMS, HiggsfieldImageWire, HiggsfieldImageResult>;

/** `resolution`, in the route's spelling of the tier, or a refusal naming the tiers it has. */
function applyResolution(
  input: ImageParams,
  body: HiggsfieldImageWire,
  row: HiggsfieldImageParamRow | undefined,
  ctx: CompileContext<ImageParams>,
): void {
  if (input.resolution === undefined) return;
  if (row === undefined) {
    refuseWithoutRow(ctx, "resolution", TIER_SPELLINGS);
    return;
  }
  if (!row.keys.includes("resolution")) {
    refuseWord(ctx, "resolution", "resolution", TABLE);
    return;
  }
  const spelling = row.tierWire?.[input.resolution];
  if (spelling !== undefined) {
    body.resolution = spelling;
    return;
  }
  const offered = row.tiers ?? [];
  ctx.fail({
    code: "invalid_enum_value",
    path: ["resolution"],
    message:
      (offered.length === 0
        ? `\`${ctx.model}\` has a \`resolution\` parameter, but none of its values is a canonical tier: it sizes in a ` +
          "vocabulary `unmodel/image` has no word for"
        : `\`resolution\` must be ${offered.map((tier) => `"${tier}"`).join(" or ")} on \`${ctx.model}\``) +
      `; got "${input.resolution}". The sizes this route lists in its own words are reachable through ` +
      "`providerOptions.higgsfield.resolution`, where the route's own vocabulary still checks them.",
    meta: { allowed: [...offered], value: input.resolution, source: docsOf(ctx.model) },
  });
}

// A deliberate NON-import, asserted in test/bundle-budget.test.ts: this module
// never imports `./models.ts` or `./index.ts`. The catalog belongs to the
// validator, which the pack reaches through `./image`.
