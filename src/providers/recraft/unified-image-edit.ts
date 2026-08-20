/**
 * `unmodel/image-edit` → `recraft.imageEdit`
 * (POST https://external.api.recraft.ai/v1/images/imageToImage).
 *
 * A sibling of `./unified-image`, split per category so `unmodel/image` and
 * `unmodel/image-edit` each pay for one of Recraft's route families rather than
 * both. `./unified.ts` re-exports the pair.
 *
 * # Why `imageToImage` and not one of the other four
 *
 * Recraft ships five editing routes; four of them (`imageEditInpaint`,
 * `imageEditOutpaint`, `imageEditGenerateBackground`,
 * `imageEditReplaceBackground`) are mask- or geometry-driven and are wire-only
 * in v1. `imageToImage` is the one that takes a picture, a sentence and a dial,
 * which is exactly `ImageEditParams`.
 *
 * # `strength` is native here, and it is REQUIRED
 *
 * The one route in this category whose dial means the same thing the canonical
 * one does, in the same units and the same direction: "0 = almost identical to
 * the input, 1 = minimal similarity". So {@link STRENGTH} is the identity map,
 * declared with the same two endpoints every other adapter declares so the
 * capability sweep can read the direction off data rather than off prose.
 *
 * It is also **required** on the wire, and the endpoints doc gives no default —
 * which is a real difference from the canonical vocabulary, where `strength` is
 * optional because most providers have no dial at all. Rather than invent a
 * default (any number here is a different picture, and a silently-chosen one is
 * the worst kind of surprise on a per-image bill), a request with no `strength`
 * at a `recraft/…` ref is an error naming the field and what its ends mean.
 *
 * # `image`: a Blob or a URL, and a `data:` URL is a URL
 *
 * These routes are dual-format: `image` (multipart Blob) ⇄ `image_url` (JSON,
 * "a public URL or a `data:` URL"). So `imageInputs` is `["file", "url"]` —
 * and **not** `"data"`, because the canonical `{ data }` is a bare base64
 * payload with no media type, and `image_url` needs the type to be a `data:`
 * URL at all. A caller who has a data URI already passes it as `{ url }`, which
 * is what it is.
 *
 * # Sizing
 *
 * There is none. `imageToImage` publishes no `size` and no aspect field — the
 * output takes the input's shape — so `aspectRatio` and `dimensions` are both
 * declared gaps. `imageEditOutpaint` is the route with a `size`, and it is
 * wire-only.
 */
import {
  resolveImageEditInput,
  resolveOperation,
  toStrength,
  type StrengthRules,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageEditAdapterFor,
  ImageEditParamsFor,
} from "../../core/unified/vocabulary/image-edit";
import { imageEdit as imageToImage } from "./image-edit";
import { IMAGE_TO_IMAGE_MODELS, type RecraftModelId } from "./models";

/** The operations this route serves through the canonical vocabulary. */
const EDIT_ONLY = ["edit"] as const;

const ENDPOINTS_DOCS = "https://www.recraft.ai/docs/api-reference/endpoints";

/**
 * Every model `imageToImage` documents — the V3 **and** V4 lines, which is one
 * more line than the four V3-only editing routes accept and the reason this
 * list is not just `MODELS` from the generation adapter (recraftv2 and
 * recraft20b are generation-only).
 *
 * Spread from `IMAGE_TO_IMAGE_MODELS` rather than retyped: that array is what
 * the endpoint's own `makeModelCheck` allows, so the refs that autocomplete and
 * the ids that validate cannot drift.
 */
const MODELS = [...IMAGE_TO_IMAGE_MODELS] as const satisfies readonly RecraftModelId[];

/** "0 = almost identical to the input, 1 = minimal similarity" — the identity map. */
const STRENGTH: StrengthRules = { atZero: 0, atOne: 1, source: ENDPOINTS_DOCS };

/**
 * The wire body this adapter compiles to — the slice of `ImageToImageParams`
 * the canonical vocabulary can reach.
 *
 * No `[key: string]: unknown` tail: `ImageToImageParams` has no index
 * signature, so an open tail would make `ExactKeys` demand `never` for every
 * extra key and `recraft.imageEdit.safe` would stop being assignable. The rest
 * of the surface — `style`, `style_id`, `negative_prompt`, `controls`,
 * `text_layout`, `response_format` — arrives through `providerOptions.recraft`,
 * which the kernel merges *before* validation.
 */
export interface RecraftImageEditWire {
  model: string;
  prompt: string;
  strength: number;
  image?: Blob;
  image_url?: string;
  n?: number;
  random_seed?: number;
}

/** What a unified edit call to `recraft/…` returns: `imageToImage`'s `Validated`. */
export type RecraftImageEditResult = ReturnType<typeof imageToImage>;

export const imageEdit = {
  category: "imageEdit",
  provider: "recraft",
  models: MODELS,
  imageInputs: ["file", "url"],
  unsupported: {
    aspectRatio:
      "POST /v1/images/imageToImage publishes no size or aspect field — the result takes the " +
      "input image's shape. `recraft.imageEditOutpaint` is the route with a `size`, and it is " +
      "reachable at `unmodel/recraft`.",
    dimensions:
      "POST /v1/images/imageToImage publishes no size or aspect field — the result takes the " +
      "input image's shape. `recraft.imageEditOutpaint` is the route with a `size`, and it is " +
      "reachable at `unmodel/recraft`.",
    outputFormat:
      "Recraft's editing routes publish no output-encoding field; `response_format` chooses " +
      'between a URL and base64 ("url" / "b64_json"), which is delivery rather than encoding. ' +
      "Set it via `providerOptions.recraft`.",
  },
  compile(
    input: ImageEditParamsFor<"file" | "url">,
    ctx: CompileContext<ImageEditParamsFor<"file" | "url">>,
  ): CompiledCall<RecraftImageEditWire, RecraftImageEditResult> {
    const body: RecraftImageEditWire = {
      model: ctx.model,
      prompt: input.prompt,
      // Overwritten below when the caller supplied one; the branch that does
      // not is an error, so this value never reaches a validator.
      strength: 0,
    };
    ctx.from(["prompt"], "prompt");
    ctx.from(["image"], "image");
    ctx.from(["image_url"], "image");

    ctx.take(
      resolveOperation(input.operation, EDIT_ONLY, { path: ["operation"], warn: ctx.warn }, {
        source: ENDPOINTS_DOCS,
        hint:
          "Recraft's `imageEditInpaint`, `imageEditOutpaint`, `imageEditGenerateBackground` and " +
          "`imageEditReplaceBackground` are reachable by name at `unmodel/recraft`.",
      }),
    );

    const image = ctx.take(
      resolveImageEditInput(input.image, ["file", "url"], { path: ["image"], warn: ctx.warn }, {
        source: ENDPOINTS_DOCS,
        hint:
          "`image` is a multipart part and `image_url` is its JSON counterpart, which takes a " +
          "public URL or a `data:` URL — pass a bare base64 payload as a `data:` URL under " +
          "`{ url }`.",
      }),
    );
    if (image?.kind === "file") body.image = image.file;
    else if (image?.kind === "url") body.image_url = image.url;

    if (input.strength === undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["strength"],
        message:
          "`strength` is required on POST /v1/images/imageToImage — 0 keeps the input almost " +
          "unchanged, 1 leaves only a minimal resemblance — and Recraft documents no default, so " +
          "unmodel will not choose one for you.",
        meta: { source: ENDPOINTS_DOCS },
      });
    } else {
      ctx.from(["strength"], "strength");
      const strength = ctx.take(
        toStrength(input.strength, STRENGTH, { path: ["strength"], warn: ctx.warn }),
      );
      if (strength !== undefined) body.strength = strength;
    }

    if (input.n !== undefined) body.n = input.n;
    if (input.seed !== undefined) {
      ctx.from(["random_seed"], "seed");
      body.random_seed = input.seed;
    }

    return { params: body, validate: imageToImage.safe };
  },
} as const satisfies ImageEditAdapterFor<
  "file" | "url",
  RecraftImageEditWire,
  RecraftImageEditResult
>;
