/**
 * `unmodel/image-edit` → `ideogram.imageEditRemix`
 * (POST /v1/ideogram-v3/remix).
 *
 * A sibling of `./unified-image`, split per category so `unmodel/image` and
 * `unmodel/image-edit` each pay for one of Ideogram's route families rather
 * than both. `./unified.ts` re-exports the pair.
 *
 * # Why *remix* is the unified edit route, and `imageEdit` is not
 *
 * Ideogram ships four editing routes, and the one literally named `edit`
 * (`ideogram.imageEdit`, POST /v1/ideogram-v3/edit) **requires a mask**: it is
 * inpainting, and `mask` has no canonical field in v1 — masked operations are
 * wire-only, which is what the `operation` discriminant on `ImageEditParams`
 * exists to make expressible later. `reframe` has no prompt at all and
 * `replace-background` only repaints the background, so neither is "edit this
 * picture" either.
 *
 * `remix` is: image + prompt + a dial, no mask, output shaped by
 * `resolution` XOR `aspect_ratio`. So the canonical `operation: "edit"` at an
 * `ideogram/…` ref compiles to remix, and the three siblings stay reachable by
 * name at `unmodel/ideogram`.
 *
 * # `strength` is inverted here, and this is the sentence that says so
 *
 * `image_weight` is documented "How strongly the output should resemble the
 * input image. Default 50." — **higher means less change**. The canonical
 * `strength` is the opposite by definition ("0 = keep the source, 1 = ignore
 * it"), so the map runs downhill:
 *
 * | `strength` | `image_weight` | meaning |
 * |---|---|---|
 * | `0` | `100` | keep the source as far as the route can |
 * | `0.5` | `50` | the route's own default |
 * | `1` | `0` | let the prompt win |
 *
 * Declared as {@link IMAGE_WEIGHT}'s two endpoints rather than written as
 * `100 - strength * 100`, so the direction is data the capability sweep can
 * assert rather than arithmetic buried in a branch. `image_weight` is an
 * integer on the wire, so a `strength` that lands between two whole numbers is
 * an `approximated_param` naming both.
 *
 * # The rest
 *
 * `model` does two jobs here exactly as it does on the generation routes:
 * `ideogram-3.0-quality` picks the *pseudo-model* whose price the catalog
 * carries **and** the `rendering_speed` on the wire. Only the 3.0 refs appear —
 * remix is a v3 route, and there is no 4.0 remix to point a `ideogram-4.0-…`
 * ref at.
 */
import {
  applyExtras,
  EXTRA,
  resolveImageEditInput,
  resolveOperation,
  resolveSizing,
  sizeRules,
  sizingField,
  toRatioEnum,
  toStrength,
  type StrengthRules,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageEditAdapterFor,
  ImageEditParamsFor,
  ModelParamTable,
} from "../../core/unified/vocabulary/image-edit";
import {
  ASPECT_RATIOS,
  RESOLUTIONS,
  type IdeogramAspectRatio,
  type IdeogramColorPalette,
  type IdeogramMagicPromptOption,
  type IdeogramRenderingSpeed,
  type IdeogramResolution,
  type IdeogramStylePreset,
  type IdeogramStyleType,
} from "./image";
import { imageEditRemix as remix } from "./image-edit";
import { RENDERING_SPEED_TO_MODEL_ID, type IdeogramModelId } from "./models";

/** The operations this route serves through the canonical vocabulary. */
const EDIT_ONLY = ["edit"] as const;

const REMIX_DOCS = "https://developer.ideogram.ai/api-reference/api-reference/remix-v3";
const OPENAPI_DOCS = "https://developer.ideogram.ai/openapi.json";

/**
 * The 3.0 pseudo-models, and only those: remix is `/v1/ideogram-v3/remix` and
 * the 4.0 line publishes no remix route, so a `ideogram-4.0-…` ref here would
 * autocomplete a request that cannot be made.
 *
 * `satisfies readonly IdeogramModelId[]` pins the list to `models.ts`, so a
 * typo is a compile error rather than an `unknown_model` warning that silently
 * skips the per-speed price.
 */
const MODELS = [
  "ideogram-3.0-flash",
  "ideogram-3.0-turbo",
  "ideogram-3.0-default",
  "ideogram-3.0-quality",
] as const satisfies readonly IdeogramModelId[];

/**
 * One row, four times: the four refs differ only in `rendering_speed` and
 * price, and `/v1/ideogram-v3/remix` is one route with one form.
 *
 * `sizes` is the same closed 69-value `resolution` enum the generation route
 * has, and `ratios` the same fifteen shapes respelled with a colon — the wire
 * spells them with an `x`, and `toRatioEnum` bridges the two. Neither is
 * free-form: `checkEnums` rejects anything outside the lists.
 *
 * `rendering_speed` is deliberately absent from the extras: it is compiled
 * from the model half of the ref, and a second way to set it would let one
 * request say two things about which model it wants.
 */
const IDEOGRAM_REMIX_RATIOS = [
  "1:3",
  "3:1",
  "1:2",
  "2:1",
  "9:16",
  "16:9",
  "10:16",
  "16:10",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "1:1",
] as const;

const REMIX_ROW = {
  sizes: RESOLUTIONS,
  ratios: IDEOGRAM_REMIX_RATIOS,
  extras: {
    magic_prompt: EXTRA as IdeogramMagicPromptOption,
    style_type: EXTRA as IdeogramStyleType,
    style_preset: EXTRA as IdeogramStylePreset,
    style_codes: EXTRA as string[],
    color_palette: EXTRA as IdeogramColorPalette,
    style_reference_images: EXTRA as Blob[],
    character_reference_images: EXTRA as Blob[],
    character_reference_images_mask: EXTRA as Blob[],
  },
} as const;

const IDEOGRAM_IMAGE_EDIT_MODEL_PARAMS = {
  "ideogram-3.0-flash": REMIX_ROW,
  "ideogram-3.0-turbo": REMIX_ROW,
  "ideogram-3.0-default": REMIX_ROW,
  "ideogram-3.0-quality": REMIX_ROW,
} as const satisfies ModelParamTable;

/**
 * `image_weight` at canonical 0 and 1 — see the inversion table in the header.
 * Integer because the route's schema is `z.number().int()`.
 */
const IMAGE_WEIGHT: StrengthRules = { atZero: 100, atOne: 0, integer: true, source: OPENAPI_DOCS };

/** Pseudo-model id → the `rendering_speed` it encodes, by inverting the price map. */
const SPEEDS: Readonly<Record<string, IdeogramRenderingSpeed>> = Object.freeze(
  Object.fromEntries(
    Object.entries(RENDERING_SPEED_TO_MODEL_ID).map(([speed, id]) => [id, speed]),
  ) as Record<string, IdeogramRenderingSpeed>,
);

/**
 * The wire body this adapter compiles to — the slice of `RemixParams` the
 * canonical vocabulary can reach.
 *
 * No `[key: string]: unknown` tail: `RemixParams` has no index signature, so an
 * open tail would make `ExactKeys` demand `never` for every extra key and
 * `ideogram.imageEditRemix.safe` would stop being assignable. The rest of the
 * form — `style_type`, `magic_prompt`, `negative_prompt`, `color_palette`, the
 * reference-image arrays — reaches the body through `providerOptions.ideogram`,
 * which the kernel merges *before* validation.
 */
export interface IdeogramImageEditWire {
  image: Blob;
  prompt: string;
  image_weight?: number;
  aspect_ratio?: IdeogramAspectRatio;
  resolution?: IdeogramResolution;
  rendering_speed?: IdeogramRenderingSpeed;
  seed?: number;
  num_images?: number;
  // The per-model extras, named rather than reached through an index
  // signature — `RemixParams` has none, and an open tail would make
  // `ExactKeys` demand `never` for every key.
  magic_prompt?: IdeogramMagicPromptOption;
  style_type?: IdeogramStyleType;
  style_preset?: IdeogramStylePreset;
  style_codes?: string[];
  color_palette?: IdeogramColorPalette;
  style_reference_images?: Blob[];
  character_reference_images?: Blob[];
  character_reference_images_mask?: Blob[];
}

/** What a unified edit call to `ideogram/…` returns: remix's own `Validated`. */
export type IdeogramImageEditResult = ReturnType<typeof remix>;

export const imageEdit = {
  category: "imageEdit",
  provider: "ideogram",
  models: MODELS,
  imageInputs: ["file"],
  modelParams: IDEOGRAM_IMAGE_EDIT_MODEL_PARAMS,
  unsupported: {
    outputFormat:
      "Ideogram's editing routes are multipart in and PNG out — no route on /v1/ideogram-v3/* " +
      "publishes an output-encoding field, so a format could only be dropped.",
  },
  compile(
    input: ImageEditParamsFor<"file">,
    ctx: CompileContext<ImageEditParamsFor<"file">>,
  ): CompiledCall<IdeogramImageEditWire, IdeogramImageEditResult> {
    const body: IdeogramImageEditWire = { image: new Blob([]), prompt: input.prompt };
    ctx.from(["image"], "image");
    ctx.from(["prompt"], "prompt");

    ctx.take(
      resolveOperation(input.operation, EDIT_ONLY, { path: ["operation"], warn: ctx.warn }, {
        source: OPENAPI_DOCS,
        hint:
          "Ideogram's mask-driven `imageEdit`, its `imageEditReframe` and its " +
          "`imageEditReplaceBackground` are reachable by name at `unmodel/ideogram`.",
      }),
    );

    const image = ctx.take(
      resolveImageEditInput(input.image, ["file"], { path: ["image"], warn: ctx.warn }, {
        source: REMIX_DOCS,
        hint: "POST /v1/ideogram-v3/remix reads the bytes from a multipart `image` part.",
      }),
    );
    if (image?.kind === "file") body.image = image.file;

    const speed = SPEEDS[ctx.model];
    if (speed !== undefined) {
      // The ref picked a billable tier as well as a route; saying so is what
      // makes a `rendering_speed` finding point at `model`, which is the field
      // the caller actually wrote.
      ctx.from(["rendering_speed"], "model");
      body.rendering_speed = speed;
    }

    if (input.strength !== undefined) {
      ctx.from(["image_weight"], "strength");
      const weight = ctx.take(
        toStrength(input.strength, IMAGE_WEIGHT, { path: ["strength"], warn: ctx.warn }),
      );
      if (weight !== undefined) body.image_weight = weight;
    }

    const sizing = ctx.take(
      resolveSizing(
        input,
        { path: ["aspectRatio"], warn: ctx.warn },
        sizeRules(IDEOGRAM_IMAGE_EDIT_MODEL_PARAMS, ctx.model),
      ),
    );
    if (sizing?.kind === "ratio") {
      ctx.from(["aspect_ratio"], "aspectRatio");
      // S1. Ideogram spells its ratios with an `x`; `toRatioEnum` matches on
      // the reduced ratio and hands back the provider's own spelling, so
      // "16:9", "16x9" and "32:18" all compile to "16x9" and none of them warns.
      const ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, ASPECT_RATIOS, { source: REMIX_DOCS }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio as IdeogramAspectRatio;
    } else if (sizing?.kind === "dimensions") {
      // Straight through: the 69-value `resolution` list is `checkEnums`'
      // business — the same check a hand-written call meets — and its message
      // already names the allowed values, remapped here onto `dimensions`.
      ctx.from(["resolution"], sizingField(sizing));
      body.resolution = (sizing.size ??
        `${sizing.dimensions.width}x${sizing.dimensions.height}`) as IdeogramResolution;
    }

    if (input.n !== undefined) {
      ctx.from(["num_images"], "n");
      body.num_images = input.n;
    }
    // `seed` is `seed`: identical name, so no provenance to declare.
    if (input.seed !== undefined) body.seed = input.seed;

    applyExtras(input, IDEOGRAM_IMAGE_EDIT_MODEL_PARAMS, body, ctx);

    return { params: body, validate: remix.safe };
  },
} as const satisfies ImageEditAdapterFor<
  "file",
  IdeogramImageEditWire,
  IdeogramImageEditResult,
  typeof IDEOGRAM_IMAGE_EDIT_MODEL_PARAMS
>;
