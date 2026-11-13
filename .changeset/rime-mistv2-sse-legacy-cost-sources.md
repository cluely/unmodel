---
"unmodel": patch
---

rime: Mist v2 server-sent events pass, Mist v2 and Mist v1 lose their unsourced cost, and the legacy checks cite a live page

Every fact below comes from Rime's docs and pricing page, checked 2026-11-12
and 2026-11-13.

- **`accept: "text/event-stream"` passes on `mistv2` with a warning.** Before
  this change, `rime.tts` refused it with an `invalid_enum_value` error.
  Rime still serves it:
  https://docs.rime.ai/docs/migrate-legacy-mist says "Server-sent events
  (`Accept: text/event-stream`) are Mist v2 only. Before December 3, move them
  to HTTP streaming or the Mist v3 WebSocket." The warning is
  `invalid_enum_value` with `meta.retires: "2026-12-03"` and cites that page.
  `RimeTtsParams.accept` now types the value, and `unmodel/rime` exports it
  as `MIST_V2_SSE_ACCEPT`. Every other id, including `mist`, still refuses it,
  and the error now says that server-sent events are `mistv2` only. The
  constant goes away with the `mistv2` row once it retires on 2026-12-03.
- **`rime.tts` no longer estimates cost for `mistv2` or `mist`, and
  `maxCostUSD` no longer applies to them.** Both rows carried
  `perMillionCharacters: 30`, quoting a "$0.03 / 1K characters" Starter rate
  that https://www.rime.ai/pricing no longer shows. The page lists only Mist
  v3 and Coda v2 for TTS, so no Mist v2 or Mist v1 rate exists to quote. `coda`
  and `mistv3` keep $50/1M and $30/1M characters. Those figures are now
  re-sourced to the per-minute Flex rates ("$0.050 / min" and
  "$0.030 / min") through Rime's own "about 1,000 characters per minute"
  conversion, which is approximate.
- **The legacy checks cite a page that still exists.** Rime's Mist v2 HTTP
  reference (https://docs.rime.ai/api-reference/mistv2/http) now redirects
  to the Mist v3 page. The `meta.source` of the `mistv2`/`mist` samplingRate
  check (4000–44100 Hz) and of the three-format Accept check is now
  https://docs.rime.ai/docs/migrate-legacy-mist, and both messages say the
  values were last verified 2026-08-13. The Coda `noTextNormalization`
  refusal now cites https://docs.rime.ai/docs/models. Severities are
  unchanged.
