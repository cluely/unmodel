/**
 * `unmodel/image` → Black Forest Labs, across both FLUX generations.
 *
 * A sibling of `./unified-image-edit` (FLUX.1 Kontext), and a separate module
 * for a reason that is about bytes rather than tidiness: `unmodel/image` and
 * `unmodel/image-edit` both import from this provider, and a single module
 * holding both adapters puts the FLUX.2 and FLUX.1 generation validators into
 * the editing pack, where nothing can ever use them. One module per category is
 * what keeps each pack paying only for the endpoint it calls; `./unified.ts`
 * re-exports both, so the public subpath is unchanged.
 *
 * One adapter, two endpoints. `bfl.image` (FLUX.2) and `bfl.imageFlux1`
 * (FLUX.1) are separate validators with different schemas, different dimension
 * rules and, on one route, a different way of asking for a shape at all — but
 * they are one *provider*, and a ref resolves to exactly one adapter per
 * provider id. So `compile` reads `ctx.model`, picks the generation and returns
 * that generation's own `.safe`. The kernel does not care which validator comes
 * back; it only runs the one it is handed.
 *
 * That is also the better answer for a caller: `"black-forest-labs/flux-2-pro"`
 * and `"black-forest-labs/flux-pro-1.1-ultra"` are the same kind of thing to
 * someone shopping for an image model, and the difference between them belongs
 * in the warnings, not in which import they had to remember.
 *
 * # What every BFL route has in common
 *
 * `POST https://api.bfl.ai/v1/{model}` is an **async job submission**: the
 * model is the route rather than a body field (`model` is a pseudo-param the
 * validators strip into `.request.url`), and the response is
 * `{ id, polling_url }` — never image bytes. Three consequences the loss policy
 * has to state rather than paper over:
 *
 * - **`n` is unsupported.** One request is one job is one image. There is no
 *   count field on any route, and inventing one by fanning out four requests
 *   would spend four times the money the caller budgeted for.
 * - **`outputDelivery` is unsupported.** Not because the bytes never arrive,
 *   but because the *request* has no field that decides how: the submit body
 *   carries `output_format` (an encoding) and `webhook_url` (a notification
 *   address), and the shape the finished image arrives in is settled by the
 *   poll of `GET /v1/get_result`, which is transport and outside unmodel's
 *   scope. Neither `"url"` nor `"base64"` is a request this endpoint can carry,
 *   so both are errors rather than one of them being a silent no-op.
 * - **`negativePrompt` is unsupported**, on every route in both generations —
 *   no FLUX schema declares one.
 *
 * `seed` and `outputFormat` map exactly and everywhere: `seed` → `seed`, and
 * the canonical `png` / `jpeg` / `webp` is precisely BFL's `output_format`
 * enum, so the two agree without a table.
 *
 * # Size — the one place the two generations genuinely differ
 *
 * | route | wire | class | rules |
 * |---|---|---|---|
 * | every FLUX.2 route | `width` + `height` | **S2** | ≥ 64 px, no grid, no documented ceiling |
 * | `flux-pro-1.1`, `flux-dev` | `width` + `height` | **S2** | multiple of 32, 256–1440 |
 * | `flux-pro-1.1-ultra`(`-finetuned`) | `aspect_ratio` | **S5** | any `W:H` between 21:9 and 9:21 |
 *
 * The FLUX.2 row is the surprising one and it is deliberate: `Flux2Inputs`
 * publishes exactly one bound on `width`/`height`, `minimum: 64`. The FLUX.2
 * pages advertise "up to 4MP output" in prose and publish no maximum, no
 * multiple-of rule and no aspect bound, so this adapter enforces none —
 * over-narrowing here would reject sizes the API accepts. It also means a
 * grid-free S2 lands on the requested ratio to within a pixel, so 16:9 at 1k is
 * 1365×768 with **no** warning, where the same request on `flux-pro-1.1` is
 * 1344×768 on the 32-px grid and warns about the 1.6% it cost. That difference
 * between two routes at one provider is the whole argument for a shared
 * derivation with a shared warning.
 *
 * The FLUX.1 pixel routes also cap every side at 1440 px, which puts a ceiling
 * on the *tier*: 1440² is 2.07 MP, so `2k` (4.19 MP) and `4k` (8.29 MP) are
 * unreachable no matter what shape is asked for. That is an `invalid_enum_value`
 * on `resolution` naming `1k` — not a clamp, because a clamp would deliver a
 * quarter of the pixels that were asked for and say nothing.
 *
 * The ultra routes have no size field at all, only a shape, so `resolution`
 * there is an error and `dimensions` is the one honestly *approximate* mapping
 * in this file: the pixels become the aspect ratio they describe, with an
 * `approximated_param` saying the size itself was not expressible.
 */
import {
  applyExtras,
  EXTRA,
  pixelsToRatio,
  redundantTier,
  resolveSizing,
  toPixels,
  sizingField,
  toRatioString,
  toTier,
  type PixelRules,
  type RatioStringRules,
  type Sizing,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  AnyImageAdapter,
  ImageParams,
  ModelParamTable,
} from "../../core/unified/vocabulary/image";
import { BFL_ASPECT_RATIOS } from "./aspect";
import { image as validator } from "./image";
import {
  imageFlux1 as flux1Validator,
  FLUX1_DIMENSION_MULTIPLE,
  FLUX1_MAX_DIMENSION,
  FLUX1_MIN_DIMENSION,
} from "./image-flux1";

const OPENAPI_URL = "https://api.bfl.ai/openapi.json";

// ---------------------------------------------------------------------------
// The three answers both adapters give
// ---------------------------------------------------------------------------

/** One request is one job is one image, on every route BFL publishes. */
const ONE_IMAGE_PER_REQUEST =
  "Black Forest Labs generates one image per request — POST /v1/{model} submits a single async " +
  "job (`{ id, polling_url }`) whose result is one image, and no FLUX schema declares a count " +
  "field; issue N requests to get N images.";

/**
 * The submit body has an *encoding* field and a *notification* field, and
 * nothing that decides between a URL and inline bytes.
 */
const NO_DELIVERY_FIELD =
  "POST /v1/{model} is an async job submission: it answers `{ id, polling_url }` and never " +
  "image bytes, so the request has no delivery field to set. How the finished image arrives is " +
  "settled by the poll of GET /v1/get_result (or by the `webhook_url` you registered), which is " +
  "transport and outside unmodel's scope.";

/**
 * Wire params shared by both endpoints, in the spelling both schemas use.
 * `seed` keeps its canonical name, which is why no `ctx.from` declares it.
 */
interface BflImageWireBase {
  model: string;
  prompt: string;
  seed?: number;
  /** `"jpeg"` (BFL's default) / `"png"` / `"webp"` — `BFL_OUTPUT_FORMATS`. */
  output_format?: string;
  [key: string]: unknown;
}

/**
 * `seed` and `output_format`, which every route in both generations takes and
 * both take exactly.
 *
 * Exactly: `output_format`'s enum is `["jpeg", "png", "webp"]`, which is the
 * canonical `ImageOutputFormat` union with the members in a different order, so
 * there is no table to consult and nothing to approximate. A value that is
 * neither (a JavaScript caller's `"gif"`) is caught by the endpoint's own
 * `z.enum` and remapped onto `outputFormat` by the `ctx.from` here.
 */
function applyShared(
  input: ImageParams,
  body: BflImageWireBase,
  ctx: CompileContext<ImageParams>,
): void {
  ctx.from(["output_format"], "outputFormat");
  if (input.seed !== undefined) body.seed = input.seed;
  if (input.outputFormat !== undefined) body.output_format = input.outputFormat;
}

// ---------------------------------------------------------------------------
// image — the FLUX.2 route family
// ---------------------------------------------------------------------------

/** Every FLUX.2 route in the catalog — the ref union for `black-forest-labs/…`. */
const FLUX2_MODELS = [
  "flux-2-pro",
  "flux-2-max",
  "flux-2-pro-preview",
  "flux-2-flex",
  "flux-2-klein-9b",
  "flux-2-klein-9b-preview",
  "flux-2-klein-4b",
] as const;

/**
 * FLUX.2's documented dimension rules, in full: `minimum: 64`.
 *
 * `grid: 1` is not a placeholder — `Flux2Inputs` publishes no multiple-of rule,
 * so any integer ≥ 64 is a legal side, and snapping to a grid this API does not
 * have would cost accuracy for nothing. No `max` for the same reason: the "up
 * to 4MP" in the FLUX.2 prose is not a published bound, and enforcing a number
 * the schema does not state would reject requests the API accepts. A size the
 * server does refuse comes back from the server, which is the only party that
 * knows.
 */
const FLUX2_PIXELS: PixelRules = {
  grid: 1,
  min: 64,
  source: `${OPENAPI_URL}#/components/schemas/Flux2Inputs`,
};

/** The wire body this adapter compiles to — the loose arm of `Flux2Body`. */
export interface BflImageWire extends BflImageWireBase {
  /** Pixels, ≥ 64. Omitted (server default 0) means automatic sizing. */
  width?: number;
  height?: number;
}

/** What a unified call to a FLUX.2 ref returns: `bfl.image`'s own `Validated`. */
export type BflImageResult = ReturnType<
  typeof validator<BflImageWire["model"], BflImageWire>
>;

/**
 * The FLUX.2 half of `compile`. Split out so the dispatch below reads as the
 * one decision it is, rather than as a branch inside a hundred lines of sizing.
 */
function compileFlux2(
  input: ImageParams,
  ctx: CompileContext<ImageParams>,
): CompiledCall<BflImageWire, BflImageResult> {
    const body: BflImageWire = { model: ctx.model, prompt: input.prompt };
    applyShared(input, body, ctx);

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    const tier = input.resolution ?? "1k";

    if (sizing?.kind === "dimensions") {
      // Straight through: this endpoint's size vocabulary *is* pixels, so the
      // pair the caller wrote is the pair on the wire and there is nothing to
      // approximate. A side under 64 is the schema's own error, remapped. A
      // tier alongside is refused rather than ignored — the pixel count is
      // already settled and the two could disagree.
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
      ctx.from(["width"], wrote === "size" ? "size" : "dimensions.width");
      ctx.from(["height"], wrote === "size" ? "size" : "dimensions.height");
      body.width = sizing.dimensions.width;
      body.height = sizing.dimensions.height;
    } else if (sizing?.kind === "ratio" || input.resolution !== undefined) {
      // A tier with no shape is a square — the canonical shape, and the one
      // that solves any tier exactly. A shape with no tier is that shape at 1k:
      // `width` and `height` are a pair, so there is no way to send a shape
      // here without also sending a size, and 1k is the vocabulary's default
      // rather than this adapter's opinion.
      const from = sizing?.kind === "ratio" ? "aspectRatio" : "resolution";
      ctx.from(["width"], from);
      ctx.from(["height"], from);
      const pixels = ctx.take(
        toPixels(sizing?.kind === "ratio" ? sizing.aspectRatio : "1:1", tier, FLUX2_PIXELS, {
          path: [from],
          warn: ctx.warn,
        }),
      );
      if (pixels !== undefined) {
        body.width = pixels.width;
        body.height = pixels.height;
      }
    }

    return { params: body, validate: validator.safe };
}

// ---------------------------------------------------------------------------
// imageFlux1 — the previous-generation FLUX.1 routes
// ---------------------------------------------------------------------------

/**
 * # `imageFlux1`
 *
 * Four routes, three schemas, and one fork this adapter has to make in the
 * middle of the size decision:
 *
 * | route | schema | size |
 * |---|---|---|
 * | `flux-pro-1.1` | `FluxPro11Inputs` | `width`/`height` |
 * | `flux-dev` | `FluxDevInputs` | `width`/`height` |
 * | `flux-pro-1.1-ultra` | `FluxUltraInput` | `aspect_ratio` |
 * | `flux-pro-1.1-ultra-finetuned` | `FinetuneFluxUltraInput` | `aspect_ratio` |
 *
 * The ultra arm is a **range**, not a list. `FluxUltraInput` types
 * `aspect_ratio` as a bare string and documents the bound in prose — "Aspect
 * ratio of the image between 21:9 and 9:21" — and `checkAspectRatioRange`
 * enforces exactly that: any `W:H` whose value lies in `[9/21, 21/9]` passes,
 * including spellings BFL never enumerated. So this is {@link toRatioString}
 * (S5) with those bounds and not `toRatioEnum` (S1) with a list, and the
 * spelling that goes out is the reduced one — `"21:9"` compiles to `"7:3"`,
 * which is the same shape, inside the same bound, and the one spelling two
 * callers who meant the same thing will both send. `BflAspectRatio`'s thirteen
 * named presets are autocomplete for hand-written calls, not a closed domain.
 *
 * `-finetuned` is in `models` because it is a real route with its own catalog
 * row, but it also *requires* `finetune_id`, which has no canonical spelling
 * and never will. A unified call to it therefore fails at the provider's own
 * `checkFinetuneId` unless `providerOptions["black-forest-labs"]` supplies the
 * LoRA id — which is precisely the escape hatch's job, and precisely the error
 * message a caller needs to discover it.
 */
const FLUX1_MODELS = [
  "flux-pro-1.1",
  "flux-dev",
  "flux-pro-1.1-ultra",
  "flux-pro-1.1-ultra-finetuned",
] as const;

/** The two routes that size by shape instead of pixels (`FluxUltraInput`). */
const ULTRA_MODELS: ReadonlySet<string> = new Set([
  "flux-pro-1.1-ultra",
  "flux-pro-1.1-ultra-finetuned",
]);

/** "multiple of 32", 256–1440 — `FluxPro11Inputs` / `FluxDevInputs`. */
const FLUX1_PIXELS: PixelRules = {
  grid: FLUX1_DIMENSION_MULTIPLE,
  min: FLUX1_MIN_DIMENSION,
  max: FLUX1_MAX_DIMENSION,
  source: `${OPENAPI_URL}#/components/schemas/FluxPro11Inputs`,
};

/**
 * The tiers the pixel routes can actually reach.
 *
 * A 1440-px ceiling on each side caps the output at 2.07 MP, so `2k`
 * (4.19 MP) and `4k` (8.29 MP) have no expression on these routes at any
 * shape. Gating on the tier *before* the pixels are computed is what turns that
 * into an `invalid_enum_value` naming `1k` instead of a pair of dimensions
 * silently clamped to 1440 — which is the failure mode this whole surface
 * exists to prevent, since a clamped 2k request comes back a quarter of the
 * size with nothing on the record to say so.
 */
const FLUX1_TIERS = { "1k": "1k" } as const;

/** "Aspect ratio of the image between 21:9 and 9:21." — `FluxUltraInput`. */
const ULTRA_RATIO: RatioStringRules = {
  min: 9 / 21,
  max: 21 / 9,
  source: `${OPENAPI_URL}#/components/schemas/FluxUltraInput`,
};

/** The wire body this adapter compiles to — the loose arm of `Flux1Body`. */
export interface BflImageFlux1Wire extends BflImageWireBase {
  /** `flux-pro-1.1` / `flux-dev`: multiple of 32, 256–1440. */
  width?: number;
  height?: number;
  /** The ultra routes only: `"W:H"` between 21:9 and 9:21. */
  aspect_ratio?: string;
}

/** What a unified call to a FLUX.1 ref returns: `bfl.imageFlux1`'s `Validated`. */
export type BflImageFlux1Result = ReturnType<typeof flux1Validator>;

/** The FLUX.1 half of `compile` — three schemas behind one `ctx.model` fork. */
function compileFlux1(
  input: ImageParams,
  ctx: CompileContext<ImageParams>,
): CompiledCall<BflImageFlux1Wire, BflImageFlux1Result> {
  const body: BflImageFlux1Wire = { model: ctx.model, prompt: input.prompt };
  applyShared(input, body, ctx);

  const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
  if (ULTRA_MODELS.has(ctx.model)) compileUltraSize(input, sizing, body, ctx);
  else compilePixelSize(input, sizing, body, ctx);

  return { params: body, validate: flux1Validator.safe };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** Every BFL generation route, both generations, in catalog order. */
const MODELS = [...FLUX2_MODELS, ...FLUX1_MODELS] as const;

// ---------------------------------------------------------------------------
// The per-model table
// ---------------------------------------------------------------------------

/**
 * Eleven generation routes, three sizing shapes and a `safety_tolerance` whose
 * *range* differs between the two generations — 0–5 on FLUX.2, 0–6 on FLUX.1
 * — which the endpoints' own schemas check and this table does not restate.
 *
 * **Sizes.** The FLUX.2 and FLUX.1 pixel routes take a free `width`/`height`
 * pair, so both carry `sizeFreeform` and a curated preset list: exact-ratio
 * integer pairs at ~1 MP and ~4 MP for FLUX.2 (whose only documented rule is
 * `minimum: 64`), and pairs with both sides divisible by 32 inside 256–1440
 * for FLUX.1 (whose grid and range are enforced). The ultra routes have no
 * width/height field at all — `FluxUltraInput` declares none — so they carry
 * no `sizes` and `size` types as `never` there, which is the same fact
 * `compileUltraSize` states at run time.
 *
 * **Ratios.** Only the ultra routes have a ratio field, and it is a *range*
 * rather than an enum ("between 21:9 and 9:21"), so `ratioFreeform` keeps the
 * template tail beside the thirteen presets. The pixel routes leave `ratios`
 * absent: a canonical ratio there is derived into a pair by `toPixels`.
 *
 * **Tiers.** FLUX.2 reaches 1k and 2k; FLUX.1's pixel routes cap at 1440²
 * (2.07 MP) so only 1k is reachable; the ultra routes have no size field, so
 * `tiers` is empty and `resolution` is a compile error there.
 */
const FLUX_2_SIZES = [
  "1024x1024", "1568x672", "1440x720", "1344x756", "1248x832", "1184x888",
  "1140x912", "912x1140", "888x1184", "832x1248", "756x1344", "720x1440",
  "672x1568", "2048x2048", "3136x1344", "2896x1448", "2688x1512", "2496x1664",
  "2368x1776", "2280x1824", "1824x2280", "1776x2368", "1664x2496", "1512x2688",
  "1448x2896", "1344x3136",
] as const;

const FLUX_1_SIZES = [
  "1024x1024", "512x512", "1440x1440", "1344x576", "1408x704", "1024x576",
  "1344x896", "960x640", "1280x960", "1024x768", "1280x1024", "1024x1280",
  "960x1280", "768x1024", "896x1344", "640x960", "576x1024", "704x1408",
  "576x1344",
] as const;

/** 0–5 on FLUX.2 and the tools routes, 0–6 on FLUX.1 — the schemas check it. */
const SAFETY_TOLERANCE = EXTRA as number;
const PROMPT_UPSAMPLING = EXTRA as boolean;

const FLUX_2_BASE = { sizes: FLUX_2_SIZES, sizeFreeform: true, tiers: ["1k", "2k"] } as const;
const FLUX_1_PIXEL_BASE = { sizes: FLUX_1_SIZES, sizeFreeform: true, tiers: ["1k"] } as const;
const ULTRA_BASE = { ratios: BFL_ASPECT_RATIOS, ratioFreeform: true, tiers: [] } as const;

const FLUX_2_PRO_ROW = {
  ...FLUX_2_BASE,
  extras: { disable_pup: EXTRA as boolean, safety_tolerance: SAFETY_TOLERANCE },
} as const;

const FLUX_2_KLEIN_ROW = {
  ...FLUX_2_BASE,
  extras: { safety_tolerance: SAFETY_TOLERANCE },
} as const;

const BFL_IMAGE_MODEL_PARAMS = {
  "flux-2-pro": FLUX_2_PRO_ROW,
  "flux-2-max": FLUX_2_PRO_ROW,
  "flux-2-pro-preview": FLUX_2_PRO_ROW,
  "flux-2-flex": {
    ...FLUX_2_BASE,
    extras: {
      prompt_upsampling: EXTRA as boolean | null,
      guidance: EXTRA as number,
      steps: EXTRA as number,
      safety_tolerance: SAFETY_TOLERANCE,
    },
  },
  "flux-2-klein-9b": FLUX_2_KLEIN_ROW,
  "flux-2-klein-9b-preview": FLUX_2_KLEIN_ROW,
  "flux-2-klein-4b": FLUX_2_KLEIN_ROW,
  "flux-pro-1.1": {
    ...FLUX_1_PIXEL_BASE,
    extras: { prompt_upsampling: PROMPT_UPSAMPLING, safety_tolerance: SAFETY_TOLERANCE },
  },
  "flux-dev": {
    ...FLUX_1_PIXEL_BASE,
    extras: {
      steps: EXTRA as number | null,
      guidance: EXTRA as number | null,
      prompt_upsampling: PROMPT_UPSAMPLING,
      safety_tolerance: SAFETY_TOLERANCE,
    },
  },
  "flux-pro-1.1-ultra": {
    ...ULTRA_BASE,
    extras: {
      raw: EXTRA as boolean,
      prompt_upsampling: PROMPT_UPSAMPLING,
      safety_tolerance: SAFETY_TOLERANCE,
    },
  },
  "flux-pro-1.1-ultra-finetuned": {
    ...ULTRA_BASE,
    extras: {
      finetune_id: EXTRA as string,
      finetune_strength: EXTRA as number,
      raw: EXTRA as boolean,
      prompt_upsampling: PROMPT_UPSAMPLING,
      safety_tolerance: SAFETY_TOLERANCE,
    },
  },
} as const satisfies ModelParamTable;


/** Which generation a ref belongs to. FLUX.1's four ids are the closed set. */
const FLUX1_ROUTES: ReadonlySet<string> = new Set<string>(FLUX1_MODELS);

/**
 * A ref this adapter does not know compiles as FLUX.2 — the current generation,
 * and the one a model released after this snapshot will belong to. The kernel
 * has already warned `unknown_model` by the time `compile` runs, so the guess is
 * on the record rather than silent.
 */
export const image = {
  category: "image",
  provider: "black-forest-labs",
  models: MODELS,
  modelParams: BFL_IMAGE_MODEL_PARAMS,
  unsupported: {
    n: ONE_IMAGE_PER_REQUEST,
    outputDelivery: NO_DELIVERY_FIELD,
    negativePrompt:
      "no FLUX route declares a negative-prompt field — Flux2Inputs (pro/max), Flux2FlexInputs, " +
      "Flux2KleinInputs, FluxPro11Inputs, FluxDevInputs and FluxUltraInput all take a single " +
      "`prompt`; describe what to avoid inside it instead.",
  },
  compile(input: ImageParams, ctx: CompileContext<ImageParams>) {
    const call = FLUX1_ROUTES.has(ctx.model) ? compileFlux1(input, ctx) : compileFlux2(input, ctx);
    applyExtras(input, BFL_IMAGE_MODEL_PARAMS, call.params, ctx);
    return call;
  },
} as const satisfies AnyImageAdapter;

/**
 * `flux-pro-1.1` / `flux-dev`: ratio + tier → a 32-px-grid pair inside
 * 256–1440, or the caller's own pixels straight through.
 */
function compilePixelSize(
  input: ImageParams,
  sizing: Sizing | undefined,
  body: BflImageFlux1Wire,
  ctx: CompileContext<ImageParams>,
): void {
  if (sizing?.kind === "dimensions") {
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
    ctx.from(["width"], wrote === "size" ? "size" : "dimensions.width");
    ctx.from(["height"], wrote === "size" ? "size" : "dimensions.height");
    body.width = sizing.dimensions.width;
    body.height = sizing.dimensions.height;
    return;
  }
  if (sizing?.kind !== "ratio" && input.resolution === undefined) return;

  const from = sizing?.kind === "ratio" ? "aspectRatio" : "resolution";
  // The tier gate first: a tier with no reachable pixels is a different
  // mistake from a ratio that does not land on the grid, and only one of the
  // two has a value worth computing afterwards.
  const tier = ctx.take(
    toTier(input.resolution ?? "1k", FLUX1_TIERS, { path: ["resolution"], warn: ctx.warn }),
  );
  if (tier === undefined) return;

  ctx.from(["width"], from);
  ctx.from(["height"], from);
  const pixels = ctx.take(
    toPixels(sizing?.kind === "ratio" ? sizing.aspectRatio : "1:1", tier, FLUX1_PIXELS, {
      path: [from],
      warn: ctx.warn,
    }),
  );
  if (pixels !== undefined) {
    body.width = pixels.width;
    body.height = pixels.height;
  }
}

/**
 * `flux-pro-1.1-ultra`(`-finetuned`): a shape, and only a shape.
 *
 * `dimensions` is the one approximation in this file. The pixels describe a
 * ratio, the ratio is expressible, the pixel count is not — so
 * {@link pixelsToRatio} sends the shape and warns that the size was dropped,
 * which is exactly the case that separates "expressed approximately" from
 * "cannot be expressed". `resolution` is on the other side of that line: there
 * is no size field on this route at all, so a tier has nothing to become.
 */
function compileUltraSize(
  input: ImageParams,
  sizing: Sizing | undefined,
  body: BflImageFlux1Wire,
  ctx: CompileContext<ImageParams>,
): void {
  if (input.resolution !== undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["resolution"],
      message:
        "the ultra routes size by `aspect_ratio` (FluxUltraInput) and declare no width/height " +
        `fields — "${ctx.model}" has no size knob of any kind, so a resolution tier has ` +
        "nothing to become. Use `aspectRatio` to choose the shape, or flux-pro-1.1 / flux-dev " +
        "to choose the pixels.",
      meta: { value: input.resolution, source: ULTRA_RATIO.source },
    });
  }

  const from = sizing?.kind === "dimensions" ? sizingField(sizing) : "aspectRatio";
  const path = [from];
  ctx.from(["aspect_ratio"], from);

  let spelling: string | undefined;
  if (sizing?.kind === "ratio") {
    spelling = sizing.aspectRatio;
  } else if (sizing?.kind === "dimensions") {
    // Always warns, even for a shape that matches exactly: a ratio cannot
    // carry a pixel count, so something was lost however well it matched.
    spelling = ctx.take(
      pixelsToRatio(sizing.dimensions.width, sizing.dimensions.height, undefined, {
        path,
        warn: ctx.warn,
      }),
    );
  }
  if (spelling === undefined) return;

  const ratio = ctx.take(toRatioString(spelling, ULTRA_RATIO, { path, warn: ctx.warn }));
  if (ratio !== undefined) body.aspect_ratio = ratio;
}
