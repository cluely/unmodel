/**
 * `unmodel/image` → `leonardo.image`
 * (POST https://cloud.leonardo.ai/api/rest/v2/generations).
 *
 * # Everything lives one level down
 *
 * Leonardo's v2 body is `{ model, parameters, public? }` and `model` is an
 * OpenAPI **discriminator**: it selects which `…GenerationRequest` schema
 * `parameters` has to satisfy. So every canonical param that survives
 * compilation lands inside `parameters`, and every `ctx.from` below points two
 * segments deep. That is not decoration — the provider's checks report at
 * `["parameters", "width"]`, and a caller who wrote `aspectRatio: "16:9"` has
 * never seen a param called `parameters.width` in their life.
 *
 * It also means the escape hatch nests: `providerOptions: { leonardo: {
 * parameters: { mode: "ULTRA", style_ids: [...] } } }` deep-merges *into* the
 * compiled `parameters` object rather than replacing it, because the kernel's
 * merge recurses through plain objects. That is where `mode`, `style_ids`,
 * `prompt_enhance`, `contrast`, `tiling`, `guidances` and `public` go: they are
 * real Leonardo params with no canonical equivalent, and inventing one would
 * make every other adapter answer for them.
 *
 * # Size is pixels, on a grid, with per-model ceilings
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `aspectRatio` + `resolution` | `parameters.width` / `parameters.height` | **S2** — 8-px grid |
 * | `dimensions` | `parameters.width` / `parameters.height` | straight through |
 * | `resolution` alone | a square at that tier | **S2** at 1:1 |
 *
 * Every Leonardo image model sizes in multiples of 8 (`multipleOf` in
 * `LEONARDO_MODEL_RULES`), and 16:9 at 1k lands on 1360×768 — 1.7708:1 against
 * a requested 1.7778:1, which is 0.39% off and therefore inside
 * `RATIO_DRIFT_TOLERANCE`. So the commonest request on this provider maps with
 * **zero warnings**, and the drift warning is reserved for the ratios that
 * really do miss the grid.
 *
 * ## The ceilings are deliberately NOT passed to `toPixels`
 *
 * `PixelRules` has one `min`/`max` pair for both axes, and Leonardo's caps are
 * per-axis and per-model: Lucid Origin allows width ≤ 3840 but height ≤ 3616,
 * Phoenix caps both at 2048, Lucid Realism at 2496. Feeding a single ceiling in
 * would make `toPixels` *clamp*, and a clamp changes the shape: 16:9 at 4k on
 * Phoenix would come back as 2048×2048 — a square — with a drift warning
 * attached, which is a request nobody asked for dressed up as an approximation.
 *
 * So this adapter computes the pixels the tier actually implies and lets
 * `checkDimension` — the same function a hand-written `leonardo.image()` call
 * meets — say `parameters.height must be between 32 and 2048 for
 * "phoenix-v1.0"; got 2160`, which the kernel then remaps onto `aspectRatio`.
 * An error you can read beats an approximation you cannot. `min` *is* passed:
 * it is identical on both axes in every tabled model, so it cannot distort a
 * shape, and no tier lands near it anyway.
 *
 * # `n` — and the four-image default worth knowing about
 *
 * `n` → `parameters.quantity`, 1–8, bounds enforced by the provider's own
 * `checkIntegerRange` and remapped. Note what happens when you *omit* it:
 * Leonardo's documented default is **4**, so a unified request with no `n`
 * bills for four images. Nothing is warned, because nothing was lost — the
 * caller expressed no count, and pinning a 1 into the body would be this
 * adapter overriding a provider default on their behalf, which is the mirror
 * image of the mistake. It is documented here because it is the one thing about
 * this endpoint that surprises people, and it costs money.
 *
 * # Negative prompt is Phoenix-only, so it is a compile-time decision
 *
 * `negative_prompt` (with a 1000-character cap) is in `PHOENIX_PARAMETERS` and
 * not in `LUCID_PARAMETERS`, and `checkParameters` reports a Lucid request
 * carrying it as `unsupported_param` — "it belongs to another model on this
 * endpoint". Because the answer depends on the model, it cannot go in
 * `unsupported` (which is model-blind); it is a `ctx.fail` naming the two
 * Phoenix ids that can serve it.
 *
 * `seed` is a plain nested pass-through. `outputFormat` and `outputDelivery`
 * have no field anywhere on this endpoint — the POST returns a generation id
 * and you fetch the images from `GET /v2/generations/{id}` or a webhook — so
 * both are declared gaps.
 */
import {
  applyExtras,
  EXTRA,
  redundantTier,
  resolveSizing,
  sizingField,
  toPixels,
  type PixelRules,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageAdapterFor,
  ImageParams,
  ModelParamTable,
} from "../../core/unified/vocabulary/image";
import {
  image as validator,
  type LeonardoLucidParameters,
  type LeonardoPhoenixParameters,
} from "./image";
import {
  LEONARDO_DOCS_URL,
  LEONARDO_MODEL_RULES,
  type LeonardoContrast,
  type LeonardoPromptEnhance,
} from "./model-rules";

/**
 * Leonardo's own image models on `POST /v2/generations` — the whole of
 * `./models.ts`.
 *
 * The same endpoint routes ~60 third-party models (FLUX, Imagen, Seedream,
 * Kling, Veo, …), each with a different `parameters` schema. They belong to
 * their own providers' catalogs, so they are deliberately absent: a ref like
 * `leonardo/flux-dev` draws an `unknown_model` warning and compiles against the
 * shape below, which is honest about being a guess.
 */
const MODELS = ["lucid-origin", "lucid-realism", "phoenix-v1.0", "phoenix-v0.9"] as const;

// ---------------------------------------------------------------------------
// The per-model table
// ---------------------------------------------------------------------------

/**
 * The four Leonardo rows, split by `parameters` schema: Lucid and Phoenix.
 *
 * **Sizes.** `parameters.width` / `height` are a free pixel pair on an 8-px
 * grid, so `sizeFreeform` is set and the presets are curated exact-ratio pairs
 * at each model's own reachable tiers (Lucid Origin goes to 4k, the other
 * three to 2k). `ratios` is absent everywhere: there is no ratio field on this
 * API — a canonical ratio is *derived* into pixels by `toPixels` — so the wide
 * vocabulary is the honest one.
 *
 * **Extras.** The split is the schemas': Phoenix adds `contrast`, `tiling` and
 * a `QUALITY` mode Lucid does not have, and its `guidances` object takes two
 * more kinds. `style_ids` is `string[]` on both rather than the per-model UUID
 * allowlist — those are checked by `checkStyleIds` against the model's own
 * table, whose message names the ids, and hard-coding four twenty-UUID unions
 * here would be a second copy of a list that already exists and can already
 * answer better.
 */
const LUCID_ORIGIN_SIZES = [
  "1024x1024", "2048x2048", "2880x2880", "3616x3616", "1536x1024", "2400x1600",
  "3456x2304", "1024x1536", "1600x2400", "2400x3600", "1024x768", "2048x1536",
  "3200x2400", "768x1024", "1536x2048", "2400x3200", "1280x720", "2560x1440",
  "3840x2160", "720x1280", "1440x2560", "2016x3584", "2048x1024", "3840x1920",
  "1024x2048", "1808x3616", "2520x1080", "3360x1440", "1080x2520", "1440x3360",
] as const;

const LUCID_REALISM_SIZES = [
  "1024x1024", "2048x2048", "2496x2496", "1536x1024", "2400x1600", "1024x1536",
  "1600x2400", "1024x768", "2048x1536", "2432x1824", "768x1024", "1536x2048",
  "1824x2432", "1280x720", "2432x1368", "720x1280", "1368x2432", "2048x1024",
  "2432x1216", "1024x2048", "1216x2432", "1680x720", "2352x1008", "720x1680",
  "1008x2352",
] as const;

const PHOENIX_SIZES = [
  "1024x1024", "1536x1536", "2048x2048", "1536x1024", "1920x1280", "1024x1536",
  "1280x1920", "1024x768", "1600x1200", "2048x1536", "768x1024", "1200x1600",
  "1536x2048", "1280x720", "2048x1152", "720x1280", "1152x2048", "1024x512",
  "2048x1024", "512x1024", "1024x2048", "1680x720", "2016x864", "720x1680",
  "864x2016",
] as const;

const LEONARDO_SHARED_EXTRAS = {
  prompt_enhance: EXTRA as LeonardoPromptEnhance,
  style_ids: EXTRA as string[],
  public: EXTRA as boolean | null,
} as const;

const LUCID_ROW_EXTRAS = {
  mode: EXTRA as "FAST" | "ULTRA",
  guidances: EXTRA as LeonardoLucidParameters["guidances"],
  ...LEONARDO_SHARED_EXTRAS,
} as const;

const PHOENIX_ROW_EXTRAS = {
  mode: EXTRA as "FAST" | "QUALITY" | "ULTRA",
  contrast: EXTRA as LeonardoContrast,
  tiling: EXTRA as boolean,
  guidances: EXTRA as LeonardoPhoenixParameters["guidances"],
  ...LEONARDO_SHARED_EXTRAS,
} as const;

const PHOENIX_ROW = {
  sizes: PHOENIX_SIZES,
  sizeFreeform: true,
  tiers: ["1k", "2k"],
  extras: PHOENIX_ROW_EXTRAS,
} as const;

const LEONARDO_IMAGE_MODEL_PARAMS = {
  "lucid-origin": {
    sizes: LUCID_ORIGIN_SIZES,
    sizeFreeform: true,
    tiers: ["1k", "2k", "4k"],
    extras: LUCID_ROW_EXTRAS,
  },
  "lucid-realism": {
    sizes: LUCID_REALISM_SIZES,
    sizeFreeform: true,
    tiers: ["1k", "2k"],
    extras: LUCID_ROW_EXTRAS,
  },
  "phoenix-v1.0": PHOENIX_ROW,
  "phoenix-v0.9": PHOENIX_ROW,
} as const satisfies ModelParamTable;


/** "every image model sizes in multiples of 8" — `LeonardoDimensionRule`. */
const LEONARDO_GRID = 8;

/**
 * The pixel rules for one model: the model's own grid and floor, and **no**
 * ceiling — see the module header for why a clamped ratio is worse than a
 * provider error. An untabled model gets the grid every documented one shares.
 */
function pixelRulesFor(model: string): PixelRules {
  const rule = LEONARDO_MODEL_RULES[model];
  if (rule === undefined) return { grid: LEONARDO_GRID, source: LEONARDO_DOCS_URL };
  return {
    grid: rule.width.multipleOf,
    min: Math.min(rule.width.min, rule.height.min),
    source: LEONARDO_DOCS_URL,
  };
}

/** Whether this model's `parameters` schema has a `negative_prompt` field. */
function hasNegativePrompt(model: string): boolean {
  const rule = LEONARDO_MODEL_RULES[model];
  // An untabled (third-party) model is given the benefit of the doubt: its
  // schema is unknown, it has already warned as `unknown_model`, and refusing a
  // param that might exist would be a claim this file cannot back either.
  return rule === undefined || rule.parameters.includes("negative_prompt");
}

/**
 * `parameters` — the loose arm of Leonardo's per-model parameter objects.
 *
 * Loose because it is only ever the *compiled* subset: `mode`, `style_ids`,
 * `guidances` and the Phoenix extras are reachable through `providerOptions`
 * and are checked, per model, by `checkParameters`.
 */
export interface LeonardoImageWireParameters {
  /** REQUIRED on every documented arm. */
  prompt: string;
  /** Multiple of 8, within the model's own bounds. */
  width?: number;
  /** Multiple of 8, within the model's own bounds. */
  height?: number;
  /** 1–8. Leonardo's own default is 4. */
  quantity?: number;
  seed?: number;
  /** Phoenix only; ≤ 1000 characters. */
  negative_prompt?: string;
  [key: string]: unknown;
}

/**
 * The wire body this adapter compiles to.
 *
 * No index signature at the top level, unlike this repo's other wire arms:
 * `UnknownLeonardoModelBody` has none either, and `ExactKeys` compares the two
 * key sets directly. The looseness that matters is one level down, where the
 * params actually live.
 */
export interface LeonardoImageWire {
  model: string;
  parameters: LeonardoImageWireParameters;
  /** The one body-level key: "show the generated images in the community feed". */
  public?: boolean | null;
}

/** What a unified image call to `leonardo/…` returns: `leonardo.image`'s `Validated`. */
export type LeonardoImageResult = ReturnType<typeof validator>;

export const image = {
  category: "image",
  provider: "leonardo",
  models: MODELS,
  modelParams: LEONARDO_IMAGE_MODEL_PARAMS,
  unsupported: {
    outputFormat:
      "POST /v2/generations has no output-format field on any model's `parameters` schema — " +
      "the encoding of a finished generation is Leonardo's to choose and is reported back on " +
      "`GET /v2/generations/{id}`, so a format could only be dropped.",
    outputDelivery:
      "POST /v2/generations is an async-job API: it answers with a generation id, and the " +
      "images come back from `GET /v2/generations/{id}` or a webhook callback. There is no " +
      "delivery to choose — both of those are transport rather than request params.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<LeonardoImageWire, LeonardoImageResult> {
    const parameters: LeonardoImageWireParameters = { prompt: input.prompt };
    const body: LeonardoImageWire = { model: ctx.model, parameters };
    ctx.from(["parameters", "prompt"], "prompt");
    ctx.from(["parameters", "quantity"], "n");
    ctx.from(["parameters", "seed"], "seed");
    ctx.from(["parameters", "negative_prompt"], "negativePrompt");

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    const tier = input.resolution ?? "1k";
    const rules = pixelRulesFor(ctx.model);

    if (sizing?.kind === "ratio") {
      ctx.from(["parameters", "width"], "aspectRatio");
      ctx.from(["parameters", "height"], "aspectRatio");
      const pixels = ctx.take(
        toPixels(sizing.aspectRatio, tier, rules, { path: ["aspectRatio"], warn: ctx.warn }),
      );
      if (pixels !== undefined) {
        parameters.width = pixels.width;
        parameters.height = pixels.height;
      }
    } else if (sizing?.kind === "dimensions") {
      // Straight through. Leonardo's field IS a pixel pair, so the pixels the
      // caller asked for are the pixels that go on the wire — nothing to
      // approximate and nothing to warn about. A value off the 8-px grid or
      // over the model's cap is that model's own error, remapped onto
      // `dimensions.width` / `dimensions.height`.
      //
      // `resolution` has nothing to add here and could only contradict what
      // was already said, so it is refused rather than ignored.
      const wrote = sizingField(sizing);
      if (input.resolution !== undefined) {
        ctx.take(
          redundantTier(
            input.resolution,
            { path: ["resolution"], warn: ctx.warn },
            wrote === "size" ? "size" : "dimensions",
          ),
        );
      }
      ctx.from(["parameters", "width"], wrote === "size" ? "size" : "dimensions.width");
      ctx.from(["parameters", "height"], wrote === "size" ? "size" : "dimensions.height");
      parameters.width = sizing.dimensions.width;
      parameters.height = sizing.dimensions.height;
    } else if (input.resolution !== undefined) {
      // A tier with no shape is a square at that tier — the same answer every
      // provider's size table gives, and one `toPixels` solves exactly on an
      // 8-px grid (1024², 2048², 2880²).
      ctx.from(["parameters", "width"], "resolution");
      ctx.from(["parameters", "height"], "resolution");
      const pixels = ctx.take(
        toPixels("1:1", tier, rules, { path: ["resolution"], warn: ctx.warn }),
      );
      if (pixels !== undefined) {
        parameters.width = pixels.width;
        parameters.height = pixels.height;
      }
    }

    if (input.n !== undefined) parameters.quantity = input.n;
    if (input.seed !== undefined) parameters.seed = input.seed;

    if (input.negativePrompt !== undefined) {
      if (hasNegativePrompt(ctx.model)) {
        parameters.negative_prompt = input.negativePrompt;
      } else {
        ctx.fail({
          code: "unsupported_param",
          path: ["negativePrompt"],
          message:
            "`negative_prompt` is part of the Phoenix `parameters` schema only; " +
            `"${ctx.model}" does not accept it (the API answers with a schema error, not a ` +
            "silent ignore). Use leonardo/phoenix-v1.0 or leonardo/phoenix-v0.9, or describe " +
            "what to avoid inside `prompt`.",
          meta: { value: input.negativePrompt, source: LEONARDO_DOCS_URL },
        });
      }
    }

    applyExtras(input, LEONARDO_IMAGE_MODEL_PARAMS, body, ctx, { at: ["parameters"] });
    // `public` is a body-level key, not a `parameters` one — the one extra on
    // this route that does not nest — so it is moved back up after the copy.
    const params = body.parameters as Record<string, unknown>;
    if (Object.hasOwn(params, "public")) {
      body.public = params["public"] as boolean | null;
      delete params["public"];
      ctx.from(["public"], "public");
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies ImageAdapterFor<
  typeof LEONARDO_IMAGE_MODEL_PARAMS,
  LeonardoImageWire,
  LeonardoImageResult
>;
