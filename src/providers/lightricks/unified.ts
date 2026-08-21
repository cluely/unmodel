/**
 * `unmodel/video` → `lightricks.video` (POST /v2/text-to-video) and
 * `lightricks.videoFromImage` (POST /v2/image-to-video) — the LTX-2 family.
 *
 * # `resolution` is a pixel pair, and it carries the shape too
 *
 * LTX takes `resolution: "1920x1080"` and no aspect-ratio field at all, so one
 * wire param answers both halves of the canonical size decision — which makes
 * this an **S3** size table with an unusually tidy shape, because every
 * documented value is 16:9 in one of its two orientations:
 *
 * | tier | landscape (`16:9`) | portrait (`9:16`) |
 * |---|---|---|
 * | `720p` | `1280x720` | `720x1280` |
 * | `1080p` | `1920x1080` | `1080x1920` |
 * | `1440p` | `2560x1440` | `1440x2560` |
 * | `4k` | `3840x2160` | `2160x3840` |
 *
 * A shape that is not one of those two is an `invalid_enum_value` from
 * {@link toSizeEnum} listing what the tier offers — LTX publishes a list, not
 * a rule, and 4:3 is not on it at any tier. `480p` is likewise absent from
 * every model's matrix, so it errors rather than snapping up to 720p.
 *
 * Both fields are **required** by the OpenAPI schema, so an omitted
 * `resolution` is filled with `1920x1080` and warned about — the same
 * fill-and-say-so rule PixVerse's three required fields get.
 *
 * # `duration: null` is a documented value, not a missing one
 *
 * LTX-2.5 has an "automatic duration" mode spelled `duration: null`, and the
 * field is required either way. So an omitted canonical `duration` compiles to
 * `null` with an `approximated_param`: the request works, the model picks the
 * length, and the caller is told that is what happened. On a model without
 * automatic duration (`ltx-2-3-*`, `ltx-2-*`) the endpoint's own check then
 * reports it — remapped onto `duration`, naming the two models that do have
 * it.
 *
 * # Frames in, and only frames
 *
 * `image` (first) is `image_uri` and `role: "last"` is `last_frame_uri`, both
 * on the image-to-video route. There is no reference field — LTX's
 * subject-consistency story is a different product — and no video input on
 * either of these two routes (`/v2/retake`, `/v2/extend` and the two
 * video-to-video routes exist but are not validated here), so both are
 * declared gaps rather than params quietly dropped.
 */
import {
  applyExtras,
  EXTRA,
  requireMediaUrl,
  resolveImageSlots,
  resolveVideoRoute,
  toDurationNumber,
  toSizeEnum,
  unsupportedSlot,
  type SizeTable,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoModelParamTable,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import {
  MODELS_SOURCE,
  type LtxCameraMotion,
  type LtxDuration,
  type LtxResolution,
} from "./shared";
import { video as textValidator, type TextToVideoParams } from "./video";
import {
  videoFromImage as imageValidator,
  type ImageToVideoParams,
} from "./video-from-image";

/** The six ids with a text-to-video and an image-to-video arm. */
const MODELS = [
  "ltx-2-5-fast",
  "ltx-2-5-pro",
  "ltx-2-3-fast",
  "ltx-2-3-pro",
  "ltx-2-fast",
  "ltx-2-pro",
] as const;

/**
 * `resolution` — the published tier table, keyed by the two shapes it comes in.
 *
 * Written out rather than derived from `LTX_RESOLUTION_TIERS` because the pair
 * in that table is ordered (landscape first) and nothing records *which*
 * orientation each entry is; keying by shape is what lets a caller ask for
 * `9:16` and get the portrait one.
 */
const SIZES: SizeTable<VideoResolution> = {
  "720p": { "16:9": "1280x720", "9:16": "720x1280" },
  "1080p": { "16:9": "1920x1080", "9:16": "1080x1920" },
  "1440p": { "16:9": "2560x1440", "9:16": "1440x2560" },
  "4k": { "16:9": "3840x2160", "9:16": "2160x3840" },
};

/** What a required `resolution` is filled with — the tier every model renders. */
const DEFAULT_TIER: VideoResolution = "1080p";
const DEFAULT_SHAPE = "16:9";

/** Both routes are on every model; which one runs is the image's business. */
const ROUTES: readonly VideoRoute[] = ["text", "image"];

/** The two shapes {@link SIZES} is keyed by — LTX publishes 16:9 and nothing else. */
const RATIOS = ["16:9", "9:16"] as const;

/**
 * LTX's per-model surface, read off `SUPPORT_MATRIX` in `./shared.ts`.
 *
 * The `fast` / `pro` split is the whole table: a fast model runs 6 to 20
 * seconds in even steps and reaches every tier, a pro model runs 6, 8 or 10.
 * `ltx-2-5-pro` is the one row that is neither — 720p and 1080p only, and the
 * one model whose `fps` list drops 48.
 *
 * **These lists are a union, not a product.** `checkSupportMatrix` owns the
 * pairings that a per-field row cannot state: a fast model's 12–20 second
 * lengths are 720p/1080p at 24 or 25 fps only, and 1440p/4k cap at 10 seconds
 * whatever the frame rate. So the row says "6 through 20 are lengths this model
 * offers" — true — and the endpoint answers for the combination, remapped onto
 * `duration`. `480p` is on no LTX model, which is why no row carries it.
 *
 * `fps` is typed as the exact per-model union rather than the exported
 * `LtxFps`, which is deliberately open (`| (number & {})`) because the wire
 * field is a bare `z.number().int()`. Here the model's matrix *is* the limit,
 * so the closed union is the truer type and `48` on `ltx-2-5-pro` is a compile
 * error rather than a 400.
 */
const FAST_FPS = [24, 25, 48, 50] as const;

const FAST_EXTRAS = {
  fps: EXTRA as (typeof FAST_FPS)[number],
  generate_audio: EXTRA as boolean,
  camera_motion: EXTRA as LtxCameraMotion,
} as const;

const FAST_ROW = {
  durations: [6, 8, 10, 12, 14, 16, 18, 20],
  resolutions: ["720p", "1080p", "1440p", "4k"],
  ratios: RATIOS,
  extras: FAST_EXTRAS,
} as const;

const PRO_ROW = {
  durations: [6, 8, 10],
  resolutions: ["720p", "1080p", "1440p", "4k"],
  ratios: RATIOS,
  extras: FAST_EXTRAS,
} as const;

const LIGHTRICKS_VIDEO_MODEL_PARAMS = {
  "ltx-2-5-fast": FAST_ROW,
  "ltx-2-5-pro": {
    durations: [6, 8, 10],
    resolutions: ["720p", "1080p"],
    ratios: RATIOS,
    extras: {
      fps: EXTRA as 24 | 25 | 50,
      generate_audio: EXTRA as boolean,
      camera_motion: EXTRA as LtxCameraMotion,
    },
  },
  "ltx-2-3-fast": FAST_ROW,
  "ltx-2-3-pro": PRO_ROW,
  "ltx-2-fast": FAST_ROW,
  "ltx-2-pro": PRO_ROW,
} as const satisfies VideoModelParamTable;

/** The wire body of whichever of the two routes the inputs select. */
export type LightricksVideoWire = TextToVideoParams | ImageToVideoParams;

/** What a unified video call to `lightricks/…` returns — one route's `Validated`. */
export type LightricksVideoResult =
  | ReturnType<typeof textValidator<TextToVideoParams>>
  | ReturnType<typeof imageValidator<ImageToVideoParams>>;

/** See the note on kling's image adapter: `validate` is contravariant. */
type LightricksValidate = CompiledCall<LightricksVideoWire, LightricksVideoResult>["validate"];

/** The body under construction, before the route narrows it. */
interface LtxDraft {
  model: string;
  prompt: string;
  duration: LtxDuration | null;
  resolution: LtxResolution;
  image_uri?: string;
  last_frame_uri?: string;
}

export const video = {
  category: "video",
  provider: "lightricks",
  models: MODELS,
  modelParams: LIGHTRICKS_VIDEO_MODEL_PARAMS,
  unsupported: {
    video:
      "POST /v2/text-to-video and /v2/image-to-video generate from a prompt and frames. LTX's " +
      "video inputs live on /v2/retake, /v2/extend, /v2/video-to-video-hdr and " +
      "/v2/video-to-video-reframe, none of which unmodel validates yet.",
    negativePrompt:
      "the LTX generation bodies have no negative-prompt field; describe what to avoid inside " +
      "`prompt`.",
    seed:
      "the LTX generation bodies have no seed field, so a generation is not reproducible from " +
      "the request.",
    n:
      "each request generates one video and answers with one job; issue one request per clip " +
      "(there is no count on either body).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<LightricksVideoWire, LightricksVideoResult> {
    ctx.from(["image_uri"], "image");
    ctx.from(["last_frame_uri"], "image");

    const route = ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes: ROUTES, source: MODELS_SOURCE },
        { path: ["image"], warn: ctx.warn },
      ),
    );

    if (input.prompt === undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["prompt"],
        message:
          "`prompt` is required by both LTX generation routes — on image-to-video it is how the " +
          "still is animated, so an image alone is not a request.",
        meta: { source: MODELS_SOURCE },
      });
    }

    // `resolution` carries the shape here, so a request that names only a
    // shape still lands in the tier table (at 1080p, the filled tier).
    let size: string | undefined;
    if (input.resolution === undefined && input.aspectRatio === undefined) {
      size = SIZES[DEFAULT_TIER]?.[DEFAULT_SHAPE];
      ctx.warn({
        code: "approximated_param",
        path: ["resolution"],
        message:
          `\`resolution\` is required by the LTX generation schema and no tier or shape was ` +
          `given, so ${JSON.stringify(size)} was sent — the tier every model renders, in ` +
          "landscape. Set `resolution` and `aspectRatio` to choose.",
        meta: { achieved: size, source: MODELS_SOURCE },
      });
    } else {
      if (input.aspectRatio !== undefined) ctx.from(["resolution"], "aspectRatio");
      size = ctx.take(
        toSizeEnum(input.aspectRatio ?? DEFAULT_SHAPE, input.resolution ?? DEFAULT_TIER, SIZES, {
          path: [input.aspectRatio !== undefined ? "aspectRatio" : "resolution"],
          warn: ctx.warn,
        }),
      );
    }

    // `duration` is required and nullable: `null` is LTX-2.5's documented
    // "automatic duration", which is the only honest thing to send for a
    // caller who named no length — and it is an approximation, because the
    // model rather than the request decides what comes back.
    let duration: number | null = null;
    if (input.duration === undefined) {
      ctx.warn({
        code: "approximated_param",
        path: ["duration"],
        message:
          "`duration` is required by the LTX generation schema, so `null` — its documented " +
          '"automatic duration" — was sent and the model picks the length. Set `duration` to ' +
          "choose (LTX-2.3 and LTX-2 need an explicit one).",
        meta: { achieved: null, source: MODELS_SOURCE },
      });
    } else {
      // No `allowed`: `checkSupportMatrix` carries this model's resolution ×
      // fps × duration matrix and answers on the way out, at `duration`.
      duration =
        ctx.take(toDurationNumber(input.duration, undefined, { path: ["duration"], warn: ctx.warn })) ??
        null;
    }

    const body: LtxDraft = {
      model: ctx.model,
      // Empty only when the check above failed, which is an error the kernel
      // has already collected — the body is never validated in that case.
      prompt: input.prompt ?? "",
      duration,
      resolution: (size ?? "") as LtxResolution,
    };

    const derive = { path: ["image"], warn: ctx.warn };
    const slots = ctx.take(resolveImageSlots(input.image, derive));
    if (slots !== undefined) {
      const hint =
        "LTX takes an HTTPS URL, a base64 data URI, or a `storage_uri` from POST /v1/upload; " +
        "pass `{ url }`, or a `data:` URI as `{ data }`.";
      if (slots.first !== undefined) {
        const uri = ctx.take(requireMediaUrl(slots.first, hint, derive));
        if (uri !== undefined) body.image_uri = uri;
      }
      if (slots.last !== undefined) {
        const uri = ctx.take(requireMediaUrl(slots.last, hint, derive));
        if (uri !== undefined) body.last_frame_uri = uri;
      }
      if (slots.references.length > 0) {
        ctx.take(
          unsupportedSlot(
            "reference",
            ctx.model,
            "`image_uri` and `last_frame_uri` are keyframes; the LTX generation routes have no " +
              "subject- or style-reference field.",
            derive,
          ),
        );
      }
    }

    applyExtras(input, LIGHTRICKS_VIDEO_MODEL_PARAMS, body, ctx);

    const validate = (route === "image" ? imageValidator.safe : textValidator.safe) as LightricksValidate;
    // One cast, at the one place the two routes meet: each validator takes its
    // own arm of the union, and the inputs decided which arm `body` is.
    return { params: body as unknown as LightricksVideoWire, validate };
  },
} as const satisfies VideoAdapterFor<
  typeof LIGHTRICKS_VIDEO_MODEL_PARAMS,
  LightricksVideoWire,
  LightricksVideoResult
>;
