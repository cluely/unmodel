/**
 * `kling.video` / `kling.videoFromImage` → fal: the overlap tables and the
 * mappings.
 *
 * **Reached only from `./index.ts`** — see `core/translate/media-retarget.ts`
 * for why the seam is placed there and not in the endpoint modules.
 *
 * ## What fal serves, and what it does not
 *
 * Six of fal's nine curated Kling video endpoints are in scope, verified
 * against fal's roster on 2026-08-25 (`data/fal/curation.json`; the drift guard
 * in `fal-target.test.ts` re-asserts every id here against
 * `FAL_VIDEO_ENDPOINTS`). Source pages, one per row, under
 * https://fal.ai/models/fal-ai/kling-video/…/api
 *
 * | native `model_name` | `mode` | fal endpoint |
 * |---|---|---|
 * | `kling-v3` | `pro` / `std` | `…/v3/pro/…` / `…/v3/standard/…` |
 * | `kling-v2-6` | `pro` | `…/v2.6/pro/…` |
 * | `kling-v2-5-turbo` | `pro` | `…/v2.5-turbo/pro/…` |
 *
 * Six native ids have no fal endpoint at all (`kling-v1`, `kling-v1-5`,
 * `kling-v1-6`, `kling-v2-master`, `kling-v2-1`, `kling-v2-1-master`) — which
 * also takes `cfg_scale` and `camera_control` with them, since Kling permits
 * those only on the v1 generation.
 *
 * ## `mode` is a path segment here, not a param
 *
 * At fal the endpoint id *is* the URL, so Kling's `mode` picks the route
 * rather than riding in the body. `pro` and `std` are two endpoints on
 * `kling-v3`; on v2.6 and v2.5-turbo fal publishes only the pro tier, and
 * `mode: "std"` — which is Kling's own DEFAULT — is refused rather than
 * promoted. Promotion would change the resolution (720P → 1080P) and the
 * price, and a warning on a doubled bill is not consent. `mode: "4k"` is
 * refused everywhere for the same reason: fal has no 4K Kling arm.
 *
 * ## The two defaults that invert
 *
 * Both are written out explicitly rather than left to either side's default,
 * which is what keeps a plain retarget exact:
 *
 * - **`negative_prompt`.** Kling's default is empty; fal's is the literal
 *   `"blur, distort, and low quality"`. An omitted field would silently add a
 *   negative prompt, so unmodel emits `""`.
 * - **`sound` → `generate_audio`.** Kling defaults to `"off"`, fal to `true`.
 *   Silence there would turn audio on and roughly double the per-second rate,
 *   so unmodel emits the boolean every time the endpoint has the field.
 */
import type { ApiRetargeter } from "../../core/request";
import {
  approximateParam,
  createMediaToApi,
  refuseParam,
  type MediaMapContext,
} from "../../core/translate/media-retarget";
import { FAL_MEDIA_TARGET } from "../../core/translate/media-endpoints";
import type { FalVideoBodyById } from "../fal/interop";
import type { KlingShot } from "./v1-routes";
import type { TextToVideoParams } from "./video";
import type { ImageToVideoParams } from "./video-from-image";

// The per-endpoint aliases below are `export`ed rather than private, and it is
// not decoration: they are the exact symbols `<Provider>…FalOverlap`'s
// `ReturnType` resolves to, so a consumer that emits declarations around a
// result carrying `.toApi("fal")` cannot name it without them (TS4023, "has or
// is using name 'FalAiFlux2ProInput' … but cannot be named"). Type-only, and
// re-exported one line from ./index.ts. See src/core/carriers.ts.
export type ById = FalVideoBodyById;

export type FalKlingV25Text = ById["fal-ai/kling-video/v2.5-turbo/pro/text-to-video"];
export type FalKlingV26Text = ById["fal-ai/kling-video/v2.6/pro/text-to-video"];
export type FalKlingV3Text =
  | ById["fal-ai/kling-video/v3/pro/text-to-video"]
  | ById["fal-ai/kling-video/v3/standard/text-to-video"];
export type FalKlingV25Image = ById["fal-ai/kling-video/v2.5-turbo/pro/image-to-video"];
export type FalKlingV26Image = ById["fal-ai/kling-video/v2.6/pro/image-to-video"];
export type FalKlingV3Image =
  | ById["fal-ai/kling-video/v3/pro/image-to-video"]
  | ById["fal-ai/kling-video/v3/standard/image-to-video"];

/** fal's default when `negative_prompt` is absent — never what Kling meant. */
const EMPTY_NEGATIVE_PROMPT = "";

// ---------------------------------------------------------------------------
// Shared refusals
// ---------------------------------------------------------------------------

/**
 * The params no fal Kling endpoint has, on any tier or generation.
 *
 * `external_task_id` and `callback_url` are the two a reader will want to
 * argue about, so the reasons are on the messages: fal answers a submit with
 * its own `request_id` and has no client-supplied id to correlate against, and
 * its queue has no in-body webhook at all. Dropping either leaves the caller
 * holding a task-tracking strategy that silently stopped working.
 */
function refuseUniversal(
  params: TextToVideoParams | ImageToVideoParams,
  ctx: MediaMapContext,
  endpoint: string,
): void {
  if (params.watermark_info !== undefined) {
    refuseParam(
      ctx,
      ["watermark_info"],
      endpoint,
      "publishes no watermark field, so unmodel can promise neither setting",
    );
  }
  if (params.callback_url !== undefined) {
    refuseParam(
      ctx,
      ["callback_url"],
      endpoint,
      "carries no in-body callback: fal's queue answers a submit with a `request_id` and a `status_url` you poll",
    );
  }
  if (params.external_task_id !== undefined) {
    refuseParam(
      ctx,
      ["external_task_id"],
      endpoint,
      "has no client-supplied task id — fal answers with its own `request_id`, so a dropped `external_task_id` would leave your task lookup silently broken",
    );
  }
  if (params.camera_control !== undefined) {
    refuseParam(
      ctx,
      ["camera_control"],
      endpoint,
      "publishes no camera field on any Kling tier (Kling itself offers it on kling-v1 only, which fal does not serve)",
    );
  }
}

/** `prompt` is required on every fal Kling row; Kling's is optional. */
function requirePrompt(prompt: string | undefined, ctx: MediaMapContext, endpoint: string): string {
  if (prompt !== undefined && prompt !== "") return prompt;
  ctx.unsupported({
    path: ["prompt"],
    message:
      `\`prompt\` is required at ${endpoint}. Kling accepts a request without one (its multi-shot arms ` +
      "carry the text elsewhere); fal does not, and unmodel will not invent one.",
  });
  return prompt ?? "";
}

/** Refuses a `duration` outside the target endpoint's own enum. */
function requireDuration<D extends string>(
  duration: string | undefined,
  allowed: readonly D[],
  ctx: MediaMapContext,
  endpoint: string,
): D | undefined {
  if (duration === undefined) return undefined;
  if ((allowed as readonly string[]).includes(duration)) return duration as D;
  ctx.unsupported({
    path: ["duration"],
    message:
      `\`duration: "${duration}"\` has no equivalent at ${endpoint}, which serves ${allowed.map((v) => `"${v}"`).join(" or ")}. ` +
      "Duration is the billing unit on this route, so unmodel refuses rather than snapping to the nearest.",
  });
  return undefined;
}

/**
 * A frame reference fal can actually fetch.
 *
 * Kling accepts an HTTPS URL **or a bare base64 payload**; fal accepts an
 * HTTPS URL or a `data:` URI. Bare base64 is refused rather than wrapped:
 * a `data:` URI needs a MIME type, the bytes do not carry one, and a guessed
 * MIME is a silent server-side failure rather than a visible one.
 */
function requireFetchableFrame(
  value: string,
  path: Array<string | number>,
  ctx: MediaMapContext,
  endpoint: string,
): string {
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  ctx.unsupported({
    path,
    message:
      `\`${String(path[0])}\` is a bare base64 payload, which ${endpoint} cannot take — fal accepts an https URL ` +
      "or a `data:` URI, and a `data:` URI needs a MIME type the bytes do not carry. Pass a URL, or wrap the " +
      "bytes yourself as `data:image/png;base64,…` with the real type.",
  });
  return value;
}

/** Refuses the motion-brush, element and voice inputs fal's Kling rows lack. */
function refuseImageOnlyExtras(
  params: ImageToVideoParams,
  ctx: MediaMapContext,
  endpoint: string,
): void {
  if (params.static_mask !== undefined || params.dynamic_masks !== undefined) {
    refuseParam(
      ctx,
      [params.static_mask !== undefined ? "static_mask" : "dynamic_masks"],
      endpoint,
      "has no motion-brush surface: no mask field and no trajectory field on any Kling row",
    );
  }
  if (params.element_list !== undefined) {
    refuseParam(
      ctx,
      ["element_list"],
      endpoint,
      "takes inline media rather than library references — `element_id` addresses your own Kling account's Element library, and resolving one would mean calling Kling, which is the thing the retarget exists to avoid",
    );
  }
  if (params.voice_list !== undefined) {
    refuseParam(
      ctx,
      ["voice_list"],
      endpoint,
      "has no equivalent voice list on the tiers unmodel maps, and Kling's own `voice_list` element shape is undocumented — there is nothing to translate from",
    );
  }
}

/**
 * `sound` → `generate_audio`, refused where the endpoint has no audio switch.
 *
 * The v2.5-turbo rows have no `generate_audio`, and Kling gives
 * `kling-v2-5-turbo` no `sound` arm either, so the pair is consistently absent
 * — a typed call can never reach the refusal, and a loose one is told why.
 */
function audioSwitch(
  sound: "on" | "off" | undefined,
  supported: boolean,
  ctx: MediaMapContext,
  endpoint: string,
): boolean | undefined {
  if (!supported) {
    if (sound !== undefined) {
      refuseParam(ctx, ["sound"], endpoint, "publishes no audio switch — Kling offers native audio on kling-v3 and kling-v2-6 only");
    }
    return undefined;
  }
  // Always emitted: Kling defaults to "off", fal to `true`.
  return sound === "on";
}

/**
 * Kling's `multi_prompt` storyboard → fal's positional `multi_prompt`.
 *
 * The one genuine approximation in this family, and it is structural rather
 * than numeric: Kling's shots carry an explicit `index`, fal's are positional
 * and have no index field. The shots are ordered by `index` and the key is
 * dropped — which is right, and is still a change a caller should be told
 * about, because a 1-based, non-contiguous or duplicated index set is
 * reinterpreted rather than rejected.
 */
function mapMultiPrompt(
  shots: readonly KlingShot[],
  ctx: MediaMapContext,
  endpoint: string,
): Array<{ prompt: string; duration?: string }> {
  approximateParam(ctx, ["multi_prompt"], {
    requested: shots.map((shot) => ({ index: shot.index, duration: shot.duration })),
    achieved: "positional shots",
    message:
      `\`multi_prompt\` shots carry an explicit \`index\` at Kling; ${endpoint} takes them positionally and has ` +
      "no index field. unmodel ordered the shots by `index` ascending and dropped the key — a non-contiguous " +
      "or duplicated index set is reinterpreted by that ordering rather than refused.",
    source: `https://fal.ai/models/${endpoint}/api`,
  });
  return [...shots]
    .sort((a, b) => a.index - b.index)
    .map((shot) => ({
      prompt: shot.prompt,
      ...(shot.duration !== undefined && { duration: shot.duration }),
    }));
}

/** `prompt` and `multi_prompt` are mutually exclusive at fal; at Kling they are not. */
function dropInertPrompt(
  params: TextToVideoParams | ImageToVideoParams,
  ctx: MediaMapContext,
  endpoint: string,
): void {
  if (params.multi_prompt === undefined || params.prompt === undefined) return;
  ctx.warn({
    code: "dropped_param",
    path: ["prompt"],
    message:
      `${endpoint} accepts \`prompt\` or \`multi_prompt\`, but not both. Kling makes \`prompt\` inert when a ` +
      "storyboard is present, so the storyboard was kept and `prompt` dropped.",
    meta: { param: "prompt" },
  });
}

/** The v3-only fields, refused on the two older tiers. */
function refuseV3OnlyFields(
  params: TextToVideoParams | ImageToVideoParams,
  ctx: MediaMapContext,
  endpoint: string,
): void {
  if (params.multi_prompt !== undefined) {
    refuseParam(ctx, ["multi_prompt"], endpoint, "has no storyboard field — fal publishes `multi_prompt` on the Kling 3.0 rows only");
  }
  if (params.shot_type !== undefined) {
    refuseParam(ctx, ["shot_type"], endpoint, "has no `shot_type` — fal publishes it on the Kling 3.0 rows only");
  }
  if (params.multi_shot === true) {
    refuseParam(ctx, ["multi_shot"], endpoint, "has no multi-shot arm — fal publishes storyboards on the Kling 3.0 rows only");
  }
}

/**
 * `multi_shot` has no fal field, and it does not need one: fal derives
 * multi-shot from the two things Kling pairs the flag with.
 *
 * - **`multi_prompt` present** — fal's own `multi_prompt` is the storyboard,
 *   and carrying it says "multi-shot" already.
 * - **`shot_type: "intelligence"`** — fal's `shot_type: "intelligent"` is
 *   exactly "work the shots out from one prompt".
 *
 * Either way the flag is a derived fact and warns. `multi_shot: true` with
 * neither is refused: it asks for multi-shot without saying how, and fal has
 * no way to express the request. `multi_shot: false` restates both sides'
 * default and says nothing.
 */
function handleMultiShot(
  params: TextToVideoParams | ImageToVideoParams,
  ctx: MediaMapContext,
  endpoint: string,
): void {
  if (params.multi_shot !== true) return;
  const carrier =
    params.multi_prompt !== undefined
      ? "`multi_prompt`"
      : params.shot_type === "intelligence"
        ? '`shot_type: "intelligent"`'
        : undefined;
  if (carrier === undefined) {
    refuseParam(
      ctx,
      ["multi_shot"],
      endpoint,
      'derives multi-shot from `multi_prompt` or `shot_type: "intelligent"` and has no flag of its own — there is no way to ask for multi-shot while supplying neither the shots nor the intelligent arm',
    );
    return;
  }
  approximateParam(ctx, ["multi_shot"], {
    requested: true,
    achieved: `implied by ${carrier}`,
    message: `${endpoint} has no \`multi_shot\` flag: it derives multi-shot from ${carrier}, which this request carries, so the flag was dropped.`,
  });
}

/** Kling spells it `"intelligence"`; fal spells it `"intelligent"`. A rename, nothing more. */
function shotType(value: "customize" | "intelligence" | undefined): "customize" | "intelligent" | undefined {
  if (value === undefined) return undefined;
  return value === "intelligence" ? "intelligent" : "customize";
}

// ---------------------------------------------------------------------------
// text-to-video
// ---------------------------------------------------------------------------

const V3_DURATIONS = ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"] as const;
const V25_V26_DURATIONS = ["5", "10"] as const;

/**
 * `mode` → the fal route, for a model fal serves on both tiers.
 *
 * `undefined` means Kling's own default, `"std"`.
 */
function v3Route(mode: string | undefined, ctx: MediaMapContext, arm: "text" | "image"): string | undefined {
  const suffix = arm === "text" ? "text-to-video" : "image-to-video";
  switch (mode ?? "std") {
    case "pro":
      return `fal-ai/kling-video/v3/pro/${suffix}`;
    case "std":
      return `fal-ai/kling-video/v3/standard/${suffix}`;
    default:
      ctx.unsupported({
        path: ["mode"],
        message:
          '`mode: "4k"` has no equivalent on fal, whose Kling 3.0 rows are the pro (1080P) and standard (720P) ' +
          "tiers only. Promoting or demoting a tier would change both the resolution and the price, so unmodel refuses.",
      });
      return undefined;
  }
}

/** `mode` → the fal route, for the two models fal serves on the pro tier only. */
function proOnlyRoute(
  mode: string | undefined,
  endpoint: string,
  ctx: MediaMapContext,
): string | undefined {
  if ((mode ?? "std") === "pro") return endpoint;
  ctx.unsupported({
    path: ["mode"],
    message:
      `\`mode: "${mode ?? "std"}"\` has no equivalent at ${endpoint}: fal serves this model on the pro tier only. ` +
      'Kling\'s own default is "std" (720P), so set `mode: "pro"` to retarget — unmodel will not promote the tier ' +
      "for you, because that changes the resolution and the price.",
  });
  return undefined;
}

function mapV25Text(params: TextToVideoParams, ctx: MediaMapContext): FalKlingV25Text {
  const endpoint = "fal-ai/kling-video/v2.5-turbo/pro/text-to-video";
  refuseUniversal(params, ctx, endpoint);
  refuseV3OnlyFields(params, ctx, endpoint);
  audioSwitch(params.sound, false, ctx, endpoint);
  const duration = requireDuration(params.duration, V25_V26_DURATIONS, ctx, endpoint);
  return {
    prompt: requirePrompt(params.prompt, ctx, endpoint),
    negative_prompt: params.negative_prompt ?? EMPTY_NEGATIVE_PROMPT,
    ...(duration !== undefined && { duration }),
    ...(params.aspect_ratio !== undefined && { aspect_ratio: params.aspect_ratio }),
    ...(params.cfg_scale !== undefined && { cfg_scale: params.cfg_scale }),
  };
}

function mapV26Text(params: TextToVideoParams, ctx: MediaMapContext): FalKlingV26Text {
  const endpoint = "fal-ai/kling-video/v2.6/pro/text-to-video";
  refuseUniversal(params, ctx, endpoint);
  refuseV3OnlyFields(params, ctx, endpoint);
  const duration = requireDuration(params.duration, V25_V26_DURATIONS, ctx, endpoint);
  return {
    prompt: requirePrompt(params.prompt, ctx, endpoint),
    negative_prompt: params.negative_prompt ?? EMPTY_NEGATIVE_PROMPT,
    generate_audio: audioSwitch(params.sound, true, ctx, endpoint) ?? false,
    ...(duration !== undefined && { duration }),
    ...(params.aspect_ratio !== undefined && { aspect_ratio: params.aspect_ratio }),
    ...(params.cfg_scale !== undefined && { cfg_scale: params.cfg_scale }),
  };
}

function mapV3Text(params: TextToVideoParams, ctx: MediaMapContext): FalKlingV3Text {
  const endpoint = "fal-ai/kling-video/v3/pro/text-to-video";
  refuseUniversal(params, ctx, endpoint);
  handleMultiShot(params, ctx, endpoint);
  dropInertPrompt(params, ctx, endpoint);
  const duration = requireDuration(params.duration, V3_DURATIONS, ctx, endpoint);
  const storyboard = params.multi_prompt;
  return {
    ...(storyboard === undefined
      ? { prompt: requirePrompt(params.prompt, ctx, endpoint) }
      : { multi_prompt: mapMultiPrompt(storyboard, ctx, endpoint) }),
    negative_prompt: params.negative_prompt ?? EMPTY_NEGATIVE_PROMPT,
    generate_audio: audioSwitch(params.sound, true, ctx, endpoint) ?? false,
    ...(duration !== undefined && { duration }),
    ...(params.aspect_ratio !== undefined && { aspect_ratio: params.aspect_ratio }),
    ...(params.shot_type !== undefined && { shot_type: shotType(params.shot_type) }),
    ...(params.cfg_scale !== undefined && { cfg_scale: params.cfg_scale }),
  } as FalKlingV3Text;
}

/** Kling text-to-video model id → the fal endpoints that serve it. */
export const KLING_VIDEO_FAL_OVERLAP = {
  "kling-v3": {
    endpoints: [
      "fal-ai/kling-video/v3/pro/text-to-video",
      "fal-ai/kling-video/v3/standard/text-to-video",
    ],
    route: (params: TextToVideoParams, ctx: MediaMapContext) => v3Route(params.mode, ctx, "text"),
    map: mapV3Text,
  },
  "kling-v2-6": {
    endpoints: ["fal-ai/kling-video/v2.6/pro/text-to-video"],
    route: (params: TextToVideoParams, ctx: MediaMapContext) =>
      proOnlyRoute(params.mode, "fal-ai/kling-video/v2.6/pro/text-to-video", ctx),
    map: mapV26Text,
  },
  "kling-v2-5-turbo": {
    endpoints: ["fal-ai/kling-video/v2.5-turbo/pro/text-to-video"],
    route: (params: TextToVideoParams, ctx: MediaMapContext) =>
      proOnlyRoute(params.mode, "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", ctx),
    map: mapV25Text,
  },
} as const;

// ---------------------------------------------------------------------------
// image-to-video
// ---------------------------------------------------------------------------

/**
 * The start frame, whose field name differs per tier
 * (`image_url` at v2.5-turbo, `start_image_url` at v2.6 and v3) and which fal
 * marks **required** while Kling only requires *one* of the two frames.
 *
 * An end-frame-only request is therefore refused rather than reshaped: fal has
 * no way to say "animate towards this frame from nothing".
 */
function requireStartFrame(
  params: ImageToVideoParams,
  ctx: MediaMapContext,
  endpoint: string,
): string {
  if (params.image === undefined) {
    ctx.unsupported({
      path: ["image"],
      message:
        `a start frame is required at ${endpoint}. Kling accepts an end frame alone (\`image_tail\` with no ` +
        "`image`); fal marks the start frame required and offers no end-frame-only arm, so there is nothing to map to.",
    });
    return "";
  }
  return requireFetchableFrame(params.image, ["image"], ctx, endpoint);
}

function mapV25Image(params: ImageToVideoParams, ctx: MediaMapContext): FalKlingV25Image {
  const endpoint = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
  refuseUniversal(params, ctx, endpoint);
  refuseImageOnlyExtras(params, ctx, endpoint);
  refuseV3OnlyFields(params, ctx, endpoint);
  audioSwitch(params.sound, false, ctx, endpoint);
  const duration = requireDuration(params.duration, V25_V26_DURATIONS, ctx, endpoint);
  return {
    prompt: requirePrompt(params.prompt, ctx, endpoint),
    image_url: requireStartFrame(params, ctx, endpoint),
    negative_prompt: params.negative_prompt ?? EMPTY_NEGATIVE_PROMPT,
    ...(duration !== undefined && { duration }),
    ...(params.image_tail !== undefined && {
      tail_image_url: requireFetchableFrame(params.image_tail, ["image_tail"], ctx, endpoint),
    }),
    ...(params.cfg_scale !== undefined && { cfg_scale: params.cfg_scale }),
  };
}

function mapV26Image(params: ImageToVideoParams, ctx: MediaMapContext): FalKlingV26Image {
  const endpoint = "fal-ai/kling-video/v2.6/pro/image-to-video";
  refuseUniversal(params, ctx, endpoint);
  refuseImageOnlyExtras(params, ctx, endpoint);
  refuseV3OnlyFields(params, ctx, endpoint);
  // The one row in the family without `cfg_scale`.
  if (params.cfg_scale !== undefined) {
    refuseParam(ctx, ["cfg_scale"], endpoint, "is the one fal Kling row that publishes no `cfg_scale`");
  }
  const duration = requireDuration(params.duration, V25_V26_DURATIONS, ctx, endpoint);
  return {
    prompt: requirePrompt(params.prompt, ctx, endpoint),
    start_image_url: requireStartFrame(params, ctx, endpoint),
    negative_prompt: params.negative_prompt ?? EMPTY_NEGATIVE_PROMPT,
    generate_audio: audioSwitch(params.sound, true, ctx, endpoint) ?? false,
    ...(duration !== undefined && { duration }),
    ...(params.image_tail !== undefined && {
      end_image_url: requireFetchableFrame(params.image_tail, ["image_tail"], ctx, endpoint),
    }),
  };
}

function mapV3Image(params: ImageToVideoParams, ctx: MediaMapContext): FalKlingV3Image {
  const endpoint = "fal-ai/kling-video/v3/pro/image-to-video";
  refuseUniversal(params, ctx, endpoint);
  refuseImageOnlyExtras(params, ctx, endpoint);
  handleMultiShot(params, ctx, endpoint);
  dropInertPrompt(params, ctx, endpoint);
  const duration = requireDuration(params.duration, V3_DURATIONS, ctx, endpoint);
  const storyboard = params.multi_prompt;
  return {
    ...(storyboard === undefined
      ? { prompt: requirePrompt(params.prompt, ctx, endpoint) }
      : { multi_prompt: mapMultiPrompt(storyboard, ctx, endpoint) }),
    start_image_url: requireStartFrame(params, ctx, endpoint),
    negative_prompt: params.negative_prompt ?? EMPTY_NEGATIVE_PROMPT,
    generate_audio: audioSwitch(params.sound, true, ctx, endpoint) ?? false,
    ...(duration !== undefined && { duration }),
    ...(params.image_tail !== undefined && {
      end_image_url: requireFetchableFrame(params.image_tail, ["image_tail"], ctx, endpoint),
    }),
    ...(params.shot_type !== undefined && { shot_type: shotType(params.shot_type) }),
    ...(params.cfg_scale !== undefined && { cfg_scale: params.cfg_scale }),
  } as FalKlingV3Image;
}

/** Kling image-to-video model id → the fal endpoints that serve it. */
export const KLING_VIDEO_FROM_IMAGE_FAL_OVERLAP = {
  "kling-v3": {
    endpoints: [
      "fal-ai/kling-video/v3/pro/image-to-video",
      "fal-ai/kling-video/v3/standard/image-to-video",
    ],
    route: (params: ImageToVideoParams, ctx: MediaMapContext) => v3Route(params.mode, ctx, "image"),
    map: mapV3Image,
  },
  "kling-v2-6": {
    endpoints: ["fal-ai/kling-video/v2.6/pro/image-to-video"],
    route: (params: ImageToVideoParams, ctx: MediaMapContext) =>
      proOnlyRoute(params.mode, "fal-ai/kling-video/v2.6/pro/image-to-video", ctx),
    map: mapV26Image,
  },
  "kling-v2-5-turbo": {
    endpoints: ["fal-ai/kling-video/v2.5-turbo/pro/image-to-video"],
    route: (params: ImageToVideoParams, ctx: MediaMapContext) =>
      proOnlyRoute(params.mode, "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", ctx),
    map: mapV25Image,
  },
} as const;

/**
 * The six Kling ids fal serves no endpoint for, with the reason.
 *
 * Shared by both routes: the gap is a *model* gap, not a route gap. Worth
 * noting what goes with them — `cfg_scale` and `camera_control` are legal at
 * Kling only on the v1 generation, so refusing these ids is also what makes
 * those two params unreachable from typed code.
 */
export const KLING_VIDEO_FAL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  "kling-v1":
    "fal's curated Kling roster is 2.5-turbo, 2.6 and 3.0; it serves no v1 endpoint. (This is also why `camera_control` and `cfg_scale` are unreachable — Kling offers both on the v1 generation only.)",
  "kling-v1-5": "fal's curated Kling roster is 2.5-turbo, 2.6 and 3.0; it serves no v1.5 endpoint.",
  "kling-v1-6": "fal's curated Kling roster is 2.5-turbo, 2.6 and 3.0; it serves no v1.6 endpoint.",
  "kling-v2-master":
    "fal serves no Kling 2.0 Master endpoint; the nearest row, 2.5-turbo, is a different model.",
  "kling-v2-1": "fal serves no Kling 2.1 endpoint.",
  "kling-v2-1-master": "fal serves no Kling 2.1 Master endpoint.",
});

/** The type half of {@link KLING_VIDEO_FAL_OVERLAP}, derived from it. */
export type KlingVideoFalOverlap = {
  [K in keyof typeof KLING_VIDEO_FAL_OVERLAP]: ReturnType<(typeof KLING_VIDEO_FAL_OVERLAP)[K]["map"]>;
};

/** The type half of {@link KLING_VIDEO_FROM_IMAGE_FAL_OVERLAP}, derived from it. */
export type KlingVideoFromImageFalOverlap = {
  [K in keyof typeof KLING_VIDEO_FROM_IMAGE_FAL_OVERLAP]: ReturnType<
    (typeof KLING_VIDEO_FROM_IMAGE_FAL_OVERLAP)[K]["map"]
  >;
};

/** `.toApi("fal")` for `kling.video`. */
export const klingVideoToFal: (params: TextToVideoParams) => ApiRetargeter = createMediaToApi({
  endpoint: "kling.video",
  target: FAL_MEDIA_TARGET,
  modelId: (params: TextToVideoParams) => params.model_name,
  overlap: KLING_VIDEO_FAL_OVERLAP,
  refusals: KLING_VIDEO_FAL_REFUSALS,
});

/** `.toApi("fal")` for `kling.videoFromImage`. */
export const klingVideoFromImageToFal: (params: ImageToVideoParams) => ApiRetargeter =
  createMediaToApi({
    endpoint: "kling.videoFromImage",
    target: FAL_MEDIA_TARGET,
    modelId: (params: ImageToVideoParams) => params.model_name,
    overlap: KLING_VIDEO_FROM_IMAGE_FAL_OVERLAP,
    refusals: KLING_VIDEO_FAL_REFUSALS,
  });
