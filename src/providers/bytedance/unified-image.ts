/**
 * `unmodel/image` → `bytedance.image` (POST /api/v3/images/generations, the
 * BytePlus ModelArk Seedream route).
 *
 * # The size vocabulary, which is the whole adapter
 *
 * `size` is one field with two grammars, and which of the two a model accepts
 * is not a per-model *choice* — both are always legal — but which values are
 * legal in each grammar is entirely per model:
 *
 * | grammar | looks like | narrowed by |
 * |---|---|---|
 * | resolution keyword | `"1K"`, `"1.5K"`, `"2K"`, `"3K"`, `"4K"` | `imageShapeRules[model].sizeKeywords` |
 * | free-form pixels | `"2730x1536"` | `imageShapeRules[model]` total-pixel range + the global [1/16, 16] aspect range |
 *
 * So the canonical size decision lands in three different places depending on
 * what the caller actually said, and each is a different derivation class:
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `resolution` alone | `size: "2K"` | **S6** {@link toTier} over this model's keywords |
 * | `aspectRatio` + `resolution` | `size: "2730x1536"` | **S4** {@link toSizeFreeform} |
 * | `dimensions` | `size: "1920x1080"` | verbatim |
 *
 * ## Why the free-form path is gated on the *keyword* table
 *
 * A model's keyword list and its total-pixel range are two spellings of one
 * capability: Seedream 5.0 lite offers `2K`/`3K`/`4K` **because** its floor is
 * 3,686,400 px, and Seedream 5.0 pro stops at `2K` **because** its ceiling is
 * 4,624,220 px. A canonical tier the keyword table has no entry for is
 * therefore a tier no free-form size could reach either, and saying so through
 * {@link toTier} — "`resolution` must be one of "2k", "4k" for this model" —
 * is a message a caller can act on. Letting the pixels through and waiting for
 * `checkSize` to answer with "1048576 pixels; this model accepts 3686400–…"
 * would be technically identical and practically useless.
 *
 * The consequence worth stating out loud: on Seedream 4.5 and 5.0 lite,
 * `{ aspectRatio: "16:9" }` with **no** `resolution` is an error, because the
 * canonical default tier is `1k` and those models have no 1K. That is the
 * honest reading — they genuinely cannot make a one-megapixel image.
 *
 * ## Why the free-form rules carry no grid and no per-side bounds
 *
 * ModelArk documents neither. It bounds `size` by *total* pixels and by aspect
 * ratio, and {@link FreeformRules} has no way to say "total". Inventing a
 * per-side floor would reject sizes the API accepts; inventing a grid would
 * move pixels the caller asked for. So the rules are `{ grid: 1 }`, the
 * arithmetic is exact, and a size outside the model's range is rejected by
 * `checkSize` — the same check a hand-written call meets — with the kernel
 * remapping it onto `aspectRatio` or `dimensions`.
 *
 * # `response_format` vs `output_format` — they are different questions
 *
 * ModelArk carries both, and the names are close enough to be a trap:
 *
 * - **`response_format`** is `"url" | "b64_json"` — *how the bytes reach you*.
 *   That is canonical `outputDelivery`, and every documented model has it.
 * - **`output_format`** is `"png" | "jpeg"` — *how the image is encoded*. That
 *   is canonical `outputFormat`, and only Seedream 5.0 pro and 5.0 lite have
 *   it; 4.5 and 4.0 always return JPEG and deny the param.
 *
 * The deny rule and the enum list already say all of that, per model, in
 * `constraints.ts`, so the adapter sends the value and lets those tables
 * answer — the error a caller gets for `outputFormat` on Seedream 4.0 is
 * ModelArk's own wording, remapped onto the word they wrote. The one case the
 * tables cannot answer is canonical `"webp"`, which no Seedream model encodes;
 * that is an `invalid_enum_value` from here, naming the two that exist.
 *
 * # `n` is a ceiling here, not a count
 *
 * There is no `n` on this API. A batch is `sequential_image_generation:
 * "auto"` plus `sequential_image_generation_options.max_images`, and the docs
 * are explicit that `auto` lets *the model* decide whether to return a group —
 * `max_images` is "value range [1, 15]", an upper bound, not a quantity. So:
 *
 * - `n: 1` maps **exactly** and emits nothing: `sequential_image_generation`
 *   defaults to `"disabled"`, which is one image.
 * - `n > 1` maps **approximately** and warns, naming the bound that was sent.
 * - `n > 1` on Seedream 5.0 pro is an error: that model denies the whole
 *   sequential family, so it makes exactly one image per request.
 *
 * # The declared gaps
 *
 * `seed` and `negativePrompt` have no field on this endpoint at all. The
 * module says so directly ("on the current API, no `seed` and no
 * `guidance_scale` — those were Seedream 3.0-era params"), and a param that
 * would earn an `unknown_param` warning if it were passed through is a param
 * that must be refused instead.
 *
 * `watermark`, `background`, `layer_decomposition`,
 * `optimize_prompt_options` and the sequential-batch pair are ModelArk's own
 * knobs rather than canonical words, and are typed per model on
 * {@link BYTEDANCE_IMAGE_MODEL_PARAMS} — `background` on anything but Seedream
 * 5.0 pro is an `unsupported_param` naming the model that does take it.
 * `stream` stays out entirely: it changes how the response is *delivered*, not
 * what is generated, and `providerOptions.bytedance` reaches it.
 */
import {
  applyExtras,
  redundantTier,
  resolveSizing,
  sizeRules,
  sizingField,
  toSizeFreeform,
  toTier,
  type FreeformRules,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { ResolutionTier } from "../../core/unified/vocabulary/common";
import type { ImageAdapterFor, ImageParams } from "../../core/unified/vocabulary/image";
import { IMAGE_API_SOURCE, imageConstraints, imageShapeRules } from "./constraints";
import { image as imageValidator } from "./image";
import { BYTEDANCE_IMAGE_MODEL_PARAMS, MODELS } from "./image-params";

/** The wire body this adapter compiles to — the loose arm of `ImageGenerationsBody`. */
export interface BytedanceImageWire {
  model: string;
  prompt: string;
  size?: string;
  response_format?: "url" | "b64_json";
  output_format?: "png" | "jpeg";
  sequential_image_generation?: "auto" | "disabled";
  sequential_image_generation_options?: { max_images?: number };
  [key: string]: unknown;
}

/** What a unified call to `bytedance/…` returns: `bytedance.image`'s `Validated`. */
export type BytedanceImageResult = ReturnType<typeof imageValidator>;

/**
 * Canonical tier → the keyword ModelArk spells it with.
 *
 * Only three of the five documented keywords are reachable from the canonical
 * vocabulary: `"1.5K"` (Seedream 5.0 pro) and `"3K"` (Seedream 5.0 lite) sit
 * between tiers, and inventing canonical names for them would put two words in
 * every provider's mouth to serve one. They stay reachable through
 * `providerOptions.bytedance.size`.
 */
const KEYWORD_BY_TIER: Readonly<Record<ResolutionTier, string>> = {
  "1k": "1K",
  "2k": "2K",
  "4k": "4K",
};

/**
 * Free-form `size` rules. No grid and no per-side bounds — see the module
 * note; the total-pixel range is `checkSize`'s job and stays there.
 */
const FREEFORM: FreeformRules = { grid: 1, source: IMAGE_API_SOURCE };

/** Every tier a model's `size` keyword list actually offers. */
function tiersFor(model: string): Readonly<Partial<Record<ResolutionTier, string>>> {
  const rule = imageShapeRules[model];
  // An id with no shape rule is either brand new or an Endpoint ID (`ep-…`);
  // either way the kernel has already warned `unknown_model`, and gating it
  // against a table that does not describe it would be a guess.
  if (rule === undefined) return KEYWORD_BY_TIER;
  const offered: Partial<Record<ResolutionTier, string>> = {};
  for (const [tier, keyword] of Object.entries(KEYWORD_BY_TIER) as [ResolutionTier, string][]) {
    if (rule.sizeKeywords.includes(keyword as never)) offered[tier] = keyword;
  }
  return offered;
}

/** True when this model's constraint table denies the batch family outright. */
function deniesSequential(model: string): boolean {
  return imageConstraints[model]?.deny?.["sequential_image_generation"] !== undefined;
}

export const image = {
  category: "image",
  provider: "bytedance",
  models: MODELS,
  modelParams: BYTEDANCE_IMAGE_MODEL_PARAMS,
  unsupported: {
    seed:
      "POST /api/v3/images/generations has no seed field on the current API — `seed` was a " +
      "Seedream 3.0-era param and is no longer documented on this endpoint, so it would reach " +
      "ModelArk as an unknown key and be dropped.",
    negativePrompt:
      "POST /api/v3/images/generations has no negative-prompt field; describe what to avoid " +
      "inside `prompt`, or steer it with `optimize_prompt_options` via `providerOptions.bytedance`.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<BytedanceImageWire, BytedanceImageResult> {
    const body: BytedanceImageWire = { model: ctx.model, prompt: input.prompt };
    ctx.from(["size"], "aspectRatio");
    ctx.from(["response_format"], "outputDelivery");
    ctx.from(["output_format"], "outputFormat");

    const sizing = ctx.take(
      resolveSizing(
        input,
        { path: ["aspectRatio"], warn: ctx.warn },
        sizeRules(BYTEDANCE_IMAGE_MODEL_PARAMS, ctx.model),
      ),
    );
    const tier = input.resolution ?? "1k";
    const tiers = tiersFor(ctx.model);

    if (sizing?.kind === "size") {
      // A resolution keyword — `"1K"`, `"1.5K"`, `"3K"`. `resolveSizing` has
      // already checked it against this model's declared list, and a tier
      // beside it would be a second answer to the same question.
      if (input.resolution !== undefined) {
        ctx.take(
          redundantTier(input.resolution, { path: ["resolution"], warn: ctx.warn }, "size"),
        );
      }
      ctx.from(["size"], "size");
      body.size = sizing.size;
    } else if (sizing?.kind === "ratio") {
      // The tier gate first, for the message — see the module note. Its value
      // is the keyword, which the free-form arm does not want; what it is
      // being asked is whether this model reaches this tier at all.
      const reachable = ctx.take(toTier(tier, tiers, { path: ["resolution"], warn: ctx.warn }));
      if (reachable !== undefined) {
        const size = ctx.take(
          toSizeFreeform(sizing.aspectRatio, tier, FREEFORM, {
            path: ["aspectRatio"],
            warn: ctx.warn,
          }),
        );
        if (size !== undefined) body.size = size;
      }
    } else if (sizing?.kind === "dimensions") {
      // Verbatim, and deliberately ungated: `dimensions` names the pixels, and
      // the pixels are what `size` takes. A pair outside this model's
      // total-pixel range or the [1/16, 16] aspect range is rejected by
      // `checkSize` — the same check a hand-written call meets — and the
      // kernel remaps that error onto `dimensions`.
      // A tier alongside the pixels is refused rather than dropped: `size`
      // here IS the pixel count, so the two can only agree or contradict.
      if (input.resolution !== undefined) {
        ctx.take(
          redundantTier(
            input.resolution,
            { path: ["resolution"], warn: ctx.warn },
            sizingField(sizing) === "size" ? "size" : "dimensions",
          ),
        );
      }
      ctx.from(["size"], sizingField(sizing));
      body.size = sizing.size ?? `${sizing.dimensions.width}x${sizing.dimensions.height}`;
    } else if (input.resolution !== undefined) {
      const keyword = ctx.take(toTier(tier, tiers, { path: ["resolution"], warn: ctx.warn }));
      if (keyword !== undefined) {
        ctx.from(["size"], "resolution");
        body.size = keyword;
      }
    }

    if (input.n !== undefined) {
      ctx.from(["sequential_image_generation_options", "max_images"], "n");
      if (input.n === 1) {
        // Exact, and nothing to send: `sequential_image_generation` defaults to
        // `"disabled"`, which is one image per request on every model.
      } else if (deniesSequential(ctx.model)) {
        ctx.fail({
          code: "unsupported_param",
          path: ["n"],
          message:
            `"${ctx.model}" denies the sequential-image family, so it generates one image per ` +
            `request; issue ${input.n} requests to get ${input.n} images.`,
          meta: { value: input.n, source: IMAGE_API_SOURCE },
        });
      } else {
        body.sequential_image_generation = "auto";
        body.sequential_image_generation_options = { max_images: input.n };
        ctx.warn({
          code: "approximated_param",
          path: ["n"],
          message:
            `\`n\` ${input.n} was sent as \`sequential_image_generation: "auto"\` with ` +
            `\`max_images: ${input.n}\` — ModelArk has no exact image count, and "auto" lets the ` +
            `model decide how many of the ${input.n} to return, so ${input.n} is a ceiling.`,
          meta: { requested: input.n, achieved: { max_images: input.n }, source: IMAGE_API_SOURCE },
        });
      }
    }

    if (input.outputFormat !== undefined) {
      if (input.outputFormat === "webp") {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["outputFormat"],
          message:
            "`output_format` on this API encodes PNG or JPEG only; no Seedream model returns " +
            "WebP, so the encoding could only be substituted.",
          meta: { allowed: ["png", "jpeg"], value: input.outputFormat, source: IMAGE_API_SOURCE },
        });
      } else {
        // Sent unconditionally: Seedream 4.5 / 4.0 deny the param with a
        // reason of their own ("this model always returns jpeg"), which is a
        // better message than one written here and cannot drift from the table
        // the hand-written path is checked against.
        body.output_format = input.outputFormat;
      }
    }

    if (input.outputDelivery !== undefined) {
      // Both arms exist on every documented model, and URLs are "valid for 24
      // hours" — worth knowing, not worth a warning: it is what the API does,
      // not something this translation chose.
      body.response_format = input.outputDelivery === "url" ? "url" : "b64_json";
    }

    applyExtras(input, BYTEDANCE_IMAGE_MODEL_PARAMS, body, ctx);

    return { params: body, validate: imageValidator.safe };
  },
} as const satisfies ImageAdapterFor<
  typeof BYTEDANCE_IMAGE_MODEL_PARAMS,
  BytedanceImageWire,
  BytedanceImageResult
>;
