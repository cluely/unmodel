/**
 * `unmodel/video` → xAI Grok Imagine
 * (POST https://api.x.ai/v1/videos/generations).
 *
 * # One route, three input modes
 *
 * Text-to-video, image-to-video and reference-to-video are one POST whose mode
 * is decided by which inputs are present — exactly the shape the canonical
 * vocabulary assumes — so the compile is mostly renames:
 *
 * | canonical | wire | class |
 * |---|---|---|
 * | `prompt` | `prompt` | rename; required for text-to-video only (the validator checks it) |
 * | `model` (ref tail) | `model` | rename |
 * | `image` (role `first`) | `image.url` | {@link toMediaUri} — a URL, or inline bytes as a `data:` URL |
 * | `image` (role `reference`) | `reference_images[].url` | same; no reference route on grok-imagine-video-1.5-lite |
 * | `image` (role `last`) | `last_frame.url` | same; grok-imagine-video-1.5 only, else {@link unsupportedSlot} |
 * | `duration` | `duration` | plain number; range 1–15 checked by the validator |
 * | `resolution` | `resolution` | identity — xAI spells `480p`/`720p`/`1080p` canonically |
 * | `aspectRatio` | `aspect_ratio` | **S1** {@link toRatioEnum}, nine values |
 * | `video` | — | the edit/extend routes: `xai.videoEdit` / `xai.videoExtend` |
 * | `n`, `seed`, `negativePrompt` | — | declared gaps |
 *
 * # What the generations route has no field for
 *
 * - **`video`** — a source clip belongs to `POST /v1/videos/edits` (restyle)
 *   or `/v1/videos/extensions` (continue), which are different endpoints with
 *   different bodies; this adapter serves the generation route and points the
 *   caller at `xai.videoEdit` / `xai.videoExtend` instead of guessing which
 *   of the two they meant.
 * - **`n`** — one request starts one generation and answers one `request_id`.
 * - **`seed`** — no seed field; a generation is not reproducible.
 * - **`negativePrompt`** — no negative-prompt field.
 *
 * `reference_audios` (R2V voices, addressed in the prompt as `<AUDIO_0>`…),
 * `output`, `storage_options` and `user` have no canonical spelling in this
 * category and are the rows' extras.
 *
 * # Inline bytes travel as data URLs
 *
 * The wire's media inputs are `{url}` or `{file_id}` objects, and `url` takes
 * a data URL: the OpenAPI `ImageUrl` "Accepts a public URL, a base64-encoded
 * data URL, or a file_id from the xAI Files API"
 * (https://docs.x.ai/openapi.json, 2026-11-12). Canonical `{data, mimeType}`
 * therefore compiles to `data:<mimeType>;base64,<data>`; bytes with no
 * `mimeType` are an `invalid_shape` refusal from {@link toMediaUri}, never a
 * guessed media type.
 */
import {
  applyExtras,
  resolveImageSlots,
  resolveVideoRoute,
  toDurationNumber,
  toMediaUri,
  toRatioEnum,
  unsupportedSlot,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { VideoAdapterFor, VideoParams } from "../../core/unified/vocabulary/video";
import {
  video as validator,
  VIDEO_TEXT_IMAGE_ONLY_MODELS,
  VIDEO_VOICE_AND_FRAME_MODELS,
  type VideoGenerationsParams,
  type XaiVideoAspectRatio,
  type XaiVideoResolution,
} from "./video";
import { MODELS, XAI_VIDEO_MODEL_PARAMS, XAI_VIDEO_ROW } from "./video-params";

const VIDEO_DOCS = "https://docs.x.ai/developers/model-capabilities/video/generation";

/** The wire body this adapter compiles to. */
export type XaiVideoWire = VideoGenerationsParams;

/** What a unified video call to `xai/…` returns: `xai.video`'s own `Validated`. */
export type XaiVideoResult = ReturnType<typeof validator>;

export const video = {
  category: "video",
  provider: "xai",
  models: MODELS,
  modelParams: XAI_VIDEO_MODEL_PARAMS,
  unsupported: {
    n:
      "POST /v1/videos/generations starts one generation and answers with one request_id; issue " +
      "one request per clip (there is no sample count on the body).",
    seed: "xAI's video routes have no seed field, so a generation is not reproducible from the request.",
    negativePrompt:
      "POST /v1/videos/generations has no negative-prompt field; describe what to avoid inside " +
      "`prompt`.",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<XaiVideoWire, XaiVideoResult> {
    ctx.from(["image"], "image");
    ctx.from(["reference_images"], "image");
    ctx.from(["last_frame"], "image");
    ctx.from(["aspect_ratio"], "aspectRatio");

    // `prompt` is "required only for text-to-video"; the validator's own
    // check answers a text-only request without one, so an absent prompt is
    // simply not written.
    const body: XaiVideoWire = {
      model: ctx.model,
      ...(input.prompt !== undefined && { prompt: input.prompt }),
    };

    ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes: routesFor(ctx.model), source: VIDEO_DOCS },
        { path: ["image"], warn: ctx.warn },
      ),
    );

    if (input.video !== undefined) {
      ctx.fail({
        code: "unsupported_param",
        path: ["video"],
        message:
          "POST /v1/videos/generations takes a prompt and images, not a source clip; xAI's " +
          "edit and extension routes are separate endpoints — use the `xai.videoEdit` " +
          "(POST /v1/videos/edits) or `xai.videoExtend` (POST /v1/videos/extensions) validator.",
        meta: { source: VIDEO_DOCS },
      });
    }

    if (input.duration !== undefined) {
      // No `allowed`: the documented range (1–15) is the validator's check,
      // and a range cannot be a list.
      const duration = ctx.take(
        toDurationNumber(input.duration, undefined, { path: ["duration"], warn: ctx.warn }),
      );
      if (duration !== undefined) body.duration = duration;
    }

    if (input.resolution !== undefined) {
      // xAI spells its three tiers exactly the way the canonical vocabulary
      // does, so this is a closed-enum membership test, not a translation.
      const allowed = XAI_VIDEO_ROW.resolutions as readonly string[];
      if (!allowed.includes(input.resolution)) {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["resolution"],
          message:
            `\`resolution\` must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} ` +
            `on POST /v1/videos/generations; got ${JSON.stringify(input.resolution)}.`,
          meta: { allowed: [...allowed], value: input.resolution, source: VIDEO_DOCS },
        });
      } else {
        body.resolution = input.resolution as XaiVideoResolution;
      }
    }

    if (input.aspectRatio !== undefined) {
      const ratio = ctx.take(
        toRatioEnum(input.aspectRatio, XAI_VIDEO_ROW.ratios, { source: VIDEO_DOCS }, {
          path: ["aspectRatio"],
          warn: ctx.warn,
        }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio as XaiVideoAspectRatio;
    }

    const slots = ctx.take(resolveImageSlots(input.image, { path: ["image"], warn: ctx.warn }));
    if (slots !== undefined) {
      const derive = { path: ["image"], warn: ctx.warn };
      if (slots.first !== undefined) {
        const url = ctx.take(toMediaUri(slots.first, derive));
        if (url !== undefined) body.image = { url };
      }
      if (slots.last !== undefined) {
        if (hasLastFrame(ctx.model)) {
          const url = ctx.take(toMediaUri(slots.last, derive));
          if (url !== undefined) body.last_frame = { url };
        } else {
          ctx.take(
            unsupportedSlot(
              "last",
              ctx.model,
              "a pinned last frame (`last_frame`) is served by grok-imagine-video-1.5 only.",
              derive,
            ),
          );
        }
      }
      if (slots.references.length > 0) {
        const references: { url: string }[] = [];
        for (const reference of slots.references) {
          const url = ctx.take(toMediaUri(reference, derive));
          if (url !== undefined) references.push({ url });
        }
        if (references.length > 0) body.reference_images = references;
      }
    }

    applyExtras(input, XAI_VIDEO_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies VideoAdapterFor<typeof XAI_VIDEO_MODEL_PARAMS, XaiVideoWire, XaiVideoResult>;

/**
 * The routes a model serves: grok-imagine-video-1.5-lite has no
 * reference-to-video mode (./video's `VIDEO_TEXT_IMAGE_ONLY_MODELS`).
 */
function routesFor(model: string): readonly VideoRoute[] {
  return (VIDEO_TEXT_IMAGE_ONLY_MODELS as readonly string[]).includes(model)
    ? ["text", "image"]
    : ["text", "image", "reference"];
}

/**
 * Whether a model has `last_frame`: of the catalogued ids only
 * grok-imagine-video-1.5 does (./video's `VIDEO_VOICE_AND_FRAME_MODELS`). An
 * id outside the catalog (a documented alias, a newer model) is left to the
 * validator, as {@link routesFor} leaves it.
 */
function hasLastFrame(model: string): boolean {
  return (
    (VIDEO_VOICE_AND_FRAME_MODELS as readonly string[]).includes(model) ||
    !(MODELS as readonly string[]).includes(model)
  );
}
