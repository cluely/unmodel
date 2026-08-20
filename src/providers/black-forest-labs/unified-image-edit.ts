/**
 * `unmodel/image-edit` → `black-forest-labs.imageEdit` (FLUX.1 Kontext,
 * POST https://api.bfl.ai/v1/flux-kontext-{pro,max}).
 *
 * A sibling of `./unified-image`, split per category for the reason every
 * provider that serves two categories splits: one module exporting both
 * adapters is one build entry holding both, so `unmodel/image-edit` would carry
 * the FLUX.2 and FLUX.1 generation validators for nothing. `./unified.ts`
 * re-exports both halves, so the subpath is unchanged.
 *
 * # Which BFL route is "the" edit route
 *
 * BFL publishes seven editing routes and only one of them takes *a picture and
 * a sentence*: Kontext. The other six are mask- or geometry-driven —
 * `imageEditFill` wants a mask, `imageEditExpand` wants per-side margins, and
 * `imageEditOutpainting`, `imageEditErase`, `imageEditDeblur` and
 * `imageEditVto` each want a second image or a set of pixels — and none of them
 * is expressible in a v1 vocabulary whose whole content is
 * `{ prompt, image, strength }`. They stay wire-only at
 * `unmodel/black-forest-labs`, which is where they work; `operation` on
 * `ImageEditParams` is the discriminant that lets them join later without
 * either widening the type or minting a seventh entry point.
 *
 * # `image`: base64 or a URL, and honestly not a Blob
 *
 * `input_image` is documented "Base64-encoded image or URL to edit", so this
 * adapter declares `imageInputs: ["data", "url"]` — and **not** `"file"`. A
 * `Blob`'s bytes cannot be read without awaiting, and `compile` is synchronous
 * by design (it is a pure function from params to params, which is what lets
 * the same compile step run in a validator, a CLI and a test with no I/O). The
 * same reasoning, and the same honest refusal, as `inworld.transcribe`: the
 * shape that cannot work does not type-check, and the runtime message names the
 * two that do.
 *
 * A `{ data }` that already carries a `data:` prefix is unwrapped to its
 * payload, because the field is documented as base64 and the caller who had a
 * data URI meant the bytes rather than the envelope.
 *
 * # `strength`
 *
 * Kontext has no strength field of any kind — the whole route is "describe the
 * change and it happens", with no dial between the input and the output. The
 * nearest thing in the schema is `prompt_upsampling`, which embellishes the
 * *prompt*, not the edit. Declared unsupported rather than mapped onto
 * something adjacent.
 */
import {
  base64Payload,
  resolveImageEditInput,
  resolveOperation,
  resolveSizing,
  toRatioString,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageEditAdapterFor,
  ImageEditParamsFor,
} from "../../core/unified/vocabulary/image-edit";
import type { BflAspectRatio } from "./aspect";
import type { BflOutputFormat } from "./image";
import { imageEdit as validator } from "./image-edit";

const KONTEXT_SCHEMA_URL =
  "https://api.bfl.ai/openapi.json#/components/schemas/FluxKontextProInputs";

/** The operations this route serves through the canonical vocabulary. */
const EDIT_ONLY = ["edit"] as const;

/** Both Kontext routes — the `black-forest-labs/…` edit refs. */
const MODELS = ["flux-kontext-pro", "flux-kontext-max"] as const;

/**
 * "Aspect ratio of the image between 21:9 and 9:21." The bound is symmetric and
 * stated in prose only, so it is a range rather than an enum — S5, with the
 * same numbers `./aspect.ts` enforces on the way out. One copy of 21÷9 in this
 * file and one in the provider's own check is not two sources of truth: this one
 * decides the *spelling*, that one decides whether the request is legal.
 */
const KONTEXT_RATIO = { min: 9 / 21, max: 21 / 9, source: KONTEXT_SCHEMA_URL };

/**
 * The wire body this adapter compiles to — the slice of `FluxKontextParams` the
 * canonical vocabulary can reach.
 *
 * No `[key: string]: unknown` tail: `FluxKontextParams` has no index signature,
 * so an open tail would make `ExactKeys` demand `never` for every extra key and
 * `black-forest-labs.imageEdit.safe` would stop being assignable. The rest of
 * the schema — `input_image_2..4`, `prompt_upsampling`, `safety_tolerance`, the
 * webhook pair — arrives through `providerOptions["black-forest-labs"]`, which
 * the kernel merges *before* validation.
 */
export interface BflImageEditWire {
  model: string;
  prompt: string;
  input_image?: string;
  seed?: number;
  aspect_ratio?: BflAspectRatio;
  output_format?: BflOutputFormat;
}

/** What a unified edit call to `black-forest-labs/…` returns. */
export type BflImageEditResult = ReturnType<typeof validator>;

export const imageEdit = {
  category: "imageEdit",
  provider: "black-forest-labs",
  models: MODELS,
  imageInputs: ["data", "url"],
  unsupported: {
    strength:
      "FLUX.1 Kontext has no strength field — the route takes an instruction and applies it, with " +
      "no dial between keeping and replacing the input. `prompt_upsampling` embellishes the " +
      "prompt rather than the edit, so it is not the same knob under another name.",
    n:
      "Black Forest Labs generates one image per request — POST /v1/{model} submits a single " +
      "async job (`{ id, polling_url }`) whose result is one image, and FluxKontextProInputs " +
      "declares no count field; issue N requests to get N images.",
    dimensions:
      "FLUX.1 Kontext sizes by `aspect_ratio` (between 21:9 and 9:21) and publishes no " +
      "width/height pair — the output resolution follows the input. Use `aspectRatio` to change " +
      "the shape.",
  },
  compile(
    input: ImageEditParamsFor<"data" | "url">,
    ctx: CompileContext<ImageEditParamsFor<"data" | "url">>,
  ): CompiledCall<BflImageEditWire, BflImageEditResult> {
    const body: BflImageEditWire = { model: ctx.model, prompt: input.prompt };
    ctx.from(["input_image"], "image");
    ctx.from(["prompt"], "prompt");
    ctx.from(["aspect_ratio"], "aspectRatio");
    ctx.from(["output_format"], "outputFormat");

    ctx.take(
      resolveOperation(input.operation, EDIT_ONLY, { path: ["operation"], warn: ctx.warn }, {
        source: KONTEXT_SCHEMA_URL,
        hint:
          "The masked and geometry-driven FLUX routes — `imageEditFill`, `imageEditExpand`, " +
          "`imageEditOutpainting`, `imageEditErase`, `imageEditDeblur`, `imageEditVto` — are " +
          "reachable by name at `unmodel/black-forest-labs`.",
      }),
    );

    const image = ctx.take(
      resolveImageEditInput(input.image, ["data", "url"], { path: ["image"], warn: ctx.warn }, {
        source: KONTEXT_SCHEMA_URL,
        hint:
          "`input_image` is a JSON string field, so the bytes have to be base64 already — a Blob " +
          "cannot be encoded without awaiting, which a synchronous compile step cannot do. Read " +
          "it yourself and pass `{ data }`, or host it and pass `{ url }`.",
      }),
    );
    if (image?.kind === "url") body.input_image = image.url;
    else if (image?.kind === "data") body.input_image = base64Payload(image.data);

    const sizing = ctx.take(resolveSizing(input, { path: ["aspectRatio"], warn: ctx.warn }));
    if (sizing?.kind === "ratio") {
      const ratio = ctx.take(
        toRatioString(sizing.aspectRatio, KONTEXT_RATIO, { path: ["aspectRatio"], warn: ctx.warn }),
      );
      if (ratio !== undefined) body.aspect_ratio = ratio as BflAspectRatio;
    }

    if (input.seed !== undefined) body.seed = input.seed;
    if (input.outputFormat !== undefined) body.output_format = input.outputFormat;

    return { params: body, validate: validator.safe };
  },
} as const satisfies ImageEditAdapterFor<"data" | "url", BflImageEditWire, BflImageEditResult>;
