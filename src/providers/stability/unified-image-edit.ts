/**
 * `unmodel/image-edit` → `stability.imageEditRemoveBackground`
 * (POST https://api.stability.ai/v2beta/stable-image/edit/remove-background).
 *
 * # One route out of six
 *
 * Stability publishes six Stable Image edit routes. Five of them — erase,
 * inpaint, outpaint, search-and-replace, search-and-recolor — are driven by a
 * mask, a second prompt that selects a region, or a number of pixels per side,
 * and this vocabulary has no word for any of those; they stay reachable by name
 * at `unmodel/stability`. The sixth takes a picture and returns its subject on
 * a transparent background, which is exactly `operation: "removeBackground"`.
 *
 * So this adapter serves one ref, `stability/stable-image-remove-background`,
 * and one operation. A prompted `operation: "edit"` is refused naming the
 * wire-only routes that do take a prompt.
 *
 * # Two fields, both canonical
 *
 * `image: { file }` → `image` (the route is multipart and takes a Blob; a URL
 * or inline base64 is refused naming `{ file }`), and `outputFormat` →
 * `output_format`. The route "returns an alpha channel" and offers `png` and
 * `webp` only, so `outputFormat: "jpeg"` is refused by name rather than
 * dropped — the same refusal `recraft/unified-image-edit.ts` makes for the
 * same reason.
 *
 * Every other canonical word is a declared gap: the route has no field any of
 * them could become.
 *
 * Source, transcribed 2026-08-13 and re-read 2026-11-24 (see `./image-edit.ts`):
 *   https://api.stability.ai/v2alpha/openapi
 */
import { resolveImageEditInput } from "../../core/unified/derive";
import { resolveImageEditOperation } from "../../core/unified/image-edit-operations";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageEditAdapterFor,
  ImageEditParamsFor,
} from "../../core/unified/vocabulary/image-edit";
import {
  imageEditRemoveBackground as validator,
  STABILITY_ALPHA_OUTPUT_FORMATS,
  type StableImageRemoveBackgroundParams,
} from "./image-edit";
import { MODELS, STABILITY_IMAGE_EDIT_MODEL_PARAMS } from "./image-edit-params";

/** The machine-readable v2beta spec — the same URL `./image-edit.ts` quotes. */
const API_REFERENCE_URL = "https://api.stability.ai/v2alpha/openapi";

/**
 * Why none of the edit words compiles. Quoted to a caller of any of the seven,
 * so it says what the route does take.
 */
const NO_SUCH_FIELD =
  "POST /v2beta/stable-image/edit/remove-background takes `image` and `output_format` and " +
  "nothing else — it cuts the subject out and has no prompt, seed, count or output shape.";

/** The wire params this adapter compiles to (multipart form fields). */
export type StabilityImageEditWire = StableImageRemoveBackgroundParams;

/**
 * What a unified call to `stability/stable-image-remove-background` returns:
 * `stability.imageEditRemoveBackground`'s `ValidatedForm`.
 */
export type StabilityImageEditResult = ReturnType<typeof validator>;

type Input = ImageEditParamsFor<"file", "removeBackground">;

export const imageEdit = {
  category: "imageEdit",
  provider: "stability",
  models: MODELS,
  imageInputs: ["file"],
  modelParams: STABILITY_IMAGE_EDIT_MODEL_PARAMS,
  unsupported: {
    prompt: NO_SUCH_FIELD,
    strength: NO_SUCH_FIELD,
    n: NO_SUCH_FIELD,
    seed: NO_SUCH_FIELD,
    size: NO_SUCH_FIELD,
    aspectRatio: NO_SUCH_FIELD,
    dimensions: NO_SUCH_FIELD,
  },
  compile(
    input: Input,
    ctx: CompileContext<Input>,
  ): CompiledCall<StabilityImageEditWire, StabilityImageEditResult> {
    // Overwritten below when the caller supplied a Blob; the branch that does
    // not is an error, so this value never reaches a validator.
    const body: StabilityImageEditWire = { image: new Blob([]) };
    ctx.from(["image"], "image");

    // The id is unmodel's handle for one route; that route takes no model
    // field. No model can be released under it, so an id outside the list is a
    // mistyped handle and not a newer model: compiling it would send, and
    // bill, the removal route under a name nobody asked for.
    if (!(MODELS as readonly string[]).includes(ctx.model)) {
      ctx.fail({
        code: "invalid_enum_value",
        path: ["model"],
        message:
          `\`stability/${ctx.model}\` is not a Stability image-edit ref. The route takes no model field, so the ref is ` +
          `unmodel's name for it: ${MODELS.map((id) => `\`stability/${id}\``).join(" and ")}.`,
        meta: { allowed: [...MODELS], value: ctx.model, source: API_REFERENCE_URL },
      });
    }

    ctx.take(
      resolveImageEditOperation(
        input.operation,
        STABILITY_IMAGE_EDIT_MODEL_PARAMS,
        ctx.model,
        { path: ["operation"], warn: ctx.warn },
        {
          source: API_REFERENCE_URL,
          hint:
            "Stability's prompted edits are mask- or search-driven and reachable by name at " +
            "`unmodel/stability`: `stability.imageEditInpaint`, `stability.imageEditErase`, " +
            "`stability.imageEditOutpaint`, `stability.imageEditSearchAndReplace` and " +
            "`stability.imageEditSearchAndRecolor`.",
        },
      ),
    );

    const image = ctx.take(
      resolveImageEditInput(input.image, ["file"], { path: ["image"], warn: ctx.warn }, {
        source: API_REFERENCE_URL,
        hint:
          "The route is multipart and reads the picture from its `image` part; it has no URL " +
          "or base64 field — fetch or decode the picture and pass the bytes.",
      }),
    );
    if (image?.kind === "file") body.image = image.file;

    if (input.outputFormat !== undefined) {
      ctx.from(["output_format"], "outputFormat");
      if (input.outputFormat === "jpeg") {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["outputFormat"],
          message:
            "`output_format` is \"png\" or \"webp\" on this route: it returns an alpha channel, " +
            "and JPEG cannot carry one, so `outputFormat: \"jpeg\"` could only be dropped.",
          meta: {
            allowed: [...STABILITY_ALPHA_OUTPUT_FORMATS],
            value: input.outputFormat,
            source: API_REFERENCE_URL,
          },
        });
      } else {
        body.output_format = input.outputFormat;
      }
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies ImageEditAdapterFor<
  "file",
  StabilityImageEditWire,
  StabilityImageEditResult,
  typeof STABILITY_IMAGE_EDIT_MODEL_PARAMS,
  "removeBackground"
>;
