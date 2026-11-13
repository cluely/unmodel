---
"unmodel": patch
---

kling: Omni Element cap, `kling-v2-6` durations, and the path-addressed family's provenance

- **`kling.videoOmni` no longer refuses 4–7 Elements on `kling-3.0-omni` and
  `kling-o1`.** Both pages allow up to 7 — "When there is no reference
  video+only multi-image element, the sum of the number of reference pictures
  and multi-image element shall not exceed 7."
  (https://kling.ai/document-api/api/video/3-0-omni/video-omni) and "No reference
  video: reference images + Elements ≤ 7." (/api/video/o1/video-omni), read
  2026-11-12 — where the validator capped every omni model at 3. The tighter
  cases depend on whether an Element is a video-character one, which an
  `element_id` does not reveal, so 7 is the checked ceiling (`OMNI_MAX_ELEMENTS`).
- **`kling-v2-6` on `kling.video` / `kling.videoFromImage` runs 5s or 10s**, as
  its capability-map row now reads (`generationRange:{en:"5s, 10s"}`,
  https://kling.ai/document-api/guides/capability-map/video) and as the 2.6
  path-addressed routes enumerate. Any other `duration` is refused, and the
  unified `kling/kling-v2-6` row's `durations` is `[5, 10]`.
- The module notes on `kling.videoV3` / `kling.videoV3FromImage` /
  `kling.videoOmni` no longer claim the route family is uncorroborated: without
  credentials the API host answers `POST /text-to-video/kling-4.0`,
  `/omni-video/kling-4.0` and `GET /tasks` with the new API's auth error (HTTP 401,
  code 1002) where an unknown path answers 404. Each model's path is still
  doc-only, and the exports keep their EXPERIMENTAL label. The notes also record
  that `POST /v1/videos/omni-video` (`kling-video-o1`, `kling-v3-omni`) is
  documented (https://kling.ai/document-api/api/video/3-0-omni/video-omni/legacy)
  but not validated here, and that `PROMPT_MAX_CHARS` (3072) is the 3.0 / 3.0
  Turbo text-to-video cap.
