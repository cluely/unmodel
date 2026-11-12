---
"unmodel": patch
---

atlascloud: Seedance 2.5 `draft`

All three Seedance 2.5 documents on Atlas (`bytedance/seedance-2.5/text-to-video`,
`/image-to-video` and `/reference-to-video`) now declare a `draft` boolean:
"Generate a draft preview at 480p, overriding resolution. The response carries a
draft_id for completing the draft at 1080p with bytedance/seedance-2.5/draft-complete
within seven days. A draft is billed as a normal 480p render." (read 2026-09-30,
the Seedance half of the drift the weekly Atlas audit reports in #7).

- `atlascloud.video` types and validates `draft` on the 2.5 rows instead of
  passing it through with an `unknown_param` warning, and refuses it by name on
  every other Atlas video model.
- It is listed in the 2.5 rows' `extras` in `VIDEO_MODEL_PARAMS`, beside
  `output_format`.
- The three committed Seedance 2.5 snapshots under `data/atlascloud/openapi/`
  are refreshed. `draft-complete` itself is not a curated model.
