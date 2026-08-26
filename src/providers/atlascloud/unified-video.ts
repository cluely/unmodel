/**
 * `unmodel/video` → `atlascloud.video`
 * (POST https://api.atlascloud.ai/api/v1/model/generateVideo).
 *
 * # One url, and the model id IS the route
 *
 * Atlas serves every video model from a single POST path and puts the route in
 * the `model` field: `bytedance/seedance-2.5/text-to-video`,
 * `.../image-to-video` and `.../reference-to-video` are the same weights behind
 * three different Input schemas. So the route derivation here does something no
 * other adapter in this pack does — it checks the caller's inputs against the
 * route their **ref already named**, and says so when they disagree:
 *
 * ```ts
 * video({ model: "atlascloud/bytedance/seedance-2.0/text-to-video",
 *         prompt, image: { url } });
 * // → "…has no image-to-video route; it serves text-to-video" — pick the
 * //   `/image-to-video` id, which is a different ref and a different schema.
 * ```
 *
 * That is the honest shape for this provider. A `compile` that silently
 * rewrote the id to its image-to-video sibling would be inventing a model
 * choice, and the ids differ in price.
 *
 * # The mapping table
 *
 * | canonical | wire | notes |
 * |---|---|---|
 * | `prompt` | `prompt` | required on every text route and both Wan routes |
 * | `image` (first / last) | `image` / `last_image` | the `/image-to-video` ids |
 * | `image` (reference) | `reference_images` (Seedance) / `images` (Veo 3.1) | the `/reference-to-video` ids |
 * | `video` | `reference_videos` | Seedance 2.x reference routes only |
 * | `duration` | `duration` | plain seconds via `toDurationNumber`; per-model enums answer on the way out |
 * | `resolution` | `resolution` | **S6** — four spellings across four families, see below |
 * | `aspectRatio` | `ratio` **or** `aspect_ratio` | **S1**, minus `adaptive` |
 * | `seed` | `seed` | absent on Seedance 2.5; refused by name there |
 * | `negativePrompt` | `negative_prompt` | Veo 3.1 only; refused by name elsewhere |
 *
 * `adaptive` is filtered out of every ratio candidate list, exactly as
 * `bytedance/unified-video.ts` filters it: it is not a shape, it is the default
 * "follow the primary input", and it is never what a caller who named a ratio
 * meant.
 *
 * # `duration: -1` rides on `providerOptions.atlascloud`, deliberately
 *
 * The Seedance 2.x and Wan 3.0 schemas list `-1` as a `duration` enum member
 * meaning "the model chooses the length". The canonical `duration` cannot carry
 * it: `core/unified/derive.ts` defines the word as "a positive number of
 * seconds" and refuses `-1` before any adapter sees it, at every provider —
 * `bytedance/dreamina-seedance-2-5-260628` refuses it identically, and that is
 * the vocabulary being consistent rather than a gap here.
 *
 * So the documented arm is the escape hatch, and it is one line:
 *
 * ```ts
 * video({
 *   model: "atlascloud/bytedance/seedance-2.5/reference-to-video",
 *   prompt: "@Image1 walks into the snowfield",
 *   image: [{ url, role: "reference" }],
 *   providerOptions: { atlascloud: { duration: -1 } },
 * });
 * ```
 *
 * That reaches the wire verbatim, with no warning, and `checkDuration` in
 * ./video.ts still gates it — accepting it on the families whose schema
 * declares the sentinel and refusing it on Seedance v1.5 pro and Veo 3.1, which
 * is one message, in one place, saying which models have it. A sentinel is not
 * a duration, and promoting `-1` into the canonical word would make `duration`
 * mean two things at once at every provider in the pack to serve two of them.
 *
 * # `resolution` is the interesting column here
 *
 * Atlas spells the same tier four ways, and one family has no native spelling
 * for two of the tiers it can render:
 *
 * | canonical | Seedance 2.5 | Seedance 2.0 | Seedance 2.0 mini/fast | Wan 3.0 prime | Wan 3.0 | Veo 3.1 |
 * |---|---|---|---|---|---|---|
 * | `480p` | `480p` | `480p` | `480p` | `480P` | `480p` | — |
 * | `720p` | `720p` | `720p` | `720p` | `720P` | `720p` | `720p` |
 * | `1080p` | `1080p` | `1080p` | `1080p-SR` | `1080P` | `1080p` | `1080p` |
 * | `1440p` | `1440p-sr` | `1440p-SR` | `1440p-SR` | — | `1440p-esr` | — |
 * | `4k` | `4k-esr` | `4k` | — | — | `4k-esr` | `4k` |
 *
 * The `-sr` / `-esr` rows are Atlas's upscale ladder — "Every -sr and -esr
 * option first generates the nearest native source, then upscales or enhances
 * it" — and they are mapped rather than refused because they are the ONLY way
 * those models render those tiers. The mapping is silent: a caller who asked
 * for 1440p gets 1440 lines, which is what the word means. What the ladder also
 * changes is the PRICE ("Native 1080p, 1080p-sr, and 1080p-esr are different
 * products and are priced differently"), and that is exactly why `atlascloud`
 * ships no cost estimate at all — see ./pricing.ts. A caller who wants a
 * specific rung names it on `providerOptions.atlascloud.resolution`, where the
 * eleven-member enum lives untranslated.
 */
import {
  applyExtras,
  resolveImageSlots,
  resolveVideoRoute,
  toDurationNumber,
  toMediaUri,
  toRatioEnum,
  toTier,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import { VIDEO_API_SOURCE } from "./constraints";
import { video as validator, type AtlasMediaRef, type GenerateVideoBody } from "./video";
import { ATLASCLOUD_VIDEO_MODEL_PARAMS, MODELS } from "./video-params";

type TierMap = Readonly<Partial<Record<VideoResolution, string>>>;

const SEEDANCE_25_TIERS: TierMap = {
  "480p": "480p",
  "720p": "720p",
  "1080p": "1080p",
  "1440p": "1440p-sr",
  "4k": "4k-esr",
};

const SEEDANCE_20_TIERS: TierMap = {
  "480p": "480p",
  "720p": "720p",
  "1080p": "1080p",
  "1440p": "1440p-SR",
  "4k": "4k",
};

/** The mini/fast tier has no NATIVE 1080p: `1080p-SR` upscales a 720p render. */
const SEEDANCE_20_SMALL_TIERS: TierMap = {
  "480p": "480p",
  "720p": "720p",
  "1080p": "1080p-SR",
  "1440p": "1440p-SR",
};

const SEEDANCE_15_TIERS: TierMap = { "480p": "480p", "720p": "720p" };
const SEEDANCE_15_FAST_TIERS: TierMap = { "720p": "720p" };

/** The one UPPER-case enum on this provider. */
const WAN_PRIME_TIERS: TierMap = { "480p": "480P", "720p": "720P", "1080p": "1080P" };

const WAN_TIERS: TierMap = {
  "480p": "480p",
  "720p": "720p",
  "1080p": "1080p",
  "1440p": "1440p-esr",
  "4k": "4k-esr",
};

const VEO_TIERS: TierMap = { "720p": "720p", "1080p": "1080p", "4k": "4k" };

/** The shapes, per family — every list is the wire's enum minus `adaptive`. */
const SEEDANCE_SHAPES = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const WAN_SHAPES = ["16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const VEO_SHAPES = ["16:9", "9:16"] as const;

/**
 * How one Atlas model's schema differs from its neighbours', in the four ways
 * `compile` has to know about.
 *
 * A table rather than a chain of `startsWith` tests, because Atlas's families
 * disagree per ROUTE and not only per family: Wan's text route has `ratio` and
 * its image route has none, Seedance 2.5's image route pins the shape to
 * `adaptive`, and Veo's reference route drops the shape field its two siblings
 * declare. `videoShapeRules` (./constraints.ts) carries the bounds; this
 * carries the field NAMES, which is the part the mapping needs.
 */
interface AtlasWireRow {
  /** The single route this id serves, plus `video` where a clip is accepted. */
  readonly routes: readonly VideoRoute[];
  readonly resolutions: TierMap;
  /** The wire spelling of the shape field, or absent when there is none. */
  readonly ratioField?: "ratio" | "aspect_ratio";
  readonly ratios?: readonly string[];
  /** Where a `role: "reference"` image goes. */
  readonly referenceField?: "reference_images" | "images";
  /** `seed` is absent from every Seedance 2.5 schema. */
  readonly seed: boolean;
  /** `negative_prompt` is Veo 3.1's alone. */
  readonly negativePrompt: boolean;
}

const TEXT: readonly VideoRoute[] = ["text"];
const IMAGE: readonly VideoRoute[] = ["image"];
const REFERENCE: readonly VideoRoute[] = ["reference"];
/** The Seedance reference routes take `reference_videos`, so `video` too. */
const REFERENCE_AND_VIDEO: readonly VideoRoute[] = ["reference", "video"];

const seedance25 = (routes: readonly VideoRoute[], extra: Partial<AtlasWireRow>): AtlasWireRow => ({
  routes,
  resolutions: SEEDANCE_25_TIERS,
  ratioField: "ratio",
  ratios: SEEDANCE_SHAPES,
  seed: false,
  negativePrompt: false,
  ...extra,
});

const seedance20 = (
  routes: readonly VideoRoute[],
  resolutions: TierMap,
  extra: Partial<AtlasWireRow> = {},
): AtlasWireRow => ({
  routes,
  resolutions,
  ratioField: "ratio",
  ratios: SEEDANCE_SHAPES,
  seed: true,
  negativePrompt: false,
  ...extra,
});

const seedance15 = (routes: readonly VideoRoute[], resolutions: TierMap): AtlasWireRow => ({
  routes,
  resolutions,
  ratioField: "aspect_ratio",
  ratios: SEEDANCE_SHAPES,
  seed: true,
  negativePrompt: false,
});

const wan = (
  routes: readonly VideoRoute[],
  resolutions: TierMap,
  extra: Partial<AtlasWireRow> = {},
): AtlasWireRow => ({
  routes,
  resolutions,
  ratioField: "ratio",
  ratios: WAN_SHAPES,
  seed: true,
  negativePrompt: false,
  ...extra,
});

const veo = (routes: readonly VideoRoute[], extra: Partial<AtlasWireRow> = {}): AtlasWireRow => ({
  routes,
  resolutions: VEO_TIERS,
  ratioField: "aspect_ratio",
  ratios: VEO_SHAPES,
  seed: true,
  negativePrompt: true,
  ...extra,
});

/** The shape field a route does not have, said once. */
const NO_SHAPE = { ratioField: undefined, ratios: undefined } as const;

const ROWS: Readonly<Partial<Record<string, AtlasWireRow>>> = {
  "bytedance/seedance-2.5/text-to-video": seedance25(TEXT, {}),
  // "…accepts only 'adaptive': the output preserves the source image's aspect
  // ratio" — so this route has no shape a caller can name.
  "bytedance/seedance-2.5/image-to-video": seedance25(IMAGE, NO_SHAPE),
  "bytedance/seedance-2.5/reference-to-video": seedance25(REFERENCE_AND_VIDEO, {
    referenceField: "reference_images",
  }),
  "bytedance/seedance-2.0/text-to-video": seedance20(TEXT, SEEDANCE_20_TIERS),
  "bytedance/seedance-2.0/image-to-video": seedance20(IMAGE, SEEDANCE_20_TIERS),
  "bytedance/seedance-2.0/reference-to-video": seedance20(REFERENCE_AND_VIDEO, SEEDANCE_20_TIERS, {
    referenceField: "reference_images",
  }),
  "bytedance/seedance-2.0-mini/text-to-video": seedance20(TEXT, SEEDANCE_20_SMALL_TIERS),
  "bytedance/seedance-2.0-mini/image-to-video": seedance20(IMAGE, SEEDANCE_20_SMALL_TIERS),
  "bytedance/seedance-2.0-mini/reference-to-video": seedance20(
    REFERENCE_AND_VIDEO,
    SEEDANCE_20_SMALL_TIERS,
    { referenceField: "reference_images" },
  ),
  "bytedance/seedance-2.0-fast/text-to-video": seedance20(TEXT, SEEDANCE_20_SMALL_TIERS),
  "bytedance/seedance-2.0-fast/image-to-video": seedance20(IMAGE, SEEDANCE_20_SMALL_TIERS),
  "bytedance/seedance-2.0-fast/reference-to-video": seedance20(
    REFERENCE_AND_VIDEO,
    SEEDANCE_20_SMALL_TIERS,
    { referenceField: "reference_images" },
  ),
  "bytedance/seedance-v1.5-pro/text-to-video": seedance15(TEXT, SEEDANCE_15_TIERS),
  "bytedance/seedance-v1.5-pro/image-to-video": seedance15(IMAGE, SEEDANCE_15_TIERS),
  "bytedance/seedance-v1.5-pro/text-to-video-fast": seedance15(TEXT, SEEDANCE_15_FAST_TIERS),
  "bytedance/seedance-v1.5-pro/image-to-video-fast": seedance15(IMAGE, SEEDANCE_15_FAST_TIERS),
  "alibaba/wan-3.0-prime/text-to-video": wan(TEXT, WAN_PRIME_TIERS),
  "alibaba/wan-3.0-prime/image-to-video": wan(IMAGE, WAN_PRIME_TIERS, NO_SHAPE),
  "alibaba/wan-3.0/text-to-video": wan(TEXT, WAN_TIERS),
  "alibaba/wan-3.0/image-to-video": wan(IMAGE, WAN_TIERS, NO_SHAPE),
  "google/veo3.1/text-to-video": veo(TEXT),
  "google/veo3.1/image-to-video": veo(IMAGE),
  "google/veo3.1/reference-to-video": veo(REFERENCE, {
    referenceField: "images",
    // Its schema declares no `aspect_ratio` property (see ./constraints.ts).
    ...NO_SHAPE,
  }),
};

/**
 * The row for an id this snapshot has not seen — a model Atlas added after the
 * roster was curated. It has already drawn `unknown_model`; gating it against a
 * table that does not describe it would be a guess dressed as a check, so every
 * route is open and every canonical field passes through.
 */
const UNKNOWN_ROW: AtlasWireRow = {
  routes: ["text", "image", "reference", "video"],
  resolutions: {
    "480p": "480p",
    "720p": "720p",
    "1080p": "1080p",
    "1440p": "1440p",
    "4k": "4k",
  },
  ratioField: "ratio",
  ratios: SEEDANCE_SHAPES,
  referenceField: "reference_images",
  seed: true,
  negativePrompt: true,
};

/** The wire body this adapter compiles to — the loose arm of the video body. */
export interface AtlascloudVideoWire {
  model: string;
  prompt?: string;
  image?: AtlasMediaRef;
  last_image?: AtlasMediaRef;
  images?: AtlasMediaRef[];
  reference_images?: AtlasMediaRef[];
  reference_videos?: AtlasMediaRef[];
  duration?: number;
  resolution?: string;
  ratio?: string;
  aspect_ratio?: string;
  negative_prompt?: string;
  seed?: number;
  [key: string]: unknown;
}

/** What a unified video call to `atlascloud/…` returns: `atlascloud.video`'s `Validated`. */
export type AtlascloudVideoResult = ReturnType<typeof validator>;

export const video = {
  category: "video",
  provider: "atlascloud",
  models: MODELS,
  modelParams: ATLASCLOUD_VIDEO_MODEL_PARAMS,
  unsupported: {
    n:
      "one POST creates one prediction and the response is a single id; issue one request per " +
      "clip (no Atlas video schema has a count field).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<AtlascloudVideoWire, AtlascloudVideoResult> {
    const row = ROWS[ctx.model] ?? UNKNOWN_ROW;
    const body: AtlascloudVideoWire = { model: ctx.model };

    if (input.prompt !== undefined) {
      ctx.from(["prompt"], "prompt");
      body.prompt = input.prompt;
    }

    ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes: row.routes, source: VIDEO_API_SOURCE },
        { path: ["image"], warn: ctx.warn },
      ),
    );

    const derive = { path: ["image"], warn: ctx.warn };
    const slots = ctx.take(resolveImageSlots(input.image, derive));
    if (slots !== undefined) {
      const uri = (image: (typeof slots)["first"]): string | undefined =>
        image === undefined ? undefined : ctx.take(toMediaUri(image, derive));

      const first = uri(slots.first);
      if (first !== undefined) {
        ctx.from(["image"], "image");
        body.image = first;
      }
      const last = uri(slots.last);
      if (last !== undefined) {
        ctx.from(["last_image"], "image");
        body.last_image = last;
      }
      if (slots.references.length > 0 && row.referenceField !== undefined) {
        const field = row.referenceField;
        const references: AtlasMediaRef[] = [];
        for (const reference of slots.references) {
          const value = uri(reference);
          if (value !== undefined) references.push(value);
        }
        if (references.length > 0) {
          ctx.from([field], "image");
          body[field] = references;
        }
      }
    }

    if (input.video !== undefined) {
      const clip = ctx.take(toMediaUri(input.video, { path: ["video"], warn: ctx.warn }));
      if (clip !== undefined) {
        ctx.from(["reference_videos"], "video");
        body.reference_videos = [clip];
      }
    }

    if (input.duration !== undefined) {
      // The model's own row answers on the way out: nineteen of the
      // twenty-three publish an enum too long to autocomplete (see
      // ./video-params.ts) and `checkDuration` quotes it, including the `-1`
      // sentinel rule. Veo 3.1's three-member enum IS declared, so it is
      // passed here and refused at compile time as well.
      const allowed = ATLASCLOUD_VIDEO_MODEL_PARAMS[ctx.model as keyof typeof ATLASCLOUD_VIDEO_MODEL_PARAMS];
      const durations = (allowed as { durations?: readonly number[] } | undefined)?.durations;
      const duration = ctx.take(
        toDurationNumber(input.duration, durations, { path: ["duration"], warn: ctx.warn }),
      );
      if (duration !== undefined) body.duration = duration;
    }

    if (input.resolution !== undefined) {
      const resolution = ctx.take(
        toTier(input.resolution, row.resolutions, { path: ["resolution"], warn: ctx.warn }),
      );
      if (resolution !== undefined) body.resolution = resolution;
    }

    if (input.aspectRatio !== undefined) {
      if (row.ratioField === undefined || row.ratios === undefined) {
        ctx.fail({
          code: "unsupported_param",
          path: ["aspectRatio"],
          message: `"${ctx.model}" declares no aspect-ratio field: the input media decides the shape on this route. A sibling id (\`/text-to-video\`) has one.`,
          meta: { source: VIDEO_API_SOURCE },
        });
      } else {
        const field = row.ratioField;
        const ratio = ctx.take(
          toRatioEnum(
            input.aspectRatio,
            // `adaptive` is filtered for the reason bytedance filters it: it is
            // not a shape, it is "follow the primary input", and it is the
            // documented default there — so it is never a candidate for a
            // caller who named a ratio.
            row.ratios,
            { source: VIDEO_API_SOURCE },
            { path: ["aspectRatio"], warn: ctx.warn },
          ),
        );
        if (ratio !== undefined) {
          ctx.from([field], "aspectRatio");
          body[field] = ratio;
        }
      }
    }

    if (input.negativePrompt !== undefined) {
      if (!row.negativePrompt) {
        ctx.fail({
          code: "unsupported_param",
          path: ["negativePrompt"],
          message: `"${ctx.model}" has no \`negative_prompt\` field — Veo 3.1 is the only family on Atlas with one; describe what to avoid inside \`prompt\`.`,
          meta: { source: VIDEO_API_SOURCE },
        });
      } else {
        ctx.from(["negative_prompt"], "negativePrompt");
        body.negative_prompt = input.negativePrompt;
      }
    }

    if (input.seed !== undefined) {
      if (!row.seed) {
        ctx.fail({
          code: "unsupported_param",
          path: ["seed"],
          message: `"${ctx.model}" declares no \`seed\`: the Seedance 2.5 schemas have no seed field, unlike the 2.0 series, Seedance v1.5 pro, Wan 3.0 and Veo 3.1.`,
          meta: { source: VIDEO_API_SOURCE },
        });
      } else {
        ctx.from(["seed"], "seed");
        body.seed = input.seed;
      }
    }

    applyExtras(input, ATLASCLOUD_VIDEO_MODEL_PARAMS, body, ctx);

    return { params: body as AtlascloudVideoWire & GenerateVideoBody, validate: validator.safe };
  },
} as const satisfies VideoAdapterFor<
  typeof ATLASCLOUD_VIDEO_MODEL_PARAMS,
  AtlascloudVideoWire,
  AtlascloudVideoResult
>;

// A deliberate NON-import, asserted in test/bundle-budget.test.ts: this module
// never imports `./models.ts`. The catalog belongs to the validator — the pack
// reaches it through `./video`, which is where a model id is looked up — and an
// adapter leaf that imported it directly would be the barrel trap in miniature:
// `unmodel/atlascloud/values` re-exports this file's tables for pickers, and
// that entry must not pay for twenty-three catalog rows to render a dropdown.
// `./constraints` and `./video-params` are the import-free halves it may reach.
