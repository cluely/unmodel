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
  redundantTier,
  resolveSizing,
  toPixels,
  type PixelRules,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { ImageParams } from "../../core/unified/vocabulary/image";
import { image as validator } from "./image";
import { LEONARDO_DOCS_URL, LEONARDO_MODEL_RULES } from "./model-rules";

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
}

/** What a unified image call to `leonardo/…` returns: `leonardo.image`'s `Validated`. */
export type LeonardoImageResult = ReturnType<typeof validator>;

export const image = {
  category: "image",
  provider: "leonardo",
  models: MODELS,
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
      if (input.resolution !== undefined) {
        ctx.take(redundantTier(input.resolution, { path: ["resolution"], warn: ctx.warn }));
      }
      ctx.from(["parameters", "width"], "dimensions.width");
      ctx.from(["parameters", "height"], "dimensions.height");
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

    return { params: body, validate: validator.safe };
  },
} as const satisfies UnifiedAdapter<ImageParams, LeonardoImageWire, LeonardoImageResult>;
