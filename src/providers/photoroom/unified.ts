/**
 * `unmodel/image-edit` → `photoroom.imageEdit`
 * (POST https://image-api.photoroom.com/v2/edit), in its Edit With AI mode.
 *
 * The adapter itself, not a barrel: Photoroom serves one unified category, so
 * there is no sibling leaf to keep out of a pack.
 *
 * # One mode out of forty
 *
 * `/v2/edit` is one route for background removal, AI backgrounds, shadows,
 * relighting, text removal, expand, upscale, virtual model and more. Exactly
 * one of them has the shape this vocabulary names — a picture, a sentence, no
 * mask — and that is Edit With AI: `editWithAI.mode: "ai.auto"` plus
 * `editWithAI.prompt`. So the adapter serves one ref, `photoroom/edit-with-ai`,
 * and the rest of the route stays reachable by name at `unmodel/photoroom`.
 *
 * # `removeBackground: false` is written for you
 *
 * The route's default is `removeBackground: true`, which here would return a
 * CUT-OUT of the edit. All five examples on the Edit With AI page send
 * `removeBackground=false`, so the adapter does. It is not a default that moves
 * a price — every `/v2/edit` call costs the same — and a caller who wants the
 * cut-out says so through `providerOptions.photoroom`, which wins.
 *
 * `referenceBox` is deliberately NOT written. One of the five examples adds
 * `referenceBox=originalImage`; four do not, and the OpenAPI document says
 * `referenceBox` "Can't be provided if `removeBackground` is set to `false`".
 * The one forced field is the form the docs send most and the only one that
 * agrees with the document. Whether the second changes the picture is
 * unconfirmed (it needs a `sandbox_` call); `photoroom.imageEdit` accepts the
 * pair without complaint, so `providerOptions: { photoroom: { referenceBox:
 * "originalImage" } }` reproduces that first example exactly.
 *
 * # `image` is a Blob, and only a Blob
 *
 * "The POST endpoint accepts `imageFile` only." Photoroom fetches a URL only on
 * `GET /v2/edit`, which this library does not address (see `./index.ts`), and
 * the route has no base64 field at all — so `imageInputs` is `["file"]`.
 *
 * # More pictures, and everything else the route takes
 *
 * Edit With AI reads up to four further reference pictures, each under a name
 * the caller chooses: `editWithAI.additionalImages.<name>.imageFile`. They ride
 * in `providerOptions.photoroom`, which is typed from the WHOLE `/v2/edit` form
 * ({@link PhotoroomImageEditWire} is `EditParams`), so every field of the
 * route — the five `pr-*` header params included — completes there and is
 * checked by the same validator a hand-written call meets.
 *
 * Sources, read 2026-11-24:
 *   https://docs.photoroom.com/image-editing-api-plus-plan/edit-with-ai.md
 *   https://image-api.photoroom.com/openapi
 * Research: docs/research/photoroom-api-2026-11-24.md §4.2.
 */
import { resolveImageEditInput, resolveOperation } from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageEditAdapterFor,
  ImageEditParamsFor,
} from "../../core/unified/vocabulary/image-edit";
import { PHOTOROOM_OPENAPI_URL } from "./constants";
import { imageEdit as validator, type EditParams, type EditValidated } from "./image-edit";
import { MODELS, PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS } from "./image-edit-params";

/** The operations this route serves through the canonical vocabulary. */
const EDIT_ONLY = ["edit"] as const;

const EDIT_WITH_AI_DOCS = "https://docs.photoroom.com/image-editing-api-plus-plan/edit-with-ai.md";

/**
 * Why no canonical shape word compiles. Quoted to a caller of any of the three,
 * so it names the field that looks like the answer and says what it really is.
 */
const NO_OUTPUT_SIZE =
  "Edit With AI has no field for the shape of its output: \"By default, Edit With AI will produce " +
  "outputs at a resolution of 1K (`1024x1024`)\", and 2K / 4K are Enterprise-only with no " +
  "documented parameter. `outputSize` is the CANVAS the result is positioned in, not the size it " +
  "is generated at — set it through `providerOptions.photoroom` when a canvas is what you want.";

/**
 * The wire body this adapter compiles to: the `/v2/edit` form itself.
 *
 * The whole of `EditParams` rather than the six fields written below, because
 * this type is also what `providerOptions.photoroom` is typed from — and the
 * fields a caller reaches for there (the reference pictures, `referenceBox`,
 * the `pr-*` header params) are exactly the ones this adapter does not write.
 */
export type PhotoroomImageEditWire = EditParams;

/**
 * What a unified edit call to `photoroom/…` returns: `photoroom.imageEdit`'s
 * `ValidatedForm`.
 *
 * `EditValidated` rather than `ReturnType<typeof validator>`. They are one type
 * (asserted both ways in `test/types/unified-image-edit.test-d.ts`), but the
 * validator's own spelling is an `Omit` of five keys from a form of more than
 * a hundred, and a pack's result type is instantiated at every `imageEdit()`
 * call site in an editor: ~3,100 type instantiations against ~330, measured
 * by `test/type-bench`.
 */
export type PhotoroomImageEditResult = EditValidated;

export const imageEdit = {
  category: "imageEdit",
  provider: "photoroom",
  models: MODELS,
  imageInputs: ["file"],
  modelParams: PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS,
  unsupported: {
    strength:
      "Edit With AI is steered by `editWithAI.prompt` alone — POST /v2/edit has no dial between " +
      "keeping and replacing the source picture, so a `strength` could only be dropped.",
    n:
      "POST /v2/edit answers with the bytes of one image and has no count field; issue N requests " +
      "to get N images (each is billed).",
    size: NO_OUTPUT_SIZE,
    aspectRatio: NO_OUTPUT_SIZE,
    dimensions: NO_OUTPUT_SIZE,
  },
  compile(
    input: ImageEditParamsFor<"file">,
    ctx: CompileContext<ImageEditParamsFor<"file">>,
  ): CompiledCall<PhotoroomImageEditWire, PhotoroomImageEditResult> {
    const body: PhotoroomImageEditWire = {
      // Both halves of the documented switch: the mode alone edits nothing, and
      // the prompt alone is not read.
      "editWithAI.mode": "ai.auto",
      "editWithAI.prompt": input.prompt,
      // See "`removeBackground: false` is written for you" in the header.
      removeBackground: false,
    };
    ctx.from(["editWithAI.prompt"], "prompt");
    ctx.from(["editWithAI.mode"], "prompt");
    ctx.from(["imageFile"], "image");

    ctx.take(
      resolveOperation(input.operation, EDIT_ONLY, { path: ["operation"], warn: ctx.warn }, {
        source: EDIT_WITH_AI_DOCS,
        hint:
          "Everything else POST /v2/edit does — background removal, AI backgrounds, shadows, " +
          "relighting, text removal, expand, upscale — is reachable by name at `unmodel/photoroom` " +
          "(`photoroom.imageEdit`, `photoroom.imageEditRemoveBackground`).",
      }),
    );

    const image = ctx.take(
      resolveImageEditInput(input.image, ["file"], { path: ["image"], warn: ctx.warn }, {
        source: PHOTOROOM_OPENAPI_URL,
        hint:
          "POST /v2/edit reads the picture from the multipart `imageFile` part (\"The POST " +
          "endpoint accepts `imageFile` only\"). Photoroom fetches a URL only on `GET /v2/edit`, " +
          "which unmodel does not address, and the route has no base64 field — fetch or decode " +
          "the picture and pass the bytes.",
      }),
    );
    if (image?.kind === "file") body.imageFile = image.file;

    if (input.seed !== undefined) {
      ctx.from(["editWithAI.seed"], "seed");
      body["editWithAI.seed"] = input.seed;
    }

    // `png`, `jpeg` and `webp` are all members of `export.format`, spelled the
    // way the canonical vocabulary spells them.
    if (input.outputFormat !== undefined) {
      ctx.from(["export.format"], "outputFormat");
      body["export.format"] = input.outputFormat;
    }

    return { params: body, validate: validator.safe };
  },
} as const satisfies ImageEditAdapterFor<
  "file",
  PhotoroomImageEditWire,
  PhotoroomImageEditResult,
  typeof PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS
>;
