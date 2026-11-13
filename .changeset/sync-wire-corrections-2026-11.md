---
"unmodel": patch
---

sync.: `sync.lipsync` and `sync.avatar` re-verified against sync.'s curated OpenAPI document, reference pages and `@sync.so/sdk@0.4.0` (2026-11-12) — requests the API accepts are no longer refused

- **Dubbing languages.** `dubParams.targetLang` takes 110 codes and
  `sourceLang` 111: the 17 regional variants (`ar-EG`, `yue`, `zh-TW`, `dgo`,
  `en-AU`, `en-CA`, `en-GB`, `en-US`, `fr-CA`, `fr-FR`, `cmn`, `pt-BR`,
  `pt-PT`, `es-AR`, `es-CL`, `es-ES`, `es-MX`) were refused as
  `invalid_shape`. `dubParams` also types `cloningStrength` (integer 1–10),
  `startTime` and `endTime`; a range whose `endTime` is not after `startTime`
  is refused, as sync. answers 422 `generation_input_trim_invalid`.
- **Segments.** `startTime`, `endTime` and `audioInput` are optional;
  `startFrame` / `endFrame` and `lipsync` are typed. A `lipsync: false`
  segment needs no `audioInput`, frame-bounded segments validate, and the
  rules from https://sync.so/docs/developer-guides/segments are checked: a
  lipsynced segment needs an `audioInput`, at least one segment must be
  lipsynced, and `startFrame` must be strictly less than `endFrame`.
- **`outputAudio`** (one audio input played over the whole output) is typed
  and checked: it needs `segments`, its `refId` must name an `audio` input,
  and a `lipsync: false` segment with several audio inputs needs it.
- **`dialogueEdit`** (`{ id }` of a completed `POST /v2/dialogue-edits` job) is
  typed. A request with it and one video input is no longer refused for
  having no voice input; adding a voice input, `segments` or `dubParams` is
  refused, per https://sync.so/docs/developer-guides/dialogue-editing.
- **Options.** All fifteen `GenerationOptions` fields the curated spec and the
  SDK declare are typed: `reasoning_enabled` (gated to `lipsync-2-pro` —
  a warning elsewhere, and a `lipsync-2-pro` extra at `unmodel/lipsync`),
  `refinement_enabled`, `blending_mode` (`SYNC_BLENDING_MODES`),
  `face_boxes_url`, `prompt_image_uris`, `i2v_prompt` and the deprecated
  `output_format` (`SYNC_OUTPUT_FORMATS`), `fps` and `output_resolution`; plus
  `active_speaker_detection.face_image`. `options.prompt` is a `string` on the
  wire, so a `react-1` emotion outside the six documented ones is a warning
  instead of a refusal.
- **Error catalog.** `SYNC_ERROR_CODES` has the 135 codes `GET
  https://api.sync.so/v2/errors` serves (73 added, none removed).
- **Estimate endpoint.** `ESTIMATE_COST_URL` is `POST
  https://api.sync.so/v2/generations/estimate`, the documented quote, which
  takes `{ model, duration, fps?, workflow?, reasoningEnabled? }` rather than
  the generation body.
- **Docs.** The webhook payload carries `errorCode` (not `error_code`);
  `include=progress` adds a `progress` object; generation creation is bounded
  by plan concurrency (Free 1, Hobbyist 3, Creator 10, Growth 20, Scale 50)
  rather than a request rate; lip-sync is billed per output frame, so the
  25-fps per-second rates under-state a 30 fps output by 20%.

Removed, with their replacements:

- `ANALYZE_COST_URL` (`POST /v2/analyze/cost`, no longer documented) →
  `ESTIMATE_COST_URL`.
- `SYNC_RATE_LIMITS` (`{ create: 100, poll: 600 }`, no longer published on
  https://sync.so/docs/api-reference/guides/rate-limits) → none; the plan
  concurrency figures are documented on `unmodel/sync`.
