---
"unmodel": minor
---

Accept `background: "transparent"` on `gpt-image-2` and `gpt-image-2-2026-04-21`,
on both `openai.image` and `openai.imageEdit` and through the `unmodel/image` /
`unmodel/image-edit` packs. OpenAI shipped transparent-background support for
these models in preview (images/create and createEdit references, checked
2026-08-31), so the per-model arms regain the `transparent` value, the
constraint enum widens, and the recorded 400 fixtures that pinned the old
refusal are retired. Retired compile errors: `background: "transparent"` on a
gpt-image-2 generation or edit no longer errors.

Both image routes also gain the documented `transparent`↔`output_format`
coupling check: `background: "transparent"` with `output_format: "jpeg"` is
rejected before send on every GPT image model — jpeg has no alpha channel; use
`png` (the default) or `webp`.

The README hero and docs champion example move from the retired gpt-image-2
transparent 400 to Sora's size matrix: `openai@7.4.0` types `size` with one
closed `VideoSize` union for every model, refusing the 1920x1080 (and 16/20s
durations) that sora-2-pro documents and prices while compiling 1024p sizes
sora-2 cannot render. unmodel's per-model arms carry the documented matrix,
and the SDK-side claims are pinned in type tests so an SDK fix fails loudly.
