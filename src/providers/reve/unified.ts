/**
 * `unmodel/image` → `reve.image` (POST /v1/image/create) **and**
 * `reve.imageV2` (POST /v2/image/create).
 *
 * # One adapter, two endpoints
 *
 * Reve does not select a model with a `model` field; it selects one with a
 * `version` string, and each *route* accepts its own short list of them. Two
 * of those routes generate an image from a prompt, so both belong to this
 * category — and the kernel allows exactly one adapter per provider id, because
 * a ref can only resolve to one. So this file carries both model sets and
 * chooses the validator inside `compile`, which is precisely the freedom
 * `CompiledCall` was designed to leave open: it pairs a body with the function
 * that checks it, and nothing says every call has to name the same function.
 *
 * | ref | route | wire `version` | price |
 * |---|---|---|---|
 * | `reve/reve-create@20250915` | `POST /v1/image/create` | the id itself | 18 credits ≈ $0.024 |
 * | `reve/reve-v2-create` | `POST /v2/image/create` | `"latest"` | 150 credits ≈ $0.20 |
 *
 * `reve-v2-create` is a **pseudo-id**: Reve publishes no model string for the
 * v2 route and documents exactly one alias for it (`"latest"`), so `./models.ts`
 * invents an id for the catalog row and this adapter translates it back to the
 * alias. That is a naming translation, not an approximation — the ref and the
 * alias name the same thing — so it does not warn. The v1 id, by contrast, *is*
 * a documented dated version string and goes on the wire verbatim, which is
 * what pins it: `latest` moves when Reve ships a new model, `reve-create@20250915`
 * does not.
 *
 * Anything else routes to v2. It has already drawn an `unknown_model` warning,
 * and v2 is the flagship — the arm a model released after this snapshot is
 * likeliest to be.
 *
 * # The two routes have different aspect-ratio vocabularies
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `aspectRatio` (v1) | `aspect_ratio` | **S1** — the 7-value legacy subset |
 * | `aspectRatio` (v2) | `aspect_ratio` | **S1** — 17 ratios plus `auto` |
 * | `dimensions` | `aspect_ratio` | lossy: pixels → the nearest offered shape, always warned |
 *
 * "The v1 endpoints intentionally document and accept only the smaller legacy
 * subset", so `21:9` is an exact map on `reve-v2-create` and an
 * `invalid_enum_value` on `reve-create@20250915` — naming the seven ratios v1
 * has and (through the provider's own `checkAspectRatio` note) pointing at v2.
 * Getting this wrong in either direction is the reason the route decision is
 * made once, at the top of `compile`, and the ratio list is read off it.
 *
 * Both fields are optional with documented defaults (`3:2` on v1, `auto` on
 * v2), so a request that names no shape sends none.
 *
 * # There is no size field anywhere on either route
 *
 * Neither body has `width`, `height`, `resolution` or `size`: you get whatever
 * the model produces at the aspect ratio you asked for. `REVE_MAX_IMAGE_DIMENSION`
 * (8192) is not a counterexample — it is an **input** limit, enforced by
 * `checkImageBudget` against the base64 reference images in `references`, and
 * has nothing to say about output size.
 *
 * So `resolution` is a declared gap. The closest thing Reve offers is a paid
 * post-op (`postprocessing: [{ process: "upscale", upscale_factor: 2 }]`),
 * which is a different operation billed per megapixel of output — offering it
 * as a translation of `resolution: "2k"` would be inventing both a cost and a
 * pipeline the caller never asked for. `dimensions` is *not* a declared gap:
 * pixels still carry a shape, and `pixelsToRatio` maps that at the cost of a
 * warning that says exactly what was thrown away.
 *
 * # Delivery and format
 *
 * `outputFormat` has no body field on either route, and the two ways Reve lets
 * you choose an encoding are both outside a request body's vocabulary: v1 keys
 * it off the `Accept` **header** (the endpoint module deliberately sets only
 * `content-type`, leaving that choice to the caller), and v2 offers
 * `async.image_format` — which also switches the call into background mode and
 * hands back a `result_url` to poll instead of an image. Silently turning
 * `outputFormat: "webp"` into a different *kind of call* is not a translation,
 * so it is declared as a gap with both escape routes named.
 *
 * `outputDelivery` is handled in `compile` rather than declared, because half
 * of it is free: both routes answer with the image inline, so `"base64"` is
 * exactly what they do and costs nothing to ask for. `"url"` is the half that
 * cannot be served — it needs `async.public: true` *and* an `image/*` format,
 * i.e. the same background mode again.
 *
 * `n`, `seed` and `negativePrompt` have no field on either route at all.
 */
import {
  applyExtras,
  pixelsToRatio,
  resolveSizing,
  sizingField,
  toRatioEnum,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { ImageAdapterFor, ImageParams } from "../../core/unified/vocabulary/image";
import { image as createV1 } from "./image";
import { imageV2 as createV2 } from "./image-v2";
import { REVE_DOCS_URL, REVE_V1_ASPECT_RATIOS, REVE_V2_ASPECT_RATIOS } from "./shared";
import { MODELS, REVE_IMAGE_MODEL_PARAMS } from "./image-params";

/**
 * The ids that compile to `POST /v1/image/create`.
 *
 * A set of one, and a set rather than an equality test because the next dated
 * v1 create string is where it would go. Everything else — including an id this
 * snapshot does not know — compiles to v2.
 */
const V1_MODELS: ReadonlySet<string> = new Set(["reve-create@20250915"]);

/**
 * The only `version` alias `POST /v2/image/create` documents. `resolveReveVersion`
 * maps it back to the `reve-v2-create` catalog row, so the price is exact.
 */
const V2_VERSION = "latest";

/**
 * The wire body this adapter compiles to — the three keys it writes, on either
 * route.
 *
 * `aspect_ratio` is `string` rather than `ReveV1AspectRatio | ReveV2AspectRatio`
 * because which enum applies is a property of the route, not of this type, and
 * the route's own `checkAspectRatio` is what enforces it (with the exact list
 * and the "the wide/tall ratios are v2-only" note attached). The exact unions
 * stay exported from `./image` and `./image-v2` for hand-written calls, where a
 * literal can be checked at the call site.
 */
export interface ReveImageWire {
  prompt: string;
  /** One of `REVE_V1_ASPECT_RATIOS` on v1, `REVE_V2_ASPECT_RATIOS` on v2. */
  aspect_ratio?: string;
  /** The dated version string on v1; `"latest"` on v2. */
  version?: string;
}

/**
 * What a unified image call to `reve/…` returns — a union, because the two
 * routes are two endpoints with two `Validated` shapes and two `.request.url`s.
 * Narrow on `.request.url` (or just read the body, which is the same three
 * keys either way).
 */
export type ReveImageResult = ReturnType<typeof createV1> | ReturnType<typeof createV2>;

export const image = {
  category: "image",
  provider: "reve",
  models: MODELS,
  modelParams: REVE_IMAGE_MODEL_PARAMS,
  unsupported: {
    n:
      "Neither /v1/image/create nor /v2/image/create has a count field — Reve generates one " +
      "image per request; issue N requests to get N images.",
    seed:
      "Neither /v1/image/create nor /v2/image/create has a seed field, so a seed could only " +
      "be dropped. Reve output on these routes is not reproducible.",
    negativePrompt:
      "Neither /v1/image/create nor /v2/image/create has a negative-prompt field; describe " +
      "what to avoid inside `prompt` instead (v1 notes that the prompt is \"automatically " +
      "enhanced by the model\").",
    resolution:
      "Reve sizes by shape alone: neither route has a width, height, resolution or size " +
      "field, and you get whatever the model produces at the requested `aspect_ratio`. The " +
      "8192-pixel limit in the docs is an INPUT limit on reference images, not an output " +
      "size. `postprocessing: [{ process: \"upscale\", upscale_factor: 2 }]` via " +
      "`providerOptions.reve` is a separate, separately-billed operation — not a resolution.",
    outputFormat:
      "Neither route has an output-format body field. On v1 the encoding is chosen with the " +
      "`Accept` request header (`image/png` / `image/jpeg` / `image/webp`), which unmodel " +
      "leaves to you — it sets only `content-type`. On v2 the nearest field is " +
      "`async.image_format`, which also switches the call into background mode and returns a " +
      "`result_url` to poll instead of an image; send it through `providerOptions.reve` if " +
      "that is what you want.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<ReveImageWire, ReveImageResult> {
    const v1 = V1_MODELS.has(ctx.model);
    const ratios = v1 ? REVE_V1_ASPECT_RATIOS : REVE_V2_ASPECT_RATIOS;

    const body: ReveImageWire = { prompt: input.prompt };
    ctx.from(["aspect_ratio"], "aspectRatio");
    // `version` is where the ref's model half lands: an issue Reve raises about
    // it is an issue about the model the caller named, and saying so beats
    // pointing at a field this vocabulary does not have.
    ctx.from(["version"], "model");
    body.version = v1 ? ctx.model : V2_VERSION;

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));

    if (sizing?.kind === "ratio") {
      const ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, ratios, { source: REVE_DOCS_URL }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio;
    } else if (sizing?.kind === "dimensions") {
      // No pixel field on either route: the size is thrown away and only the
      // shape survives, so `pixelsToRatio` warns even on an exact match — what
      // was lost is the pixel count, not the ratio.
      const wrote = sizingField(sizing);
      ctx.from(["aspect_ratio"], wrote);
      const ratio = ctx.take(
        pixelsToRatio(sizing.dimensions.width, sizing.dimensions.height, ratios, {
          path: [wrote],
          warn: ctx.warn,
        }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio;
    }

    if (input.outputDelivery !== undefined && input.outputDelivery !== "base64") {
      // No `ctx.from`: nothing is emitted for delivery on either branch, and a
      // provenance rule for a wire key this adapter never writes would steal
      // the path from a caller who reached `async` through `providerOptions`.
      ctx.fail({
        code: "unsupported_param",
        path: ["outputDelivery"],
        message: v1
          ? "POST /v1/image/create answers synchronously with the image base64-encoded in " +
            "`image` (or raw bytes, if you set an `image/*` `Accept` header). There is no URL " +
            "delivery on the v1 route at all."
          : "POST /v2/image/create answers synchronously with the image inline. A signed URL " +
            "exists only in background mode — `async: { public: true, image_format: \"image/png\" }`, " +
            "which returns a 202 and a `result_url` to poll rather than an image. Send that " +
            "through `providerOptions.reve` if you want it.",
        meta: { value: input.outputDelivery, source: REVE_DOCS_URL },
      });
    }

    // One `CompiledCall` type, two endpoints. `createV1.safe` and
    // `createV2.safe` have different *closed* param types — `"21:9"` is a v2
    // ratio and not a v1 one — so no single `Wire` is assignable to both, and
    // this assertion is what lets one adapter carry both model sets, which is
    // the kernel's rule: a ref resolves to one provider, and a provider has one
    // adapter. Nothing is wrapped and nothing is re-validated: what comes back
    // is the provider's own `.safe`, handed the body compiled for its own route
    // by the same `v1` decision that chose the ratio list.
    applyExtras(input, REVE_IMAGE_MODEL_PARAMS, body, ctx);

    return {
      params: body,
      validate: v1 ? createV1.safe : createV2.safe,
    } as unknown as CompiledCall<ReveImageWire, ReveImageResult>;
  },
} as const satisfies ImageAdapterFor<
  typeof REVE_IMAGE_MODEL_PARAMS,
  ReveImageWire,
  ReveImageResult
>;
