---
"unmodel": patch
---

luma: `ray-2` and `ray-flash-2` are marked deprecated, and the reframe routes publish their input limits

- `ray-2` and `ray-flash-2` now carry `status: "deprecated"`, so every
  `luma.video`, `luma.videoModify` and `luma.videoReframe` request on them (and
  `video({ model: "luma/ray-2" })`) validates with a `deprecated_model`
  warning. Luma's migration guide
  (https://docs.agents.lumalabs.ai/guides/videos/migration/) lists Ray 2 and
  Ray 2 Flash among its "retiring models", with no global date: each account
  gets its own deprecation notice, and "Legacy requests will continue to work
  during the notice period". Both ids stay in the catalog and keep validating.
  The replacement Luma names, `ray-3.2`, is on the separate Luma Agents API
  (`POST https://agents.lumalabs.ai/v1/generations`, another key and request
  shape), which unmodel does not cover yet. Photon is not affected.
- `luma.videoReframe.constraintsFor()` now returns the input limits from
  https://docs.lumalabs.ai/docs/reframe-video-image: `ray-2` accepts up to 10s
  and 100 MB, `ray-flash-2` up to 30s and 100 MB. The 30s is twice Modify
  Video's 15s for the same model.
  `luma.imageEditReframe.constraintsFor()` returns the 10 MB source limit for
  `photon-1` and `photon-flash-1`. The tables are exported as
  `videoReframeConstraints` and `imageEditReframeConstraints`, matching
  `videoModifyConstraints`. They are metadata only. A request carries a media
  URL that unmodel never fetches, so nothing is enforced and no request that
  validated before now fails.
