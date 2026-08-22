/**
 * `unmodel/image` → `kling.image` (POST /v1/images/generations) **and**
 * `kling.imageOmni` (POST /v1/images/omni-image).
 *
 * # One adapter, two routes, and the ref decides
 *
 * Kling splits its image models across two endpoints with disjoint id spaces:
 * the Kolors/Kling Image family (`kling-v3` … `kling-v1`) lives on
 * `/v1/images/generations`, and the two Omni models (`kling-image-o1`,
 * `kling-v3-omni`) live on `/v1/images/omni-image`. Each route's validator is
 * scoped to its own catalog, so sending an Omni id to the first one earns an
 * `unknown_model` warning and then silently loses the 4K tier that route does
 * not have.
 *
 * A unified surface cannot ask a caller to know that. `createImage` also
 * refuses two adapters claiming the id `kling`, and rightly — a ref resolves to
 * one adapter. So this is one adapter carrying both model sets, and `compile`
 * returns whichever of the two `.safe` functions the ref selected. The kernel
 * runs the validator the adapter hands it, which is exactly the seam that makes
 * this possible without a second definition of what a valid request is.
 *
 * The routes' request shapes differ in more than their URL, and every
 * difference below is decided by that same set membership.
 *
 * # Size: a shape and a tier, never pixels
 *
 * Both routes spell size as two independent fields — `aspect_ratio` (a closed
 * enum of `"W:H"` strings) and `resolution` — and neither takes a pixel count.
 * The tier field is the happiest mapping in this repo: Kling's own values are
 * `"1k"` / `"2k"` (/ `"4k"` on Omni), which is the canonical spelling
 * character for character, so {@link toTier} is a lookup that cannot lose
 * anything.
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `aspectRatio` | `aspect_ratio` | **S1** {@link toRatioEnum} over the route's enum |
 * | `resolution` | `resolution` | **S6** {@link toTier} over the route's tiers |
 * | `dimensions` | `aspect_ratio` | {@link pixelsToRatio} — **always warns** |
 *
 * `dimensions` is the lossy one and unavoidably so: a caller who asks for
 * 1920×1080 can be given the *shape* 16:9 and nothing else, because there is no
 * field on either route that carries a pixel count. {@link pixelsToRatio} warns
 * even when the shape matches exactly, which is right — the pixels are gone
 * either way, and the equivalence "zero warnings means the request mapped
 * exactly" has to survive this case to mean anything anywhere. Beyond 2% from
 * the nearest enum member it is an error rather than a snap.
 *
 * **4K is an Omni capability.** `/v1/images/generations` publishes `1k` and
 * `2k`, full stop (its zod enum rejects anything else, and this repo's own
 * route test pins that). So `resolution: "4k"` on `kling/kling-v3` is an
 * `invalid_enum_value` naming the two tiers that route offers — never a quiet
 * downgrade to 2k, and never a quiet reroute to Omni, which is a different
 * model with a different price.
 *
 * **`"auto"` is Omni's, and only as a default.** `OMNI_IMAGE_ASPECT_RATIOS`
 * adds `"auto"` (match the first input image) to the eight shapes. It is not
 * reachable from the canonical vocabulary — there is no canonical word for
 * "whatever the reference image is" — but it *is* what the route does when
 * `aspect_ratio` is absent, so a request that names no shape sends no field and
 * gets it. Same on the other route, whose documented default is `"16:9"`.
 * Omitting a field to get the provider's documented default is not a loss and
 * does not warn.
 *
 * # `negative_prompt` exists on one route and not the other
 *
 * `/v1/images/generations` has it; `/v1/images/omni-image` does not. That makes
 * it model-dependent rather than a provider-wide gap, so it cannot be declared
 * in `unsupported` (the kernel checks that record before it knows anything
 * about the model beyond its id) and is an `unsupported_param` from `compile`
 * naming the route the caller landed on.
 *
 * # `n` is exact on both routes
 *
 * Both take `n` as a plain integer count, minimum 1, with no documented
 * ceiling — so it is a rename and nothing else. (Omni's `result_type: "series"`
 * / `series_amount` is a *different* idea — one prompt, a consistent set — and
 * mapping `n` onto it would silently change what the request means. It stays
 * reachable through `providerOptions.kling`.)
 *
 * # The declared gaps
 *
 * `seed`, `outputFormat` and `outputDelivery` have no field on either route.
 * The last one is structural rather than an omission: both routes are
 * asynchronous, answering with a task object that you poll, so there is nothing
 * for a delivery preference to change. `image_reference`, `image_fidelity`,
 * `human_fidelity`, `element_list`, `watermark_info` and the Omni series
 * controls are typed per model on {@link KLING_IMAGE_MODEL_PARAMS} and copied
 * to the wire verbatim — `result_type` on a `/generations` model is an
 * `unsupported_param` naming the two Omni ids, and vice versa.
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
import type { ResolutionTier } from "../../core/unified/vocabulary/common";
import type { ImageAdapterFor, ImageParams } from "../../core/unified/vocabulary/image";
import {
  image as imageValidator,
  KLING_IMAGE_ASPECT_RATIOS,
  KLING_IMAGE_RESOLUTIONS,
  type ImageGenerationsParams,
} from "./image";
import {
  imageOmni as omniValidator,
  OMNI_IMAGE_ASPECT_RATIOS,
  OMNI_IMAGE_RESOLUTIONS,
  type OmniImageParams,
} from "./image-omni";
import { DOCS_BASE } from "./shared";
import { KLING_IMAGE_MODEL_PARAMS, MODELS } from "./image-params";

/** The ids `POST /v1/images/omni-image` serves; everything else is the other route. */
const OMNI_MODELS: ReadonlySet<string> = new Set(["kling-image-o1", "kling-v3-omni"]);

const IMAGE_SOURCE = `${DOCS_BASE}/api/image/3-0-omni/image-generation`;
const OMNI_SOURCE = `${DOCS_BASE}/api/image/3-0-omni/image-omni`;

/** The wire body this adapter compiles to — one arm per route. */
export type KlingImageWire = ImageGenerationsParams | OmniImageParams;

/** What a unified call to `kling/…` returns — again one arm per route. */
export type KlingImageResult =
  | ReturnType<typeof imageValidator>
  | ReturnType<typeof omniValidator>;

type KlingValidate = CompiledCall<KlingImageWire, KlingImageResult>["validate"];

/**
 * The body under construction, before the route narrows it.
 *
 * Looser than either arm in exactly two places — `aspect_ratio` and
 * `resolution` are typed `string` here — because the value has already been
 * checked against *that route's* enum by {@link toRatioEnum} / {@link toTier}
 * before it lands, and the two routes publish different enums.
 */
interface KlingDraft {
  model_name: string;
  prompt: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  resolution?: string;
  n?: number;
}

/**
 * Canonical tier → this route's spelling of it.
 *
 * Built from the route's own exported enum rather than written out, so a tier
 * Kling adds shows up here the moment the endpoint module records it. The
 * identity mapping is not a coincidence to paper over: Kling genuinely names
 * its tiers `"1k"` / `"2k"` / `"4k"`.
 */
function tierTable(values: readonly string[]): Readonly<Partial<Record<ResolutionTier, string>>> {
  const table: Partial<Record<ResolutionTier, string>> = {};
  for (const value of values) table[value as ResolutionTier] = value;
  return table;
}

const IMAGE_TIERS = tierTable(KLING_IMAGE_RESOLUTIONS);
const OMNI_TIERS = tierTable(OMNI_IMAGE_RESOLUTIONS);

export const image = {
  category: "image",
  provider: "kling",
  models: MODELS,
  modelParams: KLING_IMAGE_MODEL_PARAMS,
  unsupported: {
    seed:
      "neither POST /v1/images/generations nor POST /v1/images/omni-image has a seed field, so " +
      "a seed could only be dropped; Kling's image routes are not reproducible by request.",
    outputFormat:
      "Kling's image routes publish no encoding field — the task result carries whatever format " +
      "Kling serves — so an encoding could only be dropped.",
    outputDelivery:
      "both image routes are asynchronous: they answer with a task object and you poll " +
      "GET /v1/images/{route}/{id} for the images, so there is no delivery to choose.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<KlingImageWire, KlingImageResult> {
    const omni = OMNI_MODELS.has(ctx.model);
    const ratios: readonly string[] = omni ? OMNI_IMAGE_ASPECT_RATIOS : KLING_IMAGE_ASPECT_RATIOS;
    const tiers = omni ? OMNI_TIERS : IMAGE_TIERS;
    const source = omni ? OMNI_SOURCE : IMAGE_SOURCE;

    const body: KlingDraft = { model_name: ctx.model, prompt: input.prompt };
    ctx.from(["model_name"], "model");
    ctx.from(["aspect_ratio"], "aspectRatio");
    ctx.from(["negative_prompt"], "negativePrompt");

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));

    if (sizing?.kind === "ratio") {
      const ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, ratios, { source }, { path: ["aspectRatio"], warn: ctx.warn }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio;
    } else if (sizing?.kind === "dimensions") {
      // The one genuinely lossy mapping here, and it always warns: neither
      // route has a field that carries a pixel count, so the shape is all that
      // survives. `resolution` below still carries the tier, when the caller
      // named one — the two halves are independent fields on this API.
      const wrote = sizingField(sizing);
      ctx.from(["aspect_ratio"], wrote);
      const { width, height } = sizing.dimensions;
      const ratio = ctx.take(
        pixelsToRatio(width, height, ratios, { path: [wrote], warn: ctx.warn }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio;
    }

    if (input.resolution !== undefined) {
      // Sent only when the caller asked for a tier. Both routes document a
      // default (`"1k"`), and letting the API apply its own default is not a
      // choice this translation made.
      const tier = ctx.take(
        toTier(input.resolution, tiers, { path: ["resolution"], warn: ctx.warn }),
      );
      if (tier !== undefined) body.resolution = tier;
    }

    if (input.n !== undefined) body.n = input.n;

    if (input.negativePrompt !== undefined) {
      if (omni) {
        ctx.fail({
          code: "unsupported_param",
          path: ["negativePrompt"],
          message:
            `POST /v1/images/omni-image has no \`negative_prompt\` field — it is a parameter of ` +
            `/v1/images/generations only, so "${ctx.model}" cannot be told what to avoid except ` +
            `inside \`prompt\`.`,
          meta: { value: input.negativePrompt, source: OMNI_SOURCE },
        });
      } else {
        body.negative_prompt = input.negativePrompt;
      }
    }

    applyExtras(input, KLING_IMAGE_MODEL_PARAMS, body, ctx);

    return {
      params: body as KlingImageWire,
      // One cast, at the one place the two routes meet: each validator takes
      // its own arm of the union, and the ref decided which arm `body` is.
      validate: (omni ? omniValidator.safe : imageValidator.safe) as KlingValidate,
    };
  },
} as const satisfies ImageAdapterFor<
  typeof KLING_IMAGE_MODEL_PARAMS,
  KlingImageWire,
  KlingImageResult
>;
