/**
 * Ideogram's unified `image` adapters — Ideogram 3.0
 * (`POST /v1/ideogram-v3/generate`) and Ideogram 4.0
 * (`POST /v1/ideogram-v4/generate`).
 *
 * A sibling of `./unified-image-edit` (3.0 remix), split per category so
 * `unmodel/image` and `unmodel/image-edit` each pay for one of Ideogram's route
 * families rather than both. `./unified.ts` re-exports the pair, so the public
 * subpath is unchanged.
 *
 * # The thing that makes Ideogram different: there is no `model` param
 *
 * Neither generate route has a `model` field. What you actually choose is a
 * **rendering speed** — `FLASH` / `TURBO` / `DEFAULT` / `QUALITY` on 3.0,
 * `TURBO` / `DEFAULT` / `QUALITY` on 4.0 (FLASH returns a 400 there, "coming
 * soon") — and each speed is billed at its own per-image rate. `models.ts`
 * therefore carries one *pseudo-model* row per speed, because the pipeline's
 * catalog lookup keys on a model id and a row per speed is what makes
 * `costUSD` exact:
 *
 * | ref | route | `rendering_speed` | USD / image |
 * |---|---|---|---|
 * | `ideogram/ideogram-3.0-flash` | v3 | `FLASH` | 0.03 |
 * | `ideogram/ideogram-3.0-turbo` | v3 | `TURBO` | 0.03 |
 * | `ideogram/ideogram-3.0-default` | v3 | `DEFAULT` | 0.06 |
 * | `ideogram/ideogram-3.0-quality` | v3 | `QUALITY` | 0.09 |
 * | `ideogram/ideogram-4.0-turbo` | v4 | `TURBO` | 0.03 |
 * | `ideogram/ideogram-4.0-default` | v4 | `DEFAULT` | 0.06 |
 * | `ideogram/ideogram-4.0-quality` | v4 | `QUALITY` | 0.10 |
 *
 * So the canonical `model` ref does **two** jobs here that it does nowhere
 * else: it picks the route (and therefore the validator, the wire vocabulary
 * and the param surface), and it picks a wire param — which is why
 * `ctx.from(["rendering_speed"], "model")` is declared. A caller who is told
 * `rendering_speed` is wrong would otherwise go looking for a field the
 * unified vocabulary does not have.
 *
 * The map is inverted from `RENDERING_SPEED_TO_MODEL_ID` and
 * `RENDERING_SPEED_TO_V4_MODEL_ID` at load rather than re-typed, so the
 * adapter and the validator's pricing lookup cannot disagree about which
 * pseudo-model means which speed.
 *
 * # Two exports, and which one to register
 *
 * `createImage` throws if two adapters claim the same provider id, so **only
 * one of these may be in any one pack**:
 *
 * - {@link image} is the one to register. It serves all seven refs and
 *   dispatches on `ctx.model` — a `3.0` ref compiles a `GenerateParams` body
 *   and returns `ideogram.image.safe`, a `4.0` ref compiles a
 *   `GenerateV4Params` body and returns `ideogram.imageV4.safe`. The kernel
 *   lets `compile` choose its own validator, which is exactly what makes one
 *   provider id able to cover two genuinely different endpoints.
 * - {@link imageV4} serves only the three 4.0 refs, for a caller who wants a
 *   pack that cannot reach 3.0 at all. Registering it *instead of*
 *   {@link image} narrows the ref union and the result type to the 4.0 route;
 *   registering it *alongside* is a `TypeError` from `createImage`.
 *
 * # 3.0's size vocabulary: S1, plus one straight-through
 *
 * `aspect_ratio` is a closed 15-value enum spelled with an `x`
 * (`"16x9"`, never `"16:9"`), and `resolution` is a closed 69-value list of
 * `WxH` strings. The two **cannot be sent together** — there is a check for
 * it — so each canonical spelling of size picks exactly one of them:
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `aspectRatio` | `aspect_ratio` | **S1** — {@link toRatioEnum} matches on the *reduced* ratio and returns Ideogram's own spelling, so `"16:9"` compiles to `"16x9"` with no warning; a spelling change is not a loss |
 * | `dimensions` | `resolution` | straight through — the 69-value list is checked by `checkEnums`, i.e. by the same code a hand-written call meets, and the error is remapped onto `dimensions` |
 * | `resolution` (tier) | *nothing* | see below |
 *
 * Every one of those 69 resolutions is about **one megapixel** (1024×1024 is
 * the largest by area; 1536×512 the smallest), and `aspect_ratio` on its own
 * lands in the same budget. So `resolution: "1k"` is free — it is what the
 * route does — and `"2k"` / `"4k"` are an error naming the 4.0 refs, which
 * genuinely do offer 2k. Nothing is sent for the tier, because there is
 * nothing to send: pinning `resolution: "1024x1024"` to satisfy a bare `1k`
 * would invent a *square* the caller never asked for.
 *
 * That tier check runs on **every** path, including the `dimensions` one where
 * nothing would consume it. The vocabulary lets a request carry both, and a
 * tier that quietly evaporates because the caller also named pixels is a
 * silent drop — the one thing this surface promises never to do. 4.0 does the
 * same on its own `dimensions` path, measuring the pixels with the very
 * function that buckets `RESOLUTIONS_V4` into tiers so the rule the caller is
 * held to is the rule the table is built from.
 *
 * # 4.0's size vocabulary: S3, and a table computed from the enum
 *
 * 4.0 is not 3.0 with a version bump. `prompt` is gone (you send `text_prompt`
 * or a structured `json_prompt`), there is no `aspect_ratio` at all, and
 * sizing is a *different* 38-value `resolution` enum spanning two pixel
 * budgets — 15 sizes at roughly 1024² and 23 at roughly 2048².
 *
 * That is textbook **S3**, and the table is derived from `RESOLUTIONS_V4` at
 * load rather than transcribed: each value's reduced ratio is its key and its
 * area picks the nearest tier in log space. Transcribing 38 rows by hand is 38
 * chances to mistype a row key, and unlike DALL·E's `1792x1024` these labels
 * are not marketing — they are the exact arithmetic of the pixel pairs, so
 * computing them is both safer and more truthful. What you get:
 *
 * - **1k** — `1:1 2:1 1:2 3:2 2:3 4:3 3:4 5:4 4:5 8:5 5:8 16:9 9:16 3:1 1:3`
 * - **2k** — the same fifteen, plus the ultra-wide pairs `22:9 9:22 23:9 9:23
 *   8:3 3:8 12:5 5:12`
 *
 * Every entry is geometrically exact, so `16:9` at `1k` is `1280x720` and at
 * `2k` is `2560x1440` — **zero warnings** either way. `4k` has no row and is
 * an `invalid_enum_value` naming the two tiers that do, never a quiet
 * downgrade.
 *
 * # What 4.0 gives up, and why that is `ctx.fail` and not `unsupported`
 *
 * The 4.0 route has no `seed`, no `negative_prompt` and no `num_images`. The
 * 3.0 route has all three. Those are therefore **model-dependent** gaps, not
 * provider-wide ones, so they cannot live in `unsupported` (which the kernel
 * checks before `compile` and cannot see the ref's route) — they are
 * `ctx.fail` inside `compile`, and each message names the 3.0 refs that do
 * have the field. On {@link imageV4}, where every ref is a 4.0 ref, the same
 * five gaps *are* provider-wide and are declared instead.
 *
 * # Output format and delivery: genuinely absent on both routes
 *
 * Both routes are `multipart/form-data`, and neither form carries an
 * output-encoding field or a delivery field. Those are the two provider-wide
 * gaps, declared on both adapters. Note what is *not* claimed: how the images
 * come back is the API's business, and a request cannot express an opinion
 * about it either way.
 */
import {
  applyExtras,
  formatRatio,
  parseRatio,
  ratioDistance,
  redundantTier,
  resolveSizing,
  sizeRules,
  sizingField,
  toRatioEnum,
  toSizeEnum,
  TIER_PIXELS,
  type SizeTable,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  AnyImageAdapter,
  ImageParams,
  ResolutionTier,
} from "../../core/unified/vocabulary/image";
import {
  image as generateV3,
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
import {
  imageV4 as generateV4,
  RESOLUTIONS_V4,
  type IdeogramResolutionV4,
  type IdeogramV4RenderingSpeed,
  type V4JsonPrompt,
} from "./image-v4";
import {
  RENDERING_SPEED_TO_MODEL_ID,
  RENDERING_SPEED_TO_V4_MODEL_ID,
  type IdeogramModelId,
} from "./models";
import { IDEOGRAM_IMAGE_MODEL_PARAMS, MODELS } from "./image-params";

const GENERATE_V3_DOCS = "https://developer.ideogram.ai/api-reference/api-reference/generate-v3";
const OPENAPI_DOCS = "https://developer.ideogram.ai/openapi.json";

/** The 4.0 slice of {@link MODELS} — {@link imageV4}'s whole ref union. */
const V4_MODELS = [
  "ideogram-4.0-turbo",
  "ideogram-4.0-default",
  "ideogram-4.0-quality",
] as const satisfies readonly IdeogramModelId[];

// ---------------------------------------------------------------------------
// Wire bodies and results
// ---------------------------------------------------------------------------

/**
 * The 3.0 wire body this adapter compiles to — the slice of `GenerateParams`
 * the canonical vocabulary can reach.
 *
 * No `[key: string]: unknown` tail, unlike some other providers' wire types:
 * `GenerateParams` has no index signature, so an open tail here would make
 * `ExactKeys` demand `never` for every extra key and the endpoint's own `.safe`
 * would stop being assignable. Everything else on the form — `style_preset`,
 * `color_palette`, the reference-image arrays — reaches the body through
 * `providerOptions.ideogram`, which the kernel merges *before* validation and
 * which the endpoint checks exactly as if the adapter had emitted it.
 */
export interface IdeogramImageWire {
  prompt: string;
  aspect_ratio?: IdeogramAspectRatio;
  resolution?: IdeogramResolution;
  rendering_speed?: IdeogramRenderingSpeed;
  seed?: number;
  negative_prompt?: string;
  num_images?: number;
  // The 3.0 extras, named rather than reached through an index signature —
  // see the note above for why an open tail would break `ExactKeys`.
  magic_prompt?: IdeogramMagicPromptOption;
  style_type?: IdeogramStyleType;
  style_preset?: IdeogramStylePreset;
  style_codes?: string[];
  color_palette?: IdeogramColorPalette;
  custom_model_uri?: string;
  style_reference_images?: Blob[];
  character_reference_images?: Blob[];
  character_reference_images_mask?: Blob[];
  enable_copyright_detection?: boolean | null;
}

/** The 4.0 wire body — a deliberately smaller and mostly disjoint surface. */
export interface IdeogramImageV4Wire {
  text_prompt: string;
  resolution?: IdeogramResolutionV4;
  rendering_speed?: IdeogramV4RenderingSpeed;
  json_prompt?: V4JsonPrompt;
  enable_copyright_detection?: boolean | null;
}

/** What a 3.0 ref returns: `ideogram.image`'s own `Validated`. */
export type IdeogramImageResult = ReturnType<typeof generateV3>;

/** What a 4.0 ref returns: `ideogram.imageV4`'s own `Validated`. */
export type IdeogramImageV4Result = ReturnType<typeof generateV4>;

/** Either route's wire body — {@link image}'s `Wire`, since it serves both. */
export type IdeogramGenerateWire = IdeogramImageWire | IdeogramImageV4Wire;

/** Either route's result — {@link image}'s `Out`, narrowed by a literal ref. */
export type IdeogramGenerateResult = IdeogramImageResult | IdeogramImageV4Result;

// ---------------------------------------------------------------------------
// The ref → (route, rendering_speed) map
// ---------------------------------------------------------------------------

/** Which endpoint a ref names, and the speed the pseudo-model id encodes. */
type IdeogramRoute =
  | { version: "v3"; speed?: IdeogramRenderingSpeed }
  | { version: "v4"; speed?: IdeogramV4RenderingSpeed };

/**
 * The inverse of the two `RENDERING_SPEED_TO_*_MODEL_ID` maps.
 *
 * Built by inversion rather than re-typed so the adapter's answer to "which
 * speed is `ideogram-3.0-quality`" is by construction the same as the one the
 * validator prices with.
 */
function invert(
  speeds: Readonly<Record<string, IdeogramModelId>>,
  version: "v3" | "v4",
): Record<string, IdeogramRoute> {
  const routes: Record<string, IdeogramRoute> = {};
  for (const [speed, id] of Object.entries(speeds)) {
    routes[id] =
      version === "v3"
        ? { version, speed: speed as IdeogramRenderingSpeed }
        : { version, speed: speed as IdeogramV4RenderingSpeed };
  }
  return routes;
}

const ROUTES: Readonly<Record<string, IdeogramRoute>> = Object.freeze({
  ...invert(RENDERING_SPEED_TO_MODEL_ID, "v3"),
  ...invert(RENDERING_SPEED_TO_V4_MODEL_ID, "v4"),
});

/**
 * The route a ref selects.
 *
 * An id the catalog does not carry has already earned an `unknown_model`
 * warning from the kernel, and a model released after this snapshot must still
 * be callable — so the version prefix picks the route and **no**
 * `rendering_speed` is sent. Guessing a tier would put a billable choice on
 * the wire that the caller did not make and the catalog cannot price.
 */
function routeFor(model: string): IdeogramRoute {
  return ROUTES[model] ?? { version: model.startsWith("ideogram-4") ? "v4" : "v3" };
}

// ---------------------------------------------------------------------------
// 4.0's size table, computed from `RESOLUTIONS_V4`
// ---------------------------------------------------------------------------

/** The tier whose target area is nearest in log space — symmetric, unlike a ratio of areas. */
function nearestTier(pixels: number): ResolutionTier {
  let best: ResolutionTier = "1k";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [tier, target] of Object.entries(TIER_PIXELS) as Array<[ResolutionTier, number]>) {
    const distance = ratioDistance(pixels, target);
    if (distance < bestDistance) {
      best = tier;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * `["2560x1440", …]` → `{ "2k": { "16:9": "2560x1440" }, … }`.
 *
 * Every key is the value's own reduced ratio and every tier is the nearest to
 * its own area, so the table cannot claim a shape the pixels do not have —
 * which is the failure mode {@link toSizeEnum}'s drift warning exists to catch
 * and this table, by construction, never triggers.
 */
function sizeTableFrom(sizes: readonly string[]): SizeTable {
  const table: { -readonly [T in ResolutionTier]?: Record<string, string> } = {};
  for (const size of sizes) {
    const ratio = parseRatio(size);
    const separator = size.indexOf("x");
    if (ratio === undefined || separator < 0) continue;
    const width = Number(size.slice(0, separator));
    const height = Number(size.slice(separator + 1));
    const row = (table[nearestTier(width * height)] ??= {});
    row[formatRatio(ratio)] ??= size;
  }
  return table;
}

const V4_SIZES: SizeTable = sizeTableFrom(RESOLUTIONS_V4);

// ---------------------------------------------------------------------------
// 3.0 — POST /v1/ideogram-v3/generate
// ---------------------------------------------------------------------------

/**
 * The only tier Ideogram 3.0 renders at.
 *
 * All 69 values of `RESOLUTIONS` sit between 0.79 MP (1536×512) and 1.05 MP
 * (1024×1024), and a bare `aspect_ratio` lands in the same budget.
 */
const V3_TIER: ResolutionTier = "1k";

function compileV3(
  input: ImageParams,
  ctx: CompileContext<ImageParams>,
  speed: IdeogramRenderingSpeed | undefined,
): CompiledCall<IdeogramImageWire, IdeogramImageResult> {
  const body: IdeogramImageWire = { prompt: input.prompt };
  if (speed !== undefined) {
    ctx.from(["rendering_speed"], "model");
    body.rendering_speed = speed;
  }

  const sizing = ctx.take(
    resolveSizing(
      input,
      { path: ["aspectRatio"], warn: ctx.warn },
      sizeRules(IDEOGRAM_IMAGE_MODEL_PARAMS, ctx.model),
    ),
  );

  // The tier check runs whatever the shape was spelled as — including
  // alongside `dimensions`, where nothing would consume it and dropping it
  // would be exactly the silent substitution this surface exists to refuse.
  // 3.0 renders one budget and one only, so there is a single right answer.
  //
  // `speed === undefined` means the ref is not one this snapshot carries (a
  // known id always resolves to one), and the kernel has already warned
  // `unknown_model` "model-dependent checks were skipped" — this is one of
  // them, and holding an unrecognised model to 3.0's table would turn a
  // lagging catalog into a broken request.
  if (
    speed !== undefined &&
    input.resolution !== undefined &&
    // The `dimensions` path has already refused the tier as redundant; two
    // findings for one mistake is one finding too many.
    sizing?.kind !== "dimensions" &&
    input.resolution !== V3_TIER
  ) {
    ctx.fail({
      code: "invalid_enum_value",
      path: ["resolution"],
      message:
        `\`resolution\` must be "1k" on Ideogram 3.0: every one of the ${RESOLUTIONS.length} ` +
        `sizes it offers is about a megapixel (1024×1024 is the largest), and \`aspect_ratio\` ` +
        `renders in the same budget. The "ideogram-4.0-…" refs offer 2k.`,
      meta: { allowed: [V3_TIER], value: input.resolution, source: GENERATE_V3_DOCS },
    });
  }

  if (sizing?.kind === "dimensions") {
    // Straight through. The 69-value list is `checkEnums`' business — the same
    // check a hand-written call meets — and its message already names the
    // allowed values, so re-implementing it here would only give a caller two
    // chances to read two versions of the same list.
    //
    // A tier beside the pixels is refused rather than dropped: `resolution` on
    // this wire IS the pixel pair, so the canonical tier has nothing left to say.
    if (input.resolution !== undefined) {
      ctx.take(
        redundantTier(
          input.resolution,
          { path: ["resolution"], warn: ctx.warn },
          sizingField(sizing) === "size" ? "size" : "dimensions",
        ),
      );
    }
    ctx.from(["resolution"], sizingField(sizing));
    body.resolution = (sizing.size ??
      `${sizing.dimensions.width}x${sizing.dimensions.height}`) as IdeogramResolution;
  } else if (sizing?.kind === "ratio") {
    ctx.from(["aspect_ratio"], "aspectRatio");
    // S1. Ideogram spells its ratios with an `x`; `toRatioEnum` matches on the
    // reduced ratio and hands back the provider's own spelling, so "16:9",
    // "16x9" and "32:18" all compile to "16x9" and none of them warns.
    const ratio = ctx.take(
      toRatioEnum(sizing.aspectRatio, ASPECT_RATIOS, { source: GENERATE_V3_DOCS }, {
        path: ["aspectRatio"],
        warn: ctx.warn,
      }),
    );
    if (ratio !== undefined) body.aspect_ratio = ratio as IdeogramAspectRatio;
  }
  // A tier with no shape sends nothing at all. The route's own default —
  // `aspect_ratio` "1x1", i.e. 1024×1024 — is already exactly 1k, so the check
  // above has already made the request exact; pinning `resolution:
  // "1024x1024"` to "honour" the tier would commit the caller to a square they
  // never asked for.

  if (input.n !== undefined) {
    ctx.from(["num_images"], "n");
    body.num_images = input.n;
  }
  // `seed` is `seed`: identical name, so no provenance to declare.
  if (input.seed !== undefined) body.seed = input.seed;
  if (input.negativePrompt !== undefined) {
    ctx.from(["negative_prompt"], "negativePrompt");
    body.negative_prompt = input.negativePrompt;
  }

  return { params: body, validate: generateV3.safe };
}

// ---------------------------------------------------------------------------
// 4.0 — POST /v1/ideogram-v4/generate
// ---------------------------------------------------------------------------

/**
 * The 4.0 gaps, as messages. Shared verbatim between the two adapters so a
 * caller who switches from the dispatching {@link image} to the 4.0-only
 * {@link imageV4} does not get a different explanation of the same fact.
 */
const V4_GAPS = {
  n:
    "the Ideogram 4.0 generate route has no `num_images` field — it generates one image per " +
    "request; issue N requests to get N images, or use an \"ideogram-3.0-…\" ref, whose route " +
    "takes `num_images`.",
  seed:
    "the Ideogram 4.0 generate route has no `seed` field, so a seed could only be dropped. " +
    "The \"ideogram-3.0-…\" refs take one.",
  negativePrompt:
    "the Ideogram 4.0 generate route has no `negative_prompt` field. Describe what to avoid " +
    "inside `prompt`, or use an \"ideogram-3.0-…\" ref, whose route takes one.",
} as const;

/** Both routes are multipart forms with neither an encoding nor a delivery field. */
const OUTPUT_GAPS = {
  outputFormat:
    "neither Ideogram generate route has an output-encoding field — the multipart form carries " +
    "no `output_format`, so an encoding could only be dropped.",
  outputDelivery:
    "neither Ideogram generate route has a delivery field — the multipart form carries no " +
    "`response_format`, so how the images come back is the API's choice and not something a " +
    "request can express.",
} as const;

function compileV4(
  input: ImageParams,
  ctx: CompileContext<ImageParams>,
  speed: IdeogramV4RenderingSpeed | undefined,
): CompiledCall<IdeogramImageV4Wire, IdeogramImageV4Result> {
  // `prompt` does not exist on this route. `text_prompt` is the natural-language
  // arm (magic-prompt on); `json_prompt` is the structured one, which has no
  // canonical spelling and belongs in `providerOptions.ideogram`.
  ctx.from(["text_prompt"], "prompt");
  const body: IdeogramImageV4Wire = { text_prompt: input.prompt };
  if (speed !== undefined) {
    ctx.from(["rendering_speed"], "model");
    body.rendering_speed = speed;
  }

  const sizing = ctx.take(
    resolveSizing(
      input,
      { path: ["aspectRatio"], warn: ctx.warn },
      sizeRules(IDEOGRAM_IMAGE_MODEL_PARAMS, ctx.model),
    ),
  );
  const tier = input.resolution ?? "1k";

  if (sizing?.kind === "dimensions") {
    // Straight through, as on 3.0: `checkV4Enums` owns the 38-value list and
    // says so in a message that also warns you off the 3.0 values.
    // Same rule as 3.0 and as every other pixel-taking route in this library:
    // the tier has nothing to add beside explicit pixels, and is refused rather
    // than dropped.
    if (input.resolution !== undefined) {
      ctx.take(
        redundantTier(
          input.resolution,
          { path: ["resolution"], warn: ctx.warn },
          sizingField(sizing) === "size" ? "size" : "dimensions",
        ),
      );
    }
    ctx.from(["resolution"], sizingField(sizing));
    const { width, height } = sizing.dimensions;
    body.resolution = (sizing.size ?? `${width}x${height}`) as IdeogramResolutionV4;
  } else if (sizing?.kind === "ratio") {
    // S3. Both tiers are exact for every shape they offer, so this warns only
    // if `RESOLUTIONS_V4` ever gains a value whose pixels contradict its ratio.
    ctx.from(["resolution"], "aspectRatio");
    const size = ctx.take(
      toSizeEnum(sizing.aspectRatio, tier, V4_SIZES, { path: ["aspectRatio"], warn: ctx.warn }),
    );
    if (size !== undefined) body.resolution = size as IdeogramResolutionV4;
  } else if (input.resolution !== undefined) {
    // A tier with no shape. Unlike 3.0 this route documents no default
    // resolution, so there is nothing to fall back to and the square is the
    // only shape a bare tier can honestly mean: 1024×1024 at 1k, 2048×2048 at
    // 2k, both exactly the tier's target area.
    ctx.from(["resolution"], "resolution");
    const size = ctx.take(
      toSizeEnum("1:1", tier, V4_SIZES, { path: ["resolution"], warn: ctx.warn }),
    );
    if (size !== undefined) body.resolution = size as IdeogramResolutionV4;
  }

  return { params: body, validate: generateV4.safe };
}

// ---------------------------------------------------------------------------
// The adapters
// ---------------------------------------------------------------------------

/**
 * The adapter: all seven refs, dispatching on `ctx.model`.
 *
 * `compile` picks the route, builds that route's body and returns *that
 * route's* `.safe`. Nothing is re-validated and nothing is wrapped — a 3.0 ref
 * ends in the identical `ideogram.image` call a hand-written request would,
 * and a 4.0 ref in `ideogram.imageV4`.
 *
 * The return type is the **union** of the two `CompiledCall`s rather than one
 * of them widened with a cast, which matters twice: a cast would claim every
 * ref returns the 3.0 `Validated` (wrong for the three 4.0 refs), and
 * `UnifiedOut` distributes over the union, so a caller who writes a 4.0 ref
 * gets 4.0's body type back. `satisfies AnyUnifiedAdapter` is what accepts it:
 * the category surface is generic over `any` wire and `any` result precisely so
 * a provider with two routes can stay honest about having two.
 */
export const image = {
  category: "image",
  provider: "ideogram",
  models: MODELS,
  modelParams: IDEOGRAM_IMAGE_MODEL_PARAMS,
  unsupported: OUTPUT_GAPS,
  compile(input: ImageParams, ctx: CompileContext<ImageParams>) {
    const route = routeFor(ctx.model);
    // The 3.0 route has `num_images`, `seed` and `negative_prompt`; nothing to
    // report, so it compiles straight through.
    if (route.version === "v3") {
      const call = compileV3(input, ctx, route.speed);
      applyExtras(input, IDEOGRAM_IMAGE_MODEL_PARAMS, call.params, ctx);
      return call;
    }

    // Model-dependent gaps: these three fields exist on the sibling route, so
    // they cannot be declared in `unsupported` — the kernel checks that before
    // `compile` runs, and it has no idea which route the ref names.
    for (const field of ["n", "seed", "negativePrompt"] as const) {
      if (input[field] === undefined) continue;
      ctx.fail({
        code: "unsupported_param",
        path: [field],
        message: `\`${field}\` is not supported by "${ctx.model}": ${V4_GAPS[field]}`,
        meta: { value: input[field], source: OPENAPI_DOCS },
      });
    }
    const call = compileV4(input, ctx, route.speed);
    applyExtras(input, IDEOGRAM_IMAGE_MODEL_PARAMS, call.params, ctx);
    return call;
  },
} as const satisfies AnyImageAdapter;
