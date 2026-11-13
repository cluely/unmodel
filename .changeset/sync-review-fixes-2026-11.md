---
"unmodel": patch
---

sync.: the documented count ceilings, `react-1`'s missing features and the `Idempotency-Key` header, verified against https://sync.so/docs (2026-11-12)

- **Count ceilings.** A generation over 101 `input` items or 100 `segments`
  is refused (`invalid_shape` at `input` / `segments`, naming the limit), as
  sync. answers 400 — "A generation can have up to 100 segments and up to 101
  inputs" (/developer-guides/segments). `SYNC_MAX_INPUTS` and
  `SYNC_MAX_SEGMENTS` publish the two numbers.
- **`react-1` takes no speaker selection and no segments**
  (https://sync.so/docs/models/react). `sync.lipsync` now warns
  (`unknown_param`) on `options.active_speaker_detection` and on `segments`
  at `react-1`. The page does not say whether sync. ignores them or rejects
  the request, so this is a warning rather than a refusal. At
  `unmodel/lipsync`, the `sync/react-1` row no longer offers
  `active_speaker_detection` or `segments`, so both are refused there as
  `unsupported_param`. `SYNC_ACTIVE_SPEAKER_MODELS` and
  `SYNC_SEGMENT_MODELS` publish the gate as data, from `unmodel/sync` and
  `unmodel/sync/values`.
- **`Idempotency-Key`.** `SYNC_IDEMPOTENCY_HEADER` and
  `SYNC_IDEMPOTENCY_KEY_PATTERN` (`/^[A-Za-z0-9._~-]{1,128}$/`) document the
  optional retry header on `POST /v2/generate`. Without it, sync. answers 409
  `DUPLICATE_SUBMISSION` to an identical request sent within 60 seconds.
  It is a header, not a body field, so you add it to `fetch` yourself;
  unmodel never writes it.
