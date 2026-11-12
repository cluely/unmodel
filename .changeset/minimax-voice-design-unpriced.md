---
"unmodel": patch
---

minimax: `voiceDesign` no longer estimates a preview cost

MiniMax now publishes two different preview rates for POST /v1/voice_design:
the voice-design API reference says "Generating preview audio incurs a fee of
$30 per 1M characters.", while the pricing overview says "In-API preview
synthesis is billed at $60 / M characters." (both read 2026-11-12). With the
vendor's own pages in contradiction there is no defensible number, so the
`voice-design` catalog row carries no `cost` and `minimax.voiceDesign` (and
`unmodel/voice-design` on `minimax/voice-design`) returns an `undefined`
`estimate.costUSD` instead of the $30 figure.

The pricing page's "$3 per voice" for design and "$1.5 per voice" for cloning
are "Charged when the designed voice is first used for synthesis" / "when the
cloned voice is first used for synthesis" — a later synthesis's cost, not the
design or clone request's, so neither is estimated on these routes either.

- Removed: `VOICE_DESIGN_PREVIEW_PER_MILLION_CHARACTERS` from `unmodel/minimax`
  (it held the $30 rate). There is no replacement; read the two sources above.

Sources: https://platform.minimax.io/docs/api-reference/voice-design-design,
https://platform.minimax.io/docs/pricing/overview (2026-11-12).
