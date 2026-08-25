/**
 * `unmodel/3d` → fal, across 19 endpoints from seven vendors.
 *
 * # The row says which MOOD, and the two words move in opposite directions
 *
 * `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale` all read a `sources`
 * list that decides one field's shape. This adapter reads an `inputs` list that
 * decides TWO fields' presence, oppositely: nine rows say `["text"]` and refuse
 * an image, nine say `["image"]` and refuse a prompt, and
 * `fal-ai/hyper3d/rodin/v2.5` says both and requires neither — its prompt
 * steers an image-driven generation and also stands alone. So a prompt sent to
 * a reconstruction route is refused by name here, and is a compile error one
 * layer up.
 *
 * The both-arm needs its own check that the narrowed arms do not: a request
 * with NEITHER a prompt nor an image type-checks against
 * `{ prompt?: string; image?: ThreeDImageInput }` and cannot possibly produce a
 * mesh, so it is refused with a message that names both fields.
 *
 * # The image has four wire names and one of them is a list
 *
 * `image_url` at Tripo, Trellis, Meshy, Hi3D and TripoSR; `input_image_url` at
 * every Hunyuan3D route; `front_image_url` at
 * `tripo3d/tripo/v2.5/multiview-to-3d`, where the canonical `image` is the FRONT
 * view and the other three angles ride as extras; and `image_urls`, an array of
 * up to five views, at Rodin. The adapter asks the row for the name and for
 * whether to wrap, rather than knowing either.
 *
 * # `seed` is one seed out of three
 *
 * Tripo's four routes publish `model_seed`, `image_seed` and `texture_seed`,
 * pinning geometry, the internal text-to-image stage and texturing separately.
 * The canonical `seed` maps to the geometry one — that is the one that decides
 * whether you got the same object — and the other two stay extras. Everywhere
 * else the field is plain `seed`, and `meshy/v7/*` has none at all on the
 * request side, which is refused by name rather than dropped.
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7. `texture` exists at eleven of the nineteen under five different
 * names, `face_limit` at fourteen under four, a format switch at three under
 * three. Every one of those is a per-model extra typed from that endpoint's own
 * wire interface, and a provider-wide claim about any of them would be false at
 * most of fal's own 3D endpoints.
 */

import { applyExtras, toMediaUri } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyThreeDAdapter, ThreeDParams } from "../../core/unified/vocabulary/3d";
import { threeD as validator } from "./three-d";
import { FAL_THREE_D_MODEL_PARAMS, MODELS } from "./three-d-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalThreeDRow {
  readonly keys: readonly string[];
  readonly inputs?: readonly string[];
  readonly imageWire?: string;
  readonly imageWireList?: true;
  readonly seedWire?: string;
}

const ROWS = FAL_THREE_D_MODEL_PARAMS as Readonly<Record<string, FalThreeDRow>>;

/**
 * The wire body this adapter compiles to.
 *
 * No index-signature tail, for `FalImageWire`'s measured reason: an open one
 * makes `ExactKeys` demand `never` for every key and quietly un-narrows the
 * hand surface. The image lands under whichever of four names the ROW chose —
 * and as an array at Rodin — so it goes through {@link write}; per-model extras
 * (`texture`, `pbr`, `face_limit`, `octree_resolution`, `model`, …) reach the
 * body through `applyExtras`'s own cast.
 */
export interface FalThreeDWire {
  /** The route selector, stripped into `.request.url` by `fal.threeD`. */
  endpoint: string;
  prompt?: string;
  image_url?: string;
  input_image_url?: string;
  front_image_url?: string;
  image_urls?: string[];
  seed?: number;
  model_seed?: number;
}

/** What a unified call to `fal/…` returns: `fal.threeD`'s own `Validated`. */
export type FalThreeDResult = ReturnType<typeof validator>;

/** See `./unified-image.ts`: `CompiledCall.validate` is not generic, and cannot be. */
type FalThreeDValidate = CompiledCall<FalThreeDWire, FalThreeDResult>["validate"];

function docs(model: string): string | undefined {
  return FAL_DOC_URLS[model as keyof typeof FAL_DOC_URLS];
}

/**
 * Writes one value onto the body under a wire name the ROW chose.
 *
 * The cast is confined here and is the price of `FalThreeDWire` having no index
 * signature: the name is a string at compile time (it came from generated data)
 * and one of the declared keys at run time. `unified-upscale.ts` keeps the same
 * three-line function for the same reason.
 */
function write(body: FalThreeDWire, wire: string, value: string | number | string[]): void {
  (body as unknown as Record<string, unknown>)[wire] = value;
}

/** The endpoints whose row reads `kind`, for a refusal that counts rather than claims. */
function readers(kind: string): string[] {
  return Object.keys(ROWS).filter((id) => ROWS[id]?.inputs?.includes(kind) === true);
}

/** What to build, described — at the nine routes that read a prompt. */
function applyPrompt(
  input: ThreeDParams,
  body: FalThreeDWire,
  row: FalThreeDRow | undefined,
  ctx: CompileContext<ThreeDParams>,
): void {
  if (input.prompt === undefined) return;
  ctx.from(["prompt"], "prompt");
  if (row === undefined || row.inputs?.includes("text") === true) {
    body.prompt = input.prompt;
    return;
  }
  const able = readers("text").length;
  ctx.fail({
    code: "unsupported_param",
    path: ["prompt"],
    message:
      `"${ctx.model}" reconstructs from an image and declares no \`prompt\` parameter, so \`prompt\` has ` +
      `nothing to become. ${able} of the ${Object.keys(ROWS).length} fal 3D endpoints are told what to build ` +
      "in words; this one is shown. Pass `image` instead, or pick a text-driven route.",
    meta: { wire: "prompt", source: docs(ctx.model), declared: [...row.keys] },
  });
}

/** What to build, shown — under whichever of four names this endpoint spells it. */
function applyImage(
  input: ThreeDParams,
  body: FalThreeDWire,
  row: FalThreeDRow | undefined,
  ctx: CompileContext<ThreeDParams>,
): void {
  if (input.image === undefined) return;
  const wire = row?.imageWire;
  ctx.from([wire ?? "image_url"], "image");

  if (row !== undefined && wire === undefined) {
    const able = readers("image").length;
    ctx.fail({
      code: "unsupported_param",
      path: ["image"],
      message:
        `"${ctx.model}" builds from a text prompt and declares no image parameter, so \`image\` has nothing ` +
        `to become. ${able} of the ${Object.keys(ROWS).length} fal 3D endpoints take a reference picture; ` +
        "this one is told what to build in words. Pass `prompt` instead.",
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }

  const uri = ctx.take(toMediaUri(input.image, { path: ["image"], warn: ctx.warn }));
  if (uri === undefined) return;
  // An uncatalogued endpoint gets the commonest spelling and `fal.threeD`'s own
  // IR has the last word.
  const name = wire ?? "image_url";
  write(body, name, row?.imageWireList === true ? [uri] : uri);
}

/** The geometry seed, under `seed` or `model_seed`. */
function applySeed(
  input: ThreeDParams,
  body: FalThreeDWire,
  row: FalThreeDRow | undefined,
  ctx: CompileContext<ThreeDParams>,
): void {
  if (input.seed === undefined) return;
  const wire = row?.seedWire;
  ctx.from([wire ?? "seed"], "seed");
  if (row === undefined || wire !== undefined) {
    write(body, wire ?? "seed", input.seed);
    return;
  }
  const able = Object.keys(ROWS).filter((id) => ROWS[id]?.seedWire !== undefined).length;
  ctx.fail({
    code: "unsupported_param",
    path: ["seed"],
    message:
      `"${ctx.model}" declares no seed parameter of any spelling, so \`seed\` has nothing to become and the ` +
      `run cannot be pinned. ${able} of the ${Object.keys(ROWS).length} fal 3D endpoints publish one ` +
      "(`seed` at most, `model_seed` at Tripo's four, which pin geometry apart from texture).",
    meta: { source: docs(ctx.model), declared: [...row.keys] },
  });
}

/**
 * The both-arm's own requirement: name the object SOMEHOW.
 *
 * Only reachable at a row whose `inputs` holds both moods, because the narrowed
 * arms already require their one field at the type level.
 * `fal-ai/hyper3d/rodin/v2.5` publishes `prompt` and `image_urls` and marks
 * neither `required`, so fal's schema would accept an empty body and bill for a
 * refusal. The row knows better than the schema does here.
 */
function checkNamed(
  input: ThreeDParams,
  row: FalThreeDRow | undefined,
  ctx: CompileContext<ThreeDParams>,
): void {
  if (row === undefined) return;
  if (input.prompt !== undefined || input.image !== undefined) return;
  if (row.inputs?.includes("text") !== true || row.inputs.includes("image") !== true) return;
  ctx.fail({
    // `invalid_shape` is the code `checkRequired` already uses for "this body
    // is missing something it cannot work without", one layer down.
    code: "invalid_shape",
    path: ["prompt"],
    message:
      `"${ctx.model}" reads both a prompt and a reference image and requires NEITHER on the wire, which means ` +
      "a body with neither is accepted and produces nothing. Pass `prompt`, `image`, or both — the prompt " +
      "steers the reconstruction when an image is present.",
    meta: { source: docs(ctx.model) },
  });
}

/**
 * The fal 3D adapter.
 *
 * `models` is the curated roster, so a ref outside it draws `unknown_model` from
 * the kernel and then compiles with no row — the refusals above stand down and
 * the request goes to `fal.threeD`'s own IR, which is the right place for an
 * endpoint unmodel has not catalogued yet.
 */
export const threeD = {
  category: "3d",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_THREE_D_MODEL_PARAMS,
  compile(
    input: ThreeDParams,
    ctx: CompileContext<ThreeDParams>,
  ): CompiledCall<FalThreeDWire, FalThreeDResult> {
    const body: FalThreeDWire = { endpoint: ctx.model };
    const row = ROWS[ctx.model];

    applyPrompt(input, body, row, ctx);
    applyImage(input, body, row, ctx);
    applySeed(input, body, row, ctx);
    checkNamed(input, row, ctx);

    applyExtras(input, FAL_THREE_D_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalThreeDValidate };
  },
} as const satisfies AnyThreeDAdapter;
