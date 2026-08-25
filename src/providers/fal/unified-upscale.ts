/**
 * `unmodel/upscale` → fal, across 10 endpoints.
 *
 * # The row says which shape, and here it genuinely varies
 *
 * `unmodel/lipsync` and `unmodel/avatar` read the same `sources` field and
 * every row in each of those categories agrees with every other. This one does
 * not: seven rows say `["image"]` and three say `["video"]`, and two of them —
 * `fal-ai/seedvr/upscale/image` and `fal-ai/seedvr/upscale/video` — are the
 * same vendor's same product on two paths. So the adapter asks the row for the
 * wire name rather than knowing one, and a still sent to a clip route is
 * refused by name here and is a compile error one layer up.
 *
 * # `factor` has three answers and each gets its own message
 *
 * A RANGE at seven endpoints — the row carries no `factors` and the bounds
 * ride in `bounds`, so the value goes out and `fal.upscale`'s own IR checks it
 * against that endpoint's minimum and maximum. A closed SET at
 * `fal-ai/aura-sr`, whose `upscale_factor` is a `const 4`: anything else is
 * refused here naming the one value, because "upscale by 4 or do not upscale"
 * is what that model is. And NOTHING at `fal-ai/recraft/upscale/crisp`, which
 * picks its own output size — refused with a different message, because "this
 * route has no multiplier" and "this route has one and it is 4" are different
 * facts and a caller can act on each differently.
 *
 * # `prompt` is canonical and still per-model
 *
 * Three of the ten steer on one (`fal-ai/clarity-upscaler`,
 * `topaz/upscale/image/generative`, `blackforestlabs/flux-video-upscale`) and
 * seven have no field for it. That is the shape `unmodel/video` has for
 * `negative_prompt` and it gets the same treatment: the word is canonical
 * because it means the same thing wherever it exists, and the refusal names the
 * endpoint and counts its siblings rather than claiming "fal cannot do this".
 *
 * # There is no adapter-wide `unsupported`
 *
 * Risk R7, and this is the category where it would have been most tempting and
 * most wrong: `seed` exists at three of the ten, `output_format` at five,
 * `prompt` at three. A provider-wide claim would be false at the majority of
 * fal's own upscale endpoints.
 */

import { applyExtras, toMediaUri } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { AnyUpscaleAdapter, UpscaleParams } from "../../core/unified/vocabulary/upscale";
import { upscale as validator } from "./upscale";
import { FAL_UPSCALE_MODEL_PARAMS, MODELS } from "./upscale-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalUpscaleRow {
  readonly keys: readonly string[];
  readonly sources?: readonly string[];
  readonly sourceWire?: string;
  readonly factorWire?: string;
  readonly factors?: readonly number[];
  readonly textWire?: string;
  readonly bounds?: Readonly<Record<string, { readonly min?: number; readonly max?: number }>>;
}

const ROWS = FAL_UPSCALE_MODEL_PARAMS as Readonly<Record<string, FalUpscaleRow>>;

/**
 * The wire body this adapter compiles to.
 *
 * No index-signature tail, for `FalImageWire`'s measured reason: an open one
 * makes `ExactKeys` demand `never` for every key and quietly un-narrows the
 * hand surface. The source and the multiplier land under names the ROW chose
 * (`image_url` / `video_url`, `upscale_factor` / `scale`), so both go on
 * through {@link write}; per-model extras (`creativity`, `denoise`, `model`,
 * `target_resolution`, …) reach the body through `applyExtras`'s own cast.
 */
export interface FalUpscaleWire {
  /** The route selector, stripped into `.request.url` by `fal.upscale`. */
  endpoint: string;
  image_url?: string;
  video_url?: string;
  upscale_factor?: number;
  scale?: number;
  prompt?: string;
}

/** What a unified call to `fal/…` returns: `fal.upscale`'s own `Validated`. */
export type FalUpscaleResult = ReturnType<typeof validator>;

/** See `./unified-image.ts`: `CompiledCall.validate` is not generic, and cannot be. */
type FalUpscaleValidate = CompiledCall<FalUpscaleWire, FalUpscaleResult>["validate"];

function docs(model: string): string | undefined {
  return FAL_DOC_URLS[model as keyof typeof FAL_DOC_URLS];
}

/**
 * Writes one value onto the body under a wire name the ROW chose.
 *
 * The cast is confined here and is the price of `FalUpscaleWire` having no
 * index signature: the name is a string at compile time (it came from generated
 * data) and one of the declared keys at run time. `unified-video.ts` keeps the
 * same three-line function for the same reason.
 */
function write(body: FalUpscaleWire, wire: string, value: string | number): void {
  (body as unknown as Record<string, unknown>)[wire] = value;
}

/** The endpoints whose row declares `wire`, for a refusal that counts rather than claims. */
function takers(wire: string): string[] {
  return Object.keys(ROWS).filter((id) => ROWS[id]?.keys.includes(wire) === true);
}

/** The source clip or still, under whichever name this endpoint spells it. */
function applySource(
  input: UpscaleParams,
  body: FalUpscaleWire,
  row: FalUpscaleRow | undefined,
  ctx: CompileContext<UpscaleParams>,
): void {
  const sourceWire = row?.sourceWire;
  if (row !== undefined && sourceWire === undefined) {
    ctx.fail({
      code: "unsupported_capability",
      path: ["source"],
      message:
        `"${ctx.model}" declares no image or video parameter, so it cannot serve an upscale request. ` +
        "This is a roster bug rather than a caller mistake — please file it.",
      meta: { source: docs(ctx.model) },
    });
    return;
  }
  const wire = sourceWire ?? "image_url";
  ctx.from([wire], "source");
  const uri = ctx.take(toMediaUri(input.source, { path: ["source"], warn: ctx.warn }));
  if (uri !== undefined) write(body, wire, uri);
}

/** The multiplier — a range, a closed set, or nothing at all. */
function applyFactor(
  input: UpscaleParams,
  body: FalUpscaleWire,
  row: FalUpscaleRow | undefined,
  ctx: CompileContext<UpscaleParams>,
): void {
  if (input.factor === undefined) return;
  const wire = row?.factorWire;
  ctx.from([wire ?? "upscale_factor"], "factor");

  if (row === undefined) {
    // An endpoint this build has not catalogued: send the commonest spelling
    // and let `fal.upscale`'s own IR have the last word.
    body.upscale_factor = input.factor;
    return;
  }

  if (wire === undefined) {
    const able = takers("upscale_factor").length + takers("scale").length;
    ctx.fail({
      code: "unsupported_param",
      path: ["factor"],
      message:
        `"${ctx.model}" upscales to a size it chooses and declares no multiplier parameter, so \`factor\` ` +
        `has nothing to become. ${able} of the ${Object.keys(ROWS).length} fal upscale endpoints do take ` +
        "one; this one is not a caller mistake so much as a different kind of upscaler.",
      meta: { source: docs(ctx.model), declared: [...row.keys] },
    });
    return;
  }

  const offered = row.factors;
  if (offered !== undefined && offered.length > 0 && !offered.includes(input.factor)) {
    ctx.fail({
      code: "invalid_enum_value",
      path: ["factor"],
      message:
        `"${ctx.model}" upscales by ${offered.join(", ")} and nothing else; got ${input.factor}. ` +
        "The value is this endpoint's own closed enum rather than a range, so a nearby multiplier is a " +
        "different request rather than a rounding.",
      meta: { allowed: [...offered], value: input.factor, wire, source: docs(ctx.model) },
    });
    return;
  }

  write(body, wire, input.factor);
}

/** The steering prompt, at the three endpoints that have one. */
function applyPrompt(
  input: UpscaleParams,
  body: FalUpscaleWire,
  row: FalUpscaleRow | undefined,
  ctx: CompileContext<UpscaleParams>,
): void {
  if (input.prompt === undefined) return;
  const wire = row?.textWire ?? "prompt";
  ctx.from([wire], "prompt");
  if (row === undefined || row.textWire !== undefined) {
    write(body, wire, input.prompt);
    return;
  }
  const able = takers("prompt");
  ctx.fail({
    code: "unsupported_param",
    path: ["prompt"],
    message:
      `"${ctx.model}" restores detail from the source alone and declares no \`prompt\` parameter, so ` +
      `\`prompt\` has nothing to become. ${able.length} of the ${Object.keys(ROWS).length} fal upscale ` +
      `endpoints steer on one${able.length > 0 && able.length <= 3 ? ` (${able.map((id) => `"${id}"`).join(", ")})` : ""}.`,
    meta: { wire: "prompt", source: docs(ctx.model), declared: [...row.keys] },
  });
}

/**
 * The fal upscale adapter.
 *
 * `models` is the curated roster, so a ref outside it draws `unknown_model`
 * from the kernel and then compiles with no row — the refusals above stand down
 * and the request goes to `fal.upscale`'s own IR, which is the right place for
 * an endpoint unmodel has not catalogued yet.
 */
export const upscale = {
  category: "upscale",
  provider: "fal",
  models: MODELS,
  modelParams: FAL_UPSCALE_MODEL_PARAMS,
  compile(
    input: UpscaleParams,
    ctx: CompileContext<UpscaleParams>,
  ): CompiledCall<FalUpscaleWire, FalUpscaleResult> {
    const body: FalUpscaleWire = { endpoint: ctx.model };
    const row = ROWS[ctx.model];

    applySource(input, body, row, ctx);
    applyFactor(input, body, row, ctx);
    applyPrompt(input, body, row, ctx);

    applyExtras(input, FAL_UPSCALE_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalUpscaleValidate };
  },
} as const satisfies AnyUpscaleAdapter;
