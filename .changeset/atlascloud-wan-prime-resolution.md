---
"unmodel": patch
---

atlascloud: Wan 3.0 prime `resolution` follows Atlas's current schema

Both Wan 3.0 prime documents (`alibaba/wan-3.0-prime/text-to-video` and
`/image-to-video`) now publish the same lower-case list Wan 3.0 does: "Output
resolution. Native tiers: 480p, 720p, 1080p. ESR tiers: 720p-esr, 1080p-esr,
1440p-esr, 4k-esr." (read 2026-09-30, the drift the weekly Atlas audit has been
reporting in #7).

- `atlascloud.video` accepts `1080p` and the `-esr` ladder on the prime rows and
  refuses the old `1080P` / `720P` / `480P` spelling, which the schema no longer
  lists. `WAN_PRIME_RESOLUTIONS` and `AtlasWanPrimeResolution` change with it.
- `unmodel/video` compiles canonical `1080p` to `1080p` on the prime rows, and
  now reaches `1440p` and `4k` there through `1440p-esr` / `4k-esr`, as it
  already did on Wan 3.0.
- The two committed snapshots under `data/atlascloud/openapi/` are refreshed.
  The Seedance 2.5 drift in the same audit (a new `draft` field) is not part of
  this change.
