/**
 * Type-level tests for the photoroom provider. NOT run by `bun test` — this
 * file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * Photoroom is the first provider here whose wire keys have dots in them and
 * whose wire has open-keyed families, so the things worth pinning are: a
 * dotted literal key is checked like any other; a family key is a
 * template-literal pattern, exact in its suffix and its value type; and the
 * five `pr-*` params leave the validated body.
 */
import { imageEdit, imageEditRemoveBackground, toFormData } from "../../src/providers/photoroom";
import type {
  EditParams,
  ImageEditBody,
  ImageEditRemoveBackgroundBody,
  PhotoroomEditError,
  PhotoroomModelId,
  PhotoroomRequestHeader,
  PhotoroomSegmentError,
  SegmentParams,
} from "../../src/providers/photoroom/types";
import { toRequestInit } from "../../src/core/request-init";
import { expectAssignable, expectTrue, type IsNever } from "./helpers";

declare const file: Blob;

function editTypeTests(): void {
  // Dotted keys, with their enums, ranges-as-numbers and both boolean spellings.
  const ok = imageEdit({
    imageFile: file,
    removeBackground: "false",
    referenceBox: "originalImage",
    padding: "10%",
    marginTop: 0.1,
    "background.blur.mode": "bokeh",
    "background.blur.radius": 0.02,
    "shadow.mode": "ai.auto-with-overrides",
    "shadow.directionOverride": "behindLeft",
    "shadow.spreadOverride": 45,
    "virtualModel.model.preset.name": "avery",
    "export.format": "jpg",
  });
  // A number is also taken as the text a form part is: the OpenAPI examples write `maxWidth: "200"`.
  imageEdit({ imageFile: file, maxWidth: "200", "background.guidance.scale": "0.6", "shadow.spreadOverride": "45" });
  // @ts-expect-error — text that is not a number.
  imageEdit({ imageFile: file, maxWidth: "wide" });
  expectAssignable<Blob>(ok.imageFile);
  expectAssignable<"form">(ok.request.body);
  expectAssignable<"POST">(ok.request.method);
  toFormData(ok);

  // @ts-expect-error — a multipart result cannot be JSON.stringify'd by toRequestInit.
  toRequestInit(ok);

  // @ts-expect-error — not a value of the enum.
  imageEdit({ imageFile: file, "shadow.mode": "soft" });
  // @ts-expect-error — `imageUrl` is the GET endpoint's field, not a POST form field.
  imageEdit({ imageUrl: "https://example.com/a.png" });
  // @ts-expect-error — a typo'd dotted key is an excess key.
  imageEdit({ imageFile: file, "shadow.mod": "ai.soft" });
  // @ts-expect-error — a file field takes a Blob, not a path.
  imageEdit({ imageFile: "/tmp/a.png" });
  // @ts-expect-error — the layer-level `removeBackground` is an enum; only the top-level one is a boolean.
  imageEdit({ imageFile: file, "layers.product.image.removeBackground": true });
}

function familyTypeTests(): void {
  // Every documented notation of every family, as literal keys.
  imageEdit({
    imageFile: file,
    "editWithAI.mode": "ai.auto",
    "editWithAI.prompt": "merge",
    "editWithAI.additionalImages.styleRef.imageUrl": "https://example.com/style.jpg",
    "editWithAI.additionalImages[0].imageFile": file,
    "editWithAI.additionalImages.1.imageFile": file,
    "layers.author.text.content": "Tom C.",
    "layers.product.image.margin": 0.1,
    "layers.product.image.removeBackground": "auto",
    "virtualModel.additionalProductImages[0].imageFile": file,
  });

  // The family whose slot spelling is undocumented takes any slot that opens
  // with a bracket or a dot.
  imageEdit({
    imageFile: file,
    "virtualModel.additionalProductImages[].imageFile": file,
    "virtualModel.additionalProductImages.1.imageUrl": "https://example.com/back.jpg",
  });
  // @ts-expect-error — a key that runs straight on from the family's name is a typo.
  imageEdit({ imageFile: file, "virtualModel.additionalProductImagesX.imageFile": file });

  // @ts-expect-error — a family key with a misspelt suffix matches no pattern.
  imageEdit({ imageFile: file, "editWithAI.additionalImages.styleRef.imagefile": file });
  // @ts-expect-error — the value type follows the suffix: `.imageUrl` is a string.
  imageEdit({ imageFile: file, "editWithAI.additionalImages.styleRef.imageUrl": file });
  // @ts-expect-error — and `.imageFile` is a Blob.
  imageEdit({ imageFile: file, "editWithAI.additionalImages.styleRef.imageFile": "https://example.com/a.png" });

  // A key built at run time is assigned, not written in the literal.
  const params: EditParams = { imageFile: file, "editWithAI.mode": "ai.auto", "editWithAI.prompt": "merge" };
  const name: string = "styleRef";
  params[`editWithAI.additionalImages.${name}.imageFile`] = file;
  params[`layers.${name}.text.content`] = "hello";
  imageEdit(params);
}

function headerTypeTests(): void {
  const req = imageEdit({
    imageFile: file,
    "shadow.mode": "ai.preset-soft",
    "pr-ai-shadows-model-version": "2026-04-15",
    // Open: a version Photoroom ships later is still a string.
    "pr-ai-background-model-version": "5",
  });
  // The header params are on `.request.headers`, not on the body.
  expectAssignable<Record<string, string>>(req.request.headers);
  expectAssignable<"ai.preset-soft">(req["shadow.mode"]);
  // @ts-expect-error — lifted off the validated body.
  req["pr-ai-shadows-model-version"];

  expectTrue<
    IsNever<Exclude<PhotoroomRequestHeader, keyof EditParams>>
  >();
  expectAssignable<PhotoroomRequestHeader>("pr-ironing-model-version");
  // @ts-expect-error — a header value is a string.
  imageEdit({ imageFile: file, "pr-hd-background-removal": true });
}

function segmentTypeTests(): void {
  const ok = imageEditRemoveBackground({ image_file: file, format: "jpg", crop: "true", size: "hd" });
  expectAssignable<"form">(ok.request.body);
  toFormData(ok);

  // @ts-expect-error — `image_file` is required.
  imageEditRemoveBackground({ format: "png" });
  // @ts-expect-error — `jpg`, not `jpeg`.
  imageEditRemoveBackground({ image_file: file, format: "jpeg" });
  // `crop` and `despill` take the boolean and its text: `toFormData` writes the same part for both.
  imageEditRemoveBackground({ image_file: file, crop: true, despill: "false" });
  // @ts-expect-error — and no other string.
  imageEditRemoveBackground({ image_file: file, crop: "yes" });
  // @ts-expect-error — no URL input on this route.
  imageEditRemoveBackground({ image_file: file, image_url: "https://example.com/a.png" });
  // @ts-expect-error — the feature headers belong to the Image Editing route.
  imageEditRemoveBackground({ image_file: file, "pr-hd-background-removal": "auto" });
}

function entryTypeTests(): void {
  // The uniform aliases are the wire types, not copies of them — except that
  // a BODY has no header keys.
  expectAssignable<ImageEditBody>({} as Omit<EditParams, PhotoroomRequestHeader>);
  expectAssignable<EditParams>({} as ImageEditBody);
  ({
    imageFile: file,
    "background.blur.radius": 0.2,
    "editWithAI.additionalImages.styleRef.imageFile": file,
    "virtualModel.additionalProductImages[0].imageFile": file,
  }) satisfies ImageEditBody;
  // @ts-expect-error — a feature header is not a form field.
  ({ imageFile: file, "pr-hd-background-removal": "auto" }) satisfies ImageEditBody;
  // @ts-expect-error — the body alias still checks values.
  ({ imageFile: file, "background.blur.radius": "wide" }) satisfies ImageEditBody;
  expectAssignable<ImageEditRemoveBackgroundBody>({} as SegmentParams);
  expectAssignable<SegmentParams>({} as ImageEditRemoveBackgroundBody);

  expectAssignable<PhotoroomModelId>("edit-with-ai");
  // @ts-expect-error — the catalog has three rows.
  expectAssignable<PhotoroomModelId>("segment");

  // One error shape per host.
  expectAssignable<PhotoroomEditError>({ error: { message: "Unauthorized" } });
  expectAssignable<PhotoroomSegmentError>({ detail: "…", status_code: 400, type: "missing_image" });
}

void editTypeTests;
void familyTypeTests;
void headerTypeTests;
void segmentTypeTests;
void entryTypeTests;
