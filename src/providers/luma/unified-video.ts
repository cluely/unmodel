/**
 * `unmodel/video` → `luma.video` (POST /dream-machine/v1/generations — Ray).
 *
 * # The route is the same object with a `keyframes` block in it
 *
 * Luma is the provider this category's one-route design was drawn from: text,
 * image-to-video and extend are the *same* POST, and what changes is whether
 * `keyframes.frame0` / `.frame1` are present. So the route derivation costs
 * nothing here — it decides which keyframe slot to fill, not which URL to
 * call — and the only route that genuinely is not on this endpoint is
 * video-to-video, which lives at `luma.videoModify` and needs a `mode` this
 * vocabulary has no word for (see `unsupported.video`).
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `duration: 5` | `duration: "5s"` | {@link toDurationSuffixedString}, closed at 5 and 9 |
 * | `resolution` | `resolution: "720p"` | **S6**, and the names line up exactly |
 * | `aspectRatio` | `aspect_ratio` | **S1** — a closed six-value enum |
 * | `image` (first) | `keyframes.frame0` | `{ type: "image", url }` |
 * | `image` (last) | `keyframes.frame1` | same shape, closing frame |
 *
 * # Duration is the tightest enum in the category
 *
 * Two values — `"5s"` and `"9s"`. Every other spelling of a duration in this
 * category is a range or a longer list, so Luma is where the "never the
 * nearest" rule earns its keep: `duration: 8` here is an `invalid_enum_value`
 * naming 5 and 9, not a silent 9-second clip that costs almost twice what a
 * 5-second one does.
 *
 * `540p` is the one documented resolution with no canonical name (the
 * vocabulary's tiers are 480p/720p/1080p/1440p/4k), so it is absent from the
 * table below and reachable through `providerOptions.luma.resolution`. `480p`
 * and `1440p` are errors rather than a snap onto it.
 *
 * # Keyframes take URLs, and that is the whole story about media
 *
 * `LumaKeyframe` is `{ type: "image", url }` or `{ type: "generation", id }` —
 * there is no inline-bytes form anywhere on this route, so `image: { data }`
 * is an `unsupported_param` pointing at the upload rather than a `data:` URI
 * sent into a field the API fetches. The `generation` form has no canonical
 * spelling either (a generation id is a Luma handle, not media), and
 * `providerOptions.luma.keyframes` is how a caller extends one.
 */
import {
  applyExtras,
  EXTRA,
  requireMediaUrl,
  resolveImageSlots,
  resolveVideoRoute,
  toDurationSuffixedString,
  toRatioEnum,
  toTier,
  unsupportedSlot,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoModelParamTable,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import { LUMA_ASPECT_RATIOS } from "./shared";
import {
  video as validator,
  type GenerationsParams,
  type LumaConcept,
  type LumaKeyframes,
} from "./video";

/** The two Ray ids this route serves — the `luma/…` ref union. */
const MODELS = ["ray-2", "ray-flash-2"] as const;

const VIDEO_GENERATION_DOCS = "https://docs.lumalabs.ai/docs/video-generation";

/** "Duration can be 5s or 9s" — the two documented values, as seconds. */
const DURATIONS = [5, 9] as const;

/**
 * `resolution` — the documented enum minus `540p`, which the canonical tiers
 * have no name for. The three that are named map through unchanged, which is
 * the pleasant case: no approximation, so no warning.
 */
const RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "720p": "720p",
  "1080p": "1080p",
  "4k": "4k",
};

/** Text and image-to-video are the same POST; extend needs a generation id. */
const ROUTES: readonly VideoRoute[] = ["text", "image"];

/**
 * Ray's per-model surface — one row, used twice.
 *
 * `ray-2` and `ray-flash-2` share `GenerationsParams` byte for byte and differ
 * only in price, and there is no per-model table anywhere in this provider (the
 * two checks `luma.video` runs are model-independent), so a second row would be
 * a second thing to keep in step with nothing.
 *
 * `durations` is the tightest enum in the category and the reason `duration` is
 * a closed list rather than a range here: `7` is a compile error naming 5 and 9
 * rather than a 9-second clip at nearly twice the price.
 *
 * The two extras are Ray's own generation controls, typed from `./video.ts`'s
 * `LumaConcept` rather than restated. `keyframes` is deliberately absent — it
 * is the *other* spelling of the canonical `image`, and the adapter writes it —
 * and `callback_url` is transport.
 */
const LUMA_ROW = {
  durations: DURATIONS,
  resolutions: ["720p", "1080p", "4k"],
  ratios: LUMA_ASPECT_RATIOS,
  extras: {
    loop: EXTRA as boolean,
    concepts: EXTRA as LumaConcept[],
  },
} as const;

const LUMA_VIDEO_MODEL_PARAMS = {
  "ray-2": LUMA_ROW,
  "ray-flash-2": LUMA_ROW,
} as const satisfies VideoModelParamTable;

/** The wire body this adapter compiles to — `luma.video`'s own param type. */
export interface LumaVideoWire extends GenerationsParams {}

/** What a unified video call to `luma/…` returns: `luma.video`'s `Validated`. */
export type LumaVideoResult = ReturnType<typeof validator>;

export const video = {
  category: "video",
  provider: "luma",
  models: MODELS,
  modelParams: LUMA_VIDEO_MODEL_PARAMS,
  unsupported: {
    video:
      "POST /generations takes a prompt and keyframes, not a source clip. Luma edits video at " +
      "`luma.videoModify` (POST /generations/video/modify), whose required `mode` — nine steps " +
      "from adhere_1 to reimagine_3 — decides how closely the output tracks the input and has " +
      "no canonical spelling, so it cannot be compiled from this vocabulary.",
    negativePrompt:
      "POST /generations has no negative-prompt field; describe what to avoid inside `prompt`.",
    seed: "POST /generations has no seed field, so Luma output is not reproducible from the request.",
    n:
      "POST /generations starts one generation and answers with one job; issue one request per " +
      "clip (there is no sample count on the body).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<LumaVideoWire, LumaVideoResult> {
    ctx.from(["aspect_ratio"], "aspectRatio");
    ctx.from(["keyframes"], "image");
    ctx.from(["keyframes", "frame0"], "image");
    ctx.from(["keyframes", "frame1"], "image");

    const body: LumaVideoWire = { model: ctx.model };
    if (input.prompt !== undefined) body.prompt = input.prompt;

    ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes: ROUTES, source: VIDEO_GENERATION_DOCS },
        { path: ["image"], warn: ctx.warn },
      ),
    );

    if (input.duration !== undefined) {
      const duration = ctx.take(
        toDurationSuffixedString(input.duration, [...DURATIONS], {
          path: ["duration"],
          warn: ctx.warn,
        }),
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
          LUMA_ASPECT_RATIOS,
          { source: VIDEO_GENERATION_DOCS },
          { path: ["aspectRatio"], warn: ctx.warn },
        ),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio as LumaVideoWire["aspect_ratio"];
    }

    const slots = ctx.take(resolveImageSlots(input.image, { path: ["image"], warn: ctx.warn }));
    if (slots !== undefined) {
      const keyframes: LumaKeyframes = {};
      const toKeyframe = (image: (typeof slots)["first"]): string | undefined =>
        image === undefined
          ? undefined
          : ctx.take(
              requireMediaUrl(
                image,
                "`keyframes` take `{ type: \"image\", url }` — a public URL Luma fetches — or a " +
                  "previous generation's id; there is no inline-bytes form on this route.",
                { path: ["image"], warn: ctx.warn },
              ),
            );
      const frame0 = toKeyframe(slots.first);
      const frame1 = toKeyframe(slots.last);
      if (frame0 !== undefined) keyframes.frame0 = { type: "image", url: frame0 };
      if (frame1 !== undefined) keyframes.frame1 = { type: "image", url: frame1 };
      if (slots.references.length > 0) {
        ctx.take(
          unsupportedSlot(
            "reference",
            ctx.model,
            "`keyframes` are the first and last frames of the clip; POST /generations has no " +
              "subject- or style-reference field.",
            { path: ["image"], warn: ctx.warn },
          ),
        );
      }
      if (Object.keys(keyframes).length > 0) body.keyframes = keyframes;
    }

    applyExtras(input, LUMA_VIDEO_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VideoAdapterFor<
  typeof LUMA_VIDEO_MODEL_PARAMS,
  LumaVideoWire,
  LumaVideoResult
>;
