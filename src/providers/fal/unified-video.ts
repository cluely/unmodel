/**
 * `unmodel/video` → fal, across 30 endpoints and one address.
 *
 * # The roles are the dispatch, and the endpoint id is not
 *
 * Every other adapter in this category branches on a model id or a route
 * family. This one cannot: at fal the route IS the id, thirty of them, and a
 * switch would need a new arm every week. What it branches on instead is the
 * generated row's `roles` — which of `first`, `last` and `reference` this
 * endpoint's schema has a wire field for — plus `videoWire` for the routes that
 * take a source clip.
 *
 * | row says | what the endpoint is | canonical input |
 * |---|---|---|
 * | `roles: []`, no `videoWire` | text-to-video | `prompt` only |
 * | `roles: ["first"]` | image-to-video | `image: { url }` |
 * | `roles: ["first", "last"]` | first-and-last-frame | `image: [{…}, { role: "last", … }]` |
 * | `roles: ["reference"]` | reference-to-video | `image: [{ role: "reference", … }]` |
 * | `videoWire: "video_url"` | extend / edit | `video: { url }` |
 *
 * That is also the answer to "why is there no `fal.videoFromImage`": the arms
 * above are not different wire routes, they are different KEYS on one route
 * shape, and `minimax/h3/image-to-video` proves the point by making its
 * `image_url` optional — the same endpoint serves text-to-video and
 * image-to-video depending on the request. See `./video.ts`.
 *
 * # Six spellings for the opening frame
 *
 * fal's vendors call it `image_url` (seedance, hailuo, wan),
 * `start_image_url` (kling v3, kling 2.6) and `first_frame_url` (veo3.1's
 * interpolation route); the closing frame is `end_image_url`,
 * `last_frame_url` or `tail_image_url`. The adapter never names any of them:
 * it reads `roleWire[role]` off the row, which the generator derived from the
 * endpoint's own property list. A vendor that invents a seventh spelling is a
 * codegen change and no adapter change at all.
 *
 * # `duration` is four different types in one category
 *
 * The string enum `"5"` at kling, the suffixed string `"8s"` at veo3.1, the
 * integer enum `5` at wan, and a free integer 1..15 at pixverse. The canonical
 * `duration` is a plain number of seconds — the only spelling that means the
 * same thing at all four — and `durationWire` maps it back. The generator built
 * that map by parsing each enum member, which is also how `"auto"` (seedance,
 * ltx-2.5) stays out of it: "you decide" is not a length.
 *
 * # `resolution` refuses more often than it maps, on purpose
 *
 * `minimax/h3` offers `"480P" | "768P" | "2K" | "4K"`. Two of those are
 * canonical tiers and two are not, so its row's `resolutions` is
 * `["480p", "4k"]` and `resolution: "720p"` is an `invalid_enum_value` naming
 * the two it can express. Snapping 720p onto `"768P"` would deliver a taller
 * frame than the caller asked for and say nothing about it; the caller who
 * genuinely wants 768P writes it through `providerOptions.fal`, where it is
 * still checked by `fal.video`'s own IR.
 *
 * # Per-model facts live on the rows, not on the adapter
 *
 * No adapter-wide `unsupported` here — risk R7. `negative_prompt` exists on
 * kling and veo3.1 and on no seedance route; `seed` exists on eleven of thirty;
 * `aspect_ratio` on twenty. A provider-wide "fal cannot do N" would be false at
 * the majority of fal's own endpoints, so every refusal in this file names the
 * endpoint and is derived from that endpoint's own generated key list.
 */

import {
  applyExtras,
  resolveImageSlots,
  toMediaUri,
  toRatioEnum,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  AnyVideoAdapter,
  VideoImageInput,
  VideoImageRole,
  VideoParams,
} from "../../core/unified/vocabulary/video";
import { video as validator } from "./video";
import { FAL_VIDEO_MODEL_PARAMS, MODELS } from "./video-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalVideoRow {
  readonly classes: readonly string[];
  readonly keys: readonly string[];
  readonly ratios?: readonly string[];
  readonly ratioFreeform?: true;
  readonly durations?: readonly number[];
  readonly durationWire?: Readonly<Record<string, string | number>>;
  readonly resolutions?: readonly string[];
  readonly resolutionWire?: Readonly<Record<string, string>>;
  readonly roles?: readonly string[];
  readonly roleWire?: Readonly<Record<string, string>>;
  readonly videoWire?: string;
  readonly bounds?: Readonly<Record<string, { readonly min?: number; readonly max?: number }>>;
}

const ROWS = FAL_VIDEO_MODEL_PARAMS as Readonly<Record<string, FalVideoRow>>;

/**
 * The wire body this adapter compiles to.
 *
 * **No `[key: string]: unknown` tail**, for the reason `FalImageWire`
 * documents at length: an open index signature makes `ExactKeys` demand
 * `never` for every key and silently un-narrows the whole hand surface. The
 * per-model extras reach the body through `applyExtras`'s own cast.
 *
 * Every media key any of the thirty endpoints uses is listed, because the
 * adapter writes whichever one that endpoint's row names — and a key missing
 * here would be a compile error at exactly the line that writes it, which is
 * the point.
 */
export interface FalVideoWire {
  /** The route selector, stripped into `.request.url` by `fal.video`. */
  endpoint: string;
  prompt?: string;
  negative_prompt?: string;
  seed?: number;
  duration?: string | number;
  resolution?: string;
  aspect_ratio?: string;
  image_url?: string;
  start_image_url?: string;
  first_frame_url?: string;
  end_image_url?: string;
  last_frame_url?: string;
  tail_image_url?: string;
  image_urls?: string[];
  video_url?: string;
  video_urls?: string[];
}

/** What a unified call to `fal/…` returns: `fal.video`'s own `Validated`. */
export type FalVideoResult = ReturnType<typeof validator>;

/** See `./unified-image.ts`: `CompiledCall.validate` is not generic, and cannot be. */
type FalVideoValidate = CompiledCall<FalVideoWire, FalVideoResult>["validate"];

function has(row: FalVideoRow | undefined, key: string): boolean {
  return row?.keys.includes(key) === true;
}

function docs(model: string): string | undefined {
  return FAL_DOC_URLS[model as keyof typeof FAL_DOC_URLS];
}

/**
 * One `unsupported_param`, phrased against the endpoint rather than the
 * provider — and counting how many of its siblings DO take the field, because
 * "fal has no negative prompt" would be false at twelve of the thirty.
 */
function refuse(
  ctx: CompileContext<VideoParams>,
  canonical: string,
  wire: string,
  row: FalVideoRow | undefined,
): void {
  const takers = Object.keys(ROWS).filter((id) => ROWS[id]?.keys.includes(wire) === true);
  ctx.fail({
    code: "unsupported_param",
    path: [canonical],
    message:
      `"${ctx.model}" declares no \`${wire}\` parameter, so \`${canonical}\` has nothing to become. ` +
      (takers.length === 0
        ? "No fal endpoint in this category takes it."
        : `${takers.length} of the ${Object.keys(ROWS).length} fal video endpoints do take it` +
          `${takers.length <= 4 ? ` — ${takers.map((id) => `"${id}"`).join(", ")}` : ""}.`) +
      " fal is a queue in front of many vendors' models, so a parameter one endpoint has is routinely absent " +
      "from the next; this is a fact about the endpoint, not about fal.",
    meta: {
      wire,
      source: docs(ctx.model),
      ...(row === undefined ? {} : { declared: [...row.keys] }),
    },
  });
}

/** The canonical words that map straight onto a wire name of the same meaning. */
function applyShared(
  input: VideoParams,
  body: FalVideoWire,
  row: FalVideoRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  ctx.from(["prompt"], "prompt");
  ctx.from(["negative_prompt"], "negativePrompt");
  ctx.from(["seed"], "seed");

  if (input.prompt !== undefined) {
    if (has(row, "prompt")) body.prompt = input.prompt;
    else refuse(ctx, "prompt", "prompt", row);
  }
  if (input.negativePrompt !== undefined) {
    if (has(row, "negative_prompt")) body.negative_prompt = input.negativePrompt;
    else refuse(ctx, "negativePrompt", "negative_prompt", row);
  }
  if (input.seed !== undefined) {
    if (has(row, "seed")) body.seed = input.seed;
    else refuse(ctx, "seed", "seed", row);
  }
  if (input.n !== undefined) {
    // Not one of the thirty publishes a count field: fal's video endpoints
    // render exactly one clip per submit, and the queue is how you ask for
    // more. Stated as a refusal rather than an adapter-wide `unsupported`
    // because the sentence should name the endpoint the caller chose.
    ctx.fail({
      code: "unsupported_param",
      path: ["n"],
      message:
        `"${ctx.model}" renders one clip per request — no fal video endpoint declares a count parameter. ` +
        "Submit the request more than once (each POST is its own queue job).",
      meta: { source: docs(ctx.model) },
    });
  }
}

/** `duration`, in whichever of the endpoint's four spellings it takes. */
function applyDuration(
  input: VideoParams,
  body: FalVideoWire,
  row: FalVideoRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  if (input.duration === undefined) return;
  ctx.from(["duration"], "duration");
  if (!has(row, "duration")) {
    refuse(ctx, "duration", "duration", row);
    return;
  }
  const wire = row?.durationWire;
  if (wire !== undefined) {
    const spelling = wire[String(input.duration)];
    if (spelling === undefined) {
      const offered = row?.durations ?? [];
      ctx.fail({
        code: "invalid_enum_value",
        path: ["duration"],
        message:
          `"${ctx.model}" renders ${offered.join(", ")} second${offered.length === 1 ? "" : "s"} and ` +
          `nothing between; got ${input.duration}. The list is this endpoint's own closed enum, so the ` +
          "nearest length is a different request rather than a rounding.",
        meta: { allowed: [...offered], value: input.duration, source: docs(ctx.model) },
      });
      return;
    }
    body.duration = spelling;
    return;
  }
  // A free numeric duration — pixverse takes any integer 1..15. The bounds are
  // on the row, and `fal.video`'s own IR enforces them again at the wire; this
  // check exists so the message arrives at `duration` rather than at a wire
  // name the caller never typed.
  const bounds = row?.bounds?.["duration"];
  if (bounds !== undefined && (isBelow(input.duration, bounds.min) || isAbove(input.duration, bounds.max))) {
    ctx.fail({
      code: "invalid_shape",
      path: ["duration"],
      message:
        `"${ctx.model}" renders between ${bounds.min ?? "?"} and ${bounds.max ?? "?"} seconds; ` +
        `got ${input.duration}.`,
      meta: { ...bounds, value: input.duration, source: docs(ctx.model) },
    });
    return;
  }
  body.duration = input.duration;
}

function isBelow(value: number, min: number | undefined): boolean {
  return min !== undefined && value < min;
}

function isAbove(value: number, max: number | undefined): boolean {
  return max !== undefined && value > max;
}

/** `resolution`, in the endpoint's own spelling — or a refusal naming its tiers. */
function applyResolution(
  input: VideoParams,
  body: FalVideoWire,
  row: FalVideoRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  if (input.resolution === undefined) return;
  ctx.from(["resolution"], "resolution");
  if (!has(row, "resolution")) {
    refuse(ctx, "resolution", "resolution", row);
    return;
  }
  const spelling = row?.resolutionWire?.[input.resolution];
  if (spelling !== undefined) {
    body.resolution = spelling;
    return;
  }
  const offered = row?.resolutions ?? [];
  ctx.fail({
    code: "invalid_enum_value",
    path: ["resolution"],
    message:
      offered.length === 0
        ? `"${ctx.model}" has a \`resolution\` field, but not one of its values is a canonical tier — ` +
          "it spells its own sizes in a vocabulary this category has no word for. Set it through " +
          "`providerOptions.fal.resolution`, where it is still checked against the endpoint's own enum."
        : `\`resolution\` must be ${offered.map((tier) => `"${tier}"`).join(" or ")} on "${ctx.model}"; ` +
          `got "${input.resolution}". Sizes this endpoint offers that are not canonical tiers reach it ` +
          "through `providerOptions.fal.resolution`.",
    meta: { allowed: [...offered], value: input.resolution, source: docs(ctx.model) },
  });
}

/** `aspect_ratio` — a shape, and only a shape. */
function applyAspectRatio(
  input: VideoParams,
  body: FalVideoWire,
  row: FalVideoRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  if (input.aspectRatio === undefined) return;
  ctx.from(["aspect_ratio"], "aspectRatio");
  if (!has(row, "aspect_ratio")) {
    refuse(ctx, "aspectRatio", "aspect_ratio", row);
    return;
  }
  const allowed = row?.ratios;
  if (allowed === undefined || allowed.length === 0 || row?.ratioFreeform === true) {
    // Either fal published no vocabulary for this field (seedance's i2v
    // `aspect_ratio` is a bare string) or it declared the enum open. Both mean
    // the list is a set of presets rather than a limit.
    body.aspect_ratio = input.aspectRatio;
    return;
  }
  const ratio = ctx.take(
    toRatioEnum(input.aspectRatio, allowed, { source: docs(ctx.model) }, { path: ["aspectRatio"], warn: ctx.warn }),
  );
  if (ratio !== undefined) body.aspect_ratio = ratio;
}

/**
 * The media decision: which of the endpoint's role slots each input image fills,
 * and where a source clip goes.
 *
 * `resolveImageSlots` does the canonical half — an unlabelled image is the
 * first frame, two images claiming one slot is an error — and this function
 * does the fal half, which is entirely a lookup in `roleWire`.
 */
function applyMedia(
  input: VideoParams,
  body: FalVideoWire,
  row: FalVideoRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  if (input.video !== undefined) {
    const wire = row?.videoWire;
    if (wire === undefined) {
      ctx.fail({
        code: "unsupported_capability",
        path: ["video"],
        message:
          `"${ctx.model}" has no source-clip parameter — it generates frames rather than editing them. ` +
          `${clipTakers()} of the ${Object.keys(ROWS).length} fal video endpoints do take one.`,
        meta: { source: docs(ctx.model) },
      });
    } else {
      ctx.from([wire], "video");
      const uri = ctx.take(toMediaUri(input.video, { path: ["video"], warn: ctx.warn }));
      if (uri !== undefined) writeMedia(body, wire, uri);
    }
  }

  const slots = ctx.take(resolveImageSlots(input.image, { path: ["image"], warn: ctx.warn }));
  if (slots === undefined) return;
  writeSlot(slots.first, "first", body, row, ctx);
  writeSlot(slots.last, "last", body, row, ctx);
  if (slots.references.length > 0) writeReferences(slots.references, body, row, ctx);
}

function clipTakers(): number {
  return Object.keys(ROWS).filter((id) => ROWS[id]?.videoWire !== undefined).length;
}

/** One keyframe into whichever wire name this endpoint spells that role. */
function writeSlot(
  image: VideoImageInput | undefined,
  role: Extract<VideoImageRole, "first" | "last">,
  body: FalVideoWire,
  row: FalVideoRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  if (image === undefined) return;
  const wire = row?.roleWire?.[role];
  if (wire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["image"],
      message:
        role === "first"
          ? `"${ctx.model}" is a text-to-video endpoint — it declares no image parameter, so a first frame ` +
            "has nothing to become. fal serves image-to-video as its own endpoint id: the same model with " +
            "`/image-to-video` on the path is usually the one you want."
          : `"${ctx.model}" declares no closing-frame parameter, so \`role: "last"\` has nothing to become. ` +
            `${roleTakers("last")} fal video endpoints do take one.`,
      meta: { role, ...(row === undefined ? {} : { roles: [...(row.roles ?? [])] }), source: docs(ctx.model) },
    });
    return;
  }
  ctx.from([wire], "image");
  const uri = ctx.take(toMediaUri(image, { path: ["image"], warn: ctx.warn }));
  if (uri !== undefined) writeMedia(body, wire, uri);
}

/** Reference images, which are an ARRAY field wherever they exist. */
function writeReferences(
  references: readonly VideoImageInput[],
  body: FalVideoWire,
  row: FalVideoRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  const wire = row?.roleWire?.["reference"];
  if (wire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["image"],
      message:
        `"${ctx.model}" declares no reference-image parameter, so \`role: "reference"\` has nothing to ` +
        `become. ${roleTakers("reference")} fal video endpoints do — the ids ending \`/reference-to-video\` ` +
        "are the ones built for it.",
      meta: { role: "reference", source: docs(ctx.model) },
    });
    return;
  }
  ctx.from([wire], "image");
  const uris: string[] = [];
  for (const [index, image] of references.entries()) {
    const uri = ctx.take(toMediaUri(image, { path: ["image", index], warn: ctx.warn }));
    if (uri !== undefined) uris.push(uri);
  }
  if (uris.length > 0) writeMedia(body, wire, uris);
}

function roleTakers(role: string): number {
  return Object.keys(ROWS).filter((id) => ROWS[id]?.roleWire?.[role] !== undefined).length;
}

/**
 * Writes one media value onto the body under a wire name the ROW chose.
 *
 * The cast is confined here and is the price of `FalVideoWire` having no index
 * signature: the name is a string at compile time (it came from generated
 * data) and one of the declared keys at run time (the generator only ever
 * emits names from `VIDEO_ROLE_WIRE`). Keeping the cast in one three-line
 * function is what stops it from spreading into the four call sites above.
 */
function writeMedia(body: FalVideoWire, wire: string, value: string | string[]): void {
  (body as unknown as Record<string, unknown>)[wire] = value;
}

/**
 * The fal video adapter.
 *
 * `models` is the curated roster, so a ref outside it draws `unknown_model`
 * from the kernel and then compiles with no row — every per-endpoint refusal
 * above stands down, and the request goes to the provider's own validator,
 * which is the right place for an endpoint unmodel has not catalogued yet.
 */
export const video = {
  category: "video",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_VIDEO_MODEL_PARAMS,
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<FalVideoWire, FalVideoResult> {
    const body: FalVideoWire = { endpoint: ctx.model };
    const row = ROWS[ctx.model];
    applyShared(input, body, row, ctx);
    applyDuration(input, body, row, ctx);
    applyResolution(input, body, row, ctx);
    applyAspectRatio(input, body, row, ctx);
    applyMedia(input, body, row, ctx);
    applyExtras(input, FAL_VIDEO_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalVideoValidate };
  },
} as const satisfies AnyVideoAdapter;
