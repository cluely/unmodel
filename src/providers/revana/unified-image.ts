/**
 * `unmodel/image` → `revana.image`
 * (POST https://api.revana.si/v1/generations).
 *
 * A sibling of `./unified-image-edit` and `./unified-upscale`, split per
 * category so that no pack pays for another's roster; `./unified.ts` re-exports
 * all of them.
 *
 * # Shape and tier are two fields, and there is no pixel field
 *
 * | canonical | wire (`input.…`) | notes |
 * |---|---|---|
 * | `prompt` | `prompt` | |
 * | `aspectRatio` | `aspect_ratio` | the catalog's spelling where the model lists shapes, verbatim where it lists none |
 * | `dimensions`, `size` (`WxH`) | `aspect_ratio` | the SHAPE of the pixels, with an `approximated_param`: Revana has no width/height |
 * | `resolution` | `resolution` | the catalog's spelling of the tier (`"2k"` → `"2K"`) |
 * | `n` | `num_images` | the model's `max_images` is checked on the way out |
 * | `seed` | `seed` | |
 * | `negativePrompt` | `negative_prompt` | sent; `revana.image` WARNS where no route took it |
 * | `outputFormat`, `outputDelivery` | — | declared unsupported |
 *
 * `resolution` beside `dimensions` is not a conflict here the way it is at a
 * provider that takes pixels: the pixels give the shape, the tier gives the
 * size, and both are sent.
 *
 * `quality` is a per-model extra on the models whose catalog row lists their
 * tiers (`gpt-image-1`: `low | medium | high`); on the rest it has no listed
 * values to type and rides on `providerOptions.revana.input.quality`.
 */

import { applyExtras, resolveSizing } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { ImageAdapterFor, ImageParams } from "../../core/unified/vocabulary/image";
import { toPictureAspectRatio, toRevanaTier } from "./compile-input";
import { image as validator } from "./image";
import { MODELS, REVANA_IMAGE_MODEL_PARAMS } from "./image-params";
import type { RevanaImageParamRow } from "./param-types";

const ROWS: Readonly<Partial<Record<string, RevanaImageParamRow>>> = REVANA_IMAGE_MODEL_PARAMS;

/**
 * `input`, as this adapter writes it and as `providerOptions.revana.input`
 * completes it: `ImageModelInput` in `./generation-wire.ts`, with a media
 * reference typed as the plain string the caller supplied.
 */
export interface RevanaImageWireInput {
  prompt?: string;
  negative_prompt?: string;
  resolution?: string;
  aspect_ratio?: string;
  num_images?: number;
  seed?: number;
  /** A per-model extra where the model's row lists its tiers. */
  quality?: string;
  /** "The picture to edit" and "reference pictures": `unmodel/image-edit`'s half of this route. */
  image_url?: string;
  image_urls?: string[];
}

/** The wire body this adapter compiles to: `GenerationRequest`, loosely typed. */
export interface RevanaImageWire {
  model: string;
  input: RevanaImageWireInput;
  max_cost_usd?: number;
  max_wait_s?: number;
}

/** What a unified image call to `revana/…` returns — see `RevanaVideoResult` in `./unified-video.ts`. */
export type RevanaImageResult = ReturnType<typeof validator<string>>;

/** See `RevanaVideoValidate` in `./unified-video.ts`. */
type RevanaImageValidate = CompiledCall<RevanaImageWire, RevanaImageResult>["validate"];

const NO_FORMAT_FIELD =
  "Revana's `ModelInput` has no encoding field: a picture request takes `prompt`, `aspect_ratio`, " +
  "`resolution`, `quality`, `num_images`, `seed` and `negative_prompt`, and `output.urls` lists the " +
  "finished files.";

const NO_DELIVERY_FIELD =
  "POST /v1/generations answers `202` with a queued `Generation` and never image bytes, so the " +
  "request has no delivery field to set: the finished files are the `output.urls` of the poll " +
  "(`GET /v1/generations/{id}`), which is transport and outside unmodel's scope.";

export const image = {
  category: "image",
  provider: "revana",
  models: MODELS,
  modelParams: REVANA_IMAGE_MODEL_PARAMS,
  unsupported: {
    outputFormat: NO_FORMAT_FIELD,
    outputDelivery: NO_DELIVERY_FIELD,
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<RevanaImageWire, RevanaImageResult> {
    const row = ROWS[ctx.model];
    const wire: RevanaImageWireInput = { prompt: input.prompt };
    ctx.from(["input", "prompt"], "prompt");
    ctx.from(["input", "resolution"], "resolution");
    ctx.from(["input", "num_images"], "n");
    ctx.from(["input", "seed"], "seed");
    ctx.from(["input", "negative_prompt"], "negativePrompt");

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing !== undefined) {
      const ratio = toPictureAspectRatio(sizing, row?.ratios, ctx);
      if (ratio !== undefined) wire.aspect_ratio = ratio;
    }
    applyResolution(input, wire, row, ctx);
    if (input.n !== undefined) wire.num_images = input.n;
    if (input.seed !== undefined) wire.seed = input.seed;
    if (input.negativePrompt !== undefined) wire.negative_prompt = input.negativePrompt;

    const body: RevanaImageWire = { model: ctx.model, input: wire };
    applyExtras(input, REVANA_IMAGE_MODEL_PARAMS, body, ctx, { at: ["input"] });
    return { params: body, validate: validator.safe as RevanaImageValidate };
  },
} as const satisfies ImageAdapterFor<
  typeof REVANA_IMAGE_MODEL_PARAMS,
  RevanaImageWire,
  RevanaImageResult
>;

/**
 * `resolution`, in the catalog's spelling of the tier. Sent as written for a
 * model this build has no row for, and for one whose catalog row lists no
 * resolutions — `revana.image` answers that one "takes no `input.resolution`".
 */
function applyResolution(
  input: ImageParams,
  wire: RevanaImageWireInput,
  row: RevanaImageParamRow | undefined,
  ctx: CompileContext<ImageParams>,
): void {
  if (input.resolution === undefined) return;
  if (row?.tierWire === undefined) {
    wire.resolution = input.resolution;
    return;
  }
  const resolution = toRevanaTier(input.resolution, row.tierWire, ctx);
  if (resolution !== undefined) wire.resolution = resolution;
}
