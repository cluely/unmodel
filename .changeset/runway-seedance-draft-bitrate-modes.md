---
"unmodel": patch
---

runway: seedance `bitrate`, `draft` and `draftTaskId` are typed, and the seedance2_5 / hailuo3 input rules are enforced

Read against Runway's OpenAPI document, `guides/models.md`,
`guides/pricing.md` and `assets/inputs.md` on 2026-11-12.

- **Typed and validated** (they used to pass as unknown params, and a typed
  call refused them at compile time):
  - `bitrate: "standard" | "high"` on `seedance2` / `_fast` / `_mini`, on
    all three video routes. It does not change the price.
  - `draft: boolean` on `seedance2_5`, on all three routes. A draft bills at
    the 480p rate (20 credits/s, 80-credit minimum) whatever its `ratio`, and
    `outputFormat: "mov"` is refused beside `draft: true`.
  - `draftTaskId` (a UUID v4) on `seedance2_5` text-to-video. An enhance
    request sends `model` and `draftTaskId` only. Every other generation
    field is refused beside it (`promptText`, `ratio`, `duration`, `seed`,
    `audio`, the three reference arrays, `draft`, `outputFormat`), and it
    gets no estimate because the preview's duration is not in the request.
  - Every other arm refuses all three fields as `unsupported_param`.
- **Now refused** (the API rejects these requests):
  - `seedance2_5` video-to-video `mode: "extend"` / `"edit"` without
    `promptText`, or with a `ratio`.
  - `mode: "edit"` with any `duration` other than `"auto"`. An omitted
    duration counts as the documented default of 5, so it is refused too.
  - On image-to-video, a `promptImage` array that mixes keyframes (with
    `position`) and references (without) on `seedance2` / `_fast` / `_mini`
    / `seedance2_5` and `hailuo3`, as on wan3.
- **Sizes and prices**:
  - `seedance2_fast` / `seedance2_mini` serve 480p and 720p only. Their
    `VIDEO_MODEL_PARAMS` row no longer lists `1080p`, so `unmodel/video`
    refuses it instead of sending the 720p `960:960` square.
  - `480p` at `1:1` now compiles to `640:640` instead of being refused.
  - The twelve small sizes split six and six into 480p and 720p
    (`SEEDANCE2_SMALL_RATIOS_BY_TIER`). `seedance2` bills its 480p sizes at
    14 credits/s, `seedance2_fast` at 11 and `seedance2_mini` at 7, rather
    than at the 720p rate.
