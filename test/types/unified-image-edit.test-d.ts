/**
 * Type-level tests for `unmodel/image-edit`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * Two of this category's claims are **compile-time** ones, so they carry more
 * weight here than in the four categories that have neither:
 *
 * 1. `operation` is a literal, not a string. It is the discriminant that lets
 *    the masked operations join later without widening `ImageEditParams`, and it
 *    only does that job if `"inpaint"` is a red squiggle *today*.
 * 2. `image` narrows per **route**, exactly as `audio` does at
 *    `unmodel/transcribe`:
 *
 * | route | accepts | `{ file }` | `{ url }` | `{ data }` |
 * |---|---|---|---|---|
 * | openai, ideogram | file | ok | error | error |
 * | black-forest-labs | data, url | error | ok | ok |
 * | recraft | file, url | ok | ok | error |
 *
 * Sections 3–6 are the same four properties every category entry has: the ref
 * union, the provider's own result type, `providerOptions` keyed by the pack,
 * and no `.toApi`.
 */
import { createImageEdit, imageEdit } from "../../src/unified/image-edit";
import { imageEdit as bflImageEdit } from "../../src/providers/black-forest-labs/unified";
import { imageEdit as ideogramImageEdit } from "../../src/providers/ideogram/unified";
import { imageEdit as openaiImageEdit } from "../../src/providers/openai/unified";
import { imageEdit as recraftImageEdit } from "../../src/providers/recraft/unified";
import type { UnifiedRef } from "../../src/core/unified/types";
import type {
  ImageEditInputFor,
  ImageEditParams,
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
  imageEdit({ operation: "edit", model: "stability/stable-image-erase", prompt, image: { file } });

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
    providerOptions: { stability: {} },
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
// The adapters satisfy the category contract
// ---------------------------------------------------------------------------

expectAssignable<"imageEdit">(openaiImageEdit.category);
expectAssignable<"openai">(openaiImageEdit.provider);
expectAssignable<readonly string[]>(openaiImageEdit.models);
expectAssignable<ImageEditParams["model"]>("openai/gpt-image-1.5");
expectAssignable<ImageEditParams["operation"]>("edit");

export {
  operationTests,
  imageNarrowingTests,
  refUnionTests,
  resultTypeTests,
  providerOptionsTests,
  noToApiTests,
};
