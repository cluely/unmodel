---
"unmodel": minor
---

Media endpoint wave: image editing, speech, and video post-production validators.

New request validators (all on existing subpaths — no new package exports):

- `unmodel/openai`: `imageEdit` (+ `imageEditToFormData`), `speech` (TTS),
  `transcription` (+ `transcriptionToFormData`).
- `unmodel/google`: `generateImages` (Imagen 4 fast/standard/ultra).
- `unmodel/black-forest-labs`: `flux1`, `fluxFill`, `fluxExpand`, and the FLUX Tools
  routes `fluxOutpainting`, `fluxErase`, `fluxDeblur`, `fluxVto`.
- `unmodel/ideogram`: `generateV4`, `edit`, `remix`, `reframe`, `replaceBackground`.
- `unmodel/recraft`: `imageToImage`, `inpaint`, `outpaint`, `generateBackground`,
  `replaceBackground`.
- `unmodel/stability`: `stableImageErase`, `stableImageInpaint`, `stableImageOutpaint`,
  `stableImageSearchAndReplace`, `stableImageSearchAndRecolor`,
  `stableImageRemoveBackground`.
- `unmodel/luma`: `modifyVideo`, `reframeVideo`, `reframeImage`, `upscale`, `addAudio`.
- `unmodel/runway`: `videoToVideo`.

Types across every audited endpoint were re-derived from the providers' current
documentation rather than their SDKs — narrowed where the SDK permits what the API
rejects, widened where the SDK enum is a subset of the documented range (e.g.
`gpt-image-2` now accepts free-form `WIDTHxHEIGHT` sizes and rejects only
`background: "transparent"`). Every deviation carries its doc URL.

The `unmodel validate` CLI registry now covers all 77 JSON-bodied endpoints and
reports multipart-upload endpoints as library-only instead of failing on a type error.
