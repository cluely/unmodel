---
"unmodel": patch
---

bria: published per-image prices for Fibo, Fibo Lite and Fibo Edit

The cost estimates for the three Bria rows in `unmodel/bria` now use the
current API price list (https://bria.ai/pricing, read 2026-11-12):

- `FIBO` (`bria.image`, `bria/FIBO`): $0.03 → **$0.032** per image ("Fibo |
  $0.032 / Image").
- `FIBO-lite` (`bria.imageLite`, `bria/FIBO-lite`): $0.02 → **$0.0288** per
  image ("Fibo Lite | $0.0288 / Image").
- `FIBO-edit` (`bria.imageEdit`): $0.03 → **$0.032** per image ("Fibo Edit |
  $0.032 / Image").
- `BRIA_STRUCTURED_PROMPT_COST_USD` stays at $0.02 per call ("Fibo Structured
  Prompt | $0.02 / Call").

`maxCostUSD` budgets and `estimate.costUSD` on these routes change with the
new rates. Comment-only fixes: the catalog header now lists the correct
editing-route paths (`/v2/image/edit/erase` and the like, not `/v2/erase`). It
also names `/v2/structured_instruction/generate` and `replace_background`'s
`mode: "fibo2"` as not modeled, and links the Markdown references
(`docs.bria.ai/image-generation.md`, `docs.bria.ai/image-editing.md`), because
the rendered pages have no parameter text in their static HTML.
