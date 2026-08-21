---
"unmodel": minor
---

Media endpoint wave: image editing, speech, and video post-production validators.

New request validators (all on existing subpaths — no new package exports):

- `unmodel/openai`: `imageEdit` (+ `imageEditToFormData`), `tts` (TTS),
  `stt` (+ `sttToFormData`).
- `unmodel/google`: `image` (Imagen 4 fast/standard/ultra).
- `unmodel/black-forest-labs`: `imageFlux1`, `imageEditFill`, `imageEditExpand`, and the
  FLUX Tools routes `imageEditOutpainting`, `imageEditErase`, `imageEditDeblur`,
  `imageEditVto`.
- `unmodel/ideogram`: `imageV4`, `imageEdit`, `imageEditRemix`, `imageEditReframe`,
  `imageEditReplaceBackground`.
- `unmodel/recraft`: `imageEdit`, `imageEditInpaint`, `imageEditOutpaint`,
  `imageEditGenerateBackground`, `imageEditReplaceBackground`.
- `unmodel/stability`: `imageEditErase`, `imageEditInpaint`, `imageEditOutpaint`,
  `imageEditSearchAndReplace`, `imageEditSearchAndRecolor`,
  `imageEditRemoveBackground`.
- `unmodel/luma`: `videoModify`, `videoReframe`, `imageEditReframe`, `videoUpscale`,
  `videoAddAudio`.
- `unmodel/runway`: `videoFromVideo`.

Types across every audited endpoint were re-derived from the providers' current
documentation rather than their SDKs — narrowed where the SDK permits what the API
rejects, widened where the SDK enum is a subset of the documented range (e.g.
`gpt-image-2` now accepts free-form `WIDTHxHEIGHT` sizes and rejects only
`background: "transparent"`). Every deviation carries its doc URL.

The `unmodel validate` CLI registry now covers all 77 JSON-bodied endpoints and
reports multipart-upload endpoints as library-only instead of failing on a type error.
