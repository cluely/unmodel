---
"unmodel": minor
---

`unmodel/image-edit` gains Photoroom: `photoroom/edit-with-ai`.

```ts
import { imageEdit } from "unmodel/image-edit";
import { toFormData } from "unmodel/photoroom";

const request = imageEdit({
  operation: "edit",
  model: "photoroom/edit-with-ai",
  prompt: "make it winter",
  image: { file },
});
// → { "editWithAI.mode": "ai.auto", "editWithAI.prompt": "make it winter", removeBackground: false, imageFile: file }
```

Edit With AI is the one mode of Photoroom's `POST /v2/edit` that is a picture and a sentence, so it is the one ref. `prompt` → `editWithAI.prompt` (with `editWithAI.mode: "ai.auto"`), `seed` → `editWithAI.seed`, `outputFormat` → `export.format`, and the result is `photoroom.imageEdit`'s own multipart `ValidatedForm` at $0.10 a call.

- The adapter writes `removeBackground: false`. The route's default would return a cut-out of the edit, and every Edit With AI example in Photoroom's docs sends it. Your own value in `providerOptions.photoroom` wins.
- `image` is `{ file }` only: `{ url }` and `{ data }` are compile errors and run-time refusals, because POST reads the picture from the `imageFile` part and Photoroom fetches a URL only on `GET /v2/edit`.
- `strength`, `n`, `size`, `aspectRatio` and `dimensions` are refused with the reason. `outputSize` is the canvas a result is positioned in, not a generation size, so no shape word compiles onto it.
- Reference pictures (`editWithAI.additionalImages.<name>.imageFile`, up to four) and every other field of the route go in `providerOptions.photoroom`, which is typed from the whole `/v2/edit` form.

New subpaths: `unmodel/photoroom/unified` (the adapter, for `createImageEdit([…])`) and `unmodel/photoroom/values` (`IMAGE_EDIT_MODELS`, `IMAGE_EDIT_MODEL_PARAMS`, the generated field tables, the feature-header names and their documented values, the byte limits).

New types on `unmodel/photoroom` and `unmodel/photoroom/types`: `EditFields` (the `/v2/edit` form's fields — `EditParams` without the five `pr-*` header params) and `EditValidated` (what `photoroom.imageEdit` returns for a request typed as the whole form; the same type as `ReturnType<typeof photoroom.imageEdit>`, named so you can state it).

Type fix: a `Blob` is now accepted at a typed `providerOptions` key on every multipart adapter. A bucket used to map over a `Blob` as if it were a nested object, so `providerOptions: { openai: { image: blob } }` did not compile.
