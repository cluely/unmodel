/**
 * `unmodel/image-edit` → `revana.imageEdit`
 * (POST https://api.revana.si/v1/generations).
 *
 * The sibling of `./unified-image`, over the same route and the same body: on
 * Revana an edit is a picture request that carries a picture. The shape words
 * compile exactly as they do there (`toPictureAspectRatio`); three things are
 * specific to editing.
 *
 * # The source is a public URL, and only that
 *
 * `imageInputs` is `["url"]`. "Media must be public https URLs that download
 * directly" — there is no multipart route, no base64 field and no `data:` URI,
 * so `{ file }` and `{ data }` are refused with the upload route that turns a
 * local file into a URL. The picture lands on `input.image_url` ("the picture
 * to edit"); further reference pictures are `input.image_urls`, which the
 * canonical vocabulary has no word for and `providerOptions.revana.input`
 * reaches.
 *
 * # `strength` and `outputFormat` have no field
 *
 * Every model here edits by instruction: `ModelInput` has no dial between
 * keeping and replacing the source, and no encoding field. Both are declared.
 */

import {
  applyExtras,
  resolveImageEditInput,
  resolveOperation,
  resolveSizing,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageEditAdapterFor,
  ImageEditParamsFor,
  ModelParams,
} from "../../core/unified/vocabulary/image-edit";
import { REVANA_MODELS_SOURCE } from "./checks";
import { toPictureAspectRatio } from "./compile-input";
import { imageEdit as validator } from "./image-edit";
import { MODELS, REVANA_IMAGE_EDIT_MODEL_PARAMS } from "./image-edit-params";
import { UPLOADS_URL } from "./urls";

const ROWS: Readonly<Partial<Record<string, ModelParams>>> = REVANA_IMAGE_EDIT_MODEL_PARAMS;

/** A public URL, and nothing else: Revana fetches every reference itself. */
const ACCEPTS = ["url"] as const;

type EditParams = ImageEditParamsFor<"url">;

/**
 * `input`, as this adapter writes it and as `providerOptions.revana.input`
 * completes it: `ImageModelInput` in `./generation-wire.ts`, with a media
 * reference typed as the plain string the caller supplied.
 */
export interface RevanaImageEditWireInput {
  prompt?: string;
  image_url?: string;
  /** "Reference pictures, up to the model's max_input_images." */
  image_urls?: string[];
  aspect_ratio?: string;
  num_images?: number;
  seed?: number;
  negative_prompt?: string;
  resolution?: string;
  /** A per-model extra where the model's row lists its tiers. */
  quality?: string;
}

/** The wire body this adapter compiles to: `GenerationRequest`, loosely typed. */
export interface RevanaImageEditWire {
  model: string;
  input: RevanaImageEditWireInput;
  max_cost_usd?: number;
  max_wait_s?: number;
}

/** What a unified image-edit call to `revana/…` returns — see `RevanaVideoResult` in `./unified-video.ts`. */
export type RevanaImageEditResult = ReturnType<typeof validator<string>>;

/** See `RevanaVideoValidate` in `./unified-video.ts`. */
type RevanaImageEditValidate = CompiledCall<RevanaImageEditWire, RevanaImageEditResult>["validate"];

export const imageEdit = {
  category: "imageEdit",
  provider: "revana",
  models: MODELS,
  imageInputs: ACCEPTS,
  modelParams: REVANA_IMAGE_EDIT_MODEL_PARAMS,
  unsupported: {
    strength:
      "Revana's `ModelInput` has no dial between keeping and replacing the source — an edit is " +
      "steered by `prompt` alone. It takes `prompt`, `image_url`, `image_urls`, `aspect_ratio`, " +
      "`resolution`, `quality`, `num_images` and `seed`.",
    outputFormat:
      "Revana's `ModelInput` has no encoding field: `output.urls` lists the finished files.",
  },
  compile(
    input: EditParams,
    ctx: CompileContext<EditParams>,
  ): CompiledCall<RevanaImageEditWire, RevanaImageEditResult> {
    const wire: RevanaImageEditWireInput = { prompt: input.prompt };
    ctx.from(["input", "prompt"], "prompt");
    ctx.from(["input", "image_url"], "image");
    ctx.from(["input", "num_images"], "n");
    ctx.from(["input", "seed"], "seed");

    ctx.take(
      resolveOperation(input.operation, ["edit"] as const, { path: ["operation"], warn: ctx.warn }, {
        source: REVANA_MODELS_SOURCE,
      }),
    );

    const source = ctx.take(
      resolveImageEditInput(input.image, ACCEPTS, { path: ["image"], warn: ctx.warn }, {
        source: REVANA_MODELS_SOURCE,
        hint:
          `Revana fetches every reference itself: \`POST ${UPLOADS_URL}\` answers a public URL ` +
          "for a local file.",
      }),
    );
    if (source?.kind === "url") wire.image_url = source.url;

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing !== undefined) {
      const ratio = toPictureAspectRatio(sizing, ROWS[ctx.model]?.ratios, ctx);
      if (ratio !== undefined) wire.aspect_ratio = ratio;
    }
    if (input.n !== undefined) wire.num_images = input.n;
    if (input.seed !== undefined) wire.seed = input.seed;

    const body: RevanaImageEditWire = { model: ctx.model, input: wire };
    applyExtras(input, REVANA_IMAGE_EDIT_MODEL_PARAMS, body, ctx, { at: ["input"] });
    return { params: body, validate: validator.safe as RevanaImageEditValidate };
  },
} as const satisfies ImageEditAdapterFor<
  "url",
  RevanaImageEditWire,
  RevanaImageEditResult,
  typeof REVANA_IMAGE_EDIT_MODEL_PARAMS
>;
