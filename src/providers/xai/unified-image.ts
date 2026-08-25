/**
 * `unmodel/image` → xAI Grok Imagine
 * (POST https://api.x.ai/v1/images/generations).
 *
 * # A shape-and-tier surface
 *
 * The wire has no `WxH` field of any kind: geometry is `aspect_ratio` (a
 * 16-value enum) and size is `resolution` (`"1k"` / `"2k"`). That makes this
 * the complementary case `redundantTier` documents — pixels supply the shape,
 * the tier supplies the size, and both fields are used:
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `prompt` | `prompt` | rename (identical name, so no `ctx.from`) |
 * | `model` (ref tail) | `model` | rename |
 * | `aspectRatio` | `aspect_ratio` | **S1** {@link toRatioEnum}, 15 shapes |
 * | `dimensions` / `WxH` `size` | `aspect_ratio` | {@link pixelsToRatio} — nearest shape, always warns |
 * | `resolution` | `resolution` | identity — xAI's tiers ARE `"1k"`/`"2k"`; `"4k"` errors |
 * | `n` | `n` | rename; the validator caps it at 10 |
 * | `outputDelivery` | `response_format` | value rename: `base64` → `"b64_json"` |
 * | `outputFormat`, `seed`, `negativePrompt` | — | declared gaps |
 *
 * # Why `outputFormat`, `seed` and `negativePrompt` are declared gaps
 *
 * - **`outputFormat`** — the request has no encoding field; the response says
 *   what it produced in `data[].mime_type`, which is xAI's pick, not yours.
 * - **`seed`** — no seed field anywhere on the route; a generation is not
 *   reproducible from the request.
 * - **`negativePrompt`** — no negative-prompt field; steer away from things
 *   inside `prompt`.
 *
 * `user` and `storage_options` have no canonical spelling in this category and
 * are this row's extras; `"auto"` aspect ratio (the wire's 16th value — "let
 * the model pick") is what an omitted `aspectRatio` already means, and stays
 * reachable through `providerOptions.xai`.
 */
import {
  applyExtras,
  pixelsToRatio,
  resolveSizing,
  sizingField,
  toRatioEnum,
  toTier,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { ImageAdapterFor, ImageParams } from "../../core/unified/vocabulary/image";
import {
  image as validator,
  type ImageGenerationsParams,
  type XaiImageAspectRatio,
  type XaiImageResolution,
} from "./image";
import { MODELS, XAI_IMAGE_MODEL_PARAMS, XAI_IMAGE_RATIOS } from "./image-params";

const IMAGE_DOCS = "https://docs.x.ai/developers/model-capabilities/imagine";

/** Canonical tier → xAI `resolution`. Identity where it exists; `4k` is absent. */
const RESOLUTIONS: Readonly<Partial<Record<string, XaiImageResolution>>> = {
  "1k": "1k",
  "2k": "2k",
};

/** Canonical delivery → `response_format`. Both documented values are mapped. */
const RESPONSE_FORMATS = { url: "url", base64: "b64_json" } as const;

/** The wire body this adapter compiles to. */
export type XaiImageWire = ImageGenerationsParams;

/** What a unified image call to `xai/…` returns: `xai.image`'s own `Validated`. */
export type XaiImageResult = ReturnType<typeof validator>;

export const image = {
  category: "image",
  provider: "xai",
  models: MODELS,
  modelParams: XAI_IMAGE_MODEL_PARAMS,
  unsupported: {
    outputFormat:
      "POST /v1/images/generations has no encoding field — the response's `data[].mime_type` " +
      "says what xAI produced, and the request cannot choose it.",
    seed:
      "xAI's image route has no seed field, so a generation is not reproducible from the request.",
    negativePrompt:
      "POST /v1/images/generations has no negative-prompt field; describe what to avoid inside " +
      "`prompt`.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<XaiImageWire, XaiImageResult> {
    const body: XaiImageWire = { model: ctx.model, prompt: input.prompt };
    ctx.from(["aspect_ratio"], "aspectRatio");
    ctx.from(["resolution"], "resolution");
    ctx.from(["response_format"], "outputDelivery");

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing?.kind === "ratio") {
      const ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, XAI_IMAGE_RATIOS, { source: IMAGE_DOCS }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      );
      // The value came out of XAI_IMAGE_RATIOS itself; the cast only restores
      // the literal type the derivation widened to `string`.
      if (ratio !== undefined) body.aspect_ratio = ratio as XaiImageAspectRatio;
    } else if (sizing?.kind === "dimensions") {
      // A `"1920x1080"` `size` lands here too. The pixel count cannot survive
      // a route whose fields are a shape and a two-tier size, so the nearest
      // shape is chosen and the conversion always warns.
      const wrote = sizingField(sizing);
      ctx.from(["aspect_ratio"], wrote);
      const { width, height } = sizing.dimensions;
      const ratio = ctx.take(
        pixelsToRatio(width, height, XAI_IMAGE_RATIOS, { path: [wrote], warn: ctx.warn }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio as XaiImageAspectRatio;
    }

    if (input.resolution !== undefined) {
      const resolution = ctx.take(
        toTier(input.resolution, RESOLUTIONS, { path: ["resolution"], warn: ctx.warn }),
      );
      if (resolution !== undefined) body.resolution = resolution;
    }

    if (input.n !== undefined) body.n = input.n;

    if (input.outputDelivery !== undefined) {
      body.response_format = RESPONSE_FORMATS[input.outputDelivery];
    }

    applyExtras(input, XAI_IMAGE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies ImageAdapterFor<typeof XAI_IMAGE_MODEL_PARAMS, XaiImageWire, XaiImageResult>;
