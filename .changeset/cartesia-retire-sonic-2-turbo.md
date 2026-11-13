---
"unmodel": patch
---

cartesia: retire the Sonic 2, Sonic Turbo and first Sonic 3 snapshot ids that Cartesia sunset after 2026-10-20

Removed from the catalog, from `cartesia.tts` / `cartesia.ttsWebsocket`
`model_id` completions and from `CartesiaTtsModelId`:

- `sonic-2`, `sonic-2-2025-06-11`, `sonic-2-2025-05-08`, `sonic-2-2025-04-16`
  — "sonic-2 and all sonic-2-* snapshots will stop working after October 20,
  2026." Use `sonic-3.6`.
- `sonic-turbo`, `sonic-turbo-2025-06-04` — "sonic-turbo and all
  sonic-turbo-* snapshots will stop working after October 20, 2026." Use
  `sonic-3.6`.
- `sonic-3-2025-10-27` — "`sonic-3` | `sonic-3-2025-10-27` | October 20,
  2026" on the sunset table. Use `sonic-3-2026-01-12` (or `sonic-3.6`).

Sources: https://docs.cartesia.ai/build-with-cartesia/tts-models/older-models
and https://docs.cartesia.ai/build-with-cartesia/tts-models/api-changes
("Requests to sunsetted models will return an error.", `"error_code":
"model_sunsetted"`), both read 2026-11-12. A retired id now validates with an
`unknown_model` warning rather than `deprecated_model`; nothing that validated
before is refused.

`ttsConstraints` is now empty: its only rules denied `pronunciation_dict_id`
on `sonic-2` and `sonic-turbo`, and every remaining sonic id is Sonic 3 or
later.
