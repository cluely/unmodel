/**
 * Type-level tests for `unmodel/image-edit`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * Two of this category's claims are **compile-time** ones, so they carry more
 * weight here than in the four categories that have neither:
 *
 * 1. `operation` is a literal, not a string, and which literal is decided by
 *    the model: `"edit"` at an edit ref, `"removeBackground"` at a removal ref,
 *    and each operation's words are errors on the other (section 8). It only
 *    does that job if `"inpaint"` is a red squiggle too.
 * 2. `image` narrows per **route**, exactly as `audio` does at
 *    `unmodel/stt`:
 *
 * | route | accepts | `{ file }` | `{ url }` | `{ data }` |
 * |---|---|---|---|---|
 * | openai, ideogram | file | ok | error | error |
 * | black-forest-labs | data, url | error | ok | ok |
 * | recraft | file, url | ok | ok | error |
 * | photoroom | file | ok | error | error |
 * | stability | file | ok | error | error |
 *
 * Sections 3–6 are the same four properties every category entry has: the ref
 * union, the provider's own result type, `providerOptions` keyed by the pack,
 * and no `.toApi`. Section 7 is the per-**model** narrowing this category
 * shares with `unmodel/image`: `size`, `aspectRatio` and the extras come from
 * the adapter's `modelParams` row the ref selects.
 */
import { createImageEdit, imageEdit } from "../../src/unified/image-edit";
import { imageEdit as bflImageEdit } from "../../src/providers/black-forest-labs/unified";
import { imageEdit as ideogramImageEdit } from "../../src/providers/ideogram/unified";
import { imageEdit as openaiImageEdit } from "../../src/providers/openai/unified";
import { imageEdit as photoroomValidator } from "../../src/providers/photoroom";
import {
  imageEdit as photoroomImageEdit,
  type PhotoroomImageEditResult,
} from "../../src/providers/photoroom/unified";
import { imageEdit as recraftImageEdit } from "../../src/providers/recraft/unified";
import { imageEdit as higgsfieldImageEdit } from "../../src/providers/higgsfield/unified-image-edit";
import { imageEdit as revanaImageEdit } from "../../src/providers/revana/unified-image-edit";
import type { UnifiedRef } from "../../src/core/unified/types";
import {
  imageEdit as stabilityImageEdit,
  type StabilityImageEditResult,
} from "../../src/providers/stability/unified-image-edit";
import { imageEditRemoveBackground as photoroomSegmentValidator } from "../../src/providers/photoroom";
import { imageEditRemoveBackground as stabilityValidator } from "../../src/providers/stability";
import type {
  ImageEditEditParams,
  ImageEditInputFor,
  ImageEditOperation,
  ImageEditOperationOf,
  ImageEditParams,
  ImageEditParamsFor,
  ImageEditRemoveBackgroundParams,
} from "../../src/core/unified/vocabulary/image-edit";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

declare const file: Blob;
const url = "https://example.com/street.png";
const data = "aVZCT1J3MEtHZ28=";
const prompt = "make it winter";

// ---------------------------------------------------------------------------
// 1 · `operation` is a literal
// ---------------------------------------------------------------------------

function operationTests(): void {
  imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { file } });
  // @ts-expect-error — masked operations are wire-only in v1; the discriminant
  // exists so they can be added, not so they can be guessed at.
  imageEdit({ operation: "inpaint", model: "openai/gpt-image-1.5", prompt, image: { file } });
  // @ts-expect-error — and it is required: there is one shape today, and it is named.
  imageEdit({ model: "openai/gpt-image-1.5", prompt, image: { file } });
}

// ---------------------------------------------------------------------------
// 2 · `image` narrows per model, at compile time
// ---------------------------------------------------------------------------

function imageNarrowingTests(): void {
  // --- Blob-only routes -----------------------------------------------------
  imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { file } });
  // @ts-expect-error — POST /v1/images/edits fetches nothing.
  imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { url } });
  // @ts-expect-error — and the JSON `{ image_url }` variant is not modeled.
  imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { data } });

  imageEdit({ operation: "edit", model: "ideogram/ideogram-3.0-quality", prompt, image: { file } });
  // @ts-expect-error — /v1/ideogram-v3/remix is multipart end to end.
  imageEdit({ operation: "edit", model: "ideogram/ideogram-3.0-quality", prompt, image: { url } });

  // --- The JSON-only route: the inverse -------------------------------------
  imageEdit({
    operation: "edit",
    model: "black-forest-labs/flux-kontext-pro",
    prompt,
    image: { data },
  });
  imageEdit({
    operation: "edit",
    model: "black-forest-labs/flux-kontext-pro",
    prompt,
    image: { url },
  });
  // @ts-expect-error — `input_image` is a base64 string, and a Blob cannot be
  // encoded without awaiting, which a synchronous compile step cannot do.
  imageEdit({ operation: "edit", model: "black-forest-labs/flux-kontext-max", prompt, image: { file } });

  // --- The dual-format route ------------------------------------------------
  imageEdit({ operation: "edit", model: "recraft/recraftv4_1", prompt, image: { file }, strength: 0.5 });
  imageEdit({ operation: "edit", model: "recraft/recraftv4_1", prompt, image: { url }, strength: 0.5 });
  // @ts-expect-error — `image_url` needs a media type to be a `data:` URL, and
  // the canonical `{ data }` is a bare payload; pass it as `{ url }`.
  imageEdit({ operation: "edit", model: "recraft/recraftv4_1", prompt, image: { data }, strength: 0.5 });

  // --- The degraded case ----------------------------------------------------
  // A ref that is not a literal selects no adapter, so `image` widens to every
  // shape any adapter in the pack accepts — open at compile time, still checked
  // at runtime. Degrading to a union beats degrading to `any`.
  const runtimeRef: string = "openai/gpt-image-1.5";
  imageEdit({ operation: "edit", model: runtimeRef, prompt, image: { file } });
  imageEdit({ operation: "edit", model: runtimeRef, prompt, image: { url } });

  // `.safe` carries the identical constraint — it is the same params type.
  imageEdit.safe({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { file } });
  // @ts-expect-error — including the narrowing.
  imageEdit.safe({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { url } });

  // A hand-built pack narrows to exactly the adapters it was given.
  const pair = createImageEdit([openaiImageEdit, bflImageEdit]);
  pair({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { file } });
  pair({ operation: "edit", model: "black-forest-labs/flux-kontext-pro", prompt, image: { url } });
  // @ts-expect-error — the narrowing survives being re-packed.
  pair({ operation: "edit", model: "black-forest-labs/flux-kontext-pro", prompt, image: { file } });
}

/** The mapping the adapters' `imageInputs` arrays feed, checked directly. */
expectAssignable<ImageEditInputFor<"file">>({ file });
expectAssignable<ImageEditInputFor<"data" | "url">>({ url });
expectAssignable<ImageEditInputFor<"data" | "url">>({ data });
// @ts-expect-error — a kind outside the set has no arm in the union.
expectAssignable<ImageEditInputFor<"file">>({ url });
// @ts-expect-error — and an empty set has no arms at all.
expectAssignable<ImageEditInputFor<never>>({ file });

// The adapters declare the arrays the table above is derived from.
expectAssignable<readonly ["file"]>(openaiImageEdit.imageInputs);
expectAssignable<readonly ["file"]>(ideogramImageEdit.imageInputs);
expectAssignable<readonly ["data", "url"]>(bflImageEdit.imageInputs);
expectAssignable<readonly ["file", "url"]>(recraftImageEdit.imageInputs);

// ---------------------------------------------------------------------------
// 3 · The ref union
// ---------------------------------------------------------------------------

type PackRefs = UnifiedRef<
  | typeof openaiImageEdit
  | typeof bflImageEdit
  | typeof ideogramImageEdit
  | typeof recraftImageEdit
>;

expectAssignable<PackRefs>("openai/gpt-image-1.5");
expectAssignable<PackRefs>("openai/chatgpt-image-latest");
expectAssignable<PackRefs>("openai/dall-e-2");
expectAssignable<PackRefs>("black-forest-labs/flux-kontext-max");
expectAssignable<PackRefs>("ideogram/ideogram-3.0-turbo");
expectAssignable<PackRefs>("recraft/recraftv4_1_pro_vector");
// @ts-expect-error — dall-e-3 is a generation model; /v1/images/edits documents
// "one of `dall-e-2` or a GPT image model".
expectAssignable<PackRefs>("openai/dall-e-3");
// @ts-expect-error — there is no 4.0 remix route to point a 4.0 ref at.
expectAssignable<PackRefs>("ideogram/ideogram-4.0-quality");
// @ts-expect-error — FLUX.2 generates; it does not edit.
expectAssignable<PackRefs>("black-forest-labs/flux-2-pro");

function refUnionTests(): void {
  // The union drives autocomplete…
  imageEdit({ operation: "edit", model: "openai/gpt-image-2", prompt, image: { file } });
  // …but does not gate the call: a model newer than this snapshot still works
  // and draws a runtime `unknown_model` warning.
  imageEdit({ operation: "edit", model: "openai/gpt-image-9", prompt, image: { file } });
  // A provider with no adapter is a runtime structural error, not a type error.
  imageEdit({ operation: "edit", model: "luma/photon-1", prompt, image: { file } });

  // @ts-expect-error — `image` is not optional; there is nothing to edit.
  imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", prompt });
  // @ts-expect-error — nor is `prompt`; there is nothing to do to it.
  imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", image: { file } });
  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { file }, stength: 1 });
  // @ts-expect-error — `aspectRatio` and `dimensions` are two spellings of one
  // decision, and the XOR survives the per-route narrowing of `image`.
  imageEdit({
    operation: "edit",
    model: "openai/gpt-image-2",
    prompt,
    image: { file },
    aspectRatio: "16:9",
    dimensions: { width: 1024, height: 1024 },
  });

  // A field the provider does not support is a RUNTIME error (declared on the
  // adapter), never a compile error: the vocabulary is one shape for everyone.
  imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", prompt, image: { file }, strength: 0.5 });
}

// ---------------------------------------------------------------------------
// 4 · The result is the ref'd provider's own
// ---------------------------------------------------------------------------

function resultTypeTests(): void {
  const openai = imageEdit({
    operation: "edit",
    model: "openai/gpt-image-1.5",
    prompt,
    image: { file },
  });
  expectAssignable<string>(openai.prompt);
  expectAssignable<string>(openai.request.url);
  openai.toSdk("openai");
  // @ts-expect-error — "recraft" is not one of openai.imageEdit's targets.
  openai.toSdk("recraft");

  const bfl = imageEdit({
    operation: "edit",
    model: "black-forest-labs/flux-kontext-pro",
    prompt,
    image: { url },
  });
  // BFL strips `model` from the body: the model IS the route.
  expectTrue<IsNever<KeyIn<typeof bfl, "model">>>();
  expectAssignable<string>(bfl.prompt);
  bfl.toSdk("black-forest-labs");

  // Warnings ride on every result, whichever provider answered.
  expectAssignable<readonly { code: string }[]>(openai.warnings);
  expectAssignable<readonly { code: string }[]>(bfl.warnings);
}

// ---------------------------------------------------------------------------
// 5 · providerOptions is keyed by the pack
// ---------------------------------------------------------------------------

function providerOptionsTests(): void {
  imageEdit({
    operation: "edit",
    model: "openai/gpt-image-1.5",
    prompt,
    image: { file },
    providerOptions: {
      openai: { input_fidelity: "high", mask: file },
      recraft: { style: "digital_illustration" },
    },
  });
  imageEdit({
    operation: "edit",
    model: "openai/gpt-image-1.5",
    prompt,
    image: { file },
    // @ts-expect-error — but not for a provider this pack does not have.
    providerOptions: { opneai: {} },
  });
  imageEdit({
    operation: "edit",
    model: "openai/gpt-image-1.5",
    prompt,
    image: { file },
    // @ts-expect-error — nor for one that ships an editing route but no adapter.
    providerOptions: { luma: {} },
  });

  const pair = createImageEdit([openaiImageEdit, bflImageEdit]);
  pair({
    operation: "edit",
    model: "openai/gpt-image-1.5",
    prompt,
    image: { file },
    providerOptions: { openai: {} },
  });
  pair({
    operation: "edit",
    model: "openai/gpt-image-1.5",
    prompt,
    image: { file },
    // @ts-expect-error — recraft is not in THIS pack, though it is in the full one.
    providerOptions: { recraft: {} },
  });
}

// ---------------------------------------------------------------------------
// 6 · No retargeting on a media result
// ---------------------------------------------------------------------------

function noToApiTests(): void {
  const result = imageEdit({
    operation: "edit",
    model: "openai/gpt-image-1.5",
    prompt,
    image: { file },
  });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

// ---------------------------------------------------------------------------
// 7 · Per-model narrowing
// ---------------------------------------------------------------------------

function modelNarrowingTests(): void {
  const base = { operation: "edit", prompt } as const;

  // The edits route's `size` is the same per-model split as generations'.
  imageEdit({ ...base, model: "openai/gpt-image-2", image: { file }, size: "3840x2160" });
  // Free-form again, so the tail admits a size the 16-px rule refuses at run
  // time — see the note in `unified-image.test-d.ts`.
  imageEdit({ ...base, model: "openai/gpt-image-2", image: { file }, size: "1920x1080" });
  imageEdit({ ...base, model: "openai/gpt-image-1.5", image: { file }, size: "1536x1024" });
  // @ts-expect-error — the gpt-image-1.5 family's enum is four values.
  imageEdit({ ...base, model: "openai/gpt-image-1.5", image: { file }, size: "1920x1080" });
  // @ts-expect-error — and dall-e-2's edit enum has no "auto".
  imageEdit({ ...base, model: "openai/dall-e-2", image: { file }, size: "auto" });
  imageEdit({ ...base, model: "openai/dall-e-2", image: { file }, size: "512x512" });

  // Kontext sizes by shape only, so `size` is `never` there…
  // @ts-expect-error
  imageEdit({ ...base, model: "black-forest-labs/flux-kontext-pro", image: { url }, size: "1024x1024" });
  // …and its `aspect_ratio` is a RANGE, so the presets come with a tail.
  imageEdit({ ...base, model: "black-forest-labs/flux-kontext-pro", image: { url }, aspectRatio: "21:9" });
  imageEdit({ ...base, model: "black-forest-labs/flux-kontext-max", image: { data }, aspectRatio: "7:3" });

  // Recraft's imageToImage has no sizing surface at all.
  // @ts-expect-error
  imageEdit({ ...base, model: "recraft/recraftv3", image: { file }, size: "1024x1024" });

  // `background` takes all three values on every GPT image model —
  // gpt-image-2's transparent support is in preview (createEdit reference,
  // checked 2026-08-31).
  imageEdit({ ...base, model: "openai/gpt-image-1.5", image: { file }, background: "transparent" });
  imageEdit({ ...base, model: "openai/gpt-image-2", image: { file }, background: "transparent" });
  imageEdit({ ...base, model: "openai/gpt-image-2", image: { file }, background: "auto" });

  // `input_fidelity` is an edits-only extra, and not on every model.
  imageEdit({ ...base, model: "openai/gpt-image-1.5", image: { file }, input_fidelity: "high" });
  imageEdit({ ...base, model: "openai/gpt-image-1-mini", image: { file }, input_fidelity: "low" });
  // @ts-expect-error — "`gpt-image-1-mini` supports only `low`".
  imageEdit({ ...base, model: "openai/gpt-image-1-mini", image: { file }, input_fidelity: "high" });
  // @ts-expect-error — gpt-image-2 processes every input at high fidelity.
  imageEdit({ ...base, model: "openai/gpt-image-2", image: { file }, input_fidelity: "low" });

  // Recraft's curated style lists are per model, exactly as on generations.
  imageEdit({ ...base, model: "recraft/recraftv3", image: { file }, style: "Watercolor" });
  // @ts-expect-error — styles are not supported for the V4 / V4.1 line.
  imageEdit({ ...base, model: "recraft/recraftv4_1", image: { file }, style: "Watercolor" });
  // @ts-expect-error — image to image takes `style_id` on V3 only ("V3 only.").
  imageEdit({ ...base, model: "recraft/recraftv4_1", image: { file }, style_id: "abc" });
  imageEdit({ ...base, model: "recraft/recraftv3", image: { file }, style_id: "abc", style_match: "regular" });
  // @ts-expect-error — `regular` is the one `style_match` image to image takes.
  imageEdit({ ...base, model: "recraft/recraftv3_vector", image: { file }, style_id: "abc", style_match: "precise" });
  // `outputFormat` compiles to imageToImage's `image_format`.
  imageEdit({ ...base, model: "recraft/recraftv4_1", image: { file }, outputFormat: "png" });

  // Ideogram's remix form.
  imageEdit({ ...base, model: "ideogram/ideogram-3.0-quality", image: { file }, magic_prompt: "ON" });
  // @ts-expect-error — a typo is still a typo, per model.
  imageEdit({ ...base, model: "ideogram/ideogram-3.0-quality", image: { file }, magic_prmpt: "ON" });
}

// ---------------------------------------------------------------------------
// The adapters satisfy the category contract
// ---------------------------------------------------------------------------

expectAssignable<"imageEdit">(openaiImageEdit.category);
expectAssignable<"openai">(openaiImageEdit.provider);
expectAssignable<readonly string[]>(openaiImageEdit.models);
expectAssignable<ImageEditParams["model"]>("openai/gpt-image-1.5");
expectAssignable<ImageEditParams["operation"]>("edit");

// ---------------------------------------------------------------------------
// revana — a URL-only route, with rows generated from a catalog
// ---------------------------------------------------------------------------

function revanaNarrowingTests(): void {
  const base = { operation: "edit", prompt: "make it night" } as const;
  const url = "https://example.com/street.png";

  imageEdit({ ...base, model: "revana/nano-banana-pro", image: { url }, aspectRatio: "4:5" });
  // @ts-expect-error — Revana fetches every reference: a Blob has no wire field.
  imageEdit({ ...base, model: "revana/nano-banana-pro", image: { file: new Blob([]) } });
  // @ts-expect-error — nor do inline bytes.
  imageEdit({ ...base, model: "revana/nano-banana-pro", image: { data: "AAAA" } });
  // @ts-expect-error — 9:21 is not one of nano-banana-pro's shapes.
  imageEdit({ ...base, model: "revana/nano-banana-pro", image: { url }, aspectRatio: "9:21" });
  // @ts-expect-error — no Revana model has a `size` spelling.
  imageEdit({ ...base, model: "revana/nano-banana-pro", image: { url }, size: "1024x1024" });

  // `quality`, typed from the tiers the catalog lists for the model.
  imageEdit({ ...base, model: "revana/ideogram-v3", image: { url }, quality: "turbo" });
  // @ts-expect-error — `high` is gpt-image-1's word, not ideogram-v3's.
  imageEdit({ ...base, model: "revana/ideogram-v3", image: { url }, quality: "high" });

  // A text-to-image-only model is `unmodel/image`'s ref, not this pack's.
  // @ts-expect-error — imagen-4 cannot edit.
  expectAssignable<UnifiedRef<typeof revanaImageEdit>>("revana/imagen-4");

  const result = imageEdit({ ...base, model: "revana/nano-banana-pro", image: { url } });
  expectAssignable<{ image_url?: string }>(result.input);
  result.toSdk("revana");
}

// ---------------------------------------------------------------------------
// higgsfield — the picture-editing view: URL-only, one row per route
// ---------------------------------------------------------------------------

function higgsfieldNarrowingTests(): void {
  const base = { operation: "edit", prompt: "make it night" } as const;
  const url = "https://example.com/street.png";

  imageEdit({ ...base, model: "higgsfield/alibaba/qwen-image-3/edit", image: { url }, aspectRatio: "7:9" });
  // @ts-expect-error — no Higgsfield route takes bytes: a Blob has no wire field.
  imageEdit({ ...base, model: "higgsfield/alibaba/qwen-image-3/edit", image: { file: new Blob([]) } });
  // @ts-expect-error — nor do inline bytes.
  imageEdit({ ...base, model: "higgsfield/alibaba/qwen-image-3/edit", image: { data: "AAAA" } });
  // @ts-expect-error — 5:4 is not one of Qwen Image 3's shapes.
  imageEdit({ ...base, model: "higgsfield/alibaba/qwen-image-3/edit", image: { url }, aspectRatio: "5:4" });
  // @ts-expect-error — no Higgsfield route has a `size` spelling.
  imageEdit({ ...base, model: "higgsfield/alibaba/qwen-image-3/edit", image: { url }, size: "1024x1024" });

  // Every route in the view edits: no row declares `operations`.
  // @ts-expect-error — no Higgsfield route removes a background.
  imageEdit({ operation: "removeBackground", model: "higgsfield/alibaba/qwen-image-3/edit", image: { url } });

  // The route's own `resolution` is an extra here, in the route's own words.
  imageEdit({ ...base, model: "higgsfield/higgsfield-ai/soul/v2/image-to-image", image: { url }, resolution: "1080p" });
  // @ts-expect-error — Soul 2 sizes in 720p and 1080p.
  imageEdit({ ...base, model: "higgsfield/higgsfield-ai/soul/v2/image-to-image", image: { url }, resolution: "2k" });
  imageEdit({ ...base, model: "higgsfield/kling-image/v4.0/edit", image: { url }, resolution: "8k" });
  // …and so is Ideogram 4.0's own dial, which is not the canonical `strength`.
  imageEdit({ ...base, model: "higgsfield/ideogram/v4.0", image: { url }, image_weight: 40 });
  // @ts-expect-error — `image_weight` is Ideogram's; Qwen's row has no such parameter.
  imageEdit({ ...base, model: "higgsfield/alibaba/qwen-image-3/edit", image: { url }, image_weight: 40 });

  // A route outside the view is `unmodel/image`'s ref, or no pack's.
  // @ts-expect-error — Z-Image Turbo takes no picture.
  expectAssignable<UnifiedRef<typeof higgsfieldImageEdit>>("higgsfield/z-image/turbo");
  // @ts-expect-error — AI Influencer's picture is an identity photo, not a picture being edited.
  expectAssignable<UnifiedRef<typeof higgsfieldImageEdit>>("higgsfield/higgsfield/ai-influencer");
  expectAssignable<UnifiedRef<typeof higgsfieldImageEdit>>("higgsfield/marketing-studio/image");

  const result = imageEdit({ ...base, model: "higgsfield/alibaba/qwen-image-3/edit", image: { url } });
  expectAssignable<string>(result.prompt);
  expectAssignable<string[] | undefined>(result.image_urls);
  expectTrue<IsNever<KeyIn<typeof result, "endpoint">>>();
  result.toSdk("higgsfield");
}

// ---------------------------------------------------------------------------
// photoroom — one mode of a flat multipart form
// ---------------------------------------------------------------------------

function photoroomNarrowingTests(): void {
  const base = { operation: "edit", prompt: "make it winter" } as const;
  const url = "https://example.com/street.png";

  expectAssignable<UnifiedRef<typeof photoroomImageEdit>>("photoroom/edit-with-ai");
  expectAssignable<UnifiedRef<typeof photoroomImageEdit>>("photoroom/remove-background");
  // The route's third catalog row is not a ref here: `image-editing` names
  // forty features, not an operation.
  // @ts-expect-error
  expectAssignable<UnifiedRef<typeof photoroomImageEdit>>("photoroom/image-editing");
  expectAssignable<readonly ["file"]>(photoroomImageEdit.imageInputs);

  imageEdit({ ...base, model: "photoroom/edit-with-ai", image: { file }, seed: 7, outputFormat: "jpeg" });
  // @ts-expect-error — "The POST endpoint accepts `imageFile` only."
  imageEdit({ ...base, model: "photoroom/edit-with-ai", image: { url } });
  // @ts-expect-error — and the route has no base64 field.
  imageEdit({ ...base, model: "photoroom/edit-with-ai", image: { data: "AAAA" } });

  // Edit With AI has no field for the shape of its output, in any spelling.
  // @ts-expect-error
  imageEdit({ ...base, model: "photoroom/edit-with-ai", image: { file }, aspectRatio: "1:1" });
  // @ts-expect-error
  imageEdit({ ...base, model: "photoroom/edit-with-ai", image: { file }, size: "1024x1024" });
  // @ts-expect-error — the row declares no extras; a wire key is not a canonical one.
  imageEdit({ ...base, model: "photoroom/edit-with-ai", image: { file }, referenceBox: "originalImage" });

  // The bucket is the whole of both forms: dotted keys, the caller-named
  // reference pictures (a `Blob`, which a bucket must take as a leaf), the
  // `pr-*` header params, and `/v1/segment`'s own fields.
  imageEdit({
    ...base,
    model: "photoroom/edit-with-ai",
    image: { file },
    providerOptions: {
      photoroom: {
        referenceBox: "originalImage",
        "editWithAI.additionalImages.styleRef.imageFile": file,
        "editWithAI.additionalImages[0].imageUrl": url,
        "pr-hd-background-removal": "auto",
        padding: "10%",
      },
    },
  });
  imageEdit({
    ...base,
    model: "photoroom/edit-with-ai",
    image: { file },
    // @ts-expect-error — `editWithAI.seed` is a number, or a number written as text, on that form.
    providerOptions: { photoroom: { "editWithAI.seed": true } },
  });
  imageEdit({
    ...base,
    model: "photoroom/edit-with-ai",
    image: { file },
    // @ts-expect-error — a reference picture's `imageFile` is bytes, not a URL.
    providerOptions: { photoroom: { "editWithAI.additionalImages.styleRef.imageFile": url } },
  });

  // The result is one of the two routes' own `ValidatedForm`s. The result type
  // is read per PROVIDER, so a field of one form is reached by narrowing.
  const result = imageEdit({ ...base, model: "photoroom/edit-with-ai", image: { file } });
  expectAssignable<"form">(result.request.body);
  if ("imageFile" in result) expectAssignable<Blob | undefined>(result.imageFile);
  // @ts-expect-error — not without narrowing: `/v1/segment`'s form has no `imageFile`.
  void result.imageFile;
  result.toSdk("photoroom");
  // @ts-expect-error — "openai" is not one of photoroom.imageEdit's targets.
  result.toSdk("openai");
}

// The adapter spells its edit arm out instead of reading it off the validator
// (see `PhotoroomImageEditResult`); the two arms must stay the two validators'
// own types, each in both directions.
type PhotoroomEditArm = Exclude<
  PhotoroomImageEditResult,
  ReturnType<typeof photoroomSegmentValidator>
>;
type PhotoroomSegmentArm = Extract<
  PhotoroomImageEditResult,
  ReturnType<typeof photoroomSegmentValidator>
>;
declare const photoroomFromValidator: ReturnType<typeof photoroomValidator>;
declare const photoroomEditArm: PhotoroomEditArm;
expectAssignable<PhotoroomEditArm>(photoroomFromValidator);
expectAssignable<ReturnType<typeof photoroomValidator>>(photoroomEditArm);
declare const photoroomSegmentFromValidator: ReturnType<typeof photoroomSegmentValidator>;
declare const photoroomSegmentArm: PhotoroomSegmentArm;
expectAssignable<PhotoroomSegmentArm>(photoroomSegmentFromValidator);
expectAssignable<ReturnType<typeof photoroomSegmentValidator>>(photoroomSegmentArm);

// ---------------------------------------------------------------------------
// 8 · the operation follows the model
// ---------------------------------------------------------------------------

function removeBackgroundTests(runtimeRef: string): void {
  const removal = { operation: "removeBackground" } as const;
  const edit = { operation: "edit", prompt } as const;
  const stability = "stability/stable-image-remove-background";

  // --- an edit ref edits, and only edits ------------------------------------
  imageEdit({ ...edit, model: "openai/gpt-image-1.5", image: { file } });
  // @ts-expect-error — this ref edits; its row declares no `operations`.
  imageEdit({ ...removal, model: "openai/gpt-image-1.5", image: { file } });
  // @ts-expect-error — and an edit still needs its sentence.
  imageEdit({ operation: "edit", model: "openai/gpt-image-1.5", image: { file } });

  // --- a removal ref removes, and takes none of the edit words --------------
  imageEdit({ ...removal, model: stability, image: { file } });
  imageEdit({ ...removal, model: stability, image: { file }, outputFormat: "webp" });
  // @ts-expect-error — no prompt: the operation is the instruction.
  imageEdit({ ...removal, model: stability, image: { file }, prompt });
  // @ts-expect-error
  imageEdit({ ...removal, model: stability, image: { file }, seed: 1 });
  // @ts-expect-error
  imageEdit({ ...removal, model: stability, image: { file }, strength: 0.5 });
  // @ts-expect-error
  imageEdit({ ...removal, model: stability, image: { file }, n: 2 });
  // @ts-expect-error — a removal has no shape to choose, in any spelling.
  imageEdit({ ...removal, model: stability, image: { file }, aspectRatio: "1:1" });
  // @ts-expect-error
  imageEdit({ ...removal, model: stability, image: { file }, size: "1024x1024" });
  // @ts-expect-error
  imageEdit({ ...removal, model: stability, image: { file }, dimensions: { width: 512, height: 512 } });
  // @ts-expect-error — this ref removes; Stability's prompted edits are wire-only.
  imageEdit({ ...edit, model: stability, image: { file } });
  // @ts-expect-error — the route is multipart.
  imageEdit({ ...removal, model: stability, image: { url } });
  // @ts-expect-error
  imageEdit({ ...removal, model: stability, image: { data } });

  // --- one provider, two models, one operation each -------------------------
  imageEdit({ ...edit, model: "photoroom/edit-with-ai", image: { file } });
  imageEdit({ ...removal, model: "photoroom/remove-background", image: { file } });
  imageEdit({
    ...removal,
    model: "photoroom/remove-background",
    image: { file },
    outputFormat: "jpeg",
    bg_color: "red",
    channels: "alpha",
    crop: "true",
    despill: "false",
  });
  // The four lines of docs/surfaces.md "Removing a background", verbatim in what they assert.
  imageEdit({ operation: "removeBackground", model: "photoroom/remove-background", image: { file }, bg_color: "white" });
  // @ts-expect-error — an edit-only provider has no removal ref.
  imageEdit({ operation: "removeBackground", model: "openai/gpt-image-1.5", image: { file } });

  // A union of refs degrades like a dynamic one: either operation compiles, and
  // the adapter refuses the wrong pairing at run time from the same row.
  function picker(model: "photoroom/remove-background" | "photoroom/edit-with-ai"): void {
    imageEdit({ operation: "edit", prompt, model, image: { file } });
    imageEdit({ operation: "removeBackground", model, image: { file } });
  }
  void picker;

  // @ts-expect-error — the operation is a fact of the MODEL, not of the provider.
  imageEdit({ ...removal, model: "photoroom/edit-with-ai", image: { file } });
  // @ts-expect-error
  imageEdit({ ...edit, model: "photoroom/remove-background", image: { file } });
  // @ts-expect-error — extras are per model: `bg_color` is `/v1/segment`'s.
  imageEdit({ ...edit, model: "photoroom/edit-with-ai", image: { file }, bg_color: "red" });
  imageEdit({ ...removal, model: "photoroom/remove-background", image: { file }, crop: true });
  // @ts-expect-error — `crop` is a boolean or its text, and nothing else.
  imageEdit({ ...removal, model: "photoroom/remove-background", image: { file }, crop: "yes" });
  // @ts-expect-error — nor a sentence.
  imageEdit({ ...removal, model: "photoroom/remove-background", image: { file }, prompt });
  // @ts-expect-error — and a seed is Edit With AI's.
  imageEdit({ ...removal, model: "photoroom/remove-background", image: { file }, seed: 7 });
  // `/v1/segment`'s `size` collides with the canonical word, so it is not an
  // extra: it rides in the bucket, typed.
  imageEdit({
    ...removal,
    model: "photoroom/remove-background",
    image: { file },
    providerOptions: { photoroom: { size: "hd" } },
  });
  // @ts-expect-error — the canonical `size` is a shape, and a removal has none.
  imageEdit({ ...removal, model: "photoroom/remove-background", image: { file }, size: "hd" });

  // --- a ref the types cannot read gets both arms, each still exact ---------
  imageEdit({ ...removal, model: runtimeRef, image: { file } });
  imageEdit({ ...edit, model: runtimeRef, image: { file }, aspectRatio: "1:1" });
  // @ts-expect-error — the removal arm has no prompt whatever the ref is.
  imageEdit({ ...removal, model: runtimeRef, image: { file }, prompt });
  // @ts-expect-error — and the edit arm still requires one.
  imageEdit({ operation: "edit", model: runtimeRef, image: { file } });
  // @ts-expect-error
  imageEdit({ operation: "inpaint", model: runtimeRef, prompt, image: { file } });
  // A model newer than this snapshot at a known provider degrades the same way,
  // and the adapter answers at run time.
  imageEdit({ ...removal, model: "openai/gpt-image-9", image: { file } });

  // --- the result is the removal route's own `ValidatedForm` ----------------
  const result = imageEdit({ ...removal, model: stability, image: { file } });
  expectAssignable<"form">(result.request.body);
  expectAssignable<Blob>(result.image);
  expectAssignable<"png" | "webp" | undefined>(result.output_format);
  result.toSdk("stability");
}

declare const stabilityFromValidator: ReturnType<typeof stabilityValidator>;
declare const stabilityFromAdapter: StabilityImageEditResult;
expectAssignable<StabilityImageEditResult>(stabilityFromValidator);
expectAssignable<ReturnType<typeof stabilityValidator>>(stabilityFromAdapter);
expectAssignable<UnifiedRef<typeof stabilityImageEdit>>("stability/stable-image-remove-background");
// @ts-expect-error — the five mask- and search-driven routes are not refs here.
expectAssignable<UnifiedRef<typeof stabilityImageEdit>>("stability/stable-image-inpaint");
expectAssignable<readonly ["file"]>(stabilityImageEdit.imageInputs);

// `operations` on a row → the operation union; absent is `"edit"`.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
expectTrue<Equal<ImageEditOperationOf<{ readonly ratios: readonly [] }>, "edit">>();
expectTrue<
  Equal<ImageEditOperationOf<{ readonly operations: readonly ["removeBackground"] }>, "removeBackground">
>();
expectTrue<
  Equal<
    ImageEditOperationOf<{ readonly operations: readonly ["edit", "removeBackground"] }>,
    ImageEditOperation
  >
>();

// The vocabulary is the union of the two operations' arms, and every arm
// declares the same keys — which is what lets `ExactKeys` see `prompt` at all.
expectTrue<Equal<ImageEditParams, ImageEditEditParams | ImageEditRemoveBackgroundParams>>();
expectTrue<Equal<keyof ImageEditEditParams, keyof ImageEditRemoveBackgroundParams>>();
expectTrue<Equal<ImageEditParams["operation"], ImageEditOperation>>();

// `ImageEditParamsFor<K>` is the edit arm by default — what every edit-only
// adapter's `compile` reads `input.prompt` off — and the full union on request.
expectTrue<Equal<ImageEditParamsFor<"file">["operation"], "edit">>();
expectTrue<Equal<ImageEditParamsFor<"file">["prompt"], string>>();
expectTrue<Equal<ImageEditParamsFor<"file", "removeBackground">["operation"], "removeBackground">>();
expectTrue<
  Equal<ImageEditParamsFor<"file", ImageEditOperation>["operation"], ImageEditOperation>
>();

// A `Blob` in a typed bucket is a leaf at every multipart adapter, not only
// Photoroom's: OpenAI's wire declares `image: Blob`.
imageEdit({
  operation: "edit",
  model: "openai/gpt-image-1.5",
  prompt,
  image: { file },
  providerOptions: { openai: { image: file } },
});

export {
  removeBackgroundTests,
  photoroomNarrowingTests,
  higgsfieldNarrowingTests,
  revanaNarrowingTests,
  operationTests,
  imageNarrowingTests,
  refUnionTests,
  resultTypeTests,
  providerOptionsTests,
  noToApiTests,
  modelNarrowingTests,
};
