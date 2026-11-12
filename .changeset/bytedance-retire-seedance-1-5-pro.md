---
"unmodel": patch
---

bytedance: retire Seedance 1.5 pro (`seedance-1-5-pro-251215`) from `bytedance.video`

BytePlus shut the model down after 17:00 UTC+8 on 2026-11-11 with no automatic migration ("The seedance-1-5-pro-251215 model will be shut down after 17:00 on November 11, 2026 (UTC+8) and will not be automatically migrated to a new model."), and it is gone from the ModelArk Model list and Pricing tables. The recommended replacement is `dreamina-seedance-2-0-mini-260615`.

- Removed: the `seedance-1-5-pro-251215` catalog row, its shape rules and constraint table, its pricing rows, its `unmodel/video` row (`VIDEO_MODELS` / `VIDEO_MODEL_PARAMS` on `unmodel/bytedance/values`), and the `Seedance15ProBody` type. A request naming the id now validates with an `unknown_model` warning and no cost estimate.
- `VideoPricingFields` drops `generateAudio` and `draft`, and `videoUsdPerSecond` drops the silent-halving and draft-factor arithmetic: both priced Seedance 1.5 pro only.
- The draft-mode refusals of `return_last_frame` and `service_tier: "flex"` are gone with it; they were documented for this model alone. `draft: true` still requires 480p.
- Deny and range messages for `seed`, `camera_fixed`, `generate_audio` and `duration: -1` now name the models that still take them.

Atlas Cloud's `bytedance/seedance-v1.5-pro/*` routes on `atlascloud.video` are a different host and are unaffected.

Source: https://docs.byteplus.com/docs/en/modelark/model-deprecation-notice.md (retrieved 2026-11-12).
