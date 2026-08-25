/**
 * `unmodel/video` → `alibaba.video` (DashScope POST …/video-synthesis).
 *
 * One route, four wire protocols, and the model id picks one — the same
 * dispatch problem MiniMax's two API generations pose, at higher fan-out:
 *
 * | protocol | shape params | media |
 * |---|---|---|
 * | wan3.0 | `resolution` + `ratio` | typed `media[]` (frames, refs, clips, audio) |
 * | wan2.7 t2v / HappyHorse | `resolution` + `ratio` | none / route-specific `media[]` |
 * | wan2.7 i2v | `resolution` only | `first_frame`/`last_frame`/`first_clip`/`driving_audio` |
 * | wan2.6 and earlier | one `size` string | none |
 *
 * All four compile from the same canonical request. The tier protocols map
 * exactly (`720p` → `"720P"` is a case change, not a loss). The legacy `size`
 * protocol is where the warnings live: a `size` string carries the tier AND
 * the shape, so `resolution` + `aspectRatio` pick one entry from the model's
 * documented list — and the entries the docs file under 4:3 / 3:4 are
 * actually 1088×832-shaped (≈17:13), which is an `approximated_param` naming
 * both ratios. A tier/shape pair with no size (480p has no 4:3 entry) is an
 * error listing what the tier does offer.
 *
 * `negativePrompt` is per-model rather than an adapter-level gap: the wan
 * protocols document `input.negative_prompt`, HappyHorse and wan3.0 do not.
 */
import {
  applyExtras,
  formatRatio,
  parseRatio,
  ratioValue,
  resolveImageSlots,
  resolveVideoRoute,
  toDurationNumber,
  toMediaUri,
  toRatioEnum,
  toTier,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { VideoAdapterFor, VideoParams } from "../../core/unified/vocabulary/video";
import {
  video as validator,
  VIDEO_MODEL_RULES,
  type AlibabaVideoMedia,
  type AlibabaVideoMediaType,
  type AlibabaVideoParameters,
  type AlibabaVideoResolution,
  type VideoSynthesisParams,
} from "./video";
import { ALIBABA_VIDEO_MODEL_PARAMS, MODELS } from "./video-params";

/** The wire body this adapter compiles to. */
export type AlibabaVideoWire = VideoSynthesisParams;

/** What a unified video call to `alibaba/…` returns. */
export type AlibabaVideoResult = ReturnType<typeof validator>;

type AlibabaVideoValidate = CompiledCall<AlibabaVideoWire, AlibabaVideoResult>["validate"];

/** Canonical tier → wire tier. A case change, not a loss — no warning. */
const WIRE_TIERS: Readonly<Partial<Record<string, AlibabaVideoResolution>>> = {
  "480p": "480P",
  "720p": "720P",
  "1080p": "1080P",
};

/**
 * Legacy `size` strings by tier × ratio, from the t2v reference's own lists.
 * The 4:3 / 3:4 entries are the docs' nearest offerings, not exact shapes.
 */
const LEGACY_SIZES: Readonly<
  Record<AlibabaVideoResolution, Readonly<Partial<Record<string, string>>>>
> = {
  "480P": { "16:9": "832*480", "9:16": "480*832", "1:1": "624*624" },
  "720P": {
    "16:9": "1280*720",
    "9:16": "720*1280",
    "1:1": "960*960",
    "4:3": "1088*832",
    "3:4": "832*1088",
  },
  "1080P": {
    "16:9": "1920*1080",
    "9:16": "1080*1920",
    "1:1": "1440*1440",
    "4:3": "1632*1248",
    "3:4": "1248*1632",
  },
};

/** The routes each model serves, from its own doc page. */
function routesOf(model: string): readonly VideoRoute[] {
  if (model === "wan3.0-video") return ["text", "image", "reference", "video"];
  if (model.startsWith("wan2.7-i2v")) return ["image", "video"];
  if (model.includes("-i2v")) return ["image"];
  if (model.includes("-r2v")) return ["reference"];
  if (model.includes("video-edit")) return ["video"];
  return ["text"];
}

/** The `media[].type` a canonical `video` input lands in, per model. */
function videoMediaType(model: string): AlibabaVideoMediaType {
  if (model === "wan3.0-video") return "reference_video";
  if (model.includes("video-edit")) return "video";
  return "first_clip";
}

export const video = {
  category: "video",
  provider: "alibaba",
  models: MODELS,
  modelParams: ALIBABA_VIDEO_MODEL_PARAMS,
  unsupported: {
    n:
      "DashScope video-synthesis starts one task and answers with one task id; issue one request " +
      "per clip (there is no sample count on the body).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<AlibabaVideoWire, AlibabaVideoResult> {
    const rule = VIDEO_MODEL_RULES[ctx.model];
    const row = Object.hasOwn(ALIBABA_VIDEO_MODEL_PARAMS, ctx.model)
      ? ALIBABA_VIDEO_MODEL_PARAMS[ctx.model as keyof typeof ALIBABA_VIDEO_MODEL_PARAMS]
      : undefined;
    const source = rule?.docs;

    ctx.from(["input", "prompt"], "prompt");
    ctx.from(["input", "negative_prompt"], "negativePrompt");
    ctx.from(["input", "media"], "image");
    ctx.from(["parameters", "duration"], "duration");
    ctx.from(["parameters", "seed"], "seed");

    const body: AlibabaVideoWire = { model: ctx.model, input: {} };
    const parameters: AlibabaVideoParameters = {};

    if (input.prompt !== undefined) body.input.prompt = input.prompt;

    if (rule !== undefined) {
      ctx.take(
        resolveVideoRoute(
          input,
          { model: ctx.model, routes: routesOf(ctx.model), source },
          { path: ["image"], warn: ctx.warn },
        ),
      );
    }

    if (input.negativePrompt !== undefined) {
      if (rule !== undefined && !rule.negativePrompt) {
        ctx.fail({
          code: "unsupported_param",
          path: ["negativePrompt"],
          message:
            `"${ctx.model}" has no negative-prompt field — the wan t2v/i2v protocols document ` +
            "`input.negative_prompt`; HappyHorse and wan3.0 do not. Describe what to avoid " +
            "inside `prompt`.",
          meta: source !== undefined ? { source } : {},
        });
      } else {
        body.input.negative_prompt = input.negativePrompt;
      }
    }

    if (input.seed !== undefined) parameters.seed = input.seed;

    if (input.duration !== undefined) {
      if (row !== undefined && row.durations.length === 0) {
        ctx.fail({
          code: "unsupported_param",
          path: ["duration"],
          message:
            `"${ctx.model}" has no \`duration\` param — the output length follows the input ` +
            "clip (3–15 seconds).",
          meta: source !== undefined ? { source } : {},
        });
      } else {
        const duration = ctx.take(
          toDurationNumber(input.duration, row === undefined ? undefined : [...row.durations], {
            path: ["duration"],
            warn: ctx.warn,
          }),
        );
        if (duration !== undefined) parameters.duration = duration;
      }
    }

    compileShape(input, ctx, parameters, rule, source);
    compileMedia(input, ctx, body);

    applyExtras(input, ALIBABA_VIDEO_MODEL_PARAMS, body, ctx, {
      nest: {
        prompt_extend: ["parameters"],
        watermark: ["parameters"],
        shot_type: ["parameters"],
        audio: ["parameters"],
        audio_setting: ["parameters"],
        audio_url: ["input"],
      },
    });

    if (Object.keys(parameters).length > 0) {
      body.parameters = { ...parameters, ...body.parameters };
    }

    return { params: body, validate: validator.safe as AlibabaVideoValidate };
  },
} as const satisfies VideoAdapterFor<
  typeof ALIBABA_VIDEO_MODEL_PARAMS,
  AlibabaVideoWire,
  AlibabaVideoResult
>;

/** `resolution` + `aspectRatio` → `parameters.resolution`/`ratio`, or `size`. */
function compileShape(
  input: VideoParams,
  ctx: CompileContext<VideoParams>,
  parameters: AlibabaVideoParameters,
  rule: (typeof VIDEO_MODEL_RULES)[string] | undefined,
  source: string | undefined,
): void {
  const legacy = rule?.sizes !== undefined;
  ctx.from(["parameters", legacy ? "size" : "resolution"], "resolution");
  if (legacy) ctx.from(["parameters", "size"], "aspectRatio");
  else ctx.from(["parameters", "ratio"], "aspectRatio");

  // Unknown model: best-effort tier protocol (the resolution spelling every
  // current-generation model takes), and the provider validator has already
  // warned unknown_model.
  if (rule === undefined) {
    if (input.resolution !== undefined) {
      const tier = ctx.take(
        toTier(input.resolution, WIRE_TIERS, { path: ["resolution"], warn: ctx.warn }),
      );
      if (tier !== undefined) parameters.resolution = tier;
    }
    if (input.aspectRatio !== undefined) parameters.ratio = input.aspectRatio;
    return;
  }

  if (!legacy) {
    if (input.resolution !== undefined) {
      const offered = Object.fromEntries(
        Object.entries(WIRE_TIERS).filter(([, wire]) =>
          rule.resolutions?.includes(wire as AlibabaVideoResolution),
        ),
      ) as Partial<Record<string, AlibabaVideoResolution>>;
      const tier = ctx.take(
        toTier(input.resolution, offered, { path: ["resolution"], warn: ctx.warn }),
      );
      if (tier !== undefined) parameters.resolution = tier;
    }
    if (input.aspectRatio !== undefined) {
      if (rule.ratios === undefined) {
        ctx.fail({
          code: "unsupported_param",
          path: ["aspectRatio"],
          message:
            `"${ctx.model}" has no \`ratio\` param on this route — the output frame follows ` +
            "the input media.",
          meta: source !== undefined ? { source } : {},
        });
      } else {
        const ratio = ctx.take(
          toRatioEnum(
            input.aspectRatio,
            // "adaptive" is the wire default, not a shape a caller can mean.
            rule.ratios.filter((value) => value !== "adaptive"),
            source !== undefined ? { source } : {},
            { path: ["aspectRatio"], warn: ctx.warn },
          ),
        );
        if (ratio !== undefined) parameters.ratio = ratio;
      }
    }
    return;
  }

  // Legacy protocol: one `size` string carries tier and shape together.
  if (input.resolution === undefined && input.aspectRatio === undefined) return;
  const tierOf = (size: string | undefined): AlibabaVideoResolution | undefined =>
    size === undefined
      ? undefined
      : (Object.entries(LEGACY_SIZES).find(([, table]) =>
          Object.values(table).includes(size),
        )?.[0] as AlibabaVideoResolution | undefined);

  let wireTier: AlibabaVideoResolution | undefined;
  if (input.resolution !== undefined) {
    const offered = Object.fromEntries(
      Object.entries(WIRE_TIERS).filter(([, wire]) =>
        rule.sizes?.some((size) => tierOf(size) === wire),
      ),
    ) as Partial<Record<string, AlibabaVideoResolution>>;
    wireTier = ctx.take(toTier(input.resolution, offered, { path: ["resolution"], warn: ctx.warn }));
    if (wireTier === undefined) return;
  } else {
    wireTier = tierOf(rule.defaultSize);
    if (wireTier === undefined) return;
  }

  const tierSizes = LEGACY_SIZES[wireTier];
  const offeredRatios = Object.keys(tierSizes).filter((ratio) =>
    rule.sizes?.includes(tierSizes[ratio] as string),
  );
  // The docs' own default shape at every tier.
  let ratio = "16:9";
  if (input.aspectRatio !== undefined) {
    const picked = ctx.take(
      toRatioEnum(
        input.aspectRatio,
        offeredRatios,
        source !== undefined ? { source } : {},
        { path: ["aspectRatio"], warn: ctx.warn },
      ),
    );
    if (picked === undefined) return;
    ratio = picked;
  }
  const size = tierSizes[ratio];
  if (size === undefined) return;
  parameters.size = size;

  // The 4:3 / 3:4 entries are 1088×832-shaped (≈17:13): a real difference in
  // a real file, so the warning names both numbers.
  if (input.aspectRatio !== undefined) {
    const [width, height] = size.split("*").map(Number) as [number, number];
    const asked = parseRatio(ratio);
    if (asked !== undefined && width / height !== ratioValue(asked)) {
      const actual = parseRatio(`${width}:${height}`);
      ctx.warn({
        code: "approximated_param",
        path: ["aspectRatio"],
        message:
          `\`aspectRatio\` ${JSON.stringify(ratio)} was sent as \`size: "${size}"\` — ` +
          `${width}×${height} is ${actual === undefined ? "a slightly different shape" : formatRatio(actual)}, the nearest size this model offers.`,
        meta: { requested: ratio, achieved: size, ...(source !== undefined && { source }) },
      });
    }
  }
}

/** `image` slots and `video` → the typed `input.media` array. */
function compileMedia(
  input: VideoParams,
  ctx: CompileContext<VideoParams>,
  body: AlibabaVideoWire,
): void {
  const media: AlibabaVideoMedia[] = [];
  const derive = { path: ["image"], warn: ctx.warn };

  const slots = ctx.take(resolveImageSlots(input.image, derive));
  if (slots !== undefined) {
    const push = (
      image: NonNullable<(typeof slots)["first"]> | undefined,
      type: AlibabaVideoMediaType,
    ): void => {
      if (image === undefined) return;
      const uri = ctx.take(toMediaUri(image, derive));
      if (uri !== undefined) media.push({ type, url: uri });
    };
    push(slots.first, "first_frame");
    push(slots.last, "last_frame");
    for (const reference of slots.references) push(reference, "reference_image");
  }

  if (input.video !== undefined) {
    const uri = ctx.take(toMediaUri(input.video, { path: ["video"], warn: ctx.warn }));
    if (uri !== undefined) {
      ctx.from(["input", "media", media.length, "url"], "video");
      media.push({ type: videoMediaType(ctx.model), url: uri });
    }
  }

  if (media.length > 0) body.input.media = media;
}
