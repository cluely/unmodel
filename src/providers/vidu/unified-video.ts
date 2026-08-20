/**
 * `unmodel/video` → `vidu.video` (POST /ent/v2/text2video), `vidu.videoFromImage`
 * (/img2video) and `vidu.videoFromReference` (/reference2video).
 *
 * # Three URLs, and the inputs pick one
 *
 * Vidu is the provider whose wire layout matches this category's route
 * derivation exactly: a prompt goes to `text2video`, a start frame to
 * `img2video`, and anything tagged `role: "reference"` to `reference2video` —
 * three different endpoints with three different per-model tables. Which
 * models are on which route is genuinely different (`viduq3-mix` is
 * reference-only; `viduq1-classic` is image-only; `viduq3-pro` has no
 * reference arm), so an unavailable route is an error naming the derivation
 * rather than a 404 later.
 *
 * A source clip is a reference too: `reference2video`'s `videos` array is the
 * only video input Vidu documents, so `video` compiles to that array — on
 * `viduq2-pro`, the one model whose arm has it, with the endpoint's own check
 * answering for every other id.
 *
 * | canonical | wire | notes |
 * |---|---|---|
 * | `duration` | `duration` | plain seconds; per-model bounds on the way out |
 * | `resolution` | `resolution` | **S6** — `720p` / `1080p`, the two with canonical names |
 * | `aspectRatio` | `aspect_ratio` | **S1**; absent from `img2video` — the frame does it |
 * | `image` (first) | `images: [uri]` | exactly one on every img2video arm |
 * | `image` (reference) | `images: [uri, …]` | 1–7 flat references |
 * | `video` | `videos: [uri]` | `viduq2-pro` only |
 * | `seed` | `seed` | |
 *
 * `360p` and `540p` are documented values with no canonical tier name, so they
 * are absent from the table below and reachable through
 * `providerOptions.vidu.resolution`; `480p`, `1440p` and `4k` are errors
 * naming what exists rather than a snap onto the nearest, which at 360p would
 * be a quarter of the pixels the caller asked for.
 *
 * `img2video` has no `aspect_ratio` at all — the start frame sets the frame —
 * so a shape passed with an image is an `unsupported_param` saying which of
 * the two to drop, rather than a param silently ignored.
 */
import {
  applyExtras,
  EXTRA,
  requireMediaUrl,
  resolveImageSlots,
  resolveVideoRoute,
  toDurationNumber,
  toRatioEnum,
  toTier,
  videoRoute,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoModelParamTable,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import { DOCS_BASE, VIDU_ASPECT_RATIOS, type ViduMovementAmplitude } from "./shared";
import { TEXT2VIDEO_SUPPORT, video as textValidator, type Text2VideoParams } from "./video";
import {
  IMG2VIDEO_SUPPORT,
  videoFromImage as imageValidator,
  type Img2VideoParams,
} from "./video-from-image";
import {
  REFERENCE2VIDEO_SUPPORT,
  videoFromReference as referenceValidator,
  type Reference2VideoParams,
} from "./video-from-reference";

/** Every model with a video arm on any of the three routes. */
const MODELS = [
  "viduq3-pro",
  "viduq3-pro-fast",
  "viduq3-turbo",
  "viduq3",
  "viduq3-mix",
  "viduq2",
  "viduq2-pro",
  "viduq2-pro-fast",
  "viduq2-turbo",
  "viduq1",
  "viduq1-classic",
  "vidu2.0",
] as const;

/**
 * `resolution` — the two documented values the canonical tiers name. 360p and
 * 540p exist on the wire and have no canonical spelling; see the header.
 */
const RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "720p": "720p",
  "1080p": "1080p",
};

/**
 * Vidu's per-model surface.
 *
 * `durations` is present on only three rows, and the reason is the same one
 * Seedance gives: every other model's length is an inclusive *range* (1–16 on
 * q3, 1–10 on q2) enforced by `checkRouteSupport`, not an enum. `viduq1` and
 * `viduq1-classic` are exactly 5 seconds and `vidu2.0` is 4 or 8, so those
 * three narrow and the rest keep the wide `number`.
 *
 * `ratios: []` marks the five **image-only** models. `aspect_ratio` does not
 * exist on `POST /ent/v2/img2video` — the start frame sets the shape — so a
 * model whose only route is that one has no shape field to fill, and the type
 * now says so instead of the adapter saying it after the fact. The models that
 * also serve text2video or reference2video keep the five-value enum.
 *
 * `resolutions` is `720p`/`1080p` almost everywhere: `360p` and `540p` are real
 * wire values with no canonical name (they live on
 * `providerOptions.vidu.resolution`), and the q1 pair renders 1080p only.
 *
 * The three extras are the fields present on **all three** routes. `style`,
 * `audio_type`, `voice_id`, `is_rec`, `auto_subjects` and `subjects` are
 * deliberately absent: each exists on one or two of the three route bodies, and
 * a per-model row cannot say "only when you also pass an image" — declaring one
 * would put it on a body that has no such key for exactly the callers who used
 * the other route. `providerOptions.vidu` reaches all of them.
 */
const VIDU_EXTRAS = {
  movement_amplitude: EXTRA as ViduMovementAmplitude,
  bgm: EXTRA as boolean,
  audio: EXTRA as boolean,
} as const;

const TIERS = ["720p", "1080p"] as const;

/** A model that serves text2video or reference2video: the shape enum applies. */
const SHAPED_ROW = {
  resolutions: TIERS,
  ratios: VIDU_ASPECT_RATIOS,
  extras: VIDU_EXTRAS,
} as const;

/** An image-only model: `img2video` has no `aspect_ratio` field at all. */
const FRAME_ONLY_ROW = {
  resolutions: TIERS,
  ratios: [],
  extras: VIDU_EXTRAS,
} as const;

const VIDU_VIDEO_MODEL_PARAMS = {
  "viduq3-pro": SHAPED_ROW,
  "viduq3-pro-fast": FRAME_ONLY_ROW,
  "viduq3-turbo": SHAPED_ROW,
  viduq3: SHAPED_ROW,
  "viduq3-mix": SHAPED_ROW,
  viduq2: SHAPED_ROW,
  "viduq2-pro": SHAPED_ROW,
  "viduq2-pro-fast": FRAME_ONLY_ROW,
  "viduq2-turbo": FRAME_ONLY_ROW,
  viduq1: {
    durations: [5],
    resolutions: ["1080p"],
    ratios: VIDU_ASPECT_RATIOS,
    extras: VIDU_EXTRAS,
  },
  "viduq1-classic": {
    durations: [5],
    resolutions: ["1080p"],
    ratios: [],
    extras: VIDU_EXTRAS,
  },
  "vidu2.0": {
    durations: [4, 8],
    resolutions: TIERS,
    ratios: VIDU_ASPECT_RATIOS,
    extras: VIDU_EXTRAS,
  },
} as const satisfies VideoModelParamTable;

/** The wire body of whichever of the three routes the inputs select. */
export type ViduVideoWire = Text2VideoParams | Img2VideoParams | Reference2VideoParams;

/** What a unified video call to `vidu/…` returns — one route's `Validated`. */
export type ViduVideoResult =
  | ReturnType<typeof textValidator>
  | ReturnType<typeof imageValidator>
  | ReturnType<typeof referenceValidator>;

/** See the note on kling's image adapter: `validate` is contravariant. */
type ViduValidate = CompiledCall<ViduVideoWire, ViduVideoResult>["validate"];

/**
 * The body under construction, before the route narrows it.
 *
 * Looser than every arm in one place — `prompt` is optional here and required
 * on two of the three routes — because which route this is has not been
 * decided when the field is written, and the arm that requires it says so on
 * the way out, at `prompt`.
 */
interface ViduDraft {
  model: string;
  prompt?: string;
  duration?: number;
  resolution?: string;
  aspect_ratio?: string;
  seed?: number;
  images?: string[];
  videos?: string[];
}

/**
 * The routes a model serves, read off the three endpoints' own tables.
 *
 * An id on none of them is one this snapshot has not seen: it has already drawn
 * `unknown_model`, and refusing every route for it would be a guess dressed as
 * a check, so every route stays open and the endpoint answers.
 */
function routesFor(model: string): readonly VideoRoute[] {
  const routes: VideoRoute[] = [];
  if (TEXT2VIDEO_SUPPORT[model] !== undefined) routes.push("text");
  if (IMG2VIDEO_SUPPORT[model] !== undefined) routes.push("image");
  if (REFERENCE2VIDEO_SUPPORT[model] !== undefined) routes.push("reference", "video");
  return routes.length > 0 ? routes : ["text", "image", "reference", "video"];
}

export const video = {
  category: "video",
  provider: "vidu",
  models: MODELS,
  modelParams: VIDU_VIDEO_MODEL_PARAMS,
  unsupported: {
    negativePrompt:
      "none of Vidu's video routes has a negative-prompt field; describe what to avoid inside " +
      "`prompt`.",
    n:
      "every Vidu video route starts one task and answers with one task id; issue one request " +
      "per clip (there is no sample count on any of the three bodies).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<ViduVideoWire, ViduVideoResult> {
    const derived = ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes: routesFor(ctx.model), source: `${DOCS_BASE}/text-to-video` },
        { path: ["image"], warn: ctx.warn },
      ),
    );
    // A model with no arm for the derived route has already failed above; the
    // body is still compiled (and never validated) so one pass reports
    // everything else wrong with the request too.
    const route = derived ?? videoRoute(input);
    const source = `${DOCS_BASE}/${
      route === "image" ? "image-to-video" : route === "text" ? "text-to-video" : "reference-to-video"
    }`;

    ctx.from(["aspect_ratio"], "aspectRatio");
    ctx.from(["images"], "image");
    ctx.from(["videos"], "video");

    const body: ViduDraft = { model: ctx.model };
    if (input.prompt !== undefined) body.prompt = input.prompt;

    if (input.duration !== undefined) {
      // No `allowed`: each route's `checkRouteSupport` carries this model's own
      // bounds (1–16 on q3, exactly 5 on q1) and answers on the way out.
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
      if (route === "image") {
        ctx.fail({
          code: "unsupported_param",
          path: ["aspectRatio"],
          message:
            "POST /ent/v2/img2video has no `aspect_ratio` field — the start frame sets the shape " +
            "of the clip. Drop `aspectRatio`, or drop `image` for a text-to-video request.",
          meta: { source },
        });
      } else {
        const ratio = ctx.take(
          toRatioEnum(
            input.aspectRatio,
            VIDU_ASPECT_RATIOS,
            { source },
            { path: ["aspectRatio"], warn: ctx.warn },
          ),
        );
        if (ratio !== undefined) body.aspect_ratio = ratio;
      }
    }

    if (input.seed !== undefined) body.seed = input.seed;

    const derive = { path: ["image"], warn: ctx.warn };
    const slots = ctx.take(resolveImageSlots(input.image, derive));
    const hint =
      "Vidu fetches `images` entries as public URLs or base64 data URIs; pass `{ url }`, or a " +
      "`data:` URI as `{ data }`.";
    if (slots !== undefined) {
      const images: string[] = [];
      for (const image of [slots.first, ...slots.references]) {
        if (image === undefined) continue;
        const uri = ctx.take(requireMediaUrl(image, hint, derive));
        if (uri !== undefined) images.push(uri);
      }
      if (slots.last !== undefined) {
        // Vidu's first-and-last-frame generation is `start-end2video`, a fourth
        // route unmodel does not validate yet — so this is a gap with a name
        // rather than a frame quietly dropped into `images`.
        ctx.fail({
          code: "unsupported_param",
          path: ["image"],
          message:
            '`role: "last"` is Vidu\'s `start-end2video` route (POST /ent/v2/start-end2video), ' +
            "which unmodel does not validate yet; `img2video` takes exactly one start frame.",
          meta: { source },
        });
      }
      if (images.length > 0) body.images = images;
    }

    if (input.video !== undefined) {
      const uri = ctx.take(
        requireMediaUrl(input.video, hint, { path: ["video"], warn: ctx.warn }),
      );
      // `videos` rides on reference2video and is `viduq2-pro`-only; that check
      // is the endpoint's, and its message names the model.
      if (uri !== undefined) body.videos = [uri];
    }

    applyExtras(input, VIDU_VIDEO_MODEL_PARAMS, body, ctx);

    const validate = (
      route === "image"
        ? imageValidator.safe
        : route === "text"
          ? textValidator.safe
          : referenceValidator.safe
    ) as ViduValidate;
    // One cast, at the one place the three routes meet: each validator takes
    // its own arm of the union, and the inputs decided which arm `body` is.
    return { params: body as unknown as ViduVideoWire, validate };
  },
} as const satisfies VideoAdapterFor<
  typeof VIDU_VIDEO_MODEL_PARAMS,
  ViduVideoWire,
  ViduVideoResult
>;
