/**
 * `unmodel/video` → `bytedance.video`
 * (POST /api/v3/contents/generations/tasks — Seedance / Dreamina Seedance).
 *
 * # One route, and `content[]` is where the mode lives
 *
 * ModelArk's video task takes a chat-style `content` array: a `text` item plus
 * image, video and audio items whose `role` says what each one is for. So the
 * route derivation lands on roles rather than URLs, and the scenarios the docs
 * say "cannot be mixed" — first/last frame versus reference — are exactly the
 * `"image"` and `"reference"` routes this category derives.
 *
 * | canonical | wire | notes |
 * |---|---|---|
 * | `prompt` | `content[0]` `{ type: "text" }` | required: it is the only text input |
 * | `image` (first / last) | `{ type: "image_url", role: "first_frame" / "last_frame" }` | |
 * | `image` (reference) | `{ type: "image_url", role: "reference_image" }` | 2.x only |
 * | `video` | `{ type: "video_url", role: "reference_video" }` | 2.x only |
 * | `duration` | `duration` | plain seconds; per-model bounds on the way out |
 * | `resolution` | `resolution` | **S6** — the one provider whose four tiers *are* the canonical four |
 * | `aspectRatio` | `ratio` | **S1**, minus `adaptive` (which is not a shape) |
 * | `seed` | `seed` | Seedance 1.x only; the 2.x arms deny it by name |
 *
 * `resolution` is the pleasant case in this category: `480p`, `720p`, `1080p`
 * and `4k` are ModelArk's own spellings, so four of the five canonical tiers
 * map through unchanged and `1440p` is the only error — and it is a real one,
 * because no Seedance model renders it.
 *
 * # What the endpoint's own tables answer for
 *
 * Which resolutions a model offers (2.5 stops at 720p, only 2.0 has 4K), what
 * `duration` range it takes, whether it has `seed` at all, and whether it
 * accepts reference input are all in `videoConstraints` / `videoShapeRules`,
 * transcribed from the capability matrix. This adapter sends the params and
 * lets those tables speak, remapped onto the canonical field — a second copy
 * here would be a second opinion about the same page.
 *
 * The legacy `--rs/--dur/--rt` prompt commands are deliberately untouched: they
 * ride inside `content[].text`, which is the caller's prompt, and rewriting a
 * prompt is not this layer's business.
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
import { VIDEO_API_SOURCE, VIDEO_RATIOS, videoShapeRules } from "./constraints";
import {
  video as validator,
  type ArkOmniContent,
  type ArkVideoRatio,
  type ContentGenerationTasksBody,
} from "./video";
import { BYTEDANCE_VIDEO_MODEL_PARAMS, MODELS } from "./video-params";

/**
 * `resolution` — ModelArk names its tiers exactly as the vocabulary does, so
 * this is an identity table and not a coincidence worth hiding: it is what
 * makes `480p` and `4k` lossless here and errors at most other providers.
 * Which of the four a given model offers is `videoConstraints`' business.
 */
const RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "480p": "480p",
  "720p": "720p",
  "1080p": "1080p",
  "4k": "4k",
};

/** The wire body this adapter compiles to — the loose arm of the task body. */
export interface BytedanceVideoWire {
  model: string;
  content: ArkOmniContent[];
  resolution?: string;
  ratio?: ArkVideoRatio;
  duration?: number;
  seed?: number;
  [key: string]: unknown;
}

/** What a unified video call to `bytedance/…` returns: `bytedance.video`'s `Validated`. */
export type BytedanceVideoResult = ReturnType<typeof validator>;

/** The routes a model serves, read off the endpoint's own shape-rules table. */
function routesFor(model: string): readonly VideoRoute[] {
  const rules = videoShapeRules[model];
  const routes: VideoRoute[] = ["text", "image"];
  // An id with no row is one this snapshot has not seen (a new model, or an
  // `ep-…` endpoint id): it has already drawn `unknown_model`, and gating it
  // against a table that does not describe it would be a guess dressed as a
  // check.
  if (rules === undefined || rules.maxReferenceImages > 0) routes.push("reference");
  if (rules === undefined || rules.maxReferenceVideos > 0) routes.push("video");
  return routes;
}

export const video = {
  category: "video",
  provider: "bytedance",
  models: MODELS,
  modelParams: BYTEDANCE_VIDEO_MODEL_PARAMS,
  unsupported: {
    negativePrompt:
      "the video task body has no negative-prompt field — ModelArk's steering knobs are the " +
      "prompt text and `camera_fixed` — so describe what to avoid inside `prompt`.",
    n:
      "one task produces one video and the response is a single task id; issue one request per " +
      "clip (there is no count on the body).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<BytedanceVideoWire, BytedanceVideoResult> {
    ctx.from(["content"], "image");
    ctx.from(["ratio"], "aspectRatio");

    const content: ArkOmniContent[] = [];
    // "`content` is a chat-style array" whose text item is the prompt: there is
    // no other text input, so an absent prompt is reported at `prompt` rather
    // than as an empty `content` array the schema rejects.
    if (input.prompt === undefined) {
      ctx.fail({
        code: "invalid_shape",
        path: ["prompt"],
        message:
          "`prompt` is required by POST /api/v3/contents/generations/tasks — the `text` item of " +
          "`content` is the only text input the route has, on every scenario.",
        meta: { source: VIDEO_API_SOURCE },
      });
    } else {
      ctx.from(["content", 0, "text"], "prompt");
      content.push({ type: "text", text: input.prompt });
    }

    ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes: routesFor(ctx.model), source: VIDEO_API_SOURCE },
        { path: ["image"], warn: ctx.warn },
      ),
    );

    const derive = { path: ["image"], warn: ctx.warn };
    const slots = ctx.take(resolveImageSlots(input.image, derive));
    if (slots !== undefined) {
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

    const body: BytedanceVideoWire = { model: ctx.model, content };

    if (input.duration !== undefined) {
      // No `allowed`: `videoShapeRules` carries this model's own bounds (4–30
      // on 2.5, 2–12 on 1.0) plus the `-1` auto-duration rule, and answers on
      // the way out at `duration`.
      const duration = ctx.take(
        toDurationNumber(input.duration, undefined, { path: ["duration"], warn: ctx.warn }),
      );
      if (duration !== undefined) body.duration = duration;
    }

    if (input.resolution !== undefined) {
      const resolution = ctx.take(
        toTier(input.resolution, RESOLUTIONS, { path: ["resolution"], warn: ctx.warn }),
      );
      if (resolution !== undefined) body.resolution = resolution;
    }

    if (input.aspectRatio !== undefined) {
      const ratio = ctx.take(
        toRatioEnum(
          input.aspectRatio,
          // `adaptive` is not a shape: it is what an image-driven request
          // follows the input with, and it is the *default* there — so it is
          // never a candidate for a caller who named a ratio.
          VIDEO_RATIOS.filter((value) => value !== "adaptive"),
          { source: VIDEO_API_SOURCE },
          { path: ["aspectRatio"], warn: ctx.warn },
        ),
      );
      if (ratio !== undefined) body.ratio = ratio as ArkVideoRatio;
    }

    if (input.seed !== undefined) body.seed = input.seed;

    applyExtras(input, BYTEDANCE_VIDEO_MODEL_PARAMS, body, ctx);

    return { params: body as BytedanceVideoWire & ContentGenerationTasksBody, validate: validator.safe };
  },
} as const satisfies VideoAdapterFor<
  typeof BYTEDANCE_VIDEO_MODEL_PARAMS,
  BytedanceVideoWire,
  BytedanceVideoResult
>;
