---
"unmodel": minor
---

Add `unmodel/photoroom`: native validators for Photoroom's two image APIs.

- `photoroom.imageEdit` — `POST https://image-api.photoroom.com/v2/edit`, the Image Editing API: background removal, AI backgrounds, shadows, relighting, text removal, expand, uncrop, upscale, beautify, ironing, flat lay, ghost mannequin, virtual model, templating and prompt-driven edits, on one multipart route. The params are the form fields themselves, dotted names included (`"background.blur.radius": 0.02`), plus three open-keyed families typed as template-literal keys (`editWithAI.additionalImages.<name>.imageFile`, `layers.<id>.text.content`, …).
- `photoroom.imageEditRemoveBackground` — `POST https://sdk.photoroom.com/v1/segment`, the Remove Background API: seven remove.bg-compatible fields.

What the validators know that the API does not tell you up front:

- Five features are switched by a request **header** that is in no schema (`pr-ai-shadows-model-version` and four siblings, exported as `PHOTOROOM_REQUEST_HEADERS`). `imageEdit` takes them as params and returns them on `.request.headers`.
- `/v2/edit` does not refuse a field it does not know: it answers 200, bills the call and names the field in a response header. That is an `unknown_param` warning here, before the send.
- A form part is text, so a field takes either spelling of its value: `maxWidth: 200` or `"200"` (the OpenAPI document's own example), `removeBackground: false` or `"false"`, and on `/v1/segment` `crop: true` or `"true"`. Nothing is converted; a bound applies to the number the text spells, and `toFormData` writes a number in plain decimal digits, never with an exponent.
- Cross-field rules are errors only where Photoroom states the rejection, and warnings where it says "can only be provided if" — its own docs examples contradict one such sentence. All 56 multipart examples in Photoroom's docs validate as published, every value the text the example sends, with no error and no warning (`test/fixtures/photoroom/docs-examples.json`).

Both are multipart: send `.request.url` with `photoroom.toFormData(validated)`. Estimates are the self-serve rates — $0.10 per Image Editing call, $0.02 per Remove Background call — and `PHOTOROOM_PRICING_CAVEAT` says what those numbers are not; a request for `virtualModel.quality` above `standard` returns no estimate, because no price is published for it.

The form-field tables are generated from Photoroom's OpenAPI document (`data/photoroom/`, `bun run codegen:photoroom`, refreshed weekly) and exported as data: `PHOTOROOM_EDIT_FIELDS`, `PHOTOROOM_EDIT_FAMILIES`, `PHOTOROOM_SEGMENT_FIELDS`. Types-only entry at `unmodel/photoroom/types`.

Not served: `GET /v2/edit` (the URL-input variant — unmodel has no body-less GET request shape), the base64 JSON body on `/v1/segment`, and Photoroom's account, visual-QA and legacy render routes.

CLI: `unmodel validate photoroom.imageEdit` is registered; `photoroom.imageEditRemoveBackground` needs a file and is library-only. The CLI's multipart note now reads the endpoint's declared framing, so it also appears for a multipart endpoint that returns headers.
