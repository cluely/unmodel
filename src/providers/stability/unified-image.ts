/**
 * `unmodel/image` → Stability AI's three v2beta Stable Image generate routes
 * (POST /v2beta/stable-image/generate/{ultra|core|sd3}).
 *
 * # One adapter, three URLs
 *
 * Stability does not have a `model` param with three values; it has three
 * *endpoints*, two of which have no `model` field at all — "the route is the
 * model" (`./image.ts`). The unified surface has the opposite shape: one
 * provider id, one adapter, and a ref that carries the model. So this adapter's
 * only real job beyond renaming four fields is to turn the bare model id into a
 * route, and then to emit `model` on exactly the one route that has the field:
 *
 * | ref | route | `model` on the wire |
 * |---|---|---|
 * | `stability/stable-image-ultra` | `…/generate/ultra` (8 credits) | — the route is the model |
 * | `stability/stable-image-core` | `…/generate/core` (3 credits) | — the route is the model |
 * | `stability/sd3.5-*`, `stability/sd3-*` | `…/generate/sd3` (2.5–6.5 credits) | `model: "sd3.5-large"`, … |
 *
 * `stable-image-ultra` and `stable-image-core` are unmodel-internal handles for
 * those two routes (see `./models.ts`) rather than strings Stability accepts
 * anywhere — which is precisely why they must never reach a wire field.
 *
 * An id this snapshot does not recognise is compiled to the **sd3** route with
 * `model` set to whatever the caller wrote. That is the only route with a
 * `model` field, so it is the only one that can carry an unknown id *without
 * dropping it*; the sd3 route's own `checkSd3Model` then reports it as an
 * `invalid_enum_value` naming the seven ids it knows, which a caller can demote
 * with `options.severity` if Stability shipped the model after this snapshot.
 * Routing an unrecognised id to ultra would be the alternative, and it would
 * mean silently generating with a different model than the one that was asked
 * for — the exact failure this library exists to prevent.
 *
 * # Size: one closed ratio enum, and no pixels anywhere
 *
 * All three routes take the same nine-value `aspect_ratio` enum
 * (`STABILITY_ASPECT_RATIOS`) and **nothing else** — no `size`, no `width`, no
 * `height`, no `resolution`. So:
 *
 * - `aspectRatio` is a pure **S1** ({@link toRatioEnum}): a shape in the enum
 *   is re-spelled the way Stability spells it and costs nothing; a shape
 *   outside it is an `invalid_enum_value` listing the nine, never a snap.
 * - `dimensions` goes through {@link pixelsToRatio}, which snaps to the nearest
 *   allowed shape within 2% and **always warns**, even for a perfect match.
 *   That is not pessimism: a ratio cannot carry a pixel count, and 1024×1024
 *   and 1536×1536 are the same request here. Beyond 2% the pixels are an
 *   `unsupported_param` rather than a shape nobody asked for.
 * - `resolution` has no field to land in, and the honest answer depends on the
 *   route — see {@link OUTPUT} below.
 *
 * # What each lossy decision costs, and why it is the honest one
 *
 * - **`resolution` is a fixed property of the route.** The spec is explicit:
 *   ultra and sd3 produce "1 megapixel … default 1024x1024", core "1.5
 *   megapixels". A caller asking for `1k` on ultra or sd3 gets exactly that, so
 *   nothing is sent and nothing is warned — the request mapped. `1k` on core
 *   gets 1.5 MP, which is the nearest thing core can do and 1.4× the area
 *   asked for, so it is an `approximated_param` naming both. `2k` and `4k` are
 *   an error on every route, because there is no field, no larger route, and no
 *   defensible way to hand back a 1 MP image for a 4 MP request.
 * - **`n` is a provider-wide gap.** These routes bill flat credits *per
 *   successful generation* and publish no `n` / `samples` / `num_images` field.
 * - **`outputDelivery: "url"` is an error; `"base64"` is free.** The three
 *   routes answer with the image itself — raw bytes by default, base64 inside
 *   JSON when the caller sends `accept: "application/json"` — and never a URL.
 *   Inline bytes is what the canonical `"base64"` means, so asking for it is
 *   exact; asking for a URL is a response this API does not have. The choice
 *   between raw and base64-in-JSON is an *Accept header*, and `./image.ts`
 *   leaves `.request.headers` deliberately empty so that `fetch` can derive the
 *   multipart boundary — so the header is the caller's to add either way, and
 *   there is nothing for this adapter to compile.
 *
 * Everything else is a rename: `negativePrompt` → `negative_prompt`,
 * `outputFormat` → `output_format` (the canonical `png | jpeg | webp` **is**
 * `STABILITY_OUTPUT_FORMATS`, value for value), `seed` → `seed`, `prompt` →
 * `prompt`. `ctx.from` is declared for the first two and not for the last two,
 * per the convention on `openai/unified.ts`: the remap is worth reading when
 * the names differ and noise when they do not.
 *
 * # The extras
 *
 * `style_preset` (all three routes) and `cfg_scale` / `mode` (sd3 only) are
 * typed per model on {@link STABILITY_IMAGE_MODEL_PARAMS} and copied to the
 * wire verbatim — they are Stability's own spellings, so there is nothing to
 * translate. `cfg_scale` on `stability/stable-image-ultra` is an
 * `unsupported_param` naming the seven sd3 ids that do take it.
 *
 * Still `providerOptions.stability` only: `image` + `strength`, which is
 * image-to-image and belongs to the `imageEdit` category rather than this one.
 */
import {
  applyExtras,
  EXTRA,
  pixelsToRatio,
  resolveSizing,
  sizingField,
  toRatioEnum,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageAdapterFor,
  ImageParams,
  ModelParamTable,
  ResolutionTier,
} from "../../core/unified/vocabulary/image";
import {
  image as ultraValidator,
  imageCore as coreValidator,
  imageSd3 as sd3Validator,
  STABILITY_ASPECT_RATIOS,
  type StabilityStylePreset,
  type StabilityAspectRatio,
  type StabilityOutputFormat,
  type StableImageCoreParams,
  type StableImageSd3Params,
  type StableImageUltraParams,
} from "./image";

/**
 * Every generate model in the hand catalog — the ref union for `stability/…`.
 *
 * The two `stable-image-*` entries are route handles; the seven others are
 * literal `model` values of the sd3 route, deprecated ids included (Stability
 * re-routes `sd3-large` & co. to their sd3.5 equivalents server-side "at the
 * same price", so they still work and still belong here).
 */
const MODELS = [
  "stable-image-ultra",
  "stable-image-core",
  "sd3.5-large",
  "sd3.5-large-turbo",
  "sd3.5-medium",
  "sd3.5-flash",
  "sd3-large",
  "sd3-large-turbo",
  "sd3-medium",
] as const;

// ---------------------------------------------------------------------------
// The per-model table
// ---------------------------------------------------------------------------

/**
 * No `sizes` row anywhere: none of the three generate routes has a pixel or a
 * `WxH` field at all, so `size` types as `never` here and an editor offers
 * `aspectRatio` — which is the only thing this API can be told about shape.
 * A `size` still *runs*: it lands in the same `pixelsToRatio` the `dimensions`
 * arm uses, with the warning that conversion always carries.
 *
 * `tiers` is `["1k"]` on every row because every route's output is fixed —
 * ultra and sd3 return 1 MP, core 1.5 — and `checkResolution` above is what
 * turns 2k/4k into an error rather than a silent downgrade.
 */
const STABILITY_TIERS = ["1k"] as const;

/** `style_preset` is the one extra all three routes share. */
const STYLE_PRESET = EXTRA as StabilityStylePreset;

const GENERATE_EXTRAS = { style_preset: STYLE_PRESET } as const;

/**
 * The sd3 route alone publishes `cfg_scale` and `mode`. `mode:
 * "image-to-image"` needs an `image` part this category has no word for, so it
 * is a value the endpoint's own schema will reject here — which is the right
 * division of labour: the table says the *param* exists, and `sd3Validator`
 * says which of its values this request can carry.
 */
const SD3_EXTRAS = {
  style_preset: STYLE_PRESET,
  cfg_scale: EXTRA as number,
  mode: EXTRA as "text-to-image" | "image-to-image",
} as const;

const RATIO_ONLY = { ratios: STABILITY_ASPECT_RATIOS, tiers: STABILITY_TIERS } as const;

const STABILITY_IMAGE_MODEL_PARAMS = {
  "stable-image-ultra": { ...RATIO_ONLY, extras: GENERATE_EXTRAS },
  "stable-image-core": { ...RATIO_ONLY, extras: GENERATE_EXTRAS },
  "sd3.5-large": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3.5-large-turbo": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3.5-medium": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3.5-flash": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3-large": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3-large-turbo": { ...RATIO_ONLY, extras: SD3_EXTRAS },
  "sd3-medium": { ...RATIO_ONLY, extras: SD3_EXTRAS },
} as const satisfies ModelParamTable;

/**
 * The machine-readable v2beta spec — the same URL `./image.ts` quotes. Despite
 * the `/v2alpha` path it serves the v2beta REST document, and it is what the
 * rendered reference loads.
 */
const API_REFERENCE_URL = "https://api.stability.ai/v2alpha/openapi";

/** Which of the three URLs a ref compiles to. */
type StabilityRoute = "ultra" | "core" | "sd3";

/** The ids that are route handles rather than wire `model` values. */
const ULTRA_MODEL_ID = "stable-image-ultra";
const CORE_MODEL_ID = "stable-image-core";

/**
 * Ref → route. Unrecognised ids go to sd3 — the module header explains why
 * that is the only route that can carry one without losing it.
 */
function routeFor(model: string): StabilityRoute {
  if (model === ULTRA_MODEL_ID) return "ultra";
  if (model === CORE_MODEL_ID) return "core";
  return "sd3";
}

/** The wire body this adapter compiles to — one arm per route. */
export type StabilityImageWire =
  | StableImageUltraParams
  | StableImageCoreParams
  | StableImageSd3Params;

/** What a unified call to `stability/…` returns — again one arm per route. */
export type StabilityImageResult =
  | ReturnType<typeof ultraValidator>
  | ReturnType<typeof coreValidator>
  | ReturnType<typeof sd3Validator>;

type StabilityValidate = CompiledCall<StabilityImageWire, StabilityImageResult>["validate"];

/** The three `.safe`s, keyed by the route the ref picked. */
const VALIDATE: Readonly<Record<StabilityRoute, StabilityValidate>> = {
  // One cast per route, at the one place the three meet: each validator takes
  // its own arm of the union above, and the ref decided which arm `body` is.
  ultra: ultraValidator.safe as StabilityValidate,
  core: coreValidator.safe as StabilityValidate,
  sd3: sd3Validator.safe as StabilityValidate,
};

/**
 * The body under construction, before the route narrows it.
 *
 * `model` is on the draft and not on two of the three arms, which is the
 * point: it is written only when {@link routeFor} chose sd3, and the cast at
 * the end of `compile` is what tells the type system that the route and the
 * shape agree.
 */
interface StabilityDraft {
  prompt: string;
  model?: string;
  aspect_ratio?: StabilityAspectRatio;
  negative_prompt?: string;
  seed?: number;
  output_format?: StabilityOutputFormat;
}

/**
 * What each route actually produces, because none of them lets you ask.
 *
 * Transcribed from the spec's own "### Output" sections: ultra — "The
 * resolution of the generated image will be 1 megapixel. The default
 * resolution is 1024x1024"; core — "The resolution of the generated image will
 * be 1.5 megapixels"; sd3 — "The resolution of the generated image will be
 * 1MP. The default resolution is 1024x1024".
 *
 * `tier` is the one canonical tier that route can answer for, and `exact` says
 * whether it answers for it *exactly*. 1024×1024 is 1,048,576 px, which is
 * `TIER_PIXELS["1k"]` to the pixel — so ultra and sd3 satisfy `1k` with
 * nothing sent and nothing warned. Core's 1.5 MP is 1.4× that: still the
 * nearest tier by a distance (2k is 2.8× away), still the only size core has,
 * and therefore an approximation rather than an error — but an approximation
 * the caller hears about.
 */
interface RouteOutput {
  /** Pixels the route always produces. */
  pixels: number;
  /** How the messages say it. */
  label: string;
  /** The only canonical tier this route can answer for. */
  tier: ResolutionTier;
  /** Whether that answer is exact, or the nearest thing the route can do. */
  exact: boolean;
}

const OUTPUT: Readonly<Record<StabilityRoute, RouteOutput>> = {
  ultra: { pixels: 1_048_576, label: "1 megapixel (1024×1024 by default)", tier: "1k", exact: true },
  core: { pixels: 1_500_000, label: "1.5 megapixels", tier: "1k", exact: false },
  sd3: { pixels: 1_048_576, label: "1 megapixel (1024×1024 by default)", tier: "1k", exact: true },
};

/**
 * `resolution` against a route whose output size is fixed.
 *
 * Three outcomes and no fourth: the tier is what the route produces (silent,
 * because the request mapped), the tier is the nearest thing the route
 * produces (a warning naming both sizes), or the tier is out of reach entirely
 * (an error naming every size that is in reach). Nothing is ever sent —
 * there is no field — so this function's whole output is its findings.
 */
function checkResolution(
  tier: ResolutionTier,
  route: StabilityRoute,
  ctx: CompileContext<ImageParams>,
): void {
  const output = OUTPUT[route];
  if (tier === output.tier) {
    if (output.exact) return;
    ctx.warn({
      code: "approximated_param",
      path: ["resolution"],
      message:
        `\`resolution\` ${tier} is approximate on the ${route} route: it has no size field and ` +
        `always returns ${output.label}, which is ${(output.pixels / 1_048_576).toFixed(2)}× ` +
        `the area the ${tier} tier asks for.`,
      meta: { requested: tier, achieved: output.label, pixels: output.pixels, source: API_REFERENCE_URL },
    });
    return;
  }
  ctx.fail({
    code: "invalid_enum_value",
    path: ["resolution"],
    message:
      `\`resolution\` ${JSON.stringify(tier)} has no equivalent on the ${route} route: none of ` +
      `Stability's generate routes takes a size or resolution field — ultra and sd3 always ` +
      `return 1 megapixel, core 1.5. Only ${JSON.stringify(output.tier)} is reachable here; ` +
      "drop `resolution` to accept the route's fixed output.",
    meta: {
      allowed: [output.tier],
      value: tier,
      achieved: output.label,
      pixels: output.pixels,
      source: API_REFERENCE_URL,
    },
  });
}

export const image = {
  category: "image",
  provider: "stability",
  models: MODELS,
  modelParams: STABILITY_IMAGE_MODEL_PARAMS,
  unsupported: {
    n:
      "Stability generates one image per request — ultra, core and sd3 publish no `n`, `samples` " +
      "or `num_images` field and bill flat credits per successful generation; issue N requests " +
      "to get N images.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<StabilityImageWire, StabilityImageResult> {
    const route = routeFor(ctx.model);
    const body: StabilityDraft = { prompt: input.prompt };
    // Only the sd3 route has a `model` field; on the other two the URL carries
    // the model and a `model` form field would be an unknown key.
    if (route === "sd3") body.model = ctx.model;

    ctx.from(["aspect_ratio"], "aspectRatio");
    ctx.from(["negative_prompt"], "negativePrompt");
    ctx.from(["output_format"], "outputFormat");

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing?.kind === "ratio") {
      const ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, STABILITY_ASPECT_RATIOS, { source: API_REFERENCE_URL }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      );
      // The value came out of STABILITY_ASPECT_RATIOS itself; the cast only
      // restores the literal type the derivation widened to `string`.
      if (ratio !== undefined) body.aspect_ratio = ratio as StabilityAspectRatio;
    } else if (sizing?.kind === "dimensions") {
      // `size` and `dimensions` land here together — a `"1920x1080"` `size` is
      // the same decision as the pair, and neither is expressible on a route
      // whose only sizing field is a shape. `sizingField` is what keeps the
      // warning pointed at the word the caller actually wrote.
      const wrote = sizingField(sizing);
      ctx.from(["aspect_ratio"], wrote);
      const { width, height } = sizing.dimensions;
      const ratio = ctx.take(
        pixelsToRatio(width, height, STABILITY_ASPECT_RATIOS, {
          path: [wrote],
          warn: ctx.warn,
        }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio as StabilityAspectRatio;
    }

    if (input.resolution !== undefined) checkResolution(input.resolution, route, ctx);

    // `negative_prompt` is documented on all three routes with the same 10,000
    // character cap — including sd3.5-large-turbo, whose predecessor sd3-turbo
    // rejected it. The route schemas in `./image.ts` say so too, and its
    // validator is what checks the length.
    if (input.negativePrompt !== undefined) body.negative_prompt = input.negativePrompt;
    if (input.seed !== undefined) body.seed = input.seed;
    // `ImageOutputFormat` and `STABILITY_OUTPUT_FORMATS` are the same three
    // values, so this is a rename and not a mapping.
    if (input.outputFormat !== undefined) body.output_format = input.outputFormat;

    if (input.outputDelivery === "url") {
      ctx.fail({
        code: "unsupported_param",
        path: ["outputDelivery"],
        message:
          "`outputDelivery: \"url\"` has no equivalent on the stable-image routes — they answer " +
          "with the image itself (raw bytes, or base64 inside JSON when you send " +
          '`accept: "application/json"`), never with a link. Use "base64" for the inline bytes ' +
          "these routes return.",
        meta: { value: input.outputDelivery, source: API_REFERENCE_URL },
      });
    }

    applyExtras(input, STABILITY_IMAGE_MODEL_PARAMS, body, ctx);

    return { params: body as StabilityImageWire, validate: VALIDATE[route] };
  },
} as const satisfies ImageAdapterFor<
  typeof STABILITY_IMAGE_MODEL_PARAMS,
  StabilityImageWire,
  StabilityImageResult
>;
