/**
 * `unmodel/image-edit` → Photoroom, one adapter over two routes:
 *
 * | ref | operation | compiles to |
 * |---|---|---|
 * | `photoroom/edit-with-ai` | `"edit"` | `photoroom.imageEdit` (POST https://image-api.photoroom.com/v2/edit), in its Edit With AI mode |
 * | `photoroom/remove-background` | `"removeBackground"` | `photoroom.imageEditRemoveBackground` (POST https://sdk.photoroom.com/v1/segment) |
 *
 * The adapter itself, not a barrel: Photoroom serves one unified category, so
 * there is no sibling leaf to keep out of a pack. Which operation a ref serves
 * is its row's `operations` in `./image-edit-params.ts`; the type narrows from
 * that row and `resolveImageEditOperation` refuses from it.
 *
 * # One mode out of forty
 *
 * `/v2/edit` is one route for background removal, AI backgrounds, shadows,
 * relighting, text removal, expand, upscale, virtual model and more. Exactly
 * one of them has the shape `operation: "edit"` names — a picture, a sentence,
 * no mask — and that is Edit With AI: `editWithAI.mode: "ai.auto"` plus
 * `editWithAI.prompt`. The rest of the route stays reachable by name at
 * `unmodel/photoroom`.
 *
 * # A removal goes to `/v1/segment`, not to `/v2/edit`
 *
 * `/v2/edit` with nothing but a picture IS a background removal — it is the
 * route's default. `operation: "removeBackground"` compiles to `/v1/segment`
 * all the same, for two reasons: it is the route Photoroom names for the job
 * (the "Remove Background API"), and it is a fifth of the price — "each API
 * call is priced at $0.02" against $0.10, and "the rate follows the endpoint,
 * not the plan". Compiling a removal to the route that costs five times as much
 * would be a price the caller did not choose.
 *
 * On that route `outputFormat` becomes `format`, and `"jpeg"` is written
 * `"jpg"`: the same encoding under remove.bg's spelling, so nothing is
 * approximated and nothing is warned. `bg_color`, `channels`, `crop` and
 * `despill` are per-model extras; the route's `size` is a named downscale
 * (`preview` … `full`) whose name collides with the canonical `size`, so it
 * rides in `providerOptions.photoroom`.
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
 * the route has no base64 field at all. `/v1/segment` is the same: "The Remove
 * Background API requires you to upload the content of your image file", and
 * its base64 form is a separate JSON body outside the OpenAPI document. So
 * `imageInputs` is `["file"]` at both refs.
 *
 * # More pictures, and everything else the route takes
 *
 * Edit With AI reads up to four further reference pictures, each under a name
 * the caller chooses: `editWithAI.additionalImages.<name>.imageFile`. They ride
 * in `providerOptions.photoroom`, which is typed from the whole of both forms
 * ({@link PhotoroomImageEditWire}), so every field of either route — the five
 * `pr-*` header params included — completes there and is checked by the same
 * validator a hand-written call meets.
 *
 * Sources, read 2026-11-24:
 *   https://docs.photoroom.com/image-editing-api-plus-plan/edit-with-ai.md
 *   https://docs.photoroom.com/remove-background-api-basic-plan/pricing.md
 *   https://www.photoroom.com/api/pricing
 *   https://image-api.photoroom.com/openapi
 * Research: docs/research/photoroom-api-2026-11-24.md §3, §4.2, §5.
 */
import { applyExtras, resolveImageEditInput } from "../../core/unified/derive";
import {
  imageEditOperations,
  resolveImageEditOperation,
} from "../../core/unified/image-edit-operations";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type {
  ImageEditAdapterFor,
  ImageEditOperation,
  ImageEditParamsFor,
} from "../../core/unified/vocabulary/image-edit";
import { PHOTOROOM_OPENAPI_URL } from "./constants";
import { imageEdit as editValidator, type EditParams, type EditValidated } from "./image-edit";
import { MODELS, PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS } from "./image-edit-params";
import {
  imageEditRemoveBackground as segmentValidator,
  type SegmentParams,
} from "./image-edit-remove-background";

const EDIT_WITH_AI_DOCS = "https://docs.photoroom.com/image-editing-api-plus-plan/edit-with-ai.md";
const SEGMENT_DOCS =
  "https://docs.photoroom.com/remove-background-api-basic-plan/remove.bg-compatibility.md";

/**
 * Why no canonical shape word compiles, at either route. Quoted to a caller of
 * any of the three, so it names the two fields that look like the answer and
 * says what each really is.
 */
const NO_OUTPUT_SIZE =
  "neither Photoroom route has a field for the shape of its output. Edit With AI: \"By default, " +
  "Edit With AI will produce outputs at a resolution of 1K (`1024x1024`)\", and 2K / 4K are " +
  "Enterprise-only with no documented parameter; `outputSize` on POST /v2/edit is the CANVAS " +
  "the result is positioned in, not the size it is generated at. The Remove Background API " +
  "returns the input's shape, and its `size` is a named downscale (`preview`, `medium`, `hd`, " +
  "`full`). Set either through `providerOptions.photoroom` when that is what you want.";

/**
 * The wire fields this adapter compiles to: the `/v2/edit` form and the
 * `/v1/segment` form, as one field set.
 *
 * One interface rather than the union of the two bodies, because this type is
 * also what `providerOptions.photoroom` is typed from, and the kernel reads it
 * per provider. A union of two open forms would accept a mistyped value at one
 * route's key on the strength of the other route's open tail; one field set
 * keeps every key's VALUE checked. The two forms share no field name. Which
 * half a request may carry is decided by the ref, and that is not typed: a
 * `/v1/segment` field in the bucket at an edit ref compiles, the route's own
 * validator reports it as `unknown_param`, and `/v2/edit` bills the call and
 * ignores the field (`docs/decisions.md` §10, "Known limits").
 *
 * The whole of both forms rather than the handful of fields written below,
 * because the fields a caller reaches for in the bucket (the reference
 * pictures, `referenceBox`, the `pr-*` header params, `/v1/segment`'s `size`)
 * are exactly the ones this adapter does not write.
 */
export interface PhotoroomImageEditWire extends EditParams, Partial<SegmentParams> {}

/**
 * What a unified call to `photoroom/…` returns: the `ValidatedForm` of the
 * route the ref compiled to — `photoroom.imageEdit`'s at `edit-with-ai`,
 * `photoroom.imageEditRemoveBackground`'s at `remove-background`.
 *
 * The edit arm is `EditValidated` rather than `ReturnType<typeof imageEdit>`.
 * They are one type (asserted both ways in
 * `test/types/unified-image-edit.test-d.ts`), but the validator's own spelling
 * is an `Omit` of five keys from a form of more than a hundred, and a pack's
 * result type is instantiated at every `imageEdit()` call site in an editor:
 * ~3,100 type instantiations against ~330, measured by `test/type-bench`.
 */
export type PhotoroomImageEditResult = EditValidated | ReturnType<typeof segmentValidator>;

type Input = ImageEditParamsFor<"file", ImageEditOperation>;
type Compiled = CompiledCall<PhotoroomImageEditWire, PhotoroomImageEditResult>;

/** The two `.safe`s, keyed by the operation the request compiled as. */
const VALIDATE: Readonly<Record<ImageEditOperation, Compiled["validate"]>> = {
  // One cast per route, at the one place the two meet: each validator takes its
  // own form, and the operation decided which form `body` is.
  edit: editValidator.safe as Compiled["validate"],
  removeBackground: segmentValidator.safe as Compiled["validate"],
};

export const imageEdit = {
  category: "imageEdit",
  provider: "photoroom",
  models: MODELS,
  imageInputs: ["file"],
  modelParams: PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS,
  // The five words no Photoroom model takes. `prompt` and `seed` are not here:
  // Edit With AI takes both, so the removal branch refuses them itself.
  unsupported: {
    strength:
      "neither Photoroom route has a dial between keeping and replacing the source picture — " +
      "Edit With AI is steered by `editWithAI.prompt` alone, and a background removal has " +
      "nothing to dial — so a `strength` could only be dropped.",
    n:
      "both Photoroom routes answer with the bytes of one image and have no count field; issue " +
      "N requests to get N images (each is billed).",
    size: NO_OUTPUT_SIZE,
    aspectRatio: NO_OUTPUT_SIZE,
    dimensions: NO_OUTPUT_SIZE,
  },
  compile(input: Input, ctx: CompileContext<Input>): Compiled {
    // The ids are unmodel's handles for two routes; Photoroom's wire has no
    // model field. No model can be released under one, so an id outside the
    // list is a mistyped handle and not a newer model: compiling it would send,
    // and bill, whichever route the operation picks.
    if (!(MODELS as readonly string[]).includes(ctx.model)) {
      ctx.fail({
        code: "invalid_enum_value",
        path: ["model"],
        message:
          `\`photoroom/${ctx.model}\` is not a Photoroom ref. Photoroom's routes take no model field, so the refs are ` +
          `unmodel's names for them: ${MODELS.map((id) => `\`photoroom/${id}\``).join(" and ")}.`,
        meta: { allowed: [...MODELS], value: ctx.model, source: PHOTOROOM_OPENAPI_URL },
      });
    }
    const served = ctx.take(
      resolveImageEditOperation(
        input.operation,
        PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS,
        ctx.model,
        { path: ["operation"], warn: ctx.warn },
        {
          source: PHOTOROOM_OPENAPI_URL,
          hint:
            "`photoroom/edit-with-ai` serves `\"edit\"` and `photoroom/remove-background` serves " +
            "`\"removeBackground\"`. Everything else POST /v2/edit does — AI backgrounds, shadows, " +
            "relighting, text removal, expand, upscale — is reachable by name at " +
            "`unmodel/photoroom` (`photoroom.imageEdit`).",
        },
      ),
    );
    // A refused operation has already stopped the request. The body is still
    // built — as the operation this MODEL serves — so that every other finding
    // is about the route the ref names and reported in the same pass.
    const operation =
      served ?? imageEditOperations(PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS, ctx.model)[0] ?? "edit";
    const body = operation === "removeBackground" ? compileRemoval(input, ctx) : compileEdit(input, ctx);
    applyExtras(input, PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS, body, ctx);
    return { params: body, validate: VALIDATE[operation] };
  },
} as const satisfies ImageEditAdapterFor<
  "file",
  PhotoroomImageEditWire,
  PhotoroomImageEditResult,
  typeof PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS,
  ImageEditOperation
>;

/** `operation: "edit"` → the `/v2/edit` form, in its Edit With AI mode. */
function compileEdit(input: Input, ctx: CompileContext<Input>): PhotoroomImageEditWire {
  const body: PhotoroomImageEditWire = {
    // Both halves of the documented switch: the mode alone edits nothing, and
    // the prompt alone is not read.
    "editWithAI.mode": "ai.auto",
    // See "`removeBackground: false` is written for you" in the header.
    removeBackground: false,
  };
  ctx.from(["editWithAI.prompt"], "prompt");
  ctx.from(["editWithAI.mode"], "prompt");
  ctx.from(["imageFile"], "image");
  if (input.prompt !== undefined) body["editWithAI.prompt"] = input.prompt;

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
  return body;
}

/** `operation: "removeBackground"` → the `/v1/segment` form. */
function compileRemoval(input: Input, ctx: CompileContext<Input>): PhotoroomImageEditWire {
  const body: PhotoroomImageEditWire = {};
  ctx.from(["image_file"], "image");

  // The two edit words Edit With AI takes and this route does not. A JavaScript
  // caller can still write them; the type already refuses them.
  const edit: { readonly prompt?: unknown; readonly seed?: unknown } = input;
  for (const word of ["prompt", "seed"] as const) {
    if (edit[word] == null) continue;
    ctx.fail({
      code: "unsupported_param",
      path: [word],
      message:
        `\`${word}\` belongs to \`operation: "edit"\`. \`photoroom/remove-background\` cuts the ` +
        "subject out and takes `image`, `outputFormat` and its extras (`bg_color`, `channels`, " +
        "`crop`, `despill`); `photoroom/edit-with-ai` is the ref that reads a prompt and a seed.",
      meta: { source: SEGMENT_DOCS },
    });
  }

  const image = ctx.take(
    resolveImageEditInput(input.image, ["file"], { path: ["image"], warn: ctx.warn }, {
      source: SEGMENT_DOCS,
      hint:
        "POST /v1/segment reads the picture from the multipart `image_file` part (\"The Remove " +
        "Background API requires you to upload the content of your image file\"). Its base64 " +
        "form is a separate JSON body, `image_file_b64`, which is outside Photoroom's OpenAPI " +
        "document and which unmodel does not address — fetch or decode the picture and pass " +
        "the bytes.",
    }),
  );
  if (image?.kind === "file") body.image_file = image.file;

  // The same three encodings under remove.bg's names: `format` spells JPEG
  // `jpg`, and only that way.
  if (input.outputFormat !== undefined) {
    ctx.from(["format"], "outputFormat");
    body.format = input.outputFormat === "jpeg" ? "jpg" : input.outputFormat;
  }
  return body;
}
