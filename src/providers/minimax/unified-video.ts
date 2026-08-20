/**
 * `unmodel/video` → `minimax.video` (POST /v1/video_generation, Hailuo) and
 * `minimax.videoV2` (POST /v2/video_generation, MiniMax-H3).
 *
 * # Two API generations, and the model id picks one
 *
 * `MiniMax-H3` is the only model on the v2 route and no other model is on it,
 * so the dispatch is an id test rather than a capability table — and the two
 * routes are genuinely different APIs, not versions of one:
 *
 * | | v1 (`/v1/video_generation`) | v2 (`/v2/video_generation`) |
 * |---|---|---|
 * | inputs | `first_frame_image`, `last_frame_image`, `subject_reference` | one `content[]` array with roles |
 * | `duration` | optional, per model × resolution | **required**, 4–15 |
 * | `resolution` | optional, `512P`/`768P`/`1080P` | **required**, `768P`/`2K` |
 * | shape | no field at all | `ratio`, 21:9 … 9:16 |
 *
 * Both halves compile from the same canonical request, and where v2 requires
 * what v1 defaults, an omitted param is an error naming the field rather than
 * an invented value: `duration` and `resolution` decide the price of an H3
 * generation, and guessing either one would be a bill the caller did not
 * approve.
 *
 * # `768P` is not 720p, and the warning says so
 *
 * MiniMax's tiers are upper-case and one of them is off by 48 lines:
 *
 * | canonical | wire | exact? |
 * |---|---|---|
 * | `480p` | `512P` (v1 only) | **no** — an `approximated_param` naming both |
 * | `720p` | `768P` | **no** — an `approximated_param` naming both |
 * | `1080p` | `1080P` (v1 only) | yes — case is not loss |
 * | `1440p` | `2K` (v2 only) | yes — 2K *is* 1440 lines |
 *
 * The two approximations are the reason this adapter has a warning at all, and
 * they are the honest kind: a caller who asked for 720p gets a 768-line video,
 * which is a real difference in a real file, and the warning names both
 * numbers so it can be reproduced.
 *
 * # What v1 has no field for
 *
 * `aspect_ratio` does not exist on the v1 body — the input image or the
 * model's default decides the frame — so `aspectRatio` on a Hailuo model is an
 * `unsupported_param` pointing at `MiniMax-H3`, which does have `ratio`. The
 * same is true in reverse for nothing: every v2 field has a v1 equivalent.
 */
import {
  applyExtras,
  EXTRA,
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
  VideoModelParamTable,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import { video as v1Validator, type VideoGenerationParams } from "./video";
import {
  VIDEO_V2_DURATIONS,
  VIDEO_V2_RATIOS,
  videoV2 as v2Validator,
  type MinimaxV2ContentItem,
  type VideoGenerationV2Params,
} from "./video-v2";

/** Every video model, both routes — the `minimax/…` ref union. */
const MODELS = [
  "MiniMax-H3",
  "MiniMax-Hailuo-2.3",
  "MiniMax-Hailuo-2.3-Fast",
  "MiniMax-Hailuo-02",
  "T2V-01-Director",
  "T2V-01",
  "I2V-01-Director",
  "I2V-01-live",
  "I2V-01",
  "S2V-01",
] as const;

const V1_DOCS = "https://platform.minimax.io/docs/api-reference/video-generation-t2v";
const V2_DOCS = "https://platform.minimax.io/docs/api-reference/video-generation-v2-create";

/** The one id on the v2 route. */
const V2_MODEL = "MiniMax-H3";

/** v1 `resolution`. `512P` and `768P` are approximations; `1080P` is exact. */
const V1_RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "480p": "512P",
  "720p": "768P",
  "1080p": "1080P",
};

/** v2 `resolution` — two values, one of them approximate. */
const V2_RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "720p": "768P",
  "1440p": "2K",
};

/** The tiers whose wire value is a different number of lines, and what it is. */
const APPROXIMATE_LINES: Readonly<Partial<Record<VideoResolution, number>>> = {
  "480p": 512,
  "720p": 768,
};

/** Models that accept a subject reference — the reference-to-video route on v1. */
const SUBJECT_REFERENCE_MODELS: ReadonlySet<string> = new Set(["S2V-01"]);

/** Models with no text-to-video mode: the image enum lists them and t2v does not. */
const IMAGE_ONLY_MODELS: ReadonlySet<string> = new Set([
  "MiniMax-Hailuo-2.3-Fast",
  "I2V-01",
  "I2V-01-Director",
  "I2V-01-live",
]);

/**
 * MiniMax's per-model surface, and the clearest case in the category for what
 * an **empty** list means.
 *
 * The six 01-generation models (`T2V-01*`, `I2V-01*`, `S2V-01`) accept
 * `resolution` on the wire — but the only value their rule row allows is
 * `"720P"`, and the adapter's `V1_RESOLUTIONS` has no entry that produces it
 * (canonical `720p` maps to `"768P"`, which is 768 lines and a different
 * value). So *every* canonical tier fails on those six, and the only request
 * that works is one that omits `resolution` entirely and lets the endpoint
 * default. `resolutions: []` says exactly that: the field is not expressible
 * from this vocabulary, and the caller finds out while typing.
 *
 * `ratios: []` says the same thing about shape on all nine v1 models —
 * `/v1/video_generation` has no aspect-ratio field at all, which `compile`
 * reports as an `unsupported_param` pointing at `MiniMax-H3`. The type now says
 * it first.
 *
 * `MiniMax-H3` is the v2 route and the mirror image: `duration` and
 * `resolution` are both **required** there (they are what the generation is
 * billed by), so its lists are the full documented enums — every integer 4–15,
 * and the two tiers `768P`/`2K` answer for.
 *
 * `prompt_optimizer` is a v1 field and is on all nine v1 rows; the v2 body has
 * no such key. `fast_pretreatment` is gated to the three Hailuo models by
 * `checkScenarioInputs`.
 */
const V1_EXTRAS = { prompt_optimizer: EXTRA as boolean } as const;

const HAILUO_EXTRAS = {
  prompt_optimizer: EXTRA as boolean,
  fast_pretreatment: EXTRA as boolean,
} as const;

/** The 01 generation: 6 seconds, no expressible tier, no shape. */
const V1_01_ROW = {
  durations: [6],
  resolutions: [],
  ratios: [],
  extras: V1_EXTRAS,
} as const;

const MINIMAX_VIDEO_MODEL_PARAMS = {
  "MiniMax-H3": {
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1440p"],
    ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  },
  "MiniMax-Hailuo-2.3": {
    durations: [6, 10],
    resolutions: ["720p", "1080p"],
    ratios: [],
    extras: HAILUO_EXTRAS,
  },
  "MiniMax-Hailuo-2.3-Fast": {
    durations: [6, 10],
    resolutions: ["720p", "1080p"],
    ratios: [],
    extras: HAILUO_EXTRAS,
  },
  "MiniMax-Hailuo-02": {
    durations: [6, 10],
    resolutions: ["480p", "720p", "1080p"],
    ratios: [],
    extras: HAILUO_EXTRAS,
  },
  "T2V-01-Director": V1_01_ROW,
  "T2V-01": V1_01_ROW,
  "I2V-01-Director": V1_01_ROW,
  "I2V-01-live": V1_01_ROW,
  "I2V-01": V1_01_ROW,
  "S2V-01": V1_01_ROW,
} as const satisfies VideoModelParamTable;

/** The wire body of whichever route the model selects. */
export type MinimaxVideoWire = VideoGenerationParams | VideoGenerationV2Params;

/** What a unified video call to `minimax/…` returns — one route's `Validated`. */
export type MinimaxVideoResult = ReturnType<typeof v1Validator> | ReturnType<typeof v2Validator>;

/**
 * The `validate` half of a two-route adapter.
 *
 * The cast at each `return` is what a union of wire bodies costs: `validate` is
 * contravariant in its parameter, so a function taking *one* arm is not
 * assignable to one taking the union. The kernel only ever calls it with the
 * body compiled beside it, which is the arm it was chosen for.
 */
type MinimaxValidate = CompiledCall<MinimaxVideoWire, MinimaxVideoResult>["validate"];

/** The routes a v1 model serves, from the four scenario pages' model enums. */
function v1Routes(model: string): readonly VideoRoute[] {
  if (SUBJECT_REFERENCE_MODELS.has(model)) return ["reference"];
  if (IMAGE_ONLY_MODELS.has(model)) return ["image"];
  return ["text", "image"];
}

export const video = {
  category: "video",
  provider: "minimax",
  models: MODELS,
  modelParams: MINIMAX_VIDEO_MODEL_PARAMS,
  unsupported: {
    negativePrompt:
      "Neither /v1/video_generation nor /v2/video_generation has a negative-prompt field; " +
      "describe what to avoid inside `prompt`.",
    seed:
      "MiniMax's video routes have no seed field, so a generation is not reproducible from the " +
      "request.",
    n:
      "Both video routes start one task and answer with one task id; issue one request per clip " +
      "(there is no sample count on either body).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<MinimaxVideoWire, MinimaxVideoResult> {
    return ctx.model === V2_MODEL ? compileV2(input, ctx) : compileV1(input, ctx);
  },
} as const satisfies VideoAdapterFor<
  typeof MINIMAX_VIDEO_MODEL_PARAMS,
  MinimaxVideoWire,
  MinimaxVideoResult
>;

/**
 * Warns when a tier's wire value is a different number of lines from the one
 * the caller named. `1080P` and `2K` are the same size spelled differently, so
 * they pass through silently; `768P` and `512P` do not.
 */
function warnLines(
  tier: VideoResolution,
  wire: string,
  ctx: CompileContext<VideoParams>,
  source: string,
): void {
  const lines = APPROXIMATE_LINES[tier];
  if (lines === undefined) return;
  ctx.warn({
    code: "approximated_param",
    path: ["resolution"],
    message:
      `\`resolution\` ${JSON.stringify(tier)} was sent as ${JSON.stringify(wire)} — MiniMax ` +
      `renders ${lines} lines at this tier, not ${tier.replace("p", "")}, and it is the nearest ` +
      "size this model offers.",
    meta: { requested: tier, achieved: wire, lines, source },
  });
}

// ---------------------------------------------------------------------------
// v1 — POST /v1/video_generation
// ---------------------------------------------------------------------------

function compileV1(
  input: VideoParams,
  ctx: CompileContext<VideoParams>,
): CompiledCall<MinimaxVideoWire, MinimaxVideoResult> {
  ctx.from(["first_frame_image"], "image");
  ctx.from(["last_frame_image"], "image");
  ctx.from(["subject_reference"], "image");

  const body: VideoGenerationParams = { model: ctx.model };
  if (input.prompt !== undefined) body.prompt = input.prompt;

  ctx.take(
    resolveVideoRoute(
      input,
      { model: ctx.model, routes: v1Routes(ctx.model), source: V1_DOCS },
      { path: ["image"], warn: ctx.warn },
    ),
  );

  if (input.video !== undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["video"],
      message:
        "POST /v1/video_generation takes images, not a source clip; `minimax/MiniMax-H3` is the " +
        "model whose `content` array carries a `reference_video`.",
      meta: { source: V1_DOCS },
    });
  }

  if (input.aspectRatio !== undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["aspectRatio"],
      message:
        `"${ctx.model}" has no aspect-ratio field on POST /v1/video_generation — the input ` +
        "image, or the model's own default, sets the frame. `minimax/MiniMax-H3` takes `ratio`.",
      meta: { source: V1_DOCS },
    });
  }

  if (input.duration !== undefined) {
    // No `allowed`: the per-model × per-resolution table in ./video.ts answers
    // on the way out with this model's own numbers, remapped onto `duration`.
    const duration = ctx.take(
      toDurationNumber(input.duration, undefined, { path: ["duration"], warn: ctx.warn }),
    );
    if (duration !== undefined) body.duration = duration;
  }

  if (input.resolution !== undefined) {
    const resolution = ctx.take(
      toTier(input.resolution, V1_RESOLUTIONS, { path: ["resolution"], warn: ctx.warn }),
    );
    if (resolution !== undefined) {
      warnLines(input.resolution, resolution, ctx, V1_DOCS);
      body.resolution = resolution as VideoGenerationParams["resolution"];
    }
  }

  const slots = ctx.take(resolveImageSlots(input.image, { path: ["image"], warn: ctx.warn }));
  if (slots !== undefined) {
    const derive = { path: ["image"], warn: ctx.warn };
    if (slots.first !== undefined) {
      const uri = ctx.take(toMediaUri(slots.first, derive));
      if (uri !== undefined) body.first_frame_image = uri;
    }
    if (slots.last !== undefined) {
      const uri = ctx.take(toMediaUri(slots.last, derive));
      if (uri !== undefined) body.last_frame_image = uri;
    }
    if (slots.references.length > 0) {
      const images: string[] = [];
      for (const reference of slots.references) {
        const uri = ctx.take(toMediaUri(reference, derive));
        if (uri !== undefined) images.push(uri);
      }
      // "currently only `character` (face of a person)" — the one documented
      // subject type, and the only one this vocabulary can mean.
      if (images.length > 0) body.subject_reference = [{ type: "character", image: images }];
    }
  }

  applyExtras(input, MINIMAX_VIDEO_MODEL_PARAMS, body, ctx);

  return { params: body, validate: v1Validator.safe as MinimaxValidate };
}

// ---------------------------------------------------------------------------
// v2 — POST /v2/video_generation (MiniMax-H3)
// ---------------------------------------------------------------------------

function compileV2(
  input: VideoParams,
  ctx: CompileContext<VideoParams>,
): CompiledCall<MinimaxVideoWire, MinimaxVideoResult> {
  ctx.from(["content"], "image");
  ctx.from(["ratio"], "aspectRatio");

  const content: MinimaxV2ContentItem[] = [];
  // "EVERY request needs exactly one non-empty `text` item" — so the prompt is
  // required here in a way it is not in the vocabulary, and an absent one is
  // reported at `prompt` rather than at `content[0].text`.
  if (input.prompt === undefined) {
    ctx.fail({
      code: "invalid_shape",
      path: ["prompt"],
      message:
        "POST /v2/video_generation requires exactly one non-empty `text` item in `content`, " +
        "including for image- and reference-driven requests, so `prompt` cannot be omitted here.",
      meta: { source: V2_DOCS },
    });
  } else {
    ctx.from(["content", 0, "text"], "prompt");
    content.push({ type: "text", text: input.prompt });
  }

  ctx.take(
    resolveVideoRoute(
      input,
      { model: ctx.model, routes: ["text", "image", "reference", "video"], source: V2_DOCS },
      { path: ["image"], warn: ctx.warn },
    ),
  );

  const slots = ctx.take(resolveImageSlots(input.image, { path: ["image"], warn: ctx.warn }));
  if (slots !== undefined) {
    const derive = { path: ["image"], warn: ctx.warn };
    const push = (
      image: (typeof slots)["first"],
      role: "first_frame" | "last_frame" | "reference_image",
    ): void => {
      if (image === undefined) return;
      const uri = ctx.take(toMediaUri(image, derive));
      if (uri !== undefined) content.push({ type: "image_url", image_url: { url: uri }, role });
    };
    push(slots.first, "first_frame");
    push(slots.last, "last_frame");
    for (const reference of slots.references) push(reference, "reference_image");
  }

  if (input.video !== undefined) {
    const uri = ctx.take(toMediaUri(input.video, { path: ["video"], warn: ctx.warn }));
    if (uri !== undefined) {
      ctx.from(["content", content.length, "video_url"], "video");
      content.push({ type: "video_url", video_url: { url: uri }, role: "reference_video" });
    }
  }

  // `duration` and `resolution` are required by the v2 schema, and both decide
  // what the generation costs — so an omitted one is an error naming the
  // documented values rather than a default this file invented.
  let duration: number | undefined;
  if (input.duration === undefined) {
    ctx.fail({
      code: "invalid_shape",
      path: ["duration"],
      message:
        "`duration` is required by POST /v2/video_generation (every integer 4–15 seconds is " +
        "documented) and it is what the generation is billed by, so there is no default to fill.",
      meta: { allowed: [...VIDEO_V2_DURATIONS], source: V2_DOCS },
    });
  } else {
    duration = ctx.take(
      toDurationNumber(input.duration, [...VIDEO_V2_DURATIONS], {
        path: ["duration"],
        warn: ctx.warn,
      }),
    );
  }

  let resolution: string | undefined;
  if (input.resolution === undefined) {
    ctx.fail({
      code: "invalid_shape",
      path: ["resolution"],
      message:
        '`resolution` is required by POST /v2/video_generation ("768P" or "2K") and the per-second ' +
        "rate differs between them, so there is no default to fill.",
      meta: { allowed: Object.keys(V2_RESOLUTIONS), source: V2_DOCS },
    });
  } else {
    resolution = ctx.take(
      toTier(input.resolution, V2_RESOLUTIONS, { path: ["resolution"], warn: ctx.warn }),
    );
    if (resolution !== undefined) warnLines(input.resolution, resolution, ctx, V2_DOCS);
  }

  const body: VideoGenerationV2Params = {
    model: ctx.model,
    content,
    // Empty only when a check above failed, which is an error the kernel has
    // already collected — the body is never validated in that case.
    resolution: (resolution ?? "") as VideoGenerationV2Params["resolution"],
    duration: (duration ?? 0) as VideoGenerationV2Params["duration"],
  };

  if (input.aspectRatio !== undefined) {
    const ratio = ctx.take(
      toRatioEnum(
        input.aspectRatio,
        // "adaptive" is not a shape, so it is not a candidate for a caller who
        // named one; it is what an image-driven request gets by default.
        VIDEO_V2_RATIOS.filter((value) => value !== "adaptive"),
        { source: V2_DOCS },
        { path: ["aspectRatio"], warn: ctx.warn },
      ),
    );
    if (ratio !== undefined) body.ratio = ratio as VideoGenerationV2Params["ratio"];
  }

  applyExtras(input, MINIMAX_VIDEO_MODEL_PARAMS, body, ctx);

  return { params: body, validate: v2Validator.safe as MinimaxValidate };
}
