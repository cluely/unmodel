/**
 * `unmodel/image` → Bria's two FIBO generate routes
 * (POST https://engine.prod.bria-api.com/v2/image/generate and
 * POST …/v2/image/generate/lite).
 *
 * # One adapter, two URLs, and a `model_version` that is not the model
 *
 * Bria's v2 API looks like it selects a model with `model_version`, and does
 * not: that enum is single-valued per route (`"FIBO"` on **both** generate
 * routes, `"FIBO-edit"` on the edit route), so what actually picks the
 * pipeline — and the price — is the URL. `./models.ts` models it that way, with
 * one catalog row per route:
 *
 * | ref | route | pipeline | per image |
 * |---|---|---|---|
 * | `bria/FIBO` | `/v2/image/generate` | Gemini 2.5 Flash VLM bridge + full FIBO | $0.03 |
 * | `bria/FIBO-lite` | `/v2/image/generate/lite` | open-source FIBO-VLM bridge + Fibo Lite | $0.02 |
 *
 * `"FIBO-lite"` is an unmodel pseudo-id — the lite route's own `model_version`
 * enum is *also* `"FIBO"` — which is exactly why this adapter sends **no**
 * `model_version` for either known id: the field would be a tautology on one
 * route and a wrong answer on the other. An id this snapshot does not
 * recognise is a different matter: it compiles to the full route with
 * `model_version` set to what the caller wrote, so nothing is dropped, and
 * Bria's own `checkBriaEnum` reports it as an `invalid_enum_value` a caller can
 * demote with `options.severity` if Bria shipped it after this snapshot.
 *
 * # Size: a nine-value shape enum and a two-value pixel budget
 *
 * The two halves of the size decision are separate fields here, and only the
 * full route has both:
 *
 * - `aspect_ratio` — nine values (`BRIA_ASPECT_RATIOS`), identical on both
 *   routes. Pure **S1** ({@link toRatioEnum}); a shape outside the nine is an
 *   `invalid_enum_value`, never a snap.
 * - `resolution` — `"1MP" | "4MP"`, **full route only**. That maps onto the
 *   canonical tiers with an accuracy that is almost suspicious: `TIER_PIXELS`
 *   puts `1k` at 1,048,576 px (1024²) and `2k` at 4,194,304 px (2048²), i.e.
 *   1 MP and 4 MP to within a rounding of the marketing name. So **S6**
 *   ({@link toTier}) maps `1k → "1MP"` and `2k → "4MP"` exactly, and `4k` is an
 *   `invalid_enum_value` naming the two that exist — never a quiet downgrade,
 *   which on an image API is the most expensive silent approximation there is.
 * - `dimensions` — there is no width/height field anywhere on these routes, so
 *   pixels become a shape through {@link pixelsToRatio}, which snaps to the
 *   nearest of the nine within 2% and **always warns**. The pixel *count* is
 *   not part of that: it lives in `resolution`, which is a canonical field of
 *   its own, so `{ dimensions: { width: 2048, height: 2048 }, resolution: "2k" }`
 *   expresses "4 MP square" with one warning for the shape and none for the
 *   size — and `dimensions` alone means "this shape, at whatever the route
 *   defaults to", which is what the warning says.
 *
 * # What the lite route costs
 *
 * `/v2/image/generate/lite` drops three fields — `resolution`,
 * `negative_prompt` and `steps_num` — and keeps everything else, `seed`
 * included (it is part of the shared `BriaCommonParams`, not of the full
 * route's extras). Setting `resolution` or `negativePrompt` against
 * `bria/FIBO-lite` is therefore a **model-dependent** gap: it cannot go in
 * `unsupported`, which is provider-wide, so it is a `ctx.fail` inside
 * `compile`, in the same words `checkGenerateLite` uses when a hand-written
 * call makes the same mistake. Silently dropping either would produce an image
 * that ignores half the request.
 *
 * # The remaining decisions
 *
 * - **`n`** — neither route has an image-count field; the platform bills per
 *   API call, one image at a time.
 * - **`outputFormat` → `output_type`** — `png` and `jpeg` are the whole enum,
 *   so those two are a rename; `webp` is an `invalid_enum_value` (Bria accepts
 *   WEBP as *input* and does not emit it).
 * - **`outputDelivery`** — these routes are **async by default**: the POST
 *   answers 202 with a `status_url` to poll (or calls `webhook_url`), and the
 *   result carries image URLs. `"url"` therefore needs no field and loses
 *   nothing; `"base64"` is an `unsupported_param`, because there is no field
 *   that would inline the bytes. `sync: true` changes *when* the URLs arrive,
 *   not what they are, so it is not a delivery mode and stays in
 *   `providerOptions.bria` with `webhook_url`, `steps_num`, the moderation
 *   flags, `images` and `structured_prompt`.
 */
import {
  applyExtras,
  EXTRA,
  pixelsToRatio,
  resolveSizing,
  sizingField,
  toRatioEnum,
  toTier,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageAdapterFor,
  ImageParams,
  ModelParamTable,
} from "../../core/unified/vocabulary/image";
import {
  image as generateValidator,
  imageLite as liteValidator,
  type ImageGenerateLiteParams,
  type ImageGenerateParams,
} from "./image";
import {
  BRIA_ASPECT_RATIOS,
  BRIA_GENERATION_SPEC_URL,
  type BriaAspectRatio,
  type BriaResolution,
} from "./shared";

/** The two generate rows in the catalog — the ref union for `bria/…`. */
const MODELS = ["FIBO", "FIBO-lite"] as const;

/**
 * The two generate routes' per-model surface.
 *
 * Neither has a width/height field, so no `sizes` row exists and `size` types
 * as `never` — the nine-value `aspect_ratio` enum is the whole shape
 * vocabulary. The tier split is the interesting half and it is real: the full
 * route publishes `resolution: "1MP" | "4MP"`, and the lite route has no such
 * field at all, so its `tiers` is empty and `resolution` is a compile error
 * rather than a value with nowhere to go.
 *
 * `steps_num` is the same story one level down: 35–50 on the full route, and
 * an explicit `unsupported_param` on lite ("`steps_num` is not part of the
 * Fibo Lite request schema"). Declaring it on one row and not the other is
 * what makes that a compile error too.
 */
const BRIA_SHARED_EXTRAS = {
  structured_prompt: EXTRA as string,
  ip_signal: EXTRA as boolean,
  prompt_content_moderation: EXTRA as boolean,
  visual_input_content_moderation: EXTRA as boolean,
  visual_output_content_moderation: EXTRA as boolean,
} as const;

const BRIA_IMAGE_MODEL_PARAMS = {
  FIBO: {
    ratios: BRIA_ASPECT_RATIOS,
    tiers: ["1k", "2k"],
    extras: { steps_num: EXTRA as number, ...BRIA_SHARED_EXTRAS },
  },
  "FIBO-lite": {
    ratios: BRIA_ASPECT_RATIOS,
    tiers: [],
    extras: BRIA_SHARED_EXTRAS,
  },
} as const satisfies ModelParamTable;

/** The pseudo-id that means "the lite route" (`./models.ts`). */
const LITE_MODEL_ID = "FIBO-lite";

/** Ids whose route is known, and which therefore need no `model_version`. */
const KNOWN_MODEL_IDS: ReadonlySet<string> = new Set<string>(MODELS);

/**
 * Canonical tier → Bria's `resolution`, full route only.
 *
 * 1 MP is 1024² and 4 MP is 2048², which is `TIER_PIXELS` for `1k` and `2k` to
 * the pixel — so both rows are exact and neither warns. There is no third row
 * because there is no third value: `4k` is an error, not a downgrade.
 */
const RESOLUTION: Readonly<Partial<Record<"1k" | "2k", BriaResolution>>> = {
  "1k": "1MP",
  "2k": "4MP",
};

/** The wire body this adapter compiles to — one arm per route. */
export type BriaImageWire = ImageGenerateParams | ImageGenerateLiteParams;

/** What a unified call to `bria/…` returns — again one arm per route. */
export type BriaImageResult =
  | ReturnType<typeof generateValidator>
  | ReturnType<typeof liteValidator>;

type BriaValidate = CompiledCall<BriaImageWire, BriaImageResult>["validate"];

/**
 * The body under construction, before the route narrows it.
 *
 * `resolution` and `negative_prompt` are on the draft and typed `never` on the
 * lite arm, which is the whole reason the draft exists: the fields are written
 * only after the lite check has refused them, and the cast at the end of
 * `compile` is what tells the type system that the route and the shape agree.
 */
interface BriaDraft {
  prompt: string;
  model_version?: string;
  aspect_ratio?: BriaAspectRatio;
  resolution?: BriaResolution;
  negative_prompt?: string;
  seed?: number;
  output_type?: "png" | "jpeg";
}

/**
 * A field the lite route has no schema entry for.
 *
 * Deliberately the same sentence `checkGenerateLite` reports for a
 * hand-written call, plus the fix a unified caller actually has (switch the
 * ref), because the two surfaces answering differently about the same field is
 * the failure mode this whole design exists to rule out.
 */
function failLiteOnly(
  field: "resolution" | "negativePrompt",
  wire: "resolution" | "negative_prompt",
  value: unknown,
  ctx: CompileContext<ImageParams>,
): void {
  ctx.fail({
    code: "unsupported_param",
    path: [field],
    message:
      `\`${wire}\` is not part of the Fibo Lite request schema; only POST /v2/image/generate ` +
      `accepts it. Use \`bria/FIBO\` if you need it.`,
    meta: { value, source: BRIA_GENERATION_SPEC_URL },
  });
}

export const image = {
  category: "image",
  provider: "bria",
  models: MODELS,
  modelParams: BRIA_IMAGE_MODEL_PARAMS,
  unsupported: {
    n:
      "Bria generates one image per request — neither /v2/image/generate nor its lite route has " +
      "an image-count field, and the platform bills per API call; issue N requests to get N " +
      "images.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<BriaImageWire, BriaImageResult> {
    const lite = ctx.model === LITE_MODEL_ID;
    const body: BriaDraft = { prompt: input.prompt };

    // Known ids are routes, and the route is already in the URL; an unknown id
    // is carried on the one field that can hold it rather than dropped.
    if (!KNOWN_MODEL_IDS.has(ctx.model)) {
      ctx.from(["model_version"], "model");
      body.model_version = ctx.model;
    }

    ctx.from(["aspect_ratio"], "aspectRatio");
    ctx.from(["negative_prompt"], "negativePrompt");
    ctx.from(["output_type"], "outputFormat");

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing?.kind === "ratio") {
      const ratio = ctx.take(
        toRatioEnum(sizing.aspectRatio, BRIA_ASPECT_RATIOS, { source: BRIA_GENERATION_SPEC_URL }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      );
      // The value came out of BRIA_ASPECT_RATIOS itself; the cast only restores
      // the literal type the derivation widened to `string`.
      if (ratio !== undefined) body.aspect_ratio = ratio as BriaAspectRatio;
    } else if (sizing?.kind === "dimensions") {
      const wrote = sizingField(sizing);
      ctx.from(["aspect_ratio"], wrote);
      const { width, height } = sizing.dimensions;
      const ratio = ctx.take(
        pixelsToRatio(width, height, BRIA_ASPECT_RATIOS, { path: [wrote], warn: ctx.warn }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio as BriaAspectRatio;
    }

    if (input.resolution !== undefined) {
      if (lite) {
        failLiteOnly("resolution", "resolution", input.resolution, ctx);
      } else {
        const resolution = ctx.take(
          toTier(input.resolution, RESOLUTION, { path: ["resolution"], warn: ctx.warn }),
        );
        if (resolution !== undefined) body.resolution = resolution;
      }
    }

    if (input.negativePrompt !== undefined) {
      if (lite) failLiteOnly("negativePrompt", "negative_prompt", input.negativePrompt, ctx);
      else body.negative_prompt = input.negativePrompt;
    }

    // `seed` is on `BriaCommonParams`, so it survives on the lite route too —
    // the three fields lite drops are `resolution`, `negative_prompt` and
    // `steps_num`, and this is not one of them.
    if (input.seed !== undefined) body.seed = input.seed;

    if (input.outputFormat !== undefined) {
      if (input.outputFormat === "webp") {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["outputFormat"],
          message:
            '`output_type` on the v2 image routes is "png" or "jpeg"; Bria reads WEBP as an ' +
            "input format but does not emit it.",
          meta: {
            allowed: ["png", "jpeg"],
            value: input.outputFormat,
            source: BRIA_GENERATION_SPEC_URL,
          },
        });
      } else {
        body.output_type = input.outputFormat;
      }
    }

    if (input.outputDelivery === "base64") {
      ctx.fail({
        code: "unsupported_param",
        path: ["outputDelivery"],
        message:
          '`outputDelivery: "base64"` has no equivalent here — the generate routes answer 202 ' +
          "with a `status_url` to poll (or call your `webhook_url`), and the finished result " +
          'carries image URLs. There is no field that inlines the bytes, so "url" is the only ' +
          "delivery these routes have.",
        meta: { value: input.outputDelivery, source: BRIA_GENERATION_SPEC_URL },
      });
    }

    applyExtras(input, BRIA_IMAGE_MODEL_PARAMS, body, ctx);

    return {
      params: body as BriaImageWire,
      // One cast, at the one place the two routes meet: each validator takes
      // its own arm of the union, and the ref decided which arm `body` is.
      validate: (lite ? liteValidator.safe : generateValidator.safe) as BriaValidate,
    };
  },
} as const satisfies ImageAdapterFor<
  typeof BRIA_IMAGE_MODEL_PARAMS,
  BriaImageWire,
  BriaImageResult
>;
