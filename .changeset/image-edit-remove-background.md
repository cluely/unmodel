---
"unmodel": minor
---

`unmodel/image-edit` gains a second operation: `operation: "removeBackground"`.

**Type change:** `ImageEditParams` is now a union over `operation`. Code that reads `prompt` off an `ImageEditParams` value, and a custom adapter typed against the full `ImageEditParams`, must narrow or re-declare — see "Type change" below.

```ts
import { imageEdit } from "unmodel/image-edit";
import { toFormData } from "unmodel/stability";

const request = imageEdit({
  operation: "removeBackground",
  model: "stability/stable-image-remove-background",
  image: { file },
  outputFormat: "webp",
});
// → { image: file, output_format: "webp" }

await fetch(request.request.url, {
  method: request.request.method,
  headers: { authorization: `Bearer ${process.env.STABILITY_API_KEY ?? ""}`, accept: "image/*" },
  body: toFormData(request),
});
```

A removal takes a picture and, optionally, an encoding. It has no prompt: the operation is the instruction.

Two refs serve it, and Stability joins the pack:

- `stability/stable-image-remove-background` → `stability.imageEditRemoveBackground` (5 credits, $0.05). `outputFormat: "jpeg"` is refused by name: the route returns an alpha channel and offers `png` and `webp`.
- `photoroom/remove-background` → `photoroom.imageEditRemoveBackground`, `POST /v1/segment` ($0.02 — a fifth of what the same cut-out costs through `/v2/edit`). `outputFormat: "jpeg"` is written `jpg`, the route's own spelling. `bg_color`, `channels`, `crop` and `despill` are per-model extras; the route's `size` (a named downscale) rides in `providerOptions.photoroom`, because the canonical `size` is a shape. Photoroom's two refs compile to two different forms, so `PhotoroomImageEditWire` is the fields of both and `PhotoroomImageEditResult` the union of the two routes' results: a unified call's result type is read per provider, and reaching a field of one form takes an `in` check (`"imageFile" in result`). `.request` and `.toSdk("photoroom")` are on both.

**Which operation a model serves is a fact of the model**, so the type follows the ref. At a removal ref, `prompt`, `strength`, `n`, `seed`, `size`, `aspectRatio` and `dimensions` are compile errors; at an edit ref, `operation: "removeBackground"` is. `photoroom/edit-with-ai` edits and `photoroom/remove-background` removes, and neither compiles with the other's operation. A JavaScript caller gets the same answers at run time: `invalid_enum_value` at `operation` naming what the model does serve, and `unsupported_param` at each word that belongs to the other operation. Photoroom's and Stability's image-edit ids are unmodel's names for routes that take no model field, so an id outside their lists is refused at `model` (`invalid_enum_value`, naming the refs) instead of being sent, and billed, as whichever route the operation picks.

For a picker:

- `IMAGE_EDIT_OPERATIONS` at `unmodel/values` — `["edit", "removeBackground"]`.
- `IMAGE_EDIT_MODEL_PARAMS[model].operations` at `unmodel/<provider>/values` — which of them that model serves. **Absent means `["edit"]`**, which is what every existing row says.
- `unmodel/stability/values` gains `IMAGE_EDIT_MODELS` and `IMAGE_EDIT_MODEL_PARAMS`; `unmodel/stability/unified` gains the `imageEdit` adapter (with `StabilityImageEditWire` / `StabilityImageEditResult`) for `createImageEdit([…])`.

**Type change.** `ImageEditParams` is now a union over `operation`: `ImageEditEditParams | ImageEditRemoveBackgroundParams`.

- Code that reads `prompt`, `seed`, `strength`, `n` or a shape word off an `ImageEditParams` value must narrow first (`if (params.operation === "edit")`); `prompt` is `string | undefined` until it does. `ImageEditParams["operation"]` is `"edit" | "removeBackground"`, so an exhaustive `switch` gains a case.
- A custom adapter is unaffected if it is typed the way the shipped ones are: `ImageEditParamsFor<K>` and `ImageEditAdapterFor<K, …>` still mean the edit arm, through a new last type parameter that defaults to `"edit"`. An adapter typed against the full `ImageEditParams` should declare `ImageEditParamsFor<K>` instead, or handle both arms. One that serves a removal declares its operation (`ImageEditAdapterFor<K, Wire, Out, Table, "removeBackground">`) and lists it on the model's row.

New types on `unmodel/image-edit`: `ImageEditOperation`, `ImageEditParamsCommon`, `ImageEditEditBase`, `ImageEditEditParams`, `ImageEditRemoveBackgroundParams`, `ImageEditModelParams`, `ImageEditModelParamTable`, `ImageEditOperationOf`, `ImageEditOperationArms`. `unmodel/types` gains `ImageEditOperation`, `ImageEditEditParams`, `ImageEditRemoveBackgroundParams`, and the two a custom adapter's row is typed with, `ImageEditModelParams` and `ImageEditModelParamTable`.

Also in this release:

- `FAL_EXCLUDED` says the true thing about background removal at fal. The seven still-image routes are excluded because promoting them is generator work, not because the vocabulary lacks the word; the nine video routes carry their own reason, which says the image-edit operation is not their path.
- `STABILITY_STYLE_PRESETS` and `STABILITY_OUTPUT_FORMATS` are declared on Stability's import-free constraints leaf (every export keeps its name and place), so a bundle that only uses Stability's edit routes no longer carries its three generation validators.

Not behind the operation yet, each needing its own wire-exact address first: Recraft's `POST /v1/images/removeBackground`, Bria's `POST /v2/image/edit/remove_background`, and fal's seven still-image removal routes. `docs/providers.md` records each with its source and date.
