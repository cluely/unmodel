/**
 * `unmodel/image-edit` → fal, across 17 endpoints.
 *
 * The sibling of `./unified-image`, split per category so that neither pack
 * pays for the other's validators and schema; `./unified.ts` re-exports both.
 * The size branching, the per-endpoint refusal rule and the `sync_mode`
 * treatment are identical to the generation adapter and are documented in full
 * there. Three things are specific to editing.
 *
 * # The source picture is a URL — an `https:` one or a `data:` one
 *
 * Every fal editing endpoint takes its input as a REFERENCE in a JSON string
 * field, so `imageInputs` is `["url"]` and both a hosted picture and inline
 * bytes arrive the same way. See {@link ACCEPTS} for why raw base64
 * (`{ data }`) is not accepted — it is a missing media type, not a gap.
 *
 * # One picture or many, and the row says which
 *
 * fal spells the source three ways across this roster, and the difference is
 * not cosmetic — it decides whether a second reference image is even possible:
 *
 * | wire | endpoints |
 * |---|---|
 * | `image_url` (one) | the kontext routes, flux fill, flux dev i2i, qwen-image-edit-2511 |
 * | `image_urls` (a list) | the nano-banana edits, the seedream edits, kontext max multi, the flux-2 edits |
 * | `image_url` + `mask_url` | `fal-ai/flux-pro/v1/fill` — inpainting |
 *
 * The canonical vocabulary has one `image`, so a list-shaped endpoint receives
 * a one-element array. That is the honest mapping rather than a lossy one: a
 * caller who wants the second and third reference images reaches for
 * `providerOptions.fal.image_urls`, and the mask has no canonical word at all
 * — inpainting is not in `unmodel/image-edit`'s vocabulary yet, so `mask_url`
 * is a per-model extra rather than a word invented on one provider's witness.
 *
 * # `strength` exists on exactly one arm
 *
 * `fal-ai/flux/dev/image-to-image` is a re-render with a denoising dial;
 * everything else here is instruction editing, which has no dial between
 * keeping and replacing the input. So `strength` is accepted where the
 * endpoint declares it and refused by name everywhere else — a per-endpoint
 * fact, like every other refusal in this file.
 */

import {
  applyExtras,
  pixelsToRatio,
  redundantTier,
  resolveImageEditInput,
  resolveOperation,
  resolveSizing,
  sizingField,
  toPixels,
  toRatioEnum,
  type PixelRules,
  type Sizing,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageEditAdapterFor,
  ImageEditParamsFor,
} from "../../core/unified/vocabulary/image-edit";
import { imageEdit as validator } from "./image-edit";
import { FAL_IMAGE_EDIT_MODEL_PARAMS, MODELS } from "./image-edit-params";
import { FAL_DOC_URLS } from "./gen/endpoints.gen";

/** The generated row shape, as this file reads it. */
interface FalImageEditRow {
  readonly classes: readonly string[];
  readonly keys: readonly string[];
  readonly sizes?: readonly string[];
  readonly ratios?: readonly string[];
  readonly ratioFreeform?: true;
  readonly pixels?: { readonly min?: number; readonly max?: number };
  readonly bounds?: Readonly<Record<string, { readonly min?: number; readonly max?: number }>>;
}

const ROWS = FAL_IMAGE_EDIT_MODEL_PARAMS as Readonly<Record<string, FalImageEditRow>>;

/**
 * This category takes `{ url }` and ONLY `{ url }`.
 *
 * fal's file fields take a reference: an `https:` URL it fetches, or a `data:`
 * URI carrying the bytes. Both are URLs, so both are `{ url }`.
 *
 * `{ data }` is deliberately NOT accepted, and the reason is a real
 * incompatibility rather than a gap. The canonical `{ data }` is documented as
 * the RAW base64 payload with no media type — "a provider that needs the type
 * takes a `data:` URL instead" — and fal is exactly such a provider: it needs
 * the `data:image/png;base64,` prefix to know what it was handed. unmodel
 * cannot synthesise that prefix, because guessing a media type from base64 is
 * guessing. A caller with bytes in hand writes the URI they already know the
 * type of:
 *
 * ```ts
 * imageEdit({ …, image: { url: `data:image/png;base64,${bytes}` } });
 * ```
 *
 * Declaring `{ data }` and quietly prefixing it with some default type would
 * send a PNG header on a JPEG about half the time.
 */
const ACCEPTS = ["url"] as const;

type EditParams = ImageEditParamsFor<"url">;

/**
 * The wire body this adapter compiles to.
 *
 * No open index signature, for the reason `./unified-image.ts` documents at
 * length: it would make `ExactKeys` demand `never` and quietly un-narrow
 * `fal.imageEdit`. Extras reach the body through `applyExtras`'s own cast.
 */
export interface FalImageEditWire {
  /** The route selector, stripped into `.request.url` by `fal.imageEdit`. */
  endpoint: string;
  prompt: string;
  image_url?: string;
  image_urls?: string[];
  image_size?: string | { width: number; height: number };
  aspect_ratio?: string;
  num_images?: number;
  seed?: number;
  output_format?: string;
  strength?: number;
  // `resolution`, `negative_prompt` and `sync_mode` are absent on purpose.
  // They exist on several of these endpoints, but `ImageEditParams` has no
  // canonical word for any of them, so they arrive as per-model EXTRAS
  // through `applyExtras` rather than being written by this adapter.
}

/** What a unified call returns: `fal.imageEdit`'s own `Validated`. */
export type FalImageEditResult = ReturnType<typeof validator>;

/** See the twin in `./unified-image.ts` for why this cast is needed and what it costs. */
type FalImageEditValidate = CompiledCall<FalImageEditWire, FalImageEditResult>["validate"];

const docUrl = (endpoint: string): string | undefined =>
  FAL_DOC_URLS[endpoint as keyof typeof FAL_DOC_URLS];

function has(row: FalImageEditRow | undefined, key: string): boolean {
  return row?.keys.includes(key) === true;
}

function hasClass(row: FalImageEditRow | undefined, name: string): boolean {
  return row?.classes.includes(name) === true;
}

function pixelRules(row: FalImageEditRow | undefined, endpoint: string): PixelRules {
  const rules: PixelRules = { grid: 1, source: docUrl(endpoint) };
  if (row?.pixels?.min !== undefined) (rules as { min?: number }).min = row.pixels.min;
  if (row?.pixels?.max !== undefined) (rules as { max?: number }).max = row.pixels.max;
  return rules;
}

/** One `unsupported_param`, phrased against the endpoint rather than the provider. */
function refuse(
  ctx: CompileContext<EditParams>,
  canonical: string,
  wire: string,
  row: FalImageEditRow | undefined,
  endpoint: string,
): void {
  const takers = Object.keys(ROWS).filter((id) => ROWS[id]?.keys.includes(wire) === true);
  ctx.fail({
    code: "unsupported_param",
    path: [canonical],
    message:
      `"${endpoint}" declares no \`${wire}\` parameter, so \`${canonical}\` has nothing to become. ` +
      (takers.length === 0
        ? "No fal endpoint in this category takes it."
        : `${takers.length} of the ${Object.keys(ROWS).length} fal image-edit endpoints do take it` +
          `${takers.length <= 4 ? ` — ${takers.map((id) => `"${id}"`).join(", ")}` : ""}.`) +
      " fal is a queue in front of many vendors' models, so a parameter one endpoint has is routinely absent " +
      "from the next; this is a fact about the endpoint, not about fal.",
    meta: {
      wire,
      source: docUrl(endpoint),
      ...(row === undefined ? {} : { declared: [...row.keys] }),
    },
  });
}

/** The source picture, onto whichever of `image_url` / `image_urls` the endpoint has. */
function applySource(
  input: EditParams,
  body: FalImageEditWire,
  row: FalImageEditRow | undefined,
  ctx: CompileContext<EditParams>,
): void {
  const single = has(row, "image_url");
  const many = has(row, "image_urls");
  ctx.from([many && !single ? "image_urls" : "image_url"], "image");

  const image = ctx.take(
    resolveImageEditInput(input.image, ACCEPTS, { path: ["image"], warn: ctx.warn }, {
      source: docUrl(ctx.model),
      hint:
        "fal takes its inputs as a reference in a JSON string field: an `https:` URL it fetches, or a " +
        "`data:` URI carrying the bytes. Both are `{ url }`. Raw base64 (`{ data }`) has no media type " +
        "for fal to read, and a Blob cannot be encoded without awaiting, which a synchronous compile step " +
        "cannot do — so host it, or pass `{ url: `data:image/png;base64,${…}` }`.",
    }),
  );
  if (image === undefined) return;
  // Both accepted kinds are already a string fal can fetch or decode: a
  // `data:` URI IS the documented inline form here, so neither arm needs
  // re-encoding.
  // `resolveImageEditInput` has already refused every kind but `url` against
  // ACCEPTS, so this narrowing is by proof rather than by assertion.
  if (image.kind !== "url") return;
  const reference = image.url;

  if (single) {
    body.image_url = reference;
    return;
  }
  if (many) {
    // One canonical `image` becomes a one-element list. The endpoint's further
    // reference slots have no canonical word, so they are reached through
    // `providerOptions.fal.image_urls` — see the module header.
    body.image_urls = [reference];
    return;
  }
  ctx.fail({
    code: "unsupported_param",
    path: ["image"],
    message:
      `"${ctx.model}" declares neither \`image_url\` nor \`image_urls\`, so there is nowhere to put the ` +
      "picture to edit. That almost certainly means this endpoint is mis-curated as an editing route; " +
      "please report it.",
    meta: { source: docUrl(ctx.model), ...(row === undefined ? {} : { declared: [...row.keys] }) },
  });
}

/** The canonical words that map straight onto a wire name, where the endpoint has one. */
function applyShared(
  input: EditParams,
  body: FalImageEditWire,
  row: FalImageEditRow | undefined,
  ctx: CompileContext<EditParams>,
): void {
  ctx.from(["prompt"], "prompt");
  ctx.from(["seed"], "seed");
  ctx.from(["num_images"], "n");
  ctx.from(["output_format"], "outputFormat");
  ctx.from(["strength"], "strength");

  if (input.seed !== undefined) {
    if (has(row, "seed")) body.seed = input.seed;
    else refuse(ctx, "seed", "seed", row, ctx.model);
  }
  if (input.n !== undefined) {
    if (has(row, "num_images")) body.num_images = input.n;
    else refuse(ctx, "n", "num_images", row, ctx.model);
  }
  if (input.outputFormat !== undefined) {
    if (has(row, "output_format")) body.output_format = input.outputFormat;
    else refuse(ctx, "outputFormat", "output_format", row, ctx.model);
  }
  if (input.strength !== undefined) {
    if (!has(row, "strength")) {
      refuse(ctx, "strength", "strength", row, ctx.model);
    } else {
      // The canonical scale starts at 0 — "keep the source" — and this
      // endpoint's floor is 0.01. Clamping UP to the floor rather than
      // rescaling the whole range: a rescale would move `strength: 0.5` to
      // 0.505 for no reason, where a clamp changes only the values fal has no
      // number for at all. It warns, because 0 and 0.01 are not the same
      // request even if they are the closest two.
      const min = row?.bounds?.["strength"]?.min;
      // Only inside the canonical range. A negative `strength` is a mistake,
      // not a request for the floor, and clamping it would turn a caller's bug
      // into a silently-accepted request; it falls through to the endpoint's
      // own bound check, which refuses it by name.
      if (min !== undefined && input.strength >= 0 && input.strength < min) {
        ctx.warn({
          code: "approximated_param",
          path: ["strength"],
          message:
            `\`strength\` ${input.strength} is below "${ctx.model}"'s floor of ${min}, so ${min} was sent — ` +
            "the least this endpoint can change the source. It cannot leave the picture untouched.",
          meta: { min, value: input.strength, source: docUrl(ctx.model) },
        });
        body.strength = min;
      } else {
        body.strength = input.strength;
      }
    }
  }
}

/** The size decision, branching on shape class exactly as the generation adapter does. */
function applySize(
  input: EditParams,
  body: FalImageEditWire,
  row: FalImageEditRow | undefined,
  ctx: CompileContext<EditParams>,
): void {
  const sizing = ctx.take(
    resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }, { sizes: row?.sizes }),
  );

  if (sizing === undefined || sizing.kind === "unset") return;

  if (hasClass(row, "imageSizeUnion")) {
    if (sizing.kind === "size") {
      ctx.from(["image_size"], "size");
      body.image_size = sizing.size;
      return;
    }
    if (sizing.kind === "dimensions") {
      const wrote = sizingField(sizing);
      ctx.from(["image_size", "width"], wrote === "size" ? "size" : "dimensions.width");
      ctx.from(["image_size", "height"], wrote === "size" ? "size" : "dimensions.height");
      body.image_size = { width: sizing.dimensions.width, height: sizing.dimensions.height };
      return;
    }
    ctx.from(["image_size", "width"], "aspectRatio");
    ctx.from(["image_size", "height"], "aspectRatio");
    const pixels = ctx.take(
      // `1k` is the vocabulary's default rather than this adapter's opinion:
      // `image_size` is a pixel pair, so a ratio cannot be sent without also
      // settling a size, and `ImageEditParams` has no tier word to ask with.
      toPixels(sizing.aspectRatio, "1k", pixelRules(row, ctx.model), {
        path: ["aspectRatio"],
        warn: ctx.warn,
      }),
    );
    if (pixels !== undefined) body.image_size = { width: pixels.width, height: pixels.height };
    return;
  }

  if (hasClass(row, "imageSizePresets")) {
    ctx.from(["image_size"], "size");
    if (sizing.kind === "size") {
      body.image_size = sizing.size;
      return;
    }
    const wrote = sizing.kind === "ratio" ? "aspectRatio" : sizingField(sizing);
    // A preset that is SPELLED as pixels. Several fal endpoints publish an
    // `image_size` enum whose members are `WxH` strings (`gpt-image-1.5` lists
    // "1024x1024", "1536x1024", "1024x1536"), and `resolveSizing` parses any
    // `WxH` into `{ kind: "dimensions" }` before a preset list is ever consulted
    // — so the endpoint's own vocabulary arrives here looking like free-form
    // pixels. Matching it back against the list is what makes `size: "1024x1024"`
    // work on an enum route: it is a preset, and it goes on the wire verbatim.
    if (sizing.kind === "dimensions") {
      const spelled = `${sizing.dimensions.width}x${sizing.dimensions.height}`;
      if (row?.sizes?.includes(spelled) === true) {
        body.image_size = spelled;
        return;
      }
    }
    ctx.fail({
      code: "unsupported_param",
      path: [wrote === "size" ? "size" : wrote],
      message:
        `"${ctx.model}" sizes by name only — its \`image_size\` is a closed list ` +
        `(${(row?.sizes ?? []).map((value) => `"${value}"`).join(", ")}) with no width/height arm, so ` +
        `\`${wrote}\` has nothing to become. Name one of those sizes with \`size\` instead.`,
      meta: { allowed: [...(row?.sizes ?? [])], source: docUrl(ctx.model) },
    });
    return;
  }

  if (hasClass(row, "aspectRatioEnum")) return applyAspectRatio(sizing, body, row, ctx);

  // `fixedGeometry`: the output follows the input, which is the commonest and
  // most sensible thing an editing route can do.
  ctx.fail({
    code: "unsupported_param",
    path: [sizing.kind === "ratio" ? "aspectRatio" : sizingField(sizing) === "size" ? "size" : "dimensions"],
    message:
      `"${ctx.model}" has no size field of any kind — an edit comes back at the shape and size of the ` +
      "picture it was given. Omit the size words to ask for exactly that.",
    meta: { source: docUrl(ctx.model) },
  });
}

/** `aspect_ratio` — a shape, and only a shape. */
function applyAspectRatio(
  sizing: Exclude<Sizing, { kind: "unset" }>,
  body: FalImageEditWire,
  row: FalImageEditRow | undefined,
  ctx: CompileContext<EditParams>,
): void {
  if (sizing.kind === "size") {
    ctx.fail({
      code: "unsupported_param",
      path: ["size"],
      message:
        `"${ctx.model}" sizes by \`aspect_ratio\` and declares no \`image_size\` field, so a size literal ` +
        "has nothing to become. Use `aspectRatio` to choose the shape.",
      meta: { value: sizing.size, source: docUrl(ctx.model) },
    });
    return;
  }
  const from = sizing.kind === "dimensions" ? sizingField(sizing) : "aspectRatio";
  const path = [from];
  ctx.from(["aspect_ratio"], from);

  let spelling: string | undefined;
  if (sizing.kind === "ratio") {
    spelling = sizing.aspectRatio;
  } else {
    // Always warns, even for a shape that matches a listed ratio exactly: a
    // ratio cannot carry a pixel count however well it matched.
    spelling = ctx.take(
      pixelsToRatio(sizing.dimensions.width, sizing.dimensions.height, row?.ratios, {
        path,
        warn: ctx.warn,
      }),
    );
  }
  if (spelling === undefined) return;

  const allowed = row?.ratios;
  if (allowed === undefined || allowed.length === 0 || row?.ratioFreeform === true) {
    body.aspect_ratio = spelling;
    return;
  }
  const ratio = ctx.take(
    toRatioEnum(spelling, allowed, { source: docUrl(ctx.model) }, { path, warn: ctx.warn }),
  );
  if (ratio !== undefined) body.aspect_ratio = ratio;
}

/**
 * The fal image-edit adapter.
 *
 * No adapter-wide `unsupported`: every refusal above is derived from the
 * endpoint's own generated key list and names that endpoint, because a
 * provider-wide claim would be false at most of fal's own routes. See
 * `./unified-image.ts` for the argument in full (risk R7).
 */
export const imageEdit = {
  category: "imageEdit",
  provider: "fal",
  models: MODELS,
  imageInputs: ACCEPTS,
  modelParams: FAL_IMAGE_EDIT_MODEL_PARAMS,
  compile(
    input: EditParams,
    ctx: CompileContext<EditParams>,
  ): CompiledCall<FalImageEditWire, FalImageEditResult> {
    const body: FalImageEditWire = { endpoint: ctx.model, prompt: input.prompt };
    const row = ROWS[ctx.model];

    ctx.take(
      resolveOperation(input.operation, ["edit"] as const, { path: ["operation"], warn: ctx.warn }, {
        source: docUrl(ctx.model),
        hint:
          "fal's masked and geometry-driven routes are reachable by name at `unmodel/fal` — " +
          "`fal-ai/flux-pro/v1/fill` inpaints, and `fal-ai/flux-2-pro/outpaint` extends a canvas.",
      }),
    );

    applySource(input, body, row, ctx);
    applyShared(input, body, row, ctx);
    applySize(input, body, row, ctx);
    applyExtras(input, FAL_IMAGE_EDIT_MODEL_PARAMS, body, ctx);
    return { params: body, validate: validator.safe as FalImageEditValidate };
  },
} as const satisfies ImageEditAdapterFor<"url", FalImageEditWire, FalImageEditResult>;
