/**
 * `unmodel/image-edit` → `higgsfield.imageEdit`
 * (POST https://api.higgsfield.ai/<route id>), across the picture-editing view.
 *
 * The sibling of `./unified-image`, over the same routes' rows: the shape, the
 * count, the seed and the encoding compile exactly as they do there
 * (`./compile-input.ts`). Four things are specific to editing.
 *
 * # The source is a public URL, and only that
 *
 * `imageInputs` is `["url"]`. No Higgsfield route takes bytes — a local file
 * goes through the presigned upload route first — so `{ file }` and `{ data }`
 * are refused with that route named.
 *
 * # One picture or a list, and the row says which
 *
 * Soul 2 image-to-image and Ideogram 4.0 take one `image_url`; the Qwen,
 * Seedream, Kling Image, Marketing Studio and Grok routes take `image_urls`.
 * The canonical vocabulary has one `image`, so a list-shaped route receives a
 * one-element array; further pictures are `providerOptions.higgsfield.image_urls`.
 *
 * # `strength` has no parameter on any route
 *
 * Every route here edits by instruction. Declared adapter-wide, which is safe
 * to say of a moving roster for one reason: `scripts/codegen-higgsfield.ts`
 * stops the day a route in the view declares a parameter named `strength`.
 * Ideogram 4.0's `image_weight` is that route's own dial and stays an extra.
 *
 * # `resolution` and `negative_prompt` are extras here
 *
 * `ImageEditParams` has no word for either, so a route that declares one takes
 * it as a per-route extra, in the route's own vocabulary: `resolution: "1080p"`
 * on Soul 2 image-to-image.
 *
 * `operation` is `"edit"` at every route: no row declares `operations`, which
 * is how a row says it edits and only edits. No Higgsfield route removes a
 * background, so `"removeBackground"` is refused at `operation`.
 */

import {
  applyExtras,
  resolveImageEditInput,
  resolveOperation,
  resolveSizing,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { ImageEditAdapterFor, ImageEditParamsFor } from "../../core/unified/vocabulary/image-edit";
import {
  applyPictureWords,
  docsOf,
  refuseWithoutRow,
  toPictureAspectRatio,
  type PictureWire,
  type RouteTable,
} from "./compile-input";
import { imageEdit as validator } from "./image-edit";
import { HIGGSFIELD_IMAGE_EDIT_MODEL_PARAMS, MODELS } from "./image-edit-params";
import type { HiggsfieldImageEditParamRow } from "./param-types";
import type { HiggsfieldCompiledResult } from "./submit";
import { HIGGSFIELD_UPLOAD_HINT, HIGGSFIELD_UPLOAD_SOURCE } from "./urls";

const ROWS: Readonly<Partial<Record<string, HiggsfieldImageEditParamRow>>> = HIGGSFIELD_IMAGE_EDIT_MODEL_PARAMS;

const TABLE: RouteTable = { noun: "image-edit", rows: HIGGSFIELD_IMAGE_EDIT_MODEL_PARAMS };

/** A public URL, and nothing else: Higgsfield fetches every reference itself. */
const ACCEPTS = ["url"] as const;

type EditParams = ImageEditParamsFor<"url">;

/** The wire body this adapter compiles to. No index-signature tail; see `HiggsfieldImageWire`. */
export interface HiggsfieldImageEditWire extends PictureWire {
  /** The route id, stripped into `.request.url` by `higgsfield.imageEdit`. */
  endpoint: string;
  prompt: string;
  image_url?: string;
  image_urls?: string[];
}

/** What a unified image-edit call to `higgsfield/…` returns; see `HiggsfieldImageResult`. */
export type HiggsfieldImageEditResult = HiggsfieldCompiledResult<HiggsfieldImageEditWire>;

/** See `HiggsfieldImageValidate` in `./unified-image.ts`. */
type HiggsfieldImageEditValidate = CompiledCall<HiggsfieldImageEditWire, HiggsfieldImageEditResult>["validate"];

export const imageEdit = {
  category: "imageEdit",
  provider: "higgsfield",
  models: MODELS,
  imageInputs: ACCEPTS,
  modelParams: HIGGSFIELD_IMAGE_EDIT_MODEL_PARAMS,
  unsupported: {
    strength:
      "no Higgsfield picture-editing route has a dial between keeping and replacing the source: an edit is " +
      "steered by `prompt`. A route's own controls (Ideogram 4.0's `image_weight`) are that route's extras.",
  },
  compile(
    input: EditParams,
    ctx: CompileContext<EditParams>,
  ): CompiledCall<HiggsfieldImageEditWire, HiggsfieldImageEditResult> {
    const row = ROWS[ctx.model];
    const body: HiggsfieldImageEditWire = { endpoint: ctx.model, prompt: input.prompt };
    ctx.from(["prompt"], "prompt");

    ctx.take(
      resolveOperation(input.operation, ["edit"] as const, { path: ["operation"], warn: ctx.warn }, {
        source: docsOf(ctx.model),
        hint:
          "No Higgsfield route removes a background. Which operation a model serves is " +
          "`IMAGE_EDIT_MODEL_PARAMS[model].operations` at `unmodel/<provider>/values`.",
      }),
    );

    applySource(input, body, row, ctx);
    applyPictureWords(input, body, row, TABLE, ctx);

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing !== undefined) {
      const ratio = toPictureAspectRatio(sizing, row, TABLE, ctx);
      if (ratio !== undefined) body.aspect_ratio = ratio;
    }

    applyExtras(input, HIGGSFIELD_IMAGE_EDIT_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as HiggsfieldImageEditValidate };
  },
} as const satisfies ImageEditAdapterFor<
  "url",
  HiggsfieldImageEditWire,
  HiggsfieldImageEditResult,
  typeof HIGGSFIELD_IMAGE_EDIT_MODEL_PARAMS
>;

/** The picture to edit, onto whichever of `image_url` / `image_urls` the route declares. */
function applySource(
  input: EditParams,
  body: HiggsfieldImageEditWire,
  row: HiggsfieldImageEditParamRow | undefined,
  ctx: CompileContext<EditParams>,
): void {
  if (row !== undefined) ctx.from([row.imageWire], "image");
  const source = ctx.take(
    resolveImageEditInput(input.image, ACCEPTS, { path: ["image"], warn: ctx.warn }, {
      source: HIGGSFIELD_UPLOAD_SOURCE,
      hint: HIGGSFIELD_UPLOAD_HINT,
    }),
  );
  if (source?.kind !== "url") return;
  if (row === undefined) {
    refuseWithoutRow(ctx, "image", ["image_url", "image_urls"]);
    return;
  }
  if (row.imageWire === "image_urls") body.image_urls = [source.url];
  else body.image_url = source.url;
}

// A deliberate NON-import, asserted in test/bundle-budget.test.ts: this module
// never imports `./models.ts` or `./index.ts`.
