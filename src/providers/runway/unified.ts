/**
 * `unmodel/image` → `runway.image` (POST /v1/text_to_image).
 *
 * # `ratio` is a size, not a shape
 *
 * Runway calls the field `ratio` and every value in it is a **pixel pair**:
 * `"1920:1080"`, `"1344:768"`, `"4096:4096"`. One field therefore carries both
 * halves of the canonical size decision, and the list is closed and **per
 * model** — 16 values for the gen4 pair, 55 for `gemini_image3.1_flash`, with
 * `"auto"` (gpt_image_2) and `"auto_1k"` / `"auto_2k"` (seedream5_pro,
 * grok_imagine_image_2) mixed in among the pairs.
 *
 * That has three consequences, and they are the whole design of this adapter:
 *
 * 1. **The tier picks the bucket.** Each model's pixel pairs are sorted into
 *    `1k` / `2k` / `4k` by total area — nearest tier in log space, using the
 *    same {@link TIER_PIXELS} targets every other adapter derives from — and
 *    the canonical `resolution` selects one bucket. A model with nothing in a
 *    bucket does not serve that tier: `gen4_image` tops out at 2.1 Mpx, so
 *    `resolution: "2k"` there is an `invalid_enum_value` from {@link toTier}
 *    naming the tiers it *does* serve. `seedream5_lite` starts at 4 Mpx, so
 *    `1k` is the error there. Neither is a downgrade, ever.
 *
 * 2. **The shape picks the entry.** Inside the bucket, {@link toRatioEnum}
 *    matches on the *reduced* ratio, so `"16:9"` finds `"1920:1080"` and
 *    `"21:9"` finds `"1680:720"` — Runway's own spelling, no warning, because a
 *    spelling change is not a loss. Buckets are pre-sorted by distance from
 *    the tier's target area, so when a bucket holds two entries of the same
 *    shape (gen4 has both `1280:720` and `1920:1080` at `1k`) the one nearer
 *    the tier wins.
 *
 * 3. **A shape that is not in the list snaps, and says so.** Three of the nine
 *    models have no exact 16:9 anywhere: what Google calls 16:9 is
 *    `"1344:768"`, which is 7:4. Refusing those requests outright would be
 *    defensible and useless — the model plainly makes widescreen images — so
 *    the fallback is {@link pixelsToRatio} over the same bucket, which takes
 *    the nearest entry within 2% and **always warns**, naming both ratios and
 *    the distance. Beyond 2% it is an `unsupported_param` listing the bucket.
 *    Note that helper reports the reduced ratio as pixels, so the message
 *    reads "`aspectRatio` 16×9 (16:9) was sent as the nearest shape this model
 *    offers, "1344:768" (1.6% away)" — the numbers are right, the "×" is the
 *    shared derivation's spelling.
 *
 * ## `dimensions` is the exact path, not the lossy one
 *
 * Because the enum members *are* pixel pairs, `dimensions: { width: 1920,
 * height: 1080 }` is `"1920:1080"` — a member of gen4's list, sent verbatim,
 * **zero warnings**. Nothing was approximated, so nothing is reported; this is
 * the one image provider where asking for exact pixels is the lossless spelling
 * and asking for a shape is the lossy one. A pair that is *not* in the list
 * falls back to {@link pixelsToRatio} over the whole list (all tiers, sorted by
 * distance from the requested area, so the nearest entry of the matching shape
 * is also the nearest in size), which warns; beyond 2% of shape it errors. Its
 * exact-shape wording — "this model takes a shape, not a pixel size" — is
 * understated for Runway, which takes a pixel size and simply not *that* one;
 * the operative half of the sentence, "the exact dimensions are not
 * expressible", is exactly true and is what the warning is for.
 * `resolution` alongside `dimensions` is not dropped — the pixel pair *is* the
 * tier.
 *
 * ## When the caller names no shape at all
 *
 * `ratio` is required by every model's arm, so something must be sent. If the
 * model has an `auto` value for the requested tier — `"auto_1k"`, `"auto_2k"`,
 * or gpt_image_2's bare `"auto"` — that is exact: the caller expressed no
 * shape and `auto` expresses no shape. Otherwise a concrete shape has to be
 * invented, so the squarest entry in the tier's bucket is sent **with an
 * `approximated_param` warning naming it**, which is the difference between a
 * request you can reproduce and one you cannot.
 *
 * # The params that are one model's and not another's
 *
 * `seed` (gen4 only), `outputCount` (denied on gen4 and gemini_2.5_flash,
 * `1–10` on gpt_image_2, exactly `1` or `4` on the gemini_image3 family,
 * `1–4` elsewhere) and `outputFormat` (seedream5 only) are all narrowed
 * per model by `imageConstraints`, transcribed from Runway's OpenAPI document.
 * This adapter sends them and lets those tables answer, because a copy of the
 * table here would be a second opinion about the same OpenAPI document, and the
 * error a caller gets — "`outputCount` must be one of 1, 4 for
 * `gemini_image3_pro`", remapped onto `n` — is better than anything written
 * from scratch.
 *
 * The one thing the tables cannot express is that a model with **no**
 * `outputCount` still makes exactly one image, so `n: 1` on `gen4_image` is
 * exact and must not fail. That case is handled here, reading the deny table
 * rather than a second list of model ids.
 *
 * Canonical `"webp"` has no `outputFormat` value anywhere on this route, so it
 * is an `invalid_enum_value` from here rather than a substitution.
 *
 * # The declared gaps
 *
 * `negativePrompt` is not a field of any text_to_image arm (Runway's video
 * routes have one; this one does not). `outputDelivery` is not a field either
 * and could not be: the endpoint starts a task and answers `{ id }`, and the
 * artifact URLs arrive from `GET /v1/tasks/{id}` however the caller asks.
 */
import {
  parseRatio,
  pixelsToRatio,
  ratioDistance,
  resolveSizing,
  toRatioEnum,
  toSizeFreeform,
  toTier,
  TIER_PIXELS,
  type FreeformRules,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../core/unified/types";
import type { ResolutionTier } from "../../core/unified/vocabulary/common";
import type { ImageParams } from "../../core/unified/vocabulary/image";
import {
  imageConstraints,
  TEXT_TO_IMAGE_SOURCE,
  type RunwayImageRatio,
} from "./constraints";
import { image as imageValidator, type TextToImageParams } from "./image";

/** Every model the text_to_image route has an arm for — the `imageModels` catalog. */
const MODELS = [
  "gen4_image",
  "gen4_image_turbo",
  "gpt_image_2",
  "gemini_image3_pro",
  "gemini_image3.1_flash",
  "seedream5_pro",
  "seedream5_lite",
  "grok_imagine_image_2",
  "gemini_2.5_flash",
] as const;

/**
 * The wire body this adapter compiles to — `runway.image`'s own param type.
 *
 * Deliberately not widened with an index signature. `TextToImageParams` has
 * none, and `ExactKeys` is what turns a typo'd wire key into a compile error;
 * an index signature here would switch that check off for the one file whose
 * job is to write those keys. Anything genuinely extra arrives through
 * `providerOptions.runway`, which the kernel merges at runtime.
 */
export interface RunwayImageWire extends TextToImageParams {}

/** What a unified call to `runway/…` returns: `runway.image`'s own `Validated`. */
export type RunwayImageResult = ReturnType<typeof imageValidator>;

const TIERS: readonly ResolutionTier[] = ["1k", "2k", "4k"];

/** A `ratio` member that is literally a pixel size. */
const PIXEL_PAIR = /^(\d+):(\d+)$/;

/** `"auto_1k"` / `"auto_2k"` — an `auto` that also names a tier. */
const AUTO_TIER = /^auto_(1k|2k|4k)$/i;

/** One model's `ratio` list, pre-chewed into the four questions the compiler asks. */
interface RunwaySizing {
  /** Every pixel-pair spelling, in the order the OpenAPI document lists them. */
  pairs: readonly string[];
  /** Those pairs bucketed by nearest tier, each sorted by distance to that tier's area. */
  byTier: Readonly<Partial<Record<ResolutionTier, readonly string[]>>>;
  /** The squarest member of each bucket — what "no shape given" resolves to. */
  squarest: Readonly<Partial<Record<ResolutionTier, string>>>;
  /** `"auto_1k"` / `"auto_2k"`, keyed by the tier they name. */
  autoByTier: Readonly<Partial<Record<ResolutionTier, string>>>;
  /** A bare `"auto"` (gpt_image_2 only), which names a shape but no tier. */
  autoAny?: string;
}

const SIZING = new Map<string, RunwaySizing | undefined>();

/** The tier whose target area a pixel count is nearest, in log space. */
function nearestTier(area: number): ResolutionTier {
  let best: ResolutionTier = "1k";
  let bestDistance = Infinity;
  for (const tier of TIERS) {
    const distance = Math.abs(Math.log(area / TIER_PIXELS[tier]));
    if (distance < bestDistance) {
      best = tier;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * One model's `ratio` enum, read straight off `imageConstraints` so there is
 * exactly one transcription of Runway's OpenAPI document in the repo.
 *
 * `undefined` for a model with no table — a new release, or an id this
 * snapshot has not seen. The kernel has already warned `unknown_model` by
 * then, and gating a request against a table that does not describe it would
 * be a guess dressed as a check.
 */
function sizingFor(model: string): RunwaySizing | undefined {
  if (SIZING.has(model)) return SIZING.get(model);
  const built = buildSizing(model);
  SIZING.set(model, built);
  return built;
}

function buildSizing(model: string): RunwaySizing | undefined {
  const allowed = imageConstraints[model]?.enums?.["ratio"];
  if (allowed === undefined) return undefined;

  const pairs: Array<{ spelling: string; area: number; ratio: number; tier: ResolutionTier }> = [];
  const autoByTier: Partial<Record<ResolutionTier, string>> = {};
  let autoAny: string | undefined;

  for (const entry of allowed) {
    if (typeof entry !== "string") continue;
    const pixels = PIXEL_PAIR.exec(entry);
    if (pixels !== null) {
      const width = Number(pixels[1]);
      const height = Number(pixels[2]);
      if (width <= 0 || height <= 0) continue;
      const area = width * height;
      pairs.push({ spelling: entry, area, ratio: width / height, tier: nearestTier(area) });
      continue;
    }
    const auto = AUTO_TIER.exec(entry);
    if (auto !== null) autoByTier[auto[1]?.toLowerCase() as ResolutionTier] = entry;
    else if (entry.toLowerCase() === "auto") autoAny = entry;
  }

  const byTier: Partial<Record<ResolutionTier, readonly string[]>> = {};
  const squarest: Partial<Record<ResolutionTier, string>> = {};
  for (const tier of TIERS) {
    const bucket = pairs.filter((pair) => pair.tier === tier);
    if (bucket.length === 0) continue;
    // Nearest the tier's own area first, so a bucket holding two entries of
    // one shape hands `toRatioEnum` the one the caller actually asked for.
    const byArea = [...bucket].sort(
      (a, b) =>
        Math.abs(Math.log(a.area / TIER_PIXELS[tier])) -
        Math.abs(Math.log(b.area / TIER_PIXELS[tier])),
    );
    byTier[tier] = byArea.map((pair) => pair.spelling);
    // Squarest first, ties broken by the area order above — the fallback for a
    // caller who named a tier and no shape.
    const bySquareness = [...byArea].sort(
      (a, b) => Math.abs(Math.log(a.ratio)) - Math.abs(Math.log(b.ratio)),
    );
    const square = bySquareness[0];
    if (square !== undefined) squarest[tier] = square.spelling;
  }

  return {
    pairs: pairs.map((pair) => pair.spelling),
    byTier,
    squarest,
    autoByTier,
    ...(autoAny !== undefined && { autoAny }),
  };
}

/**
 * The fallback spelling for a model with no `ratio` table: the pixel pair the
 * requested shape and tier imply, in Runway's own `W:H` punctuation.
 *
 * No grid — Runway documents its values as a list, not as a rule, so there is
 * no grid to honour — and no bounds, because the model that would enforce them
 * is the one unmodel has no table for.
 */
const UNLISTED: FreeformRules = { grid: 1, separator: ":", source: TEXT_TO_IMAGE_SOURCE };

/** True when this model's arm has no `outputCount` at all. */
function deniesOutputCount(model: string): boolean {
  return imageConstraints[model]?.deny?.["outputCount"] !== undefined;
}

export const image = {
  category: "image",
  provider: "runway",
  models: MODELS,
  unsupported: {
    negativePrompt:
      "POST /v1/text_to_image has no negative-prompt field on any model's arm — Runway's video " +
      "routes carry one, this route does not — so describe what to avoid inside `prompt`.",
    outputDelivery:
      "POST /v1/text_to_image starts a task and responds `{ id }`; the images arrive from " +
      "GET /v1/tasks/{id} as URLs, and there is no field to ask for anything else.",
  },
  compile(
    input: ImageParams,
    ctx: CompileContext<ImageParams>,
  ): CompiledCall<RunwayImageWire, RunwayImageResult> {
    ctx.from(["promptText"], "prompt");
    ctx.from(["ratio"], "aspectRatio");
    ctx.from(["outputCount"], "n");

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    const tier = input.resolution ?? "1k";
    const sizes = sizingFor(ctx.model);
    let ratio: string | undefined;

    if (sizing?.kind === "dimensions") {
      ctx.from(["ratio"], "dimensions");
      const { width, height } = sizing.dimensions;
      const exact = `${width}:${height}`;
      if (sizes === undefined || sizes.pairs.includes(exact)) {
        // The lossless path: Runway's `ratio` members are pixel pairs, so the
        // pixels the caller asked for are the pixels on the wire.
        ratio = exact;
      } else {
        // Nearest shape, preferring the entry nearest the requested *area* —
        // `pixelsToRatio` breaks ties by list order, so the list is handed over
        // in that order.
        const byArea = [...sizes.pairs].sort(
          (a, b) => areaDistance(a, width * height) - areaDistance(b, width * height),
        );
        ratio = ctx.take(
          pixelsToRatio(width, height, byArea, { path: ["dimensions"], warn: ctx.warn }),
        );
      }
    } else if (sizing?.kind === "ratio") {
      if (sizes === undefined) {
        ratio = ctx.take(
          toSizeFreeform(sizing.aspectRatio, tier, UNLISTED, {
            path: ["aspectRatio"],
            warn: ctx.warn,
          }),
        );
      } else {
        const bucket = ctx.take(
          toTier(tier, sizes.byTier, { path: ["resolution"], warn: ctx.warn }),
        );
        if (bucket !== undefined) ratio = snapRatio(sizing.aspectRatio, bucket, ctx);
      }
    } else if (sizes === undefined) {
      ratio = ctx.take(
        toSizeFreeform("1:1", tier, UNLISTED, { path: ["resolution"], warn: ctx.warn }),
      );
    } else {
      // No shape was named, and `ratio` is required by every arm.
      const auto =
        sizes.autoByTier[tier] ?? (input.resolution === undefined ? sizes.autoAny : undefined);
      if (auto !== undefined) {
        // Exact: the caller expressed no shape, and `auto` expresses no shape.
        ctx.from(["ratio"], "resolution");
        ratio = auto;
      } else {
        const bucket = ctx.take(
          toTier(tier, sizes.byTier, { path: ["resolution"], warn: ctx.warn }),
        );
        const chosen = bucket === undefined ? undefined : sizes.squarest[tier];
        if (chosen !== undefined) {
          ctx.from(["ratio"], "resolution");
          ratio = chosen;
          ctx.warn({
            code: "approximated_param",
            path: ["aspectRatio"],
            message:
              `\`ratio\` is required by every text_to_image model and no shape was given, so ` +
              `${JSON.stringify(chosen)} — the squarest size "${ctx.model}" offers at ${tier} — ` +
              `was sent. Set \`aspectRatio\` or \`dimensions\` to choose.`,
            meta: { achieved: chosen, tier, source: TEXT_TO_IMAGE_SOURCE },
          });
        }
      }
    }

    const body: RunwayImageWire = {
      model: ctx.model,
      promptText: input.prompt,
      // Empty only when a derivation above failed, which is an error the kernel
      // has already collected — the body is never validated in that case.
      ratio: (ratio ?? "") as RunwayImageRatio,
    };

    if (input.seed !== undefined) {
      // `seed` is gen4_image / gen4_image_turbo only; every other arm denies it
      // by name, with Runway's own reason.
      body.seed = input.seed;
    }

    if (input.n !== undefined) {
      if (deniesOutputCount(ctx.model)) {
        // No `outputCount` in the arm means exactly one image per request, so
        // asking for one is exact and asking for more cannot be served.
        if (input.n !== 1) {
          ctx.fail({
            code: "unsupported_param",
            path: ["n"],
            message:
              `"${ctx.model}" has no \`outputCount\` in its text_to_image schema — it generates ` +
              `one image per request; issue ${input.n} requests to get ${input.n} images.`,
            meta: { value: input.n, source: TEXT_TO_IMAGE_SOURCE },
          });
        }
      } else {
        body.outputCount = input.n;
      }
    }

    if (input.outputFormat !== undefined) {
      if (input.outputFormat === "webp") {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["outputFormat"],
          message:
            "`outputFormat` on this route is PNG or JPEG (and only on the seedream5 arms); no " +
            "text_to_image model returns WebP, so the encoding could only be substituted.",
          meta: {
            allowed: ["png", "jpeg"],
            value: input.outputFormat,
            source: TEXT_TO_IMAGE_SOURCE,
          },
        });
      } else {
        // Sent as-is; the seven arms without an `outputFormat` deny it by name.
        // The wire spelling is the canonical one, so no provenance is declared.
        body.outputFormat = input.outputFormat;
      }
    }

    return { params: body, validate: imageValidator.safe };
  },
} as const satisfies UnifiedAdapter<ImageParams, RunwayImageWire, RunwayImageResult>;

/**
 * The caller's shape, as one of the bucket's spellings.
 *
 * Exact first and silently — a reduced-ratio match is a spelling change, not a
 * loss. Only when the bucket has no entry of that shape does the nearest-match
 * derivation run, and that one always warns. The failed `toRatioEnum`'s issues
 * are deliberately dropped rather than reported: they say "must be one of …",
 * which is answered by the snap that follows and, when the snap fails too,
 * restated by `pixelsToRatio` with the distance to the nearest entry attached.
 */
function snapRatio(
  aspectRatio: string,
  bucket: readonly string[],
  ctx: CompileContext<ImageParams>,
): string | undefined {
  const derive = { path: ["aspectRatio"], warn: ctx.warn };
  const exact = toRatioEnum(aspectRatio, bucket, { source: TEXT_TO_IMAGE_SOURCE }, derive);
  if (exact.value !== undefined) return exact.value;
  const parsed = parseRatio(aspectRatio);
  // Unparseable is `toRatioEnum`'s `invalid_shape`, which is the right answer.
  if (parsed === undefined) return ctx.take(exact);
  return ctx.take(pixelsToRatio(parsed.width, parsed.height, bucket, derive));
}

/** How far one `"W:H"` spelling's area is from a target, in log space. */
function areaDistance(spelling: string, area: number): number {
  const pixels = PIXEL_PAIR.exec(spelling);
  if (pixels === null) return Infinity;
  const own = Number(pixels[1]) * Number(pixels[2]);
  return own > 0 ? ratioDistance(own, area) : Infinity;
}
