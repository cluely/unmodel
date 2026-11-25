/**
 * `unmodel/video` → `higgsfield.video`
 * (POST https://api.higgsfield.ai/<route id>), across every route that has a
 * canonical word for what to make.
 *
 * # The roles are the dispatch, and the route id is not
 *
 * A Higgsfield ref names a ROUTE, and text-to-video, image-to-video,
 * first-and-last-frame, reference-to-video, motion control and clip editing
 * are different KEYS on one route shape, not different wire routes
 * (`./video.ts`). So nothing here switches on an id or on the path's tail. The
 * adapter reads the route's generated row (`./video-params.ts`):
 *
 * | row says | what the route is | canonical input |
 * |---|---|---|
 * | `roles: []`, no `videoWire` | text-to-video | `prompt` only |
 * | `roles: ["first"]` | image-to-video | `image: { url }` |
 * | `roles: ["first", "last"]` | first-and-last-frame | `image: [{…}, { role: "last", … }]` |
 * | `roles: ["reference"]` | reference-to-video | `image: [{ role: "reference", … }]` |
 * | `videoWire` | motion control, edit, extend, restyle | `video: { url }` |
 *
 * Higgsfield spells the opening frame `image_url` or `first_frame_url` and the
 * closing one `end_image_url`, `last_image_url` or `last_frame_url`; the
 * adapter names none of them and reads `roleWire[role]` off the row.
 *
 * # A clip is `video_url`, or the first of `video_urls`
 *
 * Where a route has `video_url` (Genjutsu, Kling motion control, the edit and
 * extend routes) the canonical clip goes there. Where it has only the list
 * (Cinema Studio 4.0, the reference-to-video routes) the clip is sent as a
 * one-element `video_urls`, which is the row fal's adapter has for the same
 * Seedance route. Further clips are `providerOptions.higgsfield.video_urls`.
 *
 * # Media is a public URL
 *
 * No route takes bytes, so an inline picture or clip is refused with the
 * presigned upload route (`./compile-input.ts`).
 *
 * # `resolution` refuses more often than it maps, on purpose
 *
 * `minimax/h3-lite` lists `480P | 768P` and `minimax/h3` lists `2K` alone.
 * `480p` maps, in the route's capitals; `768P` and `2K` are not canonical
 * tiers, so they are not in the row, a tier the route cannot express is
 * refused naming the ones it can, and the route's own sizes are
 * `providerOptions.higgsfield.resolution`. Nothing is rounded to a neighbour:
 * resolution selects the price on most of these routes.
 *
 * # What the adapter does not check
 *
 * A duration outside a route's list or range, a required field with no
 * canonical word (`preset_id` on Genjutsu Restyle), and a route's cross-field
 * rules are `higgsfield.video`'s to report. Its findings come back at the
 * canonical word through the provenance declared here.
 */

import { applyExtras, resolveImageSlots, toRatioEnum } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  VideoAdapterFor,
  VideoImageInput,
  VideoImageRole,
  VideoParams,
} from "../../core/unified/vocabulary/video";
import { docsOf, refuseWithoutRow, refuseWord, TIER_SPELLINGS, toHiggsfieldMediaUrl, type RouteTable } from "./compile-input";
import type { HiggsfieldVideoParamRow } from "./param-types";
import type { HiggsfieldCompiledResult } from "./submit";
import { video as validator } from "./video";
import { HIGGSFIELD_VIDEO_MODEL_PARAMS, MODELS } from "./video-params";

const ROWS: Readonly<Partial<Record<string, HiggsfieldVideoParamRow>>> = HIGGSFIELD_VIDEO_MODEL_PARAMS;

const TABLE: RouteTable = { noun: "video", rows: HIGGSFIELD_VIDEO_MODEL_PARAMS };

/**
 * The wire body this adapter compiles to. Every media parameter a row can
 * name is listed, so writing the one a row chose is typed. No index-signature
 * tail; see `HiggsfieldImageWire` in `./unified-image.ts`.
 */
export interface HiggsfieldVideoWire {
  /** The route id, stripped into `.request.url` by `higgsfield.video`. */
  endpoint: string;
  prompt?: string;
  negative_prompt?: string;
  seed?: number;
  duration?: number;
  resolution?: string;
  aspect_ratio?: string;
  image_url?: string;
  first_frame_url?: string;
  end_image_url?: string;
  last_image_url?: string;
  last_frame_url?: string;
  image_urls?: string[];
  video_url?: string;
  video_urls?: string[];
}

/** What a unified video call to `higgsfield/…` returns; see `HiggsfieldImageResult` in `./unified-image.ts`. */
export type HiggsfieldVideoResult = HiggsfieldCompiledResult<HiggsfieldVideoWire>;

/** See `HiggsfieldImageValidate` in `./unified-image.ts`. */
type HiggsfieldVideoValidate = CompiledCall<HiggsfieldVideoWire, HiggsfieldVideoResult>["validate"];

export const video = {
  category: "video",
  provider: "higgsfield",
  models: MODELS,
  modelParams: HIGGSFIELD_VIDEO_MODEL_PARAMS,
  unsupported: {
    n:
      "no Higgsfield video route declares a count: one request renders one clip. Submit the request once per " +
      "clip (each POST is its own queued request).",
  },
  compile(
    input: VideoParams,
    ctx: CompileContext<VideoParams>,
  ): CompiledCall<HiggsfieldVideoWire, HiggsfieldVideoResult> {
    const row = ROWS[ctx.model];
    const body: HiggsfieldVideoWire = { endpoint: ctx.model };
    applyWords(input, body, row, ctx);
    applyAspectRatio(input, body, row, ctx);
    applyResolution(input, body, row, ctx);
    applyMedia(input, body, row, ctx);
    applyExtras(input, HIGGSFIELD_VIDEO_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as HiggsfieldVideoValidate };
  },
} as const satisfies VideoAdapterFor<typeof HIGGSFIELD_VIDEO_MODEL_PARAMS, HiggsfieldVideoWire, HiggsfieldVideoResult>;

/** The words Higgsfield spells one way on every route that has them. */
const WORDS = [
  ["prompt", "prompt"],
  ["negativePrompt", "negative_prompt"],
  ["seed", "seed"],
  ["duration", "duration"],
] as const;

/**
 * Each of {@link WORDS} to the parameter of the same meaning, or a refusal
 * where the route has none.
 */
function applyWords(
  input: VideoParams,
  body: HiggsfieldVideoWire,
  row: HiggsfieldVideoParamRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  const wire = body as { [K in (typeof WORDS)[number][1]]?: string | number };
  for (const [canonical, name] of WORDS) {
    ctx.from([name], canonical);
    const value = input[canonical];
    if (value === undefined) continue;
    if (row === undefined || row.keys.includes(name)) wire[name] = value;
    else refuseWord(ctx, canonical, name, TABLE);
  }
}

/**
 * `aspect_ratio`, in the route's own spelling of the shape: `"32:18"` is sent
 * as the `"16:9"` the route lists, and a shape it does not list is refused
 * naming the ones it does.
 */
function applyAspectRatio(
  input: VideoParams,
  body: HiggsfieldVideoWire,
  row: HiggsfieldVideoParamRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  ctx.from(["aspect_ratio"], "aspectRatio");
  if (input.aspectRatio === undefined) return;
  if (row === undefined) {
    body.aspect_ratio = input.aspectRatio;
    return;
  }
  if (!row.keys.includes("aspect_ratio")) {
    refuseWord(ctx, "aspectRatio", "aspect_ratio", TABLE);
    return;
  }
  const ratio = ctx.take(
    toRatioEnum(input.aspectRatio, row.ratios ?? [], { source: docsOf(ctx.model) }, { path: ["aspectRatio"], warn: ctx.warn }),
  );
  if (ratio !== undefined) body.aspect_ratio = ratio;
}

/** `resolution`, in the route's spelling of the tier, or a refusal naming the tiers it has. */
function applyResolution(
  input: VideoParams,
  body: HiggsfieldVideoWire,
  row: HiggsfieldVideoParamRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  ctx.from(["resolution"], "resolution");
  if (input.resolution === undefined) return;
  if (row === undefined) {
    refuseWithoutRow(ctx, "resolution", TIER_SPELLINGS);
    return;
  }
  if (!row.keys.includes("resolution")) {
    refuseWord(ctx, "resolution", "resolution", TABLE);
    return;
  }
  const spelling = row.resolutionWire?.[input.resolution];
  if (spelling !== undefined) {
    body.resolution = spelling;
    return;
  }
  const offered = row.resolutions ?? [];
  ctx.fail({
    code: "invalid_enum_value",
    path: ["resolution"],
    message:
      (offered.length === 0
        ? `\`${ctx.model}\` has a \`resolution\` parameter, but none of its values is a canonical tier`
        : `\`resolution\` must be ${offered.map((tier) => `"${tier}"`).join(" or ")} on \`${ctx.model}\``) +
      `; got "${input.resolution}". The sizes this route lists in its own words are reachable through ` +
      "`providerOptions.higgsfield.resolution`, where the route's own vocabulary still checks them.",
    meta: { allowed: [...offered], value: input.resolution, source: docsOf(ctx.model) },
  });
}

/** Which of the route's role parameters each picture fills, and where a source clip goes. */
function applyMedia(
  input: VideoParams,
  body: HiggsfieldVideoWire,
  row: HiggsfieldVideoParamRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  // Declared whether or not the request carries the input: `higgsfield.video`
  // also reports what is MISSING ("`image_url` is required"), and that finding
  // belongs at `image` too.
  for (const wire of Object.values(row?.roleWire ?? {})) ctx.from([wire], "image");
  if (row?.videoWire !== undefined) ctx.from([row.videoWire], "video");

  if (input.video !== undefined) applyClip(input.video, body, row, ctx);

  const slots = ctx.take(resolveImageSlots(input.image, { path: ["image"], warn: ctx.warn }));
  if (slots === undefined) return;
  if (row === undefined) {
    if (input.image !== undefined) {
      refuseWithoutRow(ctx, "image", ["image_url", "first_frame_url", "end_image_url", "last_image_url", "last_frame_url", "image_urls"]);
    }
    return;
  }
  for (const role of ["first", "last"] as const) {
    const picture = slots[role];
    if (picture === undefined) continue;
    const wire = row.roleWire?.[role];
    if (wire === undefined) {
      refuseRole(role, row, ctx);
      continue;
    }
    const url = mediaUrl(picture, ctx);
    if (url !== undefined) body[wire] = url;
  }
  if (slots.references.length === 0) return;
  const wire = row.roleWire?.reference;
  if (wire === undefined) {
    refuseRole("reference", row, ctx);
    return;
  }
  const urls = slots.references.flatMap((reference) => mediaUrl(reference, ctx) ?? []);
  if (urls.length > 0) body[wire] = urls;
}

function applyClip(
  clip: NonNullable<VideoParams["video"]>,
  body: HiggsfieldVideoWire,
  row: HiggsfieldVideoParamRow | undefined,
  ctx: CompileContext<VideoParams>,
): void {
  if (row === undefined) {
    refuseWithoutRow(ctx, "video", ["video_url", "video_urls"]);
    return;
  }
  const wire = row.videoWire;
  if (wire === undefined) {
    ctx.fail({
      code: "unsupported_param",
      path: ["video"],
      message:
        `\`${ctx.model}\` declares no source-clip parameter: it generates a clip and does not take one. ` +
        `${takers((other) => other.videoWire !== undefined)} of the ${Object.keys(TABLE.rows).length} Higgsfield video routes do.`,
      meta: { source: docsOf(ctx.model) },
    });
    return;
  }
  const url = ctx.take(toHiggsfieldMediaUrl(clip, { path: ["video"], warn: ctx.warn }));
  if (url === undefined) return;
  if (wire === "video_urls") body.video_urls = [url];
  else body.video_url = url;
}

function mediaUrl(image: VideoImageInput, ctx: CompileContext<VideoParams>): string | undefined {
  return ctx.take(toHiggsfieldMediaUrl(image, { path: ["image"], warn: ctx.warn }));
}

/** How a role reads in a sentence. */
const ROLE_LABELS: Readonly<Record<VideoImageRole, string>> = {
  first: "an opening frame",
  last: "a closing frame",
  reference: "reference pictures",
};

/** A picture role the route has no parameter for, naming the roles it does serve. */
function refuseRole(role: VideoImageRole, row: HiggsfieldVideoParamRow, ctx: CompileContext<VideoParams>): void {
  const serves =
    row.roles.length === 0
      ? "It takes no picture at all"
      : `It takes ${row.roles.map((own) => `${ROLE_LABELS[own]} (\`role: "${own}"\`)`).join(" and ")}`;
  ctx.fail({
    code: "unsupported_param",
    path: ["image"],
    message:
      `\`${ctx.model}\` declares no parameter for ${ROLE_LABELS[role]}, so \`role: "${role}"\` has nothing to become` +
      `${role === "first" ? " (an image with no `role` is the opening frame)" : ""}. ${serves}; ` +
      `${takers((other) => other.roleWire?.[role] !== undefined)} of the ${Object.keys(TABLE.rows).length} Higgsfield video ` +
      "routes have a parameter for this role.",
    meta: { role, roles: [...row.roles], source: docsOf(ctx.model) },
  });
}

function takers(test: (row: HiggsfieldVideoParamRow) => boolean): number {
  return Object.values(HIGGSFIELD_VIDEO_MODEL_PARAMS).filter((row) => test(row)).length;
}

// A deliberate NON-import, asserted in test/bundle-budget.test.ts: this module
// never imports `./models.ts` or `./index.ts`. The catalog belongs to the
// validator, which the pack reaches through `./video`.
