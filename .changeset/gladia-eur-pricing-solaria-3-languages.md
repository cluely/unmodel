---
"unmodel": patch
---

gladia: no USD cost for Gladia models (they are priced in EUR only now), and `solaria-3` stops refusing language setups Gladia documents

- **Cost removed from `solaria-1` and `solaria-3`.** www.gladia.io/pricing
  (and its plain-text copy www.gladia.io/pricing.md, "Last updated:
  2026-11-03", "Currency: EUR") now lists EUR rates only: Solaria-1 0.27€/hr,
  Solaria-3 0.16€/hr and real-time 0.68€/hr, with automatic volume discounts,
  on a prepaid wallet. It no longer shows a USD rate. The catalog used the old
  "Async at $0.61 /hr" for both models, so it was wrong on two counts: the
  currency, and that the two models no longer cost the same. Converting to
  USD would mean guessing an exchange rate, so the rows carry no `cost`.
  `gladia.stt` estimates and `checkPreRecorded` reports therefore have no
  `costUSD`, and `maxCostUSD` has nothing to enforce for Gladia.
- **Removed: the `REALTIME_USD_PER_MINUTE` export of `unmodel/gladia`** (the
  old "Real-time at $0.75 /hr"). There is no replacement. Gladia's only
  real-time rate is in EUR (0.68€/hr), and unmodel does not validate the live
  WebSocket API.
- **`solaria-3` with no language, or with several, is now a warning, not an
  error.** Gladia's endpoint page says "pass exactly one language", but the
  Models page (docs.gladia.io/chapters/introduction/models) says you can pass
  "several from EN/FR/DE/ES/IT so the model can pick among those covered
  languages". The OpenAPI (api.gladia.io/openapi.json) puts no per-model
  limit on the array, and www.gladia.io/solaria-3 lists auto language
  detection as Supported. The warning names the one-language form that every
  page accepts.
- **`solaria-3` now checks every entry in `language_config.languages`
  against its five languages (en, fr, de, es, it), not only the first.** So
  `["en", "ja"]` is refused at `language_config.languages.1`, and the error
  names `"ja"`. Through `unmodel/stt`, that error is reported at `languages`.
- **`solaria-3` with `code_switching: true` and exactly one language is now
  a warning.** The OpenAPI says "If one language is set, this option will be
  ignored." With no language or several, it is still refused.
