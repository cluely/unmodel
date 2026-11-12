---
"unmodel": patch
---

bria: Fibo 2 on `bria.image` and `bria.imageEdit`

Bria moved POST /v2/image/generate and POST /v2/image/edit to Fibo 2 in place
("Image generation now runs on Fibo 2, with 12 more aspect ratios and no code
changes." — https://docs.bria.ai/image-generation-overview.md; read 2026-11-12
against https://docs.bria.ai/_bundle/image-generation.yaml and
https://docs.bria.ai/_bundle/image-editing.yaml). The catalog ids stay
(`bria/FIBO`, `FIBO-edit`); their display names are now "Fibo 2" and "Fibo 2 Edit".

- `bria.image` accepts the 21 aspect ratios the route now declares. It used to
  refuse twelve of them, including Bria's own `21:9` panorama example.
  `BRIA_ASPECT_RATIOS` / `BriaAspectRatio` now hold all 21. The twelve new ones
  are also published on their own as `BRIA_FIBO2_ASPECT_RATIOS`. They return 422
  with `resolution: "4MP"`, with `prompt` + `structured_prompt` together, or with
  `images` and no `prompt`, and `bria.image` refuses those combinations before
  the request is sent.
- `bria.imageLite` keeps the original nine ratios, published as
  `BRIA_LITE_ASPECT_RATIOS` / `BriaLiteAspectRatio`. If you send it one of the
  twelve new ratios, the error says which route accepts it.
- New `style` on `bria.image`: `kodak_film` | `hard_flash` | `hazy_dreamy` |
  `rough_realism` (`BRIA_STYLES`, `BriaStyle`). It is refused with
  `structured_prompt`, `images` or 4MP ("Returns 422 with `style_id`,
  `structured_prompt`, `images` or 4MP resolution."). `bria.imageLite` reports
  it as `unsupported_param`, and the lite type has `style?: never`. In
  `unmodel/image` it is a `bria/FIBO` extra.
- `bria.image` refuses `resolution: "4MP"` with `sync: true` ("A synchronous
  4MP request returns 422.").
- `bria.imageEdit` accepts 1 to 4 `images` ("**Accepts 1 to 4 images.**",
  `minItems: 1`, `maxItems: 4`; `BRIA_EDIT_IMAGES_MIN` / `BRIA_EDIT_IMAGES_MAX`).
  It used to require exactly one image, so it refused the spec's own 3-image
  example. A `mask` is refused on a multi-image edit ("**Only supported when
  `images` contains exactly one item.**").
- `bria.imageEdit` gains `aspect_ratio`, with the same 21 values as generate.
  When omitted, the output keeps the first image's ratio.

Not changed, pending a request with a key: the 2026-11-12 bundles no longer list
`model_version`, `negative_prompt` or `steps_num` on generate, or
`guidance_scale` on edit. Bria's Fibo 2 page says "Same API, nothing to change in
your code," so these fields stay typed with their earlier bounds.
