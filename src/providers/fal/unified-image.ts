/**
 * `unmodel/image` → fal, across 32 endpoints.
 *
 * A sibling of `./unified-image-edit`, and a separate module for the reason
 * every split provider here is split: `unmodel/image` and `unmodel/image-edit`
 * both reach fal, and one module holding both adapters would put the editing
 * validators and their schema into the generation pack, where nothing can use
 * them. `./unified.ts` re-exports the pair, so the public subpath is unchanged.
 *
 * # One branch per shape class, never one per endpoint
 *
 * This is the rule that makes a 28-endpoint adapter readable, and it is not a
 * style preference — a 28-arm switch on `ctx.model` is also a 28-arm
 * declaration for tsc to walk on every hover, and it would need editing every
 * time the roster grows. So `compile` reads the endpoint's generated
 * `classes` and branches on those. There are four in this category:
 *
 * | class | wire | what a caller writes |
 * |---|---|---|
 * | `imageSizeUnion` | `image_size` | a preset name, an explicit `{width,height}`, or a ratio solved into pixels |
 * | `imageSizePresets` | `image_size` | a preset name only — no pixel arm exists |
 * | `aspectRatioEnum` | `aspect_ratio` | a `W:H` shape |
 * | `resolutionEnum` | `resolution` | a tier, in that endpoint's own spelling |
 *
 * An endpoint carrying none of them is `fixedGeometry` — it decides its own
 * output size — and every size word is then an `unsupported_param` naming the
 * endpoint. An endpoint whose geometry parameters fit none of the classes
 * fails CODEGEN rather than falling through to a default here, which is what
 * makes the four branches exhaustive by construction.
 *
 * The classes are not exclusive, and that matters: nine endpoints carry both
 * `aspectRatioEnum` and `resolutionEnum`, which is the combination that lets a
 * caller state shape and size independently the way the canonical vocabulary
 * assumes. Where an endpoint has only one of the two, the other canonical word
 * is refused with the endpoint's name in the message.
 *
 * # Per-model facts live on the rows, not on the adapter
 *
 * There is no adapter-wide `unsupported` here, deliberately. fal's endpoints
 * are 28 different vendors' models behind one queue: `negative_prompt` exists
 * on kling-image and on no flux route, `num_images` exists on most and not on
 * gpt-image-2, `sync_mode` (which is what `outputDelivery: "base64"` compiles
 * to) exists on about half. A provider-wide "fal does not support N" would be
 * false at the majority of its own endpoints. So every refusal in this file is
 * derived from the endpoint's own generated key list and names that endpoint —
 * risk R7 in the plan, and the reason `FAL_IMAGE_MODEL_PARAMS` carries `keys`
 * at all.
 *
 * # `sync_mode` is delivery, and only where it is a boolean
 *
 * `outputDelivery: "base64"` compiles to `sync_mode: true` — fal's own words:
 * "the media will be returned as a data URI and the output data won't be
 * available in the request history". `"url"` is the default and compiles to
 * nothing. The word is only usable where fal types it BOOLEAN: on
 * `fal-ai/sync-lipsync/v2` the same name is a five-arm string enum meaning
 * something else entirely, which is why no "common fal params" fragment is
 * ever hoisted and why this adapter checks the endpoint's own key list rather
 * than assuming.
 */

import {
  applyExtras,
  pixelsToRatio,
  redundantTier,
  resolveSizing,
  sizingField,
  toPixels,
  toRatioEnum,
  type PixelRules,
  type Sizing,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyImageAdapter, ImageParams } from "../../core/unified/vocabulary/image";
import { image as validator } from "./image";
import { FAL_IMAGE_MODEL_PARAMS, MODELS } from "./image-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalImageRow {
  readonly classes: readonly string[];
  readonly keys: readonly string[];
  readonly sizes?: readonly string[];
  readonly ratios?: readonly string[];
  readonly ratioFreeform?: true;
  readonly tiers?: readonly string[];
  readonly tierWire?: Readonly<Record<string, string>>;
  readonly pixels?: { readonly min?: number; readonly max?: number };
}

const ROWS = FAL_IMAGE_MODEL_PARAMS as Readonly<Record<string, FalImageRow>>;

/**
 * The wire body this adapter compiles to — the slice the canonical vocabulary
 * reaches, and nothing else.
 *
 * **No `[key: string]: unknown` tail**, even though `applyExtras` writes
 * per-model extras onto this object at run time. An open index signature would
 * make `ExactKeys<T, FalImageArm<Id>>` demand `never` for every key, and
 * `fal.image.safe` would stop being assignable to `CompiledCall`'s `validate`
 * — a green-looking type that silently un-narrows the whole surface. (Recraft's
 * adapter documents the same trap for the same reason.) The extras reach the
 * body through `applyExtras`'s own cast, and which of them a given endpoint
 * takes is `FAL_IMAGE_MODEL_PARAMS`'s answer rather than this type's.
 */
export interface FalImageWire {
  /** The route selector, stripped into `.request.url` by `fal.image`. */
  endpoint: string;
  prompt: string;
  image_size?: string | { width: number; height: number };
  aspect_ratio?: string;
  resolution?: string;
  num_images?: number;
  seed?: number;
  negative_prompt?: string;
  output_format?: string;
  sync_mode?: boolean;
}

/** What a unified call to `fal/…` returns: `fal.image`'s own `Validated`. */
export type FalImageResult = ReturnType<typeof validator>;

/**
 * `fal.image.safe`, seen as the one-argument function `CompiledCall` wants.
 *
 * The cast is unavoidable and is the same one kling, minimax, bria and murf
 * make. `fal.image` is generic in the ENDPOINT (`<Id, T extends
 * FalImageArm<Id>>`) so that a literal endpoint id narrows the body to that
 * endpoint's published parameters — which is most of the value of the hand
 * surface. `CompiledCall.validate` is not generic: it is a plain
 * `(params: Wire) => …`, because the kernel calls it with whatever the adapter
 * compiled and has no endpoint literal to hand it. Instantiating the generic
 * at `Id = string` degrades `FalImageArm` to its open arm and demands an index
 * signature `FalImageWire` deliberately does not have (see above), so the two
 * signatures cannot be reconciled by typing alone.
 *
 * What the cast gives up is narrow: nothing is skipped at run time — the body
 * still goes through `fal.image`'s full schema, IR and check battery — it is
 * only the compile-time narrowing that the kernel could never have used
 * anyway, because a unified caller names a MODEL REF and not an endpoint
 * literal.
 */
type FalImageValidate = CompiledCall<FalImageWire, FalImageResult>["validate"];

/**
 * `image_size`'s explicit arm, per endpoint.
 *
 * `grid: 1` throughout and not a placeholder: no fal `ImageSize` component
 * publishes a multiple-of rule, so any integer inside the bounds is a legal
 * side, and snapping to a grid this API does not have would cost accuracy for
 * nothing. The bounds themselves come off the endpoint's own schema.
 */
function pixelRules(row: FalImageRow, endpoint: string): PixelRules {
  const rules: PixelRules = { grid: 1, source: FAL_DOC_URLS[endpoint as keyof typeof FAL_DOC_URLS] };
  if (row.pixels?.min !== undefined) (rules as { min?: number }).min = row.pixels.min;
  if (row.pixels?.max !== undefined) (rules as { max?: number }).max = row.pixels.max;
  return rules;
}

function has(row: FalImageRow | undefined, key: string): boolean {
  return row?.keys.includes(key) === true;
}

function hasClass(row: FalImageRow | undefined, name: string): boolean {
  return row?.classes.includes(name) === true;
}

/**
 * The canonical words that map straight onto a wire name — when the endpoint
 * has that wire name at all.
 *
 * Every one of these is per-endpoint rather than provider-wide, which is the
 * R7 rule this file is built on: `negative_prompt` is on kling-image and on no
 * flux route, and a blanket "fal has no negative prompt" would be wrong 27
 * times out of 28 in the other direction.
 */
function applyShared(
  input: ImageParams,
  body: FalImageWire,
  row: FalImageRow | undefined,
  ctx: CompileContext<ImageParams>,
): void {
  ctx.from(["prompt"], "prompt");
  ctx.from(["seed"], "seed");
  ctx.from(["num_images"], "n");
  ctx.from(["negative_prompt"], "negativePrompt");
  ctx.from(["output_format"], "outputFormat");
  ctx.from(["sync_mode"], "outputDelivery");

  if (input.seed !== undefined) {
    if (has(row, "seed")) body.seed = input.seed;
    else refuse(ctx, "seed", "seed", row, ctx.model);
  }
  if (input.n !== undefined) {
    if (has(row, "num_images")) body.num_images = input.n;
    else refuse(ctx, "n", "num_images", row, ctx.model);
  }
  if (input.negativePrompt !== undefined) {
    if (has(row, "negative_prompt")) body.negative_prompt = input.negativePrompt;
    else refuse(ctx, "negativePrompt", "negative_prompt", row, ctx.model);
  }
  if (input.outputFormat !== undefined) {
    if (has(row, "output_format")) body.output_format = input.outputFormat;
    else refuse(ctx, "outputFormat", "output_format", row, ctx.model);
  }
  if (input.outputDelivery !== undefined) {
    if (!has(row, "sync_mode")) {
      refuse(ctx, "outputDelivery", "sync_mode", row, ctx.model);
    } else if (input.outputDelivery === "base64") {
      // fal: "the media will be returned as a data URI and the output data
      // won't be available in the request history".
      body.sync_mode = true;
    }
    // `"url"` is fal's own default and compiles to nothing — sending
    // `sync_mode: false` would say the same thing louder.
  }
}

/** One `unsupported_param`, phrased against the endpoint rather than the provider. */
function refuse(
  ctx: CompileContext<ImageParams>,
  canonical: string,
  wire: string,
  row: FalImageRow | undefined,
  endpoint: string,
): void {
  const takers = Object.keys(ROWS).filter((id) => ROWS[id]?.keys.includes(wire) === true);
  ctx.fail({
    code: "unsupported_param",
    path: [canonical],
    message:
      `"${endpoint}" declares no \`${wire}\` parameter, so \`${canonical}\` has nothing to become. ` +
      (takers.length === 0
        ? "No fal endpoint in this category takes it."
        : `${takers.length} of the ${Object.keys(ROWS).length} fal image endpoints do take it` +
          `${takers.length <= 4 ? ` — ${takers.map((id) => `"${id}"`).join(", ")}` : ""}.`) +
      " fal is a queue in front of many vendors' models, so a parameter one endpoint has is routinely absent " +
      "from the next; this is a fact about the endpoint, not about fal.",
    meta: {
      wire,
      value: undefined,
      source: FAL_DOC_URLS[endpoint as keyof typeof FAL_DOC_URLS],
      ...(row === undefined ? {} : { declared: [...row.keys] }),
    },
  });
}

/**
 * The size decision — the whole of it, in one place, branching on class.
 *
 * Read top to bottom it is: work out what the caller said (`resolveSizing`),
 * then hand it to whichever of the endpoint's geometry vocabularies can carry
 * it, then refuse — by name — anything left over.
 */
function applySize(
  input: ImageParams,
  body: FalImageWire,
  row: FalImageRow | undefined,
  ctx: CompileContext<ImageParams>,
): void {
  const sizing = ctx.take(
    resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }, { sizes: row?.sizes }),
  );
  const tier = input.resolution;

  // The tier first, where the endpoint has a tier field: it is an independent
  // decision from the shape on the nine endpoints that carry both, and the two
  // must not fight over one branch.
  if (hasClass(row, "resolutionEnum")) {
    applyTier(input, body, row, ctx);
  } else if (tier !== undefined && !hasClass(row, "imageSizeUnion")) {
    ctx.fail({
      code: "unsupported_param",
      path: ["resolution"],
      message:
        `"${ctx.model}" declares no \`resolution\` field and no pixel arm, so a resolution tier has nothing ` +
        "to become — this endpoint renders at the size it chooses. Use `aspectRatio` to pick the shape.",
      meta: { value: tier, source: FAL_DOC_URLS[ctx.model as keyof typeof FAL_DOC_URLS] },
    });
  }

  if (hasClass(row, "imageSizeUnion")) return applyImageSizeUnion(input, sizing, body, row, ctx);
  if (hasClass(row, "imageSizePresets")) return applyImageSizePresets(sizing, body, row, ctx);
  if (hasClass(row, "aspectRatioEnum")) return applyAspectRatio(sizing, body, row, ctx);
  if (sizing !== undefined && sizing.kind !== "unset") {
    ctx.fail({
      code: "unsupported_param",
      path: [sizingField(sizing) === "size" ? "size" : sizing.kind === "ratio" ? "aspectRatio" : "dimensions"],
      message:
        `"${ctx.model}" has no size field of any kind — it renders at a geometry it decides, and its ` +
        "schema declares neither `image_size`, `aspect_ratio` nor a width/height pair.",
      meta: { source: FAL_DOC_URLS[ctx.model as keyof typeof FAL_DOC_URLS] },
    });
  }
}

/** `resolution`, in the endpoint's own spelling (fal writes `"1K"`, we write `"1k"`). */
function applyTier(
  input: ImageParams,
  body: FalImageWire,
  row: FalImageRow | undefined,
  ctx: CompileContext<ImageParams>,
): void {
  ctx.from(["resolution"], "resolution");
  if (input.resolution === undefined) return;
  const wire = row?.tierWire?.[input.resolution];
  if (wire === undefined) {
    const offered = row?.tiers ?? [];
    ctx.fail({
      code: "invalid_enum_value",
      path: ["resolution"],
      message:
        `\`resolution\` must be ${offered.map((value) => `"${value}"`).join(" or ") || "unset"} on ` +
        `"${ctx.model}"; got "${input.resolution}".`,
      meta: { allowed: [...offered], value: input.resolution, source: FAL_DOC_URLS[ctx.model as keyof typeof FAL_DOC_URLS] },
    });
    return;
  }
  body.resolution = wire;
}

/**
 * `image_size` — the union arm, which is the commonest shape in the category.
 *
 * Three ways in, and each lands somewhere honest: explicit pixels go straight
 * through (this endpoint's size vocabulary IS pixels), a preset name goes
 * through verbatim, and a bare ratio is solved into pixels at the requested
 * tier because `image_size` has no ratio spelling to carry it.
 */
function applyImageSizeUnion(
  input: ImageParams,
  sizing: Sizing | undefined,
  body: FalImageWire,
  row: FalImageRow | undefined,
  ctx: CompileContext<ImageParams>,
): void {
  if (sizing === undefined || sizing.kind === "unset") {
    // A tier with no shape is a SQUARE at that tier — the canonical shape, and
    // the one that solves any tier exactly. Returning here instead would drop
    // `resolution` silently, which is the single failure this whole surface
    // exists to prevent: the caller asked for 4K and got fal's 512px default
    // with nothing on the record to say so. (BFL's FLUX.2 branch answers the
    // same question the same way, for the same reason.)
    if (input.resolution === undefined) return;
    ctx.from(["image_size", "width"], "resolution");
    ctx.from(["image_size", "height"], "resolution");
    const square = ctx.take(
      toPixels("1:1", input.resolution, pixelRules(row ?? { classes: [], keys: [] }, ctx.model), {
        path: ["resolution"],
        warn: ctx.warn,
      }),
    );
    if (square !== undefined) body.image_size = { width: square.width, height: square.height };
    return;
  }
  if (sizing.kind === "size") {
    // A preset this endpoint publishes, verbatim. `resolveSizing` has already
    // checked it against `row.sizes`.
    ctx.from(["image_size"], "size");
    body.image_size = sizing.size;
    if (input.resolution !== undefined && !hasClass(row, "resolutionEnum")) {
      ctx.take(redundantTier(input.resolution, { path: ["resolution"], warn: ctx.warn }, "size"));
    }
    return;
  }
  if (sizing.kind === "dimensions") {
    const wrote = sizingField(sizing);
    ctx.from(["image_size", "width"], wrote === "size" ? "size" : "dimensions.width");
    ctx.from(["image_size", "height"], wrote === "size" ? "size" : "dimensions.height");
    if (input.resolution !== undefined && !hasClass(row, "resolutionEnum")) {
      ctx.take(
        redundantTier(
          input.resolution,
          { path: ["resolution"], warn: ctx.warn },
          wrote === "size" ? "size" : "dimensions",
        ),
      );
    }
    body.image_size = { width: sizing.dimensions.width, height: sizing.dimensions.height };
    return;
  }
  // A ratio, with no ratio field to put it in: solve it into pixels at the
  // tier asked for (1k being the vocabulary's default rather than this
  // adapter's opinion).
  ctx.from(["image_size", "width"], "aspectRatio");
  ctx.from(["image_size", "height"], "aspectRatio");
  const pixels = ctx.take(
    toPixels(sizing.aspectRatio, input.resolution ?? "1k", pixelRules(row ?? { classes: [], keys: [] }, ctx.model), {
      path: ["aspectRatio"],
      warn: ctx.warn,
    }),
  );
  if (pixels !== undefined) body.image_size = { width: pixels.width, height: pixels.height };
}

/**
 * `image_size` as a bare preset enum — no explicit-dimensions arm exists, so
 * pixels and ratios have nowhere to go and are refused rather than rounded to
 * the nearest name.
 */
function applyImageSizePresets(
  sizing: Sizing | undefined,
  body: FalImageWire,
  row: FalImageRow | undefined,
  ctx: CompileContext<ImageParams>,
): void {
  if (sizing === undefined || sizing.kind === "unset") return;
  ctx.from(["image_size"], "size");
  if (sizing.kind === "size") {
    body.image_size = sizing.size;
    return;
  }
  const wrote = sizing.kind === "ratio" ? "aspectRatio" : sizingField(sizing);
  // A preset that is SPELLED as pixels. Several fal endpoints publish an
  // `image_size` enum whose members are `WxH` strings (`gpt-image-1.5` lists
  // "1024x1024", "1536x1024", "1024x1536"), and `resolveSizing` parses any
  // `WxH` into `{ kind: "dimensions" }` before a preset list is ever consulted
  // — so the endpoint's own vocabulary arrives here looking like free-form
  // pixels. Matching it back against the list is what makes `size: "1024x1024"`
  // work on an enum route: it is a preset, and it goes on the wire verbatim.
  if (sizing.kind === "dimensions") {
    const spelled = `${sizing.dimensions.width}x${sizing.dimensions.height}`;
    if (row?.sizes?.includes(spelled) === true) {
      body.image_size = spelled;
      return;
    }
  }
  ctx.fail({
    code: "unsupported_param",
    path: [wrote === "size" ? "size" : wrote],
    message:
      `"${ctx.model}" sizes by name only — its \`image_size\` is a closed list ` +
      `(${(row?.sizes ?? []).map((value) => `"${value}"`).join(", ")}) with no width/height arm, so ` +
      `\`${wrote}\` has nothing to become. Name one of those sizes with \`size\` instead; picking the ` +
      "nearest one here would deliver a shape that was never asked for and say nothing about it.",
    meta: { allowed: [...(row?.sizes ?? [])], source: FAL_DOC_URLS[ctx.model as keyof typeof FAL_DOC_URLS] },
  });
}

/**
 * `aspect_ratio` — a shape and only a shape.
 *
 * Pixels are the one honest approximation in this file: they describe a ratio,
 * the ratio is expressible, the pixel count is not, so {@link pixelsToRatio}
 * sends the shape and warns that the size was dropped. That warning fires even
 * for a pair that matches a listed ratio exactly, because a ratio cannot carry
 * a pixel count however well it matched.
 */
function applyAspectRatio(
  sizing: Sizing | undefined,
  body: FalImageWire,
  row: FalImageRow | undefined,
  ctx: CompileContext<ImageParams>,
): void {
  if (sizing === undefined || sizing.kind === "unset") return;
  if (sizing.kind === "size") {
    ctx.fail({
      code: "unsupported_param",
      path: ["size"],
      message:
        `"${ctx.model}" sizes by \`aspect_ratio\` and declares no \`image_size\` field, so a size literal ` +
        "has nothing to become. Use `aspectRatio` to choose the shape.",
      meta: { value: sizing.size, source: FAL_DOC_URLS[ctx.model as keyof typeof FAL_DOC_URLS] },
    });
    return;
  }
  const from = sizing.kind === "dimensions" ? sizingField(sizing) : "aspectRatio";
  const path = [from];
  ctx.from(["aspect_ratio"], from);

  let spelling: string | undefined;
  if (sizing.kind === "ratio") {
    spelling = sizing.aspectRatio;
  } else {
    spelling = ctx.take(
      pixelsToRatio(sizing.dimensions.width, sizing.dimensions.height, row?.ratios, {
        path,
        warn: ctx.warn,
      }),
    );
  }
  if (spelling === undefined) return;

  const allowed = row?.ratios;
  if (allowed === undefined || allowed.length === 0) {
    body.aspect_ratio = spelling;
    return;
  }
  if (row?.ratioFreeform === true) {
    // fal declared the enum OPEN (`anyOf[{enum}, {string}]`), so the list is a
    // set of presets rather than a limit and an unlisted `W:H` is legal.
    body.aspect_ratio = spelling;
    return;
  }
  const ratio = ctx.take(toRatioEnum(spelling, allowed, { source: FAL_DOC_URLS[ctx.model as keyof typeof FAL_DOC_URLS] }, { path, warn: ctx.warn }));
  if (ratio !== undefined) body.aspect_ratio = ratio;
}

/**
 * The fal image adapter.
 *
 * `models` is the curated roster, so a ref outside it draws `unknown_model`
 * from the kernel and then compiles with no row — every per-endpoint refusal
 * above stands down, and the request goes to the provider's own validator,
 * which is the right place for an endpoint unmodel has not catalogued yet.
 */
export const image = {
  category: "image",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_IMAGE_MODEL_PARAMS,
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<FalImageWire, FalImageResult> {
    // The route is a parameter at fal — the endpoint id IS the URL path — and
    // `fal.image` strips it back off into `.request.url`. See ./image.ts.
    const body: FalImageWire = { endpoint: ctx.model, prompt: input.prompt };
    const row = ROWS[ctx.model];
    applyShared(input, body, row, ctx);
    applySize(input, body, row, ctx);
    applyExtras(input, FAL_IMAGE_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalImageValidate };
  },
} as const satisfies AnyImageAdapter;
