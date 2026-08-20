/**
 * `unmodel/image` → `vidu.imageFromReference`
 * (POST https://api.vidu.com/ent/v2/reference2image).
 *
 * # The endpoint is a reference-to-image route, and that is the whole story
 *
 * Vidu has exactly one still-image route and it is called *reference to
 * image*: `{ model, prompt, images?, seed?, aspect_ratio?, resolution? }`. The
 * `images` array is 0–7 URLs or data URIs of reference pictures the model
 * should carry forward — a character, a product, a style — and the canonical
 * `image()` vocabulary has no word for any of that, by design: references are
 * `unmodel/image-edit`'s business, not this surface's.
 *
 * What saves the mapping is that the reference list is **not uniformly
 * required**. `checkModelRules` in `./image-from-reference.ts` enforces
 * `IMAGE_COUNTS`, and those bands differ:
 *
 * | model | `images` | what a prompt-only request is |
 * |---|---|---|
 * | `viduq2` | 0–7 | plain text-to-image — a complete, valid request |
 * | `viduq1` | 1–7 | incomplete: the route rejects a reference-less call |
 *
 * So `vidu/viduq2` is an ordinary text-to-image model on this surface and
 * compiles with nothing missing and nothing lost, while `vidu/viduq1` genuinely
 * cannot be expressed by prompt + shape + tier alone.
 *
 * ## The honest choice for viduq1, and why it is this one
 *
 * The gap is declared **up front**, with a `ctx.fail` that names
 * `providerOptions.vidu.images` and shows the shape — but only when that escape
 * hatch was not used. Both halves of that sentence are load-bearing:
 *
 * - Declaring it up front beats letting the provider's own validator speak.
 *   Its message ("`images` accepts 1–7 reference images for \"viduq1\"; got 0")
 *   is accurate, but it names a wire param this vocabulary does not have and
 *   says nothing about how to supply one from a unified call. A caller who
 *   never opened `image-from-reference.ts` is left guessing.
 * - Gating on `providerOptions` is what keeps the escape hatch working. The
 *   kernel deep-merges `providerOptions[provider]` over the compiled body
 *   **after** compile and **before** validation, and it abandons the request if
 *   compile reported an error — so an unconditional `ctx.fail` would make
 *   `viduq1` unreachable even for a caller who did everything right. Reading
 *   `input.providerOptions.vidu` here is not a peek behind the curtain: it is
 *   part of `ImageParams`, the kernel hands `compile` the whole request object,
 *   and the question this adapter is answering — "will the merged body have a
 *   reference list?" — cannot be answered without it.
 *
 * The adapter never *invents* an `images` entry, and never quietly rewrites a
 * `viduq1` request into a `viduq2` one. Both would be substitutions the caller
 * did not ask for, and the second one changes the price.
 *
 * # Size: a shape and a tier, both closed and both per-model
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `aspectRatio` | `aspect_ratio` | **S1** — a closed enum, wider on `viduq2` |
 * | `resolution` | `resolution` | **S6** — `"1080p"` / `"2K"` / `"4K"`, `viduq1` has only the first |
 * | `dimensions` | `aspect_ratio` | lossy: pixels → the nearest offered shape, always warned |
 *
 * `IMAGE_ASPECT_RATIOS` and `IMAGE_RESOLUTIONS` are per-model maps in the
 * endpoint module, so both tables here are *derived* from them rather than
 * retyped — a ratio Vidu adds to `viduq2` reaches this adapter the moment it
 * reaches the validator, and the two can never disagree about what `viduq1`
 * accepts.
 *
 * The tier names deserve a note. Vidu spells its base tier `"1080p"` where most
 * providers spell it `"1K"`, and `"2K"` / `"4K"` with a capital K that is *not*
 * the video routes' `ViduResolution` space. `toTier` is a naming map and does
 * not warn: `resolution: "1k"` asks for the smallest tier this model offers and
 * `"1080p"` is what Vidu calls it. Asking for `2k` or `4k` on `viduq1` is an
 * `invalid_enum_value` naming the one tier it has — never a quiet downgrade.
 *
 * Both wire fields are optional and Vidu documents its own defaults (`16:9`,
 * `1080p`), so a request that names neither sends neither. That is exact: the
 * caller expressed no preference, and pinning Vidu's default into the body
 * would be this adapter choosing a value on their behalf.
 *
 * # What this route simply does not have
 *
 * No count field, no negative prompt, no output-format field, and no way to ask
 * for a URL or for bytes — the POST answers with a task object and the image
 * arrives through the Get Generation API or `callback_url`, which is transport
 * and out of unmodel's scope. All four are declared gaps, so the kernel reports
 * them uniformly before this file runs.
 *
 * `seed` is the one plain rename-free pass-through: same name, same meaning,
 * no `ctx.from`.
 */
import {
  pixelsToRatio,
  resolveSizing,
  sizingField,
  toRatioEnum,
  toTier,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { ResolutionTier } from "../../core/unified/vocabulary/common";
import type {
  ImageAdapterFor,
  ImageParams,
  ModelParamTable,
} from "../../core/unified/vocabulary/image";
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_COUNTS,
  IMAGE_RESOLUTIONS,
  imageFromReference as validator,
  type ViduImageAspectRatio,
  type ViduImageResolution,
} from "./image-from-reference";
import { DOCS_BASE } from "./shared";

/**
 * The two ids `POST /ent/v2/reference2image` accepts — `imageModels` in
 * `./models.ts`, which is the route-scoped catalog the validator itself uses.
 * Vidu's other nine models are video-only and warn as `unknown_model` here.
 */
const MODELS = ["viduq2", "viduq1"] as const;

/**
 * The two models' per-model surface.
 *
 * `ratios` is each model's `IMAGE_ASPECT_RATIOS` row **minus `"auto"`** — a
 * Vidu keyword meaning "read the shape off the reference images", not a shape
 * — and `tiers` is the canonical half of `IMAGE_RESOLUTIONS`: viduq1 publishes
 * `["1080p"]` and viduq2 adds `2K` and `4K`, which is exactly the difference
 * between the two rows below. No `sizes`: this route has no pixel field, so
 * `size` types as `never` and still runs through `pixelsToRatio`.
 *
 * No extras — every other field on `Reference2ImageParams` is either canonical
 * (`prompt`, `seed`) or `images`, whose reference payload has no canonical
 * word yet and rides through `providerOptions.vidu`.
 */
const VIDU_IMAGE_MODEL_PARAMS = {
  viduq2: {
    ratios: ["16:9", "9:16", "1:1", "3:4", "4:3", "21:9", "2:3", "3:2"],
    tiers: ["1k", "2k", "4k"],
  },
  viduq1: {
    ratios: ["16:9", "9:16", "1:1", "3:4", "4:3"],
    tiers: ["1k"],
  },
} as const satisfies ModelParamTable;

const SOURCE = `${DOCS_BASE}/reference-to-image`;

/** The models whose `IMAGE_*` tables this file may index. */
type ViduImageModel = keyof typeof IMAGE_ASPECT_RATIOS;

/**
 * Canonical tier → Vidu's spelling of it, for the tiers Vidu names at all.
 *
 * Only the *spellings* live here; which of them a given model offers is read
 * off `IMAGE_RESOLUTIONS` by {@link tierTable}, so this file cannot claim a
 * tier the endpoint module does not.
 */
const TIER_NAMES: Readonly<Record<ResolutionTier, ViduImageResolution>> = {
  "1k": "1080p",
  "2k": "2K",
  "4k": "4K",
};

/**
 * The tiers one model actually offers, as a {@link toTier} table.
 *
 * An id neither table knows has already drawn an `unknown_model` warning, so it
 * is compiled against `viduq2` — the current generation and the wider of the
 * two, which is the arm a model released after this snapshot is likeliest to
 * resemble.
 */
function tierTable(model: string): Readonly<Partial<Record<ResolutionTier, ViduImageResolution>>> {
  const offered: readonly string[] =
    IMAGE_RESOLUTIONS[model as ViduImageModel] ?? IMAGE_RESOLUTIONS.viduq2;
  const table: Partial<Record<ResolutionTier, ViduImageResolution>> = {};
  for (const tier of Object.keys(TIER_NAMES) as ResolutionTier[]) {
    const name = TIER_NAMES[tier];
    if (offered.includes(name)) table[tier] = name;
  }
  return table;
}

/** The `aspect_ratio` enum for one model, same fallback rule as above. */
function ratiosFor(model: string): readonly ViduImageAspectRatio[] {
  return IMAGE_ASPECT_RATIOS[model as ViduImageModel] ?? IMAGE_ASPECT_RATIOS.viduq2;
}

/** `providerOptions.vidu.images`, exactly as the caller wrote it. */
function referencesVia(input: ImageParams): unknown {
  return input.providerOptions?.["vidu"]?.["images"];
}

/**
 * The wire body this adapter compiles to.
 *
 * The two enums are the endpoint module's own closed unions rather than
 * `string`: `Reference2ImageParams` spells them that way, `ExactKeys` compares
 * the two key sets directly, and every value written below provably comes out
 * of the very list the field is typed by.
 */
export interface ViduImageWire {
  model: string;
  prompt: string;
  /** 0–7 on viduq2, 1–7 on viduq1. Never written here; rides through `providerOptions`. */
  images?: string[];
  seed?: number;
  aspect_ratio?: ViduImageAspectRatio;
  resolution?: ViduImageResolution;
}

/** What a unified image call to `vidu/…` returns: `vidu.imageFromReference`'s `Validated`. */
export type ViduImageResult = ReturnType<typeof validator>;

export const image = {
  category: "image",
  provider: "vidu",
  models: MODELS,
  modelParams: VIDU_IMAGE_MODEL_PARAMS,
  unsupported: {
    n:
      "POST /ent/v2/reference2image has no count field — Vidu generates one image per " +
      "request; issue N requests to get N images.",
    negativePrompt:
      "POST /ent/v2/reference2image has no negative-prompt field; describe what to avoid " +
      "inside `prompt` instead.",
    outputFormat:
      "POST /ent/v2/reference2image has no output-format field — the route answers with a " +
      "task object and the encoding of the finished image is Vidu's to choose, so a format " +
      "could only be dropped.",
    outputDelivery:
      "POST /ent/v2/reference2image is asynchronous: it answers with `{ task_id, state, … }` " +
      "and the image arrives from the Get Generation API or your `callback_url`. There is no " +
      "delivery to choose, and both of those are transport rather than request params.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<ViduImageWire, ViduImageResult> {
    const body: ViduImageWire = { model: ctx.model, prompt: input.prompt };
    ctx.from(["aspect_ratio"], "aspectRatio");

    // viduq1's reference list is required (IMAGE_COUNTS.viduq1.min === 1) and
    // this vocabulary has no way to say it. Reported here rather than left to
    // the provider's own check so the message can name the escape hatch — and
    // skipped when that hatch was used, because a compile error would stop the
    // request before the merge that fixes it.
    const band = IMAGE_COUNTS[ctx.model as ViduImageModel];
    if (band !== undefined && band.min > 0 && referencesVia(input) === undefined) {
      ctx.fail({
        // `unsupported_capability` at `model`, not `unsupported_param` at some
        // field: nothing the caller wrote is wrong, and there is no canonical
        // param to point at. What cannot be done is *this model*, from *this
        // vocabulary*, and both halves of the fix are a change to the ref or a
        // block of `providerOptions`.
        code: "unsupported_capability",
        path: ["model"],
        message:
          `"${ctx.model}" is a reference-to-image model: \`images\` takes ${band.min}–${band.max} ` +
          "reference pictures and the route rejects a call without them, but `image()` has no " +
          "canonical word for a reference. Send them through the escape hatch — " +
          '`providerOptions: { vidu: { images: ["https://…/character.png"] } }` — or use ' +
          '"vidu/viduq2", which accepts 0 references and is a plain text-to-image model.',
        meta: { min: band.min, max: band.max, source: SOURCE },
      });
    }

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    const ratios = ratiosFor(ctx.model);

    if (sizing?.kind === "ratio") {
      // `toRatioEnum` returns a member of the list it was handed, and the list
      // handed to it IS this model's row of `IMAGE_ASPECT_RATIOS` — so the
      // narrowing is a fact about the call, not an assumption about the value.
      const ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, ratios, { source: SOURCE }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      ) as ViduImageAspectRatio | undefined;
      if (ratio !== undefined) body.aspect_ratio = ratio;
    } else if (sizing?.kind === "dimensions") {
      // There is no pixel field on this route, so exact dimensions cannot
      // survive: the size is thrown away and only the shape is sent.
      // `pixelsToRatio` warns even when the shape matches exactly, which is
      // right — what was lost is the pixel count, not the ratio.
      const wrote = sizingField(sizing);
      ctx.from(["aspect_ratio"], wrote);
      const ratio = ctx.take(
        pixelsToRatio(sizing.dimensions.width, sizing.dimensions.height, ratios, {
          path: [wrote],
          warn: ctx.warn,
        }),
      ) as ViduImageAspectRatio | undefined;
      if (ratio !== undefined) body.aspect_ratio = ratio;
    }

    // No default tier. `resolution` is optional on the wire and Vidu documents
    // its own default ("1080p"); sending one for a caller who never mentioned
    // size would put a value on the wire they did not choose.
    if (input.resolution !== undefined) {
      const resolution = ctx.take(
        toTier(input.resolution, tierTable(ctx.model), { path: ["resolution"], warn: ctx.warn }),
      );
      if (resolution !== undefined) body.resolution = resolution;
    }

    if (input.seed !== undefined) body.seed = input.seed;

    // No `applyExtras`: this route has no non-canonical param with a canonical
    // name to give it. `images` is the one field left, and its reference
    // payload has no vocabulary word yet — it rides through
    // `providerOptions.vidu`, checked by the endpoint's own schema.
    return { params: body, validate: validator.safe };
  },
} as const satisfies ImageAdapterFor<
  typeof VIDU_IMAGE_MODEL_PARAMS,
  ViduImageWire,
  ViduImageResult
>;
