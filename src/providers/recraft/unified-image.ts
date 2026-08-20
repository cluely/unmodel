/**
 * Recraft's unified `image` adapter — `POST /v1/images/generations`.
 *
 * A sibling of `./unified-image-edit` (`POST /v1/images/imageToImage`), split
 * per category so `unmodel/image` and `unmodel/image-edit` each pay for one of
 * Recraft's route families rather than both. `./unified.ts` re-exports the
 * pair, so the public subpath is unchanged.
 *
 * # One `size` field, two vocabularies
 *
 * Recraft's `size` accepts *either* an aspect ratio (`"16:9"` — a closed
 * 14-value list every model shares) *or* an explicit pixel pair (`"1344x768"`
 * — a per-model-group table from the appendix). One wire param, two
 * derivation classes, and which one a request lands in is decided by which
 * canonical spelling the caller used, not by the model:
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `aspectRatio` | `size` = `"W:H"` | **S1** — {@link toRatioEnum} against `ASPECT_RATIOS`; matches on the reduced ratio, so `"32:18"` compiles to `"16:9"` with no warning |
 * | `dimensions` | `size` = `"WxH"` | straight through — `checkSize` owns the per-model table and its message already names that model's list |
 * | `resolution` | *nothing* | a claim about the model; see below |
 *
 * The `dimensions` path is deliberately not re-checked here. `checkSize`
 * already knows that `1536x768` is a V4-standard size and `2688x1536` a V4 Pro
 * one, that `1707x1024` is the un-attributed transpose it passes through on
 * purpose, and that the vector models are documented with ratios alone so
 * their pixel pairs must not be rejected. Reimplementing any of that would
 * give a caller two chances to read two versions of the same table, and the
 * kernel remaps the provider's `size` error onto `dimensions` anyway.
 *
 * # `resolution` is a property of the model, not a param
 *
 * There is no pixel-budget field on this endpoint. `size` picks a *shape*
 * unless you name exact pixels, and how many pixels that shape is rendered at
 * comes entirely from the model id:
 *
 * | models | documented sizes | tier |
 * |---|---|---|
 * | `recraftv4_1`, `recraftv4_1_utility`, `recraftv4` | 1.03–1.18 MP around 1024² | `1k` |
 * | `recraftv4_1_pro`, `recraftv4_1_utility_pro`, `recraftv4_pro` | 4.13–4.72 MP around 2048² | `2k` |
 * | `recraftv2`, `recraftv3` | 1.05–2.10 MP around 1024² | `1k` |
 * | the vector line, `recraft20b` | none — ratios only | *none* |
 *
 * So `resolution` is expressed **by choosing the model**, and the adapter's
 * job is to check that the model you chose actually delivers what you asked
 * for. A tier that matches sends nothing extra and warns about nothing — the
 * request genuinely is 1k. A tier that does not match is an error naming the
 * Pro refs (or the standard ones) that do render at it, because silently
 * serving 1 MP for a `2k` request is the exact failure this surface exists to
 * prevent. On the vector models and `recraft20b` there is no pixel vocabulary
 * at all to check a tier against, so a tier there is `unsupported_param`.
 *
 * The V2/V3 row is the one worth squinting at: its table reaches 2.10 MP at
 * `2048x1024`, which sits exactly halfway between 1024² and 2048² in log
 * space. Every other entry is nearer 1k, and the square reference is 1024², so
 * the line is declared at `1k` — and a caller who wants those 2 MP sizes names
 * them with `dimensions`, which is what `dimensions` is for.
 *
 * # Everything else
 *
 * | canonical | wire | note |
 * |---|---|---|
 * | `prompt` | `prompt` | per-model character cap (10,000 on V4/V4.1, 1,000 on V2/V3) is `checkPromptLength`'s |
 * | `model` | `model` | same name; the bare ref half goes straight on the wire |
 * | `n` | `n` | 1–6 by the schema |
 * | `seed` | `random_seed` | |
 * | `negativePrompt` | `negative_prompt` | V2/V3 only, and that is the **provider's** deny rule, not this file's |
 * | `outputFormat` | `image_format` | `"webp"` / `"png"`; `"jpeg"` is an error |
 * | `outputDelivery` | `response_format` | `"url"` / `"b64_json"` |
 *
 * `negativePrompt` is emitted unconditionally and *not* pre-screened per
 * model. The V4/V4.1 family rule in `constraints.ts` already denies it with a
 * reason and a source, and letting that rule speak — remapped onto
 * `negativePrompt` by the provenance below — is strictly better than a second
 * copy of the same fact that can go stale independently. Same story for
 * `style` / `style_id` / `text_layout`, which have no canonical spelling and
 * reach the body through `providerOptions.recraft`.
 *
 * `image_format` deserves one caveat, taken from the endpoint module's own
 * header: it is one of seven params Recraft's API accepts but its rendered
 * parameter table omits, and its value list survives from an earlier revision
 * of an internal spec document. The module types it and validates it, so the
 * adapter emits it — but a reader deciding whether to depend on
 * `outputFormat` here should know the provenance is thinner than the rest of
 * this table.
 *
 * There are **no provider-wide gaps**: every canonical field has a home on
 * this route, so `unsupported` is absent and every refusal below is
 * model-dependent and comes with the model's name in it.
 */
import { redundantTier, resolveSizing, toRatioEnum } from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { ImageParams, ResolutionTier } from "../../core/unified/vocabulary/image";
import {
  image as generations,
  ASPECT_RATIOS,
  IMAGE_FORMATS,
  type RecraftImageFormat,
  type RecraftSize,
} from "./image";
import type { RecraftModelId } from "./models";

const ENDPOINTS_DOCS = "https://www.recraft.ai/docs/api-reference/endpoints";
const APPENDIX_DOCS = "https://www.recraft.ai/docs/api-reference/appendix";

/**
 * Every model the hand catalog carries — the ref union for `recraft/…`.
 *
 * `satisfies readonly RecraftModelId[]` pins the list to `models.ts`, so a
 * typo is a compile error rather than an `unknown_model` warning that skips
 * the prompt cap and the cost estimate at the same time.
 */
const MODELS = [
  "recraftv4_1",
  "recraftv4_1_vector",
  "recraftv4_1_pro",
  "recraftv4_1_pro_vector",
  "recraftv4_1_utility",
  "recraftv4_1_utility_vector",
  "recraftv4_1_utility_pro",
  "recraftv4_1_utility_pro_vector",
  "recraftv4",
  "recraftv4_vector",
  "recraftv4_pro",
  "recraftv4_pro_vector",
  "recraftv3",
  "recraftv3_vector",
  "recraftv2",
  "recraftv2_vector",
  "recraft20b",
] as const satisfies readonly RecraftModelId[];

/**
 * The tier each raster model renders at, read off the appendix tables in
 * `image.ts` (`V4_STANDARD_SIZES`, `V4_PRO_SIZES`, `V2_V3_SIZES`) — the same
 * eight ids `SIZES_BY_MODEL` keys, because a model with a pixel table is
 * exactly a model whose pixel budget is documented.
 *
 * Absent ids — the whole vector line and `recraft20b` — have no pixel
 * vocabulary at all, which is a different fact from "renders at another tier"
 * and gets a different message.
 */
const KNOWN_MODELS: ReadonlySet<string> = new Set<string>(MODELS);

const RENDERED_TIER: Readonly<Record<string, ResolutionTier>> = {
  recraftv4_1: "1k",
  recraftv4_1_utility: "1k",
  recraftv4: "1k",
  recraftv4_1_pro: "2k",
  recraftv4_1_utility_pro: "2k",
  recraftv4_pro: "2k",
  recraftv2: "1k",
  recraftv3: "1k",
};

/**
 * The "use one of these instead" half of a tier mismatch. `4k` is absent
 * because no Recraft model publishes a size anywhere near 8 MP, and the
 * message says so rather than listing nothing.
 */
const REFS_BY_TIER: Readonly<Partial<Record<ResolutionTier, string>>> = {
  "1k": '"recraftv4_1", "recraftv4_1_utility", "recraftv4", "recraftv3", "recraftv2"',
  "2k": '"recraftv4_1_pro", "recraftv4_1_utility_pro", "recraftv4_pro"',
};

/**
 * The wire body this adapter compiles to — the slice of `GenerationsParams`
 * the canonical vocabulary can reach.
 *
 * No `[key: string]: unknown` tail: `GenerationsParams` has no index
 * signature, so an open tail would make `ExactKeys` demand `never` for every
 * extra key and `recraft.image.safe` would stop being assignable. The rest of
 * the surface — `style`, `style_id`, `substyle`, `controls`, `text_layout`,
 * `upscale` — arrives through `providerOptions.recraft`, which the kernel
 * merges *before* validation so it is checked by exactly the same four layers.
 */
export interface RecraftImageWire {
  model: string;
  prompt: string;
  n?: number;
  size?: RecraftSize;
  random_seed?: number;
  negative_prompt?: string;
  image_format?: RecraftImageFormat;
  response_format?: "url" | "b64_json";
}

/** What a unified call to `recraft/…` returns: `recraft.image`'s own `Validated`. */
export type RecraftImageResult = ReturnType<typeof generations>;

export const image = {
  category: "image",
  provider: "recraft",
  models: MODELS,
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<RecraftImageWire, RecraftImageResult> {
    const body: RecraftImageWire = { model: ctx.model, prompt: input.prompt };

    // --- size: one field, two vocabularies --------------------------------
    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));

    if (sizing?.kind === "ratio") {
      ctx.from(["size"], "aspectRatio");
      const ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, ASPECT_RATIOS, { source: APPENDIX_DOCS }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      );
      // `toRatioEnum` is typed `string` because `derive.ts` also answers for
      // JavaScript callers; the value it returned is an element of
      // `ASPECT_RATIOS`, which is `RecraftSize`'s first arm.
      if (ratio !== undefined) body.size = ratio as RecraftSize;
    } else if (sizing?.kind === "dimensions") {
      // Straight through. `checkSize` holds the per-model table, the
      // un-attributed pass-through and the vector-model exemption; the kernel
      // remaps its error onto `dimensions`.
      //
      // And on this path a tier is refused rather than checked: `size` is
      // carrying the pixel count itself, so `resolution` is answering a
      // question that has already been answered. Same rule, same message, as
      // every other route in this library whose size field takes pixels.
      if (input.resolution !== undefined) {
        ctx.take(redundantTier(input.resolution, { path: ["resolution"], warn: ctx.warn }));
      }
      ctx.from(["size"], "dimensions");
      body.size = `${sizing.dimensions.width}x${sizing.dimensions.height}`;
    }

    // --- resolution: verified against the model, never sent ----------------
    // Reached only when the shape came from `aspectRatio` or was left unset —
    // the `dimensions` path above has already refused a tier. On this endpoint
    // a tier is not an input to the size derivation, it is an assertion about
    // the model that either holds or does not.
    //
    // An id this snapshot does not carry is skipped rather than guessed at —
    // the kernel has already warned `unknown_model` "model-dependent checks
    // were skipped", and this is one of them. Refusing a tier on the strength
    // of a table that says nothing about the model would turn a lagging
    // catalog into a broken request.
    if (
      input.resolution !== undefined &&
      sizing?.kind !== "dimensions" &&
      KNOWN_MODELS.has(ctx.model)
    ) {
      const rendered = RENDERED_TIER[ctx.model];
      if (rendered === undefined) {
        ctx.fail({
          code: "unsupported_param",
          path: ["resolution"],
          message:
            `\`resolution\` has no equivalent on "${ctx.model}": Recraft has no pixel-budget ` +
            `field, and the appendix attributes explicit sizes only to the raster models — the ` +
            `vector line and "recraft20b" are documented with aspect ratios alone, so there is ` +
            `nothing to check a tier against. Drop \`resolution\`, or name the pixels with ` +
            `\`dimensions\` on a raster model.`,
          meta: { value: input.resolution, source: APPENDIX_DOCS },
        });
      } else if (rendered !== input.resolution) {
        const instead = REFS_BY_TIER[input.resolution];
        ctx.fail({
          code: "invalid_enum_value",
          path: ["resolution"],
          message:
            `\`resolution\` must be "${rendered}" on "${ctx.model}": Recraft has no pixel-budget ` +
            `field, so the tier is a property of the model, and this one's documented sizes are ` +
            `all about ${rendered === "1k" ? "one megapixel" : "four megapixels"}. ` +
            (instead === undefined
              ? `No Recraft model renders at ${input.resolution}.`
              : `${instead} render at ${input.resolution}.`),
          meta: { allowed: [rendered], value: input.resolution, source: APPENDIX_DOCS },
        });
      }
      // A tier that matches needs no wire param: the model already renders at
      // it, so the request is exact and there is nothing to warn about.
    }

    // --- the plain renames -------------------------------------------------
    // `n` is `n`: identical name, so no provenance to declare.
    if (input.n !== undefined) body.n = input.n;

    if (input.seed !== undefined) {
      ctx.from(["random_seed"], "seed");
      body.random_seed = input.seed;
    }

    if (input.negativePrompt !== undefined) {
      // Emitted for every model. `negative_prompt` is V2/V3-only, and that is
      // the family deny rule's fact to state — with its own reason and source
      // — not a second copy kept here.
      ctx.from(["negative_prompt"], "negativePrompt");
      body.negative_prompt = input.negativePrompt;
    }

    if (input.outputFormat !== undefined) {
      ctx.from(["image_format"], "outputFormat");
      if (input.outputFormat === "jpeg") {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["outputFormat"],
          message:
            "`image_format` encodes \"webp\" or \"png\" on this route; Recraft publishes no JPEG " +
            "output, so `outputFormat: \"jpeg\"` could only be dropped.",
          meta: { allowed: [...IMAGE_FORMATS], value: input.outputFormat, source: ENDPOINTS_DOCS },
        });
      } else {
        body.image_format = input.outputFormat;
      }
    }

    if (input.outputDelivery !== undefined) {
      ctx.from(["response_format"], "outputDelivery");
      body.response_format = input.outputDelivery === "url" ? "url" : "b64_json";
    }

    return { params: body, validate: generations.safe };
  },
} as const satisfies UnifiedAdapter<ImageParams, RecraftImageWire, RecraftImageResult>;
