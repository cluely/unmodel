---
"unmodel": minor
---

The image-edit wave, and the last one the address-vs-wire law had left: one
`imageEdit()` for every image-to-image provider, and one name for each editing
endpoint at all of them.

**Endpoint renames (breaking).** Eight providers ship twenty-six editing routes
and spelled "change this picture" eight unrelated ways — a product family
(`fluxKontext`, `fluxFill`, `fluxVto`), a wire path (`imageToImage`,
`stableImageSearchAndReplace`), a bare verb (`edit`, `remix`, `reframe`) and a
noun phrase (`replaceBackground`, `generateBackground`). All twenty-six now
address the category as `imageEdit`, with each extra route qualified by *what it
does to the picture*:

| old | new |
| --- | --- |
| `black-forest-labs.fluxKontext` | `black-forest-labs.imageEdit` |
| `black-forest-labs.fluxFill` | `black-forest-labs.imageEditFill` |
| `black-forest-labs.fluxExpand` | `black-forest-labs.imageEditExpand` |
| `black-forest-labs.fluxErase` | `black-forest-labs.imageEditErase` |
| `black-forest-labs.fluxDeblur` | `black-forest-labs.imageEditDeblur` |
| `black-forest-labs.fluxOutpainting` | `black-forest-labs.imageEditOutpainting` |
| `black-forest-labs.fluxVto` | `black-forest-labs.imageEditVto` |
| `ideogram.edit` | `ideogram.imageEdit` |
| `ideogram.remix` | `ideogram.imageEditRemix` |
| `ideogram.reframe` | `ideogram.imageEditReframe` |
| `ideogram.replaceBackground` | `ideogram.imageEditReplaceBackground` |
| `recraft.imageToImage` | `recraft.imageEdit` |
| `recraft.inpaint` | `recraft.imageEditInpaint` |
| `recraft.outpaint` | `recraft.imageEditOutpaint` |
| `recraft.generateBackground` | `recraft.imageEditGenerateBackground` |
| `recraft.replaceBackground` | `recraft.imageEditReplaceBackground` |
| `stability.stableImageErase` | `stability.imageEditErase` |
| `stability.stableImageInpaint` | `stability.imageEditInpaint` |
| `stability.stableImageOutpaint` | `stability.imageEditOutpaint` |
| `stability.stableImageSearchAndReplace` | `stability.imageEditSearchAndReplace` |
| `stability.stableImageSearchAndRecolor` | `stability.imageEditSearchAndRecolor` |
| `stability.stableImageRemoveBackground` | `stability.imageEditRemoveBackground` |
| `luma.reframeImage` | `luma.imageEditReframe` |
| `reve.edit` | `reve.imageEdit` |
| `reve.remix` | `reve.imageEditRemix` |
| `openai.imageEdit`, `bria.imageEdit` | (already uniform) |

The module filenames move with the addresses as they did in the four earlier
waves: `openai/images-edit.ts`, `black-forest-labs/kontext.ts`,
`ideogram/edit.ts`, `recraft/transform.ts`, `stability/edit.ts`,
`reve/edit.ts` and `bria/edit.ts` are all `image-edit.ts` now, with
`black-forest-labs/edit.ts` → `image-edit-flux1.ts`,
`black-forest-labs/tools.ts` → `image-edit-tools.ts` and
`luma/reframe-image.ts` → `image-edit-reframe.ts`. The rename is made
structural by `test/bundle-budget.test.ts`, which asserts the pack can only
reach a provider through a file with the uniform name.

Wire-shaped names keep their wire spelling: `IMAGES_EDITS_URL`,
`IDEOGRAM_V3_REMIX_URL`, `IMAGE_TO_IMAGE_URL`, `STABLE_IMAGE_SEARCH_AND_REPLACE_URL`,
`REFRAME_IMAGE_URL`, `REVE_EDIT_URL`, `FluxKontextParams`, `EditParams`,
`RemixParams`, `ImageToImageParams`, `StableImageEraseParams`,
`IMAGE_TO_IMAGE_MODELS` and `openai.imageEditToFormData` are all unchanged.

**`unmodel/image-edit` now ships a ready-made pack** over four providers —
OpenAI (`/v1/images/edits`), Black Forest Labs (FLUX.1 Kontext), Ideogram
(`/v1/ideogram-v3/remix`) and Recraft (`/v1/images/imageToImage`) — the four
whose primary editing route is *image + prompt, no mask*, which is what
`ImageEditParams` says:

```ts
import { imageEdit } from "unmodel/image-edit";

const req = imageEdit({
  operation: "edit",
  model: "openai/gpt-image-1.5",
  prompt: "make it winter",
  image: { file: png },
});
```

**`image` narrows to the route, at compile time** — the same mechanism
`unmodel/transcribe` uses for `audio`, and for the same reason: the
disagreement is per route, not per provider. Each adapter declares its
`imageInputs`, and the ref you write decides which shapes type-check:

```ts
imageEdit({ …, model: "openai/gpt-image-1.5", image: { file } });               // ok
imageEdit({ …, model: "openai/gpt-image-1.5", image: { url } });                // compile error
imageEdit({ …, model: "black-forest-labs/flux-kontext-pro", image: { data } }); // ok
imageEdit({ …, model: "black-forest-labs/flux-kontext-pro", image: { file } }); // compile error
```

One declaration drives both halves: the same array types the caller's `image`
and backs it at run time with an `unsupported_param` naming the shapes the route
does take, for JavaScript callers and refs built at run time.

**`strength` means one thing, in one direction.** `0` keeps the source, `1`
ignores it. Recraft's `strength` already runs that way and passes through
untouched; Ideogram's `image_weight` runs **backwards** ("how strongly the
output should resemble the input"), so `strength: 0` compiles to
`image_weight: 100` and `strength: 0.5` to `image_weight: 50` — which is also
that route's own default. Every adapter declares its scale as the wire values at
canonical 0 and 1, so the inversion is one number swapped rather than a minus
sign hidden in a branch, and the capability sweep asserts the direction by
compiling two requests and checking which way the wire value moves. A `strength`
outside `[0, 1]` is refused rather than clamped, and one that lands between two
whole numbers on an integer scale is an `approximated_param` naming both.

**Masked operations are wire-only in v1.** `operation` is `"edit"` and only
`"edit"`. Inpainting, outpainting, erase, deblur, reframe, background
replacement and virtual try-on all need a mask, a second image or a set of
pixels this vocabulary has no word for, so all sixteen of them stay reachable by
name at `unmodel/<provider>`. The discriminant exists so they can join later
without either widening `ImageEditParams` into a shape where half the fields are
conditional, or minting a seventh entry point — and it is checked at **run
time** as well as in the type, per adapter, so a JavaScript caller who writes
`operation: "inpaint"` gets an `invalid_enum_value` naming the wire-only sibling
that does the job today rather than a request that is quietly an edit.

**Two honest gaps.**

- **Black Forest Labs cannot take a `Blob`.** Kontext's `input_image` is a JSON
  string documented "base64 or a URL", and a `Blob`'s bytes cannot be read
  without awaiting — which a synchronous `compile` cannot do. Its `imageInputs`
  is `["data", "url"]`, so `{ file }` does not type-check, and the runtime
  message says why and names the two shapes that work. Same reasoning, and the
  same refusal, as `inworld.transcribe`.
- **Recraft's `strength` is required and has no documented default.** The
  canonical field is optional because most providers have no dial at all, so a
  request without one at a `recraft/…` ref is an error naming the field and what
  its ends mean — rather than a number unmodel picked, which on a per-image bill
  is a different picture nobody asked for.

Beyond those: OpenAI has no `strength` and no `seed` on `/v1/images/edits`
(`input_fidelity` is a two-position switch, not a 0–1 dial), Ideogram and Recraft
publish no output-encoding field, and Recraft's `imageToImage` has no size field
at all — the result takes the input's shape. All six are declared gaps with the
kernel's uniform message.

**New package exports:** `unmodel/black-forest-labs/unified`,
`unmodel/ideogram/unified` and `unmodel/recraft/unified` now split their
adapters per category (`unified-image.ts` + `unified-image-edit.ts` behind the
same barrel), joining `unmodel/openai/unified` — so no pack pays for another
category's validators or catalogs. `unmodel validate` gains
`unified.imageEdit`.
