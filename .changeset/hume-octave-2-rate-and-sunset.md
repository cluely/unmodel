---
"unmodel": patch
---

hume: `hume/octave-2` is priced at its own rate, and every Hume row is flagged deprecated: Hume retired its TTS API on 2026-11-13

- `hume/octave-2` now prices at $75 per 1M characters, down from $150.
  Hume's pricing page has an Octave 1 view and an Octave 2 view, and the
  Octave 2 Creator cell reads "$0.075/1,000" beside the note "In Octave 2,
  characters are metered at half rate". `hume/octave`, and a `hume.tts`
  request that omits `version`, still price at Octave 1's $0.15/1,000, so the
  estimate for an omitted `version` remains an upper bound. Source: the
  archived https://www.hume.ai/pricing
  (https://web.archive.org/web/20260930030232/https://www.hume.ai/pricing; the
  2026-07-12 and 2026-09-01 captures show the same cells).
- `hume/octave`, `hume/octave-2` and `hume/voice-conversion` are now
  `status: "deprecated"`, so every `hume.tts` and `hume.sts` request (and
  `tts()` / `sts()` from `unmodel/tts` and `unmodel/sts` aimed at `hume/…`)
  returns a `deprecated_model` warning. Hume's changelog says: "Hume is
  sunsetting the TTS and EVI APIs. Access ends November 13, 2026 at 12:01
  a.m. EST, and both APIs remain fully supported until then. Any data in your
  account is permanently deleted after November 13, 2026."
  (https://web.archive.org/web/20261003165626/https://dev.hume.ai/changelog).
  The cutoff has passed. Probed on 2026-11-13, `POST /v0/tts`,
  `/v0/tts/file` and `/v0/tts/voice_conversion/file` and
  `GET /v0/tts/voices` all answer 404 with
  `sunset: Fri, 13 Nov 2026 05:01:00 GMT` and the body "This API was retired
  on 2026-11-13 and is no longer available." Voice conversion is retired with
  the rest. Nothing is removed in this release and every id still validates,
  so a `hume.tts` or `hume.sts` request that passes unmodel is one Hume now
  refuses.
