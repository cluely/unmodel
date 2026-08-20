/**
 * `unmodel/image-edit` → `openai.imageEdit` (POST /v1/images/edits).
 *
 * A fifth per-category leaf beside `./unified-image`, `./unified-speech`,
 * `./unified-video` and `./unified-transcribe`, and a separate module for the
 * reason all of them are: `unmodel/image` and `unmodel/image-edit` both reach
 * this provider, and a single module holding both adapters would put OpenAI's
 * *generation* validator into the editing pack and vice versa. `./unified.ts`
 * re-exports all five, so the public subpath is unchanged.
 *
 * # The three things worth reading
 *
 * - **`image` is a `Blob`, and only a `Blob`.** `/v1/images/edits` is a
 *   multipart route; the JSON variant that takes `{ file_id }` / `{ image_url }`
 *   references is not modeled by `openai.imageEdit` (see the header of
 *   `./image-edit.ts`), so `imageInputs` is `["file"]` and a `{ url }` here does
 *   not compile. The narrowing is the wire, not an opinion.
 * - **`size` is three vocabularies again**, decided entirely by the model id —
 *   the same split as `./unified-image`, minus `dall-e-3` (which is not an edit
 *   model) and plus `chatgpt-image-latest` (which is edit-only). The tables are
 *   restated here rather than imported from the generation adapter, because
 *   importing across the two leaves would undo the split this file exists for;
 *   they are also not the *same* tables — `dall-e-2` accepts three sizes on this
 *   route where the generation table offers one row.
 * - **`strength` has no field at all.** OpenAI's nearest neighbour is
 *   `input_fidelity: "high" | "low"`, which is a two-position switch about how
 *   much of the *input* to preserve, not a 0–1 dial about how far the output may
 *   drift — and quantizing a continuous canonical param onto two values would be
 *   an approximation nobody could reason about. Declared unsupported, with the
 *   escape hatch named.
 */
import {
  applyExtras,
  resolveImageEditInput,
  resolveOperation,
  resolveSizing,
  sizeRules,
  sizingField,
  toSizeEnum,
  toSizeFreeform,
  type FreeformRules,
  type SizeTable,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageEditAdapterFor,
  ImageEditParamsFor,
} from "../../core/unified/vocabulary/image-edit";
import { imageEdit as validator } from "./image-edit";
import { OPENAI_IMAGE_EDIT_MODEL_PARAMS } from "./image-params";

/**
 * Every model `/v1/images/edits` documents — "One of `dall-e-2` or a GPT image
 * model". `dall-e-3` is deliberately absent; `chatgpt-image-latest` is
 * deliberately present, and is edit-only.
 */
const MODELS = [
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "chatgpt-image-latest",
  "dall-e-2",
] as const;

/**
 * The operations this route serves through the canonical vocabulary. One today,
 * declared as an array rather than compared to a literal so that adding
 * `"inpaint"` here is the whole change when `mask` gains a canonical field.
 */
const EDIT_ONLY = ["edit"] as const;

const EDIT_DOCS = "https://developers.openai.com/api/docs/api-reference/images/createEdit";
const IMAGE_GUIDE_DOCS = "https://developers.openai.com/api/docs/guides/image-generation";

/** The ids whose `size` is free-form rather than an enum. */
const FREEFORM_SIZE_MODELS: ReadonlySet<string> = new Set([
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
]);

/** The ids that always return base64 and take `output_format`. */
const GPT_IMAGE_MODELS: ReadonlySet<string> = new Set([
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "chatgpt-image-latest",
]);

/**
 * dall-e-2's edit sizes are `256x256` / `512x512` / `1024x1024` — all square,
 * so one tier with one row. The two smaller values are below the `1k` tier and
 * have no ratio that could reach them; a caller who wants 512×512 says so with
 * `dimensions`, which goes straight through.
 */
const DALL_E_2_EDIT_SIZES: SizeTable = { "1k": { "1:1": "1024x1024" } };

/** `"auto" | "1024x1024" | "1536x1024" | "1024x1536"` — the GPT image enum. */
const GPT_IMAGE_EDIT_SIZES: SizeTable = {
  "1k": { "1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536" },
};

/**
 * gpt-image-2's free-form rules, from the image-generation guide: both edges
 * multiples of 16, maximum edge 3840. The total-pixel floor is not expressible
 * as a `PixelRules` (it is on the product, not on an edge) and is enforced by
 * `checkGptImage2Size` — i.e. by the same check a hand-written call meets, with
 * the kernel remapping its finding onto `aspectRatio` / `dimensions`.
 */
const GPT_IMAGE_2_RULES: FreeformRules = { grid: 16, max: 3840, source: IMAGE_GUIDE_DOCS };

/** The wire body this adapter compiles to — the loose arm of `ImageEditBody`. */
export interface OpenaiImageEditWire {
  model: string;
  image: Blob;
  prompt: string;
  n?: number;
  size?: string;
  output_format?: string;
  [key: string]: unknown;
}

/** What a unified edit call to `openai/…` returns: `openai.imageEdit`'s `Validated`. */
export type OpenaiImageEditResult = ReturnType<typeof validator>;

/** The size table for a model id; unknown ids compile like the current generation. */
function sizeTableFor(model: string): SizeTable | undefined {
  if (model === "dall-e-2") return DALL_E_2_EDIT_SIZES;
  if (FREEFORM_SIZE_MODELS.has(model)) return undefined;
  return GPT_IMAGE_EDIT_SIZES;
}

export const imageEdit = {
  category: "imageEdit",
  provider: "openai",
  models: MODELS,
  imageInputs: ["file"],
  modelParams: OPENAI_IMAGE_EDIT_MODEL_PARAMS,
  unsupported: {
    strength:
      "POST /v1/images/edits has no strength dial — `input_fidelity` is a two-position switch " +
      '("high" / "low") about how much of the input to preserve, not a 0–1 amount of change, so a ' +
      "canonical `strength` could only be quantized onto two values. Set `input_fidelity` " +
      "directly via `providerOptions.openai` when that is what you want.",
    seed:
      "POST /v1/images/edits has no seed field — neither the DALL·E nor the GPT image models " +
      "expose one on this route, so a seed could only be dropped.",
  },
  compile(
    input: ImageEditParamsFor<"file">,
    ctx: CompileContext<ImageEditParamsFor<"file">>,
  ): CompiledCall<OpenaiImageEditWire, OpenaiImageEditResult> {
    const body: OpenaiImageEditWire = {
      model: ctx.model,
      image: new Blob([]),
      prompt: input.prompt,
    };
    ctx.from(["image"], "image");
    ctx.from(["prompt"], "prompt");
    ctx.from(["n"], "n");

    ctx.take(
      resolveOperation(input.operation, EDIT_ONLY, { path: ["operation"], warn: ctx.warn }, {
        source: EDIT_DOCS,
        hint:
          "`/v1/images/edits` does the masked operations too, through the `mask` part — which has " +
          "no canonical field in v1 and is one `providerOptions.openai` key away.",
      }),
    );

    const image = ctx.take(
      resolveImageEditInput(input.image, ["file"], { path: ["image"], warn: ctx.warn }, {
        source: EDIT_DOCS,
        hint: "POST /v1/images/edits reads the bytes from a multipart `image` part.",
      }),
    );
    if (image?.kind === "file") body.image = image.file;

    const sizing = ctx.take(
      resolveSizing(
        input,
        { path: ["aspectRatio"], warn: ctx.warn },
        sizeRules(OPENAI_IMAGE_EDIT_MODEL_PARAMS, ctx.model),
      ),
    );
    const table = sizeTableFor(ctx.model);
    if (sizing?.kind === "size") {
      // `"auto"`, the one non-pixel `size` on this route. Already checked
      // against the model's declared list, so it goes across verbatim.
      ctx.from(["size"], "size");
      body.size = sizing.size;
    } else if (sizing?.kind === "ratio") {
      ctx.from(["size"], "aspectRatio");
      // `1k` is the only tier this category has a word for: `ImageEditParams`
      // carries no `resolution`, because the overwhelmingly common answer to
      // "how big" when editing is "the size it already was" — which is what
      // omitting the pair means.
      const size = ctx.take(
        table === undefined
          ? toSizeFreeform(sizing.aspectRatio, "1k", GPT_IMAGE_2_RULES, {
              path: ["aspectRatio"],
              warn: ctx.warn,
            })
          : toSizeEnum(sizing.aspectRatio, "1k", table, { path: ["aspectRatio"], warn: ctx.warn }),
      );
      if (size !== undefined) body.size = size;
    } else if (sizing?.kind === "dimensions") {
      // Straight through on both paths: gpt-image-2 documents free-form `WxH`,
      // and the enum models have a documented `size` list their own constraint
      // table checks. Either way the pixels the caller asked for are the pixels
      // that go on the wire, so there is nothing to warn about — and a size the
      // model does not offer is that model's own error, remapped onto
      // `dimensions`.
      ctx.from(["size"], sizingField(sizing));
      body.size = sizing.size ?? `${sizing.dimensions.width}x${sizing.dimensions.height}`;
    }

    if (input.n !== undefined) body.n = input.n;

    if (input.outputFormat !== undefined) {
      ctx.from(["output_format"], "outputFormat");
      if (GPT_IMAGE_MODELS.has(ctx.model)) {
        body.output_format = input.outputFormat;
      } else {
        ctx.fail({
          code: "unsupported_param",
          path: ["outputFormat"],
          message:
            "`output_format` is only supported for the GPT image models; " +
            `"${ctx.model}" returns PNG. Use a gpt-image model to choose an encoding.`,
          meta: { value: input.outputFormat, source: EDIT_DOCS },
        });
      }
    }

    applyExtras(input, OPENAI_IMAGE_EDIT_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies ImageEditAdapterFor<
  "file",
  OpenaiImageEditWire,
  OpenaiImageEditResult,
  typeof OPENAI_IMAGE_EDIT_MODEL_PARAMS
>;
