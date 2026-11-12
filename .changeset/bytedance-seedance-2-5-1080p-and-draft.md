---
"unmodel": patch
---

bytedance: Dreamina Seedance 2.5 takes 1080p and draft mode on `bytedance.video`, plus pricing and doc corrections, verified 2026-11-12

- `resolution: "1080p"` is accepted on `dreamina-seedance-2-5-260628` (typed, validated, and offered by `unmodel/video`); it was refused although the API reference says "Dreamina Seedance 2.5: Default `720p`; supports `480p`, `720p`, and `1080p`." It prices at $0.569 per second ("$2.843 per video · $0.569 per second", 16:9, no input video).
- Draft mode works on Dreamina Seedance 2.5: `draft: true` (480p only) and the final video from a `{ type: "draft_task" }` content item were both refused. A final video must set `resolution: "1080p"`, omit `draft`, and send nothing the draft fixed — the validator refuses re-sent prompt or media items, `duration`, `ratio`, `generate_audio` and `omni_reference_task_type` ("An error occurs even if their values match those used in the Draft task."). The type takes `content: ArkOmniContent[] | [ArkDraftTaskContent]`. `draft` is still denied on the 2.0 series and Seedance 1.0, now naming Dreamina Seedance 2.5.
- `VideoPricingFields.draft` prices a Dreamina Seedance 2.5 draft as an ordinary 480p video when `resolution` is omitted ("The token consumption and token rate are the same as normal 480p videos.").
- `VideoShapeRule` gains `supportsDraft`; `VIDEO_DRAFT_SOURCE` is exported.
- Docs: `return_last_frame` returns a jpeg (not a PNG) at the video's pixel dimensions without watermark; draft task ids created from 10:00 UTC+8 on 2026-10-28 stay valid 14 days (others 7); the Seedream 5.0 pro tier boundary (2.61 million pixels) is now cited from the Pricing page instead of being flagged unverified; the long-ended Seedance 2.0 fast / mini limited-time discount notes are gone (list prices unchanged).

Sources: https://docs.byteplus.com/docs/en/modelark/create-video-generation-task-api.md, https://docs.byteplus.com/docs/en/modelark/seedance-2-5.md, https://docs.byteplus.com/docs/en/modelark/model-pricing.md, https://docs.byteplus.com/docs/en/modelark/model-list.md, https://docs.byteplus.com/docs/en/modelark/seedance-2-0-mini-fast-limited-time-discount.md.
