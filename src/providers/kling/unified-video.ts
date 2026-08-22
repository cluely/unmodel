/**
 * `unmodel/video` → the five Kling video validators: `kling.video` /
 * `kling.videoFromImage` (the corroborated `POST /v1/videos/*` family) and the
 * EXPERIMENTAL path-addressed `kling.videoV3` / `kling.videoV3FromImage` /
 * `kling.videoOmni`.
 *
 * # The model id picks a route *family*, and the inputs pick a route inside it
 *
 * Kling is the widest dispatch in this category, and it is two decisions rather
 * than one:
 *
 * | model ids | family | duration | size | inputs |
 * |---|---|---|---|---|
 * | `kling-v1` … `kling-v3` | `/v1/videos/*` | `duration: "5"` — **a string** | `mode`: std / pro / 4k | `image`, `image_tail` |
 * | `kling-3.0`, `-turbo`, `kling-2.6`, `kling-2.5-turbo` | `/text-to-video/{model}` | `settings.duration: 5` — a number | `settings.resolution` | `contents[]` |
 * | `kling-3.0-omni`, `kling-o1` | `/omni-video/{model}` | `settings.duration: 5` | `settings.resolution` | `contents[]`, incl. video |
 *
 * The two duration encodings in one provider are why the canonical `duration`
 * is a plain number: `"5"` and `5` are the same request at two Kling routes,
 * and neither spelling is the one a caller should have to remember.
 *
 * The id spellings are the giveaway for which family a ref lands in —
 * `kling-v3` is the body-addressed route and `kling-3.0` the path-addressed
 * one — and that is Kling's own naming, recorded in `./models.ts` along with
 * the provenance of both families. The V3 family is uncorroborated: prefer the
 * `kling-v*` ids unless you have verified those routes against a live account.
 *
 * # `mode` is a resolution with a different name
 *
 * On the `/v1/videos/*` family the size field is `mode`, whose three values
 * are documented as resolutions: "std = 720P, pro = 1080P, 4k = 4K". So the
 * canonical tier maps to a mode, exactly, with no approximation — and 480p and
 * 1440p are `invalid_enum_value` naming the three that exist rather than a
 * snap onto std.
 *
 * # What each family can and cannot take
 *
 * - **Reference images** exist only on the omni route (`refer_image`), so
 *   `role: "reference"` on any other id is an error naming the two omni models.
 * - **A source clip** likewise: `base_video` is omni-only.
 * - **`aspect_ratio`** is absent from both image-driven routes — the frame
 *   sets the shape — so a shape passed with a first frame is refused rather
 *   than ignored.
 * - **`negative_prompt`** is a `/v1/videos/*` field only; the V3 and omni
 *   `settings` objects have no equivalent, and this adapter says so per model
 *   rather than declaring a gap that is only true for six of the twelve ids.
 */
import {
  applyExtras,
  resolveImageSlots,
  resolveVideoRoute,
  toDurationNumber,
  toDurationString,
  toMediaUri,
  toRatioEnum,
  toTier,
  videoRoute,
  type VideoRoute,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoParams,
  VideoResolution,
} from "../../core/unified/vocabulary/video";
import { DOCS_BASE, KLING_ASPECT_RATIOS, type KlingContent } from "./shared";
import { V1_MODEL_RULES } from "./v1-routes";
import { video as v1TextValidator, type TextToVideoParams } from "./video";
import { videoFromImage as v1ImageValidator, type ImageToVideoParams } from "./video-from-image";
import {
  TEXT_TO_VIDEO_V3_RULES,
  videoV3 as v3TextValidator,
  type TextToVideoV3Params,
} from "./video-v3";
import {
  IMAGE_TO_VIDEO_V3_RULES,
  videoV3FromImage as v3ImageValidator,
  type ImageToVideoV3Params,
} from "./video-v3-from-image";
import { videoOmni as omniValidator, type OmniVideoParams } from "./video-omni";
import { KLING_VIDEO_MODEL_PARAMS, MODELS } from "./video-params";

const V1_SOURCE = `${DOCS_BASE}/apiReference/model/textToVideo`;
const V3_SOURCE = `${DOCS_BASE}/api/video/3-0-omni/text-to-video`;
const OMNI_SOURCE = `${DOCS_BASE}/api/video/3-0-omni/video-omni`;

/** The two ids on the omni route. */
const OMNI_MODELS: ReadonlySet<string> = new Set(["kling-3.0-omni", "kling-o1"]);

/** `mode` on `/v1/videos/*` — "std = 720P, pro = 1080P, 4k = 4K". */
const V1_MODES: Readonly<Partial<Record<VideoResolution, string>>> = {
  "720p": "std",
  "1080p": "pro",
  "4k": "4k",
};

/** `settings.resolution` on the path-addressed family — already tier-shaped. */
const V3_RESOLUTIONS: Readonly<Partial<Record<VideoResolution, string>>> = {
  "720p": "720p",
  "1080p": "1080p",
  "4k": "4k",
};

/**
 * Where each extra lands on the two path-addressed families. The `/v1/videos/*`
 * family needs no map — every one of its extras is a body-root field.
 */
const V3_NESTING: Readonly<Record<string, readonly string[]>> = {
  audio: ["settings"],
  multi_shot: ["settings"],
  watermark_info: ["options"],
};

/** The wire body of whichever of the five routes the ref and inputs select. */
export type KlingVideoWire =
  | TextToVideoParams
  | ImageToVideoParams
  | TextToVideoV3Params
  | ImageToVideoV3Params
  | OmniVideoParams;

/** What a unified video call to `kling/…` returns — one route's `Validated`. */
export type KlingVideoResult =
  // `string` for the model parameter: this adapter compiles a run-time ref, so
  // it lands on the wide arm of the two `/v1/videos/*` validators by
  // construction (a `string` id has no `V1_MODEL_RULES` row to narrow to).
  | ReturnType<typeof v1TextValidator<string, TextToVideoParams>>
  | ReturnType<typeof v1ImageValidator<string, ImageToVideoParams>>
  | ReturnType<typeof v3TextValidator<TextToVideoV3Params>>
  | ReturnType<typeof v3ImageValidator<ImageToVideoV3Params>>
  | ReturnType<typeof omniValidator<OmniVideoParams>>;

/** See the note on kling's image adapter: `validate` is contravariant. */
type KlingValidate = CompiledCall<KlingVideoWire, KlingVideoResult>["validate"];

/** Which family a ref lands in — the first of the two dispatch decisions. */
type Family = "v1" | "v3" | "omni";

function familyOf(model: string): Family {
  if (OMNI_MODELS.has(model)) return "omni";
  // `kling-v*` is the body-addressed family; `kling-3.0` and friends are the
  // path-addressed one. An id this snapshot has not seen has already drawn
  // `unknown_model`, and the corroborated family is the safer default.
  return model.startsWith("kling-v") ? "v1" : "v3";
}

/** The routes a model serves, from its family and that family's rule table. */
function routesFor(model: string, family: Family): readonly VideoRoute[] {
  // Omni is the only family with a reference slot (`refer_image`) and the only
  // one that takes a clip (`base_video`).
  if (family === "omni") return ["text", "image", "reference", "video"];
  // Every `/v1/videos/*` model has both a text2video and an image2video arm —
  // the two enums differ only in which extra ids the image route adds.
  if (family === "v1") return ["text", "image"];
  const routes: VideoRoute[] = [];
  if (TEXT_TO_VIDEO_V3_RULES[model] !== undefined) routes.push("text");
  if (IMAGE_TO_VIDEO_V3_RULES[model] !== undefined) routes.push("image");
  return routes.length > 0 ? routes : ["text", "image"];
}

export const video = {
  category: "video",
  provider: "kling",
  models: MODELS,
  modelParams: KLING_VIDEO_MODEL_PARAMS,
  unsupported: {
    seed:
      "no Kling video route has a seed field, so a generation is not reproducible from the " +
      "request.",
    n:
      "every Kling video route starts one task and answers with one task id; issue one request " +
      "per clip (there is no sample count on any of the bodies).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<KlingVideoWire, KlingVideoResult> {
    const family = familyOf(ctx.model);
    const source = family === "omni" ? OMNI_SOURCE : family === "v3" ? V3_SOURCE : V1_SOURCE;
    const derived = ctx.take(
      resolveVideoRoute(
        input,
        { model: ctx.model, routes: routesFor(ctx.model, family), source },
        { path: ["image"], warn: ctx.warn },
      ),
    );
    const route = derived ?? videoRoute(input);
    return family === "v1"
      ? compileV1(input, ctx, route)
      : family === "v3"
        ? compileV3(input, ctx, route, derived !== undefined)
        : compileOmni(input, ctx);
  },
} as const satisfies VideoAdapterFor<
  typeof KLING_VIDEO_MODEL_PARAMS,
  KlingVideoWire,
  KlingVideoResult
>;

// ---------------------------------------------------------------------------
// The corroborated family — POST /v1/videos/{text2video,image2video}
// ---------------------------------------------------------------------------

/** The `/v1/videos/*` body under construction, before the route narrows it. */
interface V1Draft {
  model_name: string;
  prompt?: string;
  negative_prompt?: string;
  mode?: string;
  duration?: string;
  aspect_ratio?: string;
  image?: string;
  image_tail?: string;
}

function compileV1(
  input: VideoParams,
  ctx: CompileContext<VideoParams>,
  route: VideoRoute,
): CompiledCall<KlingVideoWire, KlingVideoResult> {
  ctx.from(["model_name"], "model");
  ctx.from(["mode"], "resolution");
  ctx.from(["aspect_ratio"], "aspectRatio");
  ctx.from(["negative_prompt"], "negativePrompt");
  ctx.from(["image"], "image");
  ctx.from(["image_tail"], "image");

  const body: V1Draft = { model_name: ctx.model };
  if (input.prompt !== undefined) body.prompt = input.prompt;
  if (input.negativePrompt !== undefined) body.negative_prompt = input.negativePrompt;

  if (input.duration !== undefined) {
    // The one place in the category where seconds go out as a string. The
    // allowed list is this model's own row of the capability map, so the error
    // names the durations `kling-v2-1` actually offers rather than the widest.
    const allowed = V1_MODEL_RULES[ctx.model]?.durations.map(Number);
    const duration = ctx.take(
      toDurationString(input.duration, allowed, { path: ["duration"], warn: ctx.warn }),
    );
    if (duration !== undefined) body.duration = duration;
  }

  if (input.resolution !== undefined) {
    const mode = ctx.take(
      toTier(input.resolution, V1_MODES, { path: ["resolution"], warn: ctx.warn }),
    );
    // Which modes this model has is `checkV1Support`'s business — `kling-v1`
    // is std/pro only, and its message names them.
    if (mode !== undefined) body.mode = mode;
  }

  if (input.aspectRatio !== undefined) {
    if (route === "image") {
      ctx.fail({
        code: "unsupported_param",
        path: ["aspectRatio"],
        message:
          "POST /v1/videos/image2video has no `aspect_ratio` field — the input image sets the " +
          "frame. Drop `aspectRatio`, or drop `image` for a text-to-video request.",
        meta: { source: V1_SOURCE },
      });
    } else {
      const ratio = ctx.take(
        toRatioEnum(
          input.aspectRatio,
          KLING_ASPECT_RATIOS,
          { source: V1_SOURCE },
          { path: ["aspectRatio"], warn: ctx.warn },
        ),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio;
    }
  }

  const derive = { path: ["image"], warn: ctx.warn };
  const slots = ctx.take(resolveImageSlots(input.image, derive));
  if (slots !== undefined) {
    if (slots.first !== undefined) {
      const uri = ctx.take(toMediaUri(slots.first, derive));
      if (uri !== undefined) body.image = uri;
    }
    if (slots.last !== undefined) {
      const uri = ctx.take(toMediaUri(slots.last, derive));
      if (uri !== undefined) body.image_tail = uri;
    }
  }

  applyExtras(input, KLING_VIDEO_MODEL_PARAMS, body, ctx);

  const validate = (route === "image" ? v1ImageValidator.safe : v1TextValidator.safe) as KlingValidate;
  return { params: body as unknown as KlingVideoWire, validate };
}

// ---------------------------------------------------------------------------
// The path-addressed family — POST /{text-to-video,image-to-video}/{model}
// ---------------------------------------------------------------------------

/** `settings` on the path-addressed routes; `aspect_ratio` is text-only. */
interface V3Settings {
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
}

function compileV3(
  input: VideoParams,
  ctx: CompileContext<VideoParams>,
  route: VideoRoute,
  routeOk: boolean,
): CompiledCall<KlingVideoWire, KlingVideoResult> {
  ctx.from(["settings", "resolution"], "resolution");
  ctx.from(["settings", "aspect_ratio"], "aspectRatio");
  ctx.from(["settings", "duration"], "duration");
  ctx.from(["contents"], "image");

  const settings = compileSettings(input, ctx, route === "text", V3_SOURCE);

  if (input.negativePrompt !== undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["negativePrompt"],
      message:
        `"${ctx.model}" is on the path-addressed route family, whose \`settings\` object has no ` +
        "negative-prompt field (the `POST /v1/videos/*` models do — see `kling-v3`). Describe " +
        "what to avoid inside `prompt`.",
      meta: { source: V3_SOURCE },
    });
  }

  if (route === "text") {
    const body: Record<string, unknown> = { model: ctx.model, prompt: input.prompt ?? "" };
    if (input.prompt === undefined) requirePrompt(ctx, V3_SOURCE);
    if (Object.keys(settings).length > 0) body["settings"] = settings;
    applyExtras(input, KLING_VIDEO_MODEL_PARAMS, body, ctx, { nest: V3_NESTING });
    return { params: body as unknown as KlingVideoWire, validate: v3TextValidator.safe as KlingValidate };
  }

  // `routeOk` gates the two "this route has no slot for that" messages below:
  // when the route check has already refused the request, they would be a
  // second sentence about the same mistake.
  const contents = compileContents(
    input,
    ctx,
    { reference: false, video: false, report: routeOk },
    V3_SOURCE,
  );
  const body: Record<string, unknown> = { model: ctx.model, contents };
  if (Object.keys(settings).length > 0) body["settings"] = settings;
  applyExtras(input, KLING_VIDEO_MODEL_PARAMS, body, ctx, { nest: V3_NESTING });
  return { params: body as unknown as KlingVideoWire, validate: v3ImageValidator.safe as KlingValidate };
}

// ---------------------------------------------------------------------------
// The omni route — POST /omni-video/{model}
// ---------------------------------------------------------------------------

function compileOmni(
  input: VideoParams,
  ctx: CompileContext<VideoParams>,
): CompiledCall<KlingVideoWire, KlingVideoResult> {
  ctx.from(["settings", "resolution"], "resolution");
  ctx.from(["settings", "aspect_ratio"], "aspectRatio");
  ctx.from(["settings", "duration"], "duration");
  ctx.from(["contents"], "image");

  // Omni is the one Kling route with `aspect_ratio` alongside image inputs, so
  // the shape is allowed here whatever the request carries.
  const settings = compileSettings(input, ctx, true, OMNI_SOURCE);
  if (input.negativePrompt !== undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["negativePrompt"],
      message:
        `"${ctx.model}"'s \`settings\` object has no negative-prompt field (the ` +
        "`POST /v1/videos/*` models do — see `kling-v3`). Describe what to avoid inside `prompt`.",
      meta: { source: OMNI_SOURCE },
    });
  }

  const contents = compileContents(
    input,
    ctx,
    { reference: true, video: true, report: true },
    OMNI_SOURCE,
  );
  const body: Record<string, unknown> = { model: ctx.model, contents };
  if (Object.keys(settings).length > 0) body["settings"] = settings;
  applyExtras(input, KLING_VIDEO_MODEL_PARAMS, body, ctx, { nest: V3_NESTING });
  return { params: body as unknown as KlingVideoWire, validate: omniValidator.safe as KlingValidate };
}

// ---------------------------------------------------------------------------
// Shared between the two `settings`/`contents` families
// ---------------------------------------------------------------------------

function requirePrompt(ctx: CompileContext<VideoParams>, source: string): void {
  ctx.fail({
    code: "invalid_shape",
    path: ["prompt"],
    message:
      "`prompt` is required on this route (up to 3072 characters) — the path-addressed routes " +
      "have no other text input.",
    meta: { source },
  });
}

/** `settings`, which is the same three fields on all three current routes. */
function compileSettings(
  input: VideoParams,
  ctx: CompileContext<VideoParams>,
  shapeAllowed: boolean,
  source: string,
): V3Settings {
  const settings: V3Settings = {};

  if (input.duration !== undefined) {
    // No `allowed`: `checkSettings` carries this model's own list (3–15 on
    // 3.0, 5 or 10 on 2.6) and answers on the way out at `duration`.
    const duration = ctx.take(
      toDurationNumber(input.duration, undefined, { path: ["duration"], warn: ctx.warn }),
    );
    if (duration !== undefined) settings.duration = duration;
  }

  if (input.resolution !== undefined) {
    const resolution = ctx.take(
      toTier(input.resolution, V3_RESOLUTIONS, { path: ["resolution"], warn: ctx.warn }),
    );
    if (resolution !== undefined) settings.resolution = resolution;
  }

  if (input.aspectRatio !== undefined) {
    if (!shapeAllowed) {
      ctx.fail({
        code: "unsupported_param",
        path: ["aspectRatio"],
        message:
          "POST /image-to-video/{model} has no `settings.aspect_ratio` — the first frame sets " +
          "the shape of the clip. Drop `aspectRatio`, or drop `image` for a text-to-video request.",
        meta: { source },
      });
    } else {
      const ratio = ctx.take(
        toRatioEnum(
          input.aspectRatio,
          KLING_ASPECT_RATIOS,
          { source },
          { path: ["aspectRatio"], warn: ctx.warn },
        ),
      );
      if (ratio !== undefined) settings.aspect_ratio = ratio;
    }
  }

  return settings;
}

/** `contents` — the tagged input array both current image routes take. */
function compileContents(
  input: VideoParams,
  ctx: CompileContext<VideoParams>,
  accepts: { reference: boolean; video: boolean; report: boolean },
  source: string,
): KlingContent[] {
  const contents: KlingContent[] = [];
  if (input.prompt !== undefined) contents.push({ type: "prompt", text: input.prompt });

  const derive = { path: ["image"], warn: ctx.warn };
  const slots = ctx.take(resolveImageSlots(input.image, derive));
  if (slots !== undefined) {
    const push = (
      image: (typeof slots)["first"],
      type: "first_frame" | "last_frame" | "refer_image",
    ): void => {
      if (image === undefined) return;
      const uri = ctx.take(toMediaUri(image, derive));
      if (uri !== undefined) contents.push({ type, url: uri });
    };
    push(slots.first, "first_frame");
    push(slots.last, "last_frame");
    if (slots.references.length > 0 && !accepts.reference) {
      if (accepts.report) ctx.fail({
        code: "unsupported_param",
        path: ["image"],
        message:
          '`role: "reference"` is Kling\'s `refer_image`, which only the omni route accepts — ' +
          "use `kling/kling-3.0-omni` or `kling/kling-o1`.",
        meta: { source },
      });
    } else {
      for (const reference of slots.references) push(reference, "refer_image");
    }
  }

  if (input.video !== undefined) {
    const derived = { path: ["video"], warn: ctx.warn };
    if (!accepts.video) {
      if (accepts.report) ctx.fail({
        code: "unsupported_param",
        path: ["video"],
        message:
          "a source clip is Kling's `base_video`, which only the omni route accepts — use " +
          "`kling/kling-3.0-omni` or `kling/kling-o1`.",
        meta: { source },
      });
    } else {
      const uri = ctx.take(toMediaUri(input.video, derived));
      if (uri !== undefined) contents.push({ type: "base_video", url: uri });
    }
  }

  return contents;
}
