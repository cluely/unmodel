/**
 * `unmodel/image` → `openai.image` (POST /v1/images/generations).
 *
 * A sibling of `./unified-speech`, and a separate module for a reason that is
 * about bytes rather than tidiness: `unmodel/speech` and `unmodel/image` both
 * import from this provider, and a single module holding both adapters puts
 * OpenAI's image catalog (and the generated `src/catalog/openai.gen.ts` behind
 * it) into the speech pack, where nothing can ever use it. One module per
 * category is what keeps each pack paying only for the endpoint it calls;
 * `./unified.ts` re-exports both, so the public subpath is unchanged.
 */
import {
  applyExtras,
  redundantTier,
  resolveSizing,
  sizeRules,
  sizingField,
  toSizeEnum,
  toSizeFreeform,
  type FreeformRules,
  type SizeTable,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { ImageAdapterFor, ImageParams } from "../../core/unified/vocabulary/image";
import { image as imageValidator } from "./image";
import { OPENAI_IMAGE_MODEL_PARAMS } from "./image-params";

/**
 * # `image`
 *
 * Three size vocabularies live behind one `size` field here, and which one a
 * request lands in is decided entirely by the model id:
 *
 * | family | `size` | canonical shape |
 * |---|---|---|
 * | `dall-e-2` | `256x256` / `512x512` / `1024x1024` | S3 — square only |
 * | `dall-e-3` | `1024x1024` / `1792x1024` / `1024x1792` | S3 — and `1792x1024` is **1.750:1**, not 16:9 |
 * | `gpt-image-1`, `-1-mini`, `-1.5` | `1024x1024` / `1536x1024` / `1024x1536` | S3 — square and 3:2 |
 * | `gpt-image-2`, `-2-2026-04-21` | free-form `WxH` | S4 — 16-px grid, ≤3:1, ≤3840 px/edge |
 *
 * The DALL·E 3 row is the reason {@link toSizeEnum} measures its own output:
 * everyone calls `1792x1024` "16:9" and it is not, so asking for `16:9` here
 * gets that size **and** an `approximated_param` naming 1.750 against 1.778.
 * Nothing else in this adapter is lossy — which is the point.
 *
 * The two deliveries and the two formats are orthogonal on paper and not on
 * this API: the GPT image models always return base64 and have no
 * `response_format`, and the DALL·E models return a URL or base64 and have no
 * `output_format`. So `outputDelivery: "base64"` is free on a GPT image model
 * (it is what it does) and `outputDelivery: "url"` is an error there, while
 * `outputFormat` is an error on DALL·E. Both errors quote the create
 * reference's own wording rather than a message this file invented.
 *
 * `seed` and `negativePrompt` have no field on this endpoint at all, so they
 * are declared gaps and the kernel reports them uniformly.
 */
const IMAGE_MODELS = [
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "dall-e-3",
  "dall-e-2",
] as const;

const IMAGES_CREATE_DOCS = "https://developers.openai.com/api/docs/api-reference/images/create";
const IMAGE_GUIDE_DOCS = "https://developers.openai.com/api/docs/guides/image-generation";

/** The ids whose `size` is free-form rather than an enum. */
const FREEFORM_SIZE_MODELS: ReadonlySet<string> = new Set([
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
]);

/** The ids that always return base64 and have no `response_format`. */
const GPT_IMAGE_MODELS: ReadonlySet<string> = new Set([
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
]);

/**
 * The documented `size` enums, keyed by the ratio each value is *sold* as.
 *
 * `"16:9"` for `1792x1024` is that row's label, not its arithmetic — see the
 * drift warning on {@link toSizeEnum}. Only `1k` is offered: every value here
 * is between 1.0 and 1.8 megapixels, and inventing a `2k` row for an API that
 * documents none would be a promise this file cannot keep.
 */
const DALL_E_2_SIZES: SizeTable = { "1k": { "1:1": "1024x1024" } };

const DALL_E_3_SIZES: SizeTable = {
  "1k": { "1:1": "1024x1024", "16:9": "1792x1024", "9:16": "1024x1792" },
};

const GPT_IMAGE_1_SIZES: SizeTable = {
  "1k": { "1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536" },
};

/**
 * gpt-image-2's free-form rules, from the image-generation guide: "Both edges
 * must be multiples of `16px`", "Maximum edge length must be less than or
 * equal to `3840px`".
 *
 * No `min`: the floor the guide documents is on *total* pixels (655,360), not
 * per edge, and `PixelRules` has no way to say that. Leaving it out is the
 * honest choice — a request that lands under the floor is rejected by
 * `checkGptImage2Size`, i.e. by the same check a hand-written call meets, and
 * the kernel remaps that error onto `aspectRatio`/`dimensions`.
 */
const GPT_IMAGE_2_RULES: FreeformRules = { grid: 16, max: 3840, source: IMAGE_GUIDE_DOCS };

/** The wire body this adapter compiles to — the loose arm of `ImagesBody`. */
export interface OpenaiImageWire {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  output_format?: string;
  response_format?: string;
  [key: string]: unknown;
}

/** What a unified image call to `openai/…` returns: `openai.image`'s `Validated`. */
export type OpenaiImageResult = ReturnType<typeof imageValidator>;

/** The size table for a model id; unknown ids compile like the current generation. */
function sizeTableFor(model: string): SizeTable | undefined {
  if (model === "dall-e-2") return DALL_E_2_SIZES;
  if (model === "dall-e-3") return DALL_E_3_SIZES;
  if (FREEFORM_SIZE_MODELS.has(model)) return undefined;
  return GPT_IMAGE_1_SIZES;
}

export const image = {
  category: "image",
  provider: "openai",
  models: IMAGE_MODELS,
  modelParams: OPENAI_IMAGE_MODEL_PARAMS,
  unsupported: {
    seed:
      "POST /v1/images/generations has no seed field — neither the DALL·E nor the GPT image " +
      "models expose one, so a seed could only be dropped.",
    negativePrompt:
      "POST /v1/images/generations has no negative-prompt field; describe what to avoid " +
      "inside `prompt` instead.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<OpenaiImageWire, OpenaiImageResult> {
    const body: OpenaiImageWire = { model: ctx.model, prompt: input.prompt };
    ctx.from(["size"], "aspectRatio");

    const sizing = ctx.take(
      resolveSizing(
        input,
        { path: ["aspectRatio"], warn: ctx.warn },
        sizeRules(OPENAI_IMAGE_MODEL_PARAMS, ctx.model),
      ),
    );
    const tier = input.resolution ?? "1k";
    const table = sizeTableFor(ctx.model);

    /** One ratio, through whichever of the two size vocabularies this model has. */
    const toSize = (ratio: string, path: Array<string | number>): string | undefined =>
      ctx.take(
        table === undefined
          ? toSizeFreeform(ratio, tier, GPT_IMAGE_2_RULES, { path, warn: ctx.warn })
          : toSizeEnum(ratio, tier, table, { path, warn: ctx.warn }),
      );

    if (sizing?.kind === "size") {
      // A `size` that is not a pixel pair at all, which on this endpoint means
      // exactly one value: `"auto"`. `resolveSizing` has already checked it
      // against the model's declared list, so it goes across verbatim.
      ctx.from(["size"], "size");
      body.size = sizing.size;
    } else if (sizing?.kind === "ratio") {
      const size = toSize(sizing.aspectRatio, ["aspectRatio"]);
      if (size !== undefined) body.size = size;
    } else if (sizing?.kind === "dimensions") {
      // Straight through, on both paths: gpt-image-2 documents free-form
      // `WxH`, and the enum models have a documented `size` list their own
      // constraint table checks. Either way the pixels the caller asked for
      // are the pixels that go on the wire — so there is nothing to warn
      // about, and a size the model does not offer is that model's own error,
      // remapped onto `dimensions`.
      //
      // …and a tier alongside them is refused rather than ignored: `size` here
      // IS the pixel count, so `resolution` has nothing left to say and could
      // only contradict what was already said.
      if (input.resolution !== undefined) {
        ctx.take(
          redundantTier(
            input.resolution,
            { path: ["resolution"], warn: ctx.warn },
            sizingField(sizing) === "size" ? "size" : "dimensions",
          ),
        );
      }
      ctx.from(["size"], sizingField(sizing));
      // A `size` the caller wrote goes across exactly as written; a pair goes
      // across as the pair. They are the same string whenever both are legal.
      body.size = sizing.size ?? `${sizing.dimensions.width}x${sizing.dimensions.height}`;
    } else if (input.resolution !== undefined) {
      // A tier with no shape still has an answer here, because every family's
      // table has a square entry (and free-form solves 1:1 exactly). A tier the
      // model has no square for is an error from `toSizeEnum`, not a downgrade.
      ctx.from(["size"], "resolution");
      const size = toSize("1:1", ["resolution"]);
      if (size !== undefined) body.size = size;
    }

    if (input.n !== undefined) body.n = input.n;

    if (input.outputFormat !== undefined) {
      ctx.from(["output_format"], "outputFormat");
      if (GPT_IMAGE_MODELS.has(ctx.model)) {
        body.output_format = input.outputFormat;
      } else {
        ctx.fail({
          code: "unsupported_param",
          path: ["outputFormat"],
          message:
            "`output_format` is only supported for the GPT image models; " +
            `"${ctx.model}" returns PNG. Use a gpt-image model to choose an encoding.`,
          meta: { value: input.outputFormat, source: IMAGES_CREATE_DOCS },
        });
      }
    }

    if (input.outputDelivery !== undefined) {
      ctx.from(["response_format"], "outputDelivery");
      if (GPT_IMAGE_MODELS.has(ctx.model)) {
        // No field, and none needed: "GPT image models always return
        // base64-encoded images". Asking for that is exact; asking for a URL
        // is a request this endpoint cannot serve.
        if (input.outputDelivery !== "base64") {
          ctx.fail({
            code: "unsupported_param",
            path: ["outputDelivery"],
            message:
              "`response_format` is only supported for the dall-e models — GPT image models " +
              `always return base64-encoded images, so "${ctx.model}" cannot return a URL.`,
            meta: { value: input.outputDelivery, source: IMAGES_CREATE_DOCS },
          });
        }
      } else {
        body.response_format = input.outputDelivery === "url" ? "url" : "b64_json";
      }
    }

    applyExtras(input, OPENAI_IMAGE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: imageValidator.safe };
  },
} as const satisfies ImageAdapterFor<
  typeof OPENAI_IMAGE_MODEL_PARAMS,
  OpenaiImageWire,
  OpenaiImageResult
>;
