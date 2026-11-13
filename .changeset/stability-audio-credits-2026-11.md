---
"unmodel": patch
---

stability: Stable Audio 2.5 and 3.0 now cost 8 credits ($0.08) per generation

- `stableAudioCredits("stable-audio-2.5")` returns 8 (was 20), and
  `stability.music` / `stability.musicFromAudio` with
  `model: "stable-audio-2.5"` and `stability.musicInpaint` estimate
  `costUSD` 0.08 instead of 0.20. Stability's v2beta spec
  (https://api.stability.ai/v2alpha/openapi) now says "Requests made using the
  Stable Audio 2.5 model have a flat rate of 8 credits per successful result.",
  and https://docs.stability.ai/pricing lists Stable Audio 2.5 at 8.
- `stableAudioCredits("stable-audio-3")` returns 8 (was 26): "`stable-audio-3`
  requires 8 credits per generation" (same spec), and the pricing page lists
  Stable Audio 3.0 at 8.
- `stable-audio-2` is unchanged: `credits = 17 + 0.06 * steps`, 20 credits
  ($0.20) at its default 50 steps.
- The `stable-audio-3` catalog row gains `limit.characters: 10000`, the
  `"AudioPrompt"` cap its routes share with the 2.x ones.
- `stability`'s `provider.doc` is now https://docs.stability.ai/api-reference,
  where Stability's API reference moved; the pricing source is
  https://docs.stability.ai/pricing.

Verified 2026-11-12. The archive dates the price change to between 2026-09-11
(the spec still said 20 and 26) and 2026-10-19 (the pricing page already said 8).
