---
"unmodel": major
---

atlascloud: retire the Seedance v1.5 pro family — Atlas removed it from its catalog

Atlas removed `bytedance/seedance-v1.5-pro/text-to-video`, `bytedance/seedance-v1.5-pro/image-to-video`,
`bytedance/seedance-v1.5-pro/text-to-video-fast` and `bytedance/seedance-v1.5-pro/image-to-video-fast`
from the keyless catalog (`GET https://api.atlascloud.ai/api/v1/models`), which the weekly drift audit
(`bun run audit:atlascloud`, cluely/unmodel#7) reported as four gone models. They are gone from the
catalog — the repo's source of truth for what Atlas serves — so the package can no longer offer them;
the family is retired, not kept as a stale table. The curated roster is 27 ids (was 31).

Retired names (listed here and nowhere else, per the repo's retirement rule):

- Wire bodies: `Seedance15ProTextToVideoBody`, `Seedance15ProImageToVideoBody`,
  `Seedance15ProTextToVideoFastBody`, `Seedance15ProImageToVideoFastBody`
- Types: `AtlasSeedance15AspectRatio`, `AtlasSeedance15Resolution`, `AtlasSeedance15FastResolution`
- Constants: `SEEDANCE_15_ASPECT_RATIOS`, `SEEDANCE_15_RESOLUTIONS`, `SEEDANCE_15_FAST_RESOLUTIONS`
- `camera_fixed` is accepted by no model now; passing it is still a typed refusal.

`checkDuration` no longer has a range branch: every remaining model publishes a duration enum, so the
bounds-only path the v1.5-pro family alone used is gone with it.
