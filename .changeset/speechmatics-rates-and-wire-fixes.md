---
"unmodel": patch
---

speechmatics: list rates corrected, and three requests the API accepts are no longer refused

Rates (https://www.speechmatics.com/pricing.md, "Speech-to-text list rates
(USD per hour)", read 2026-11-12 — the HTML /pricing page renders
discounted rates and is no longer the source):

- Batch, used by `costUSD` estimates and `checkJob`: Enhanced $0.40 → $0.75/hr
  ("| Pre-recorded | Enhanced | 0.75 | — |"), Standard $0.24 → $0.45/hr
  ("| Pre-recorded | Standard | 0.45 | — |"), Melia 1 $0.129 → $0.24/hr
  ("| Pre-recorded | Melia 1 | 0.24 | — |").
- Realtime constants: `REALTIME_STANDARD_USD_PER_MINUTE` now $0.45/hr
  ("| Real-time | Standard | 0.45 | — |"), `REALTIME_ENHANCED_USD_PER_MINUTE`
  $0.80/hr ("| Real-time | Enhanced | 0.8 | — |"). New
  `REALTIME_MELIA_USD_PER_MINUTE` ($0.40/hr, "| Real-time | Melia 1 | 0.4 | — |")
  and `REALTIME_OAK_USD_PER_MINUTE` ($0.46/hr, "| Real-time | Oak 1 | 0.46 | — |"):
  Melia 1 and Oak 1 now run on Realtime too.
- `MELIA_REGIONS` is `["eu1", "us1", "au1"]` and covers Oak 1: "The Melia 1 and
  Oak 1 models are available on the EU1, US1, and AU1 endpoints only"
  (https://docs.speechmatics.com/get-started/authentication.md).

Requests that were refused and now validate:

- `transcription_config.output_locale` takes an array on both layers —
  "`output_locale` also accepts an array of locales, one per language present
  in the audio" (https://docs.speechmatics.com/speech-to-text/formatting.md;
  the API reference and the SDKs still type it `string`). Two locales of one
  language (`["en-GB", "en-US"]`) are refused, as upstream does: "Passing two
  locales for the same language, for example `en-GB` and `en-US` together, is
  rejected."
- `unmodel/stt` accepts `domain: "bilingual-en"` on `speechmatics/standard`:
  the Spanish and English pack is `{"language": "es", "domain": "bilingual-en"}`
  and the packs are for "The Enhanced and Standard models"
  (https://docs.speechmatics.com/speech-to-text/languages.md).
  `domain: "medical"` stays Enhanced's.
- `SpeechmaticsTranscriptionConfig` types `language_hints_strict`,
  `entities_config.detect_advanced_entities`, `enable_redaction` and
  `redaction_config.entity_classes` (new `SpeechmaticsEntitiesConfig` /
  `SpeechmaticsRedactionConfig`), all documented at
  https://docs.speechmatics.com/api-ref/batch/create-a-new-job.md; `ExactKeys`
  rejected them at compile time. From `unmodel/stt` they ride
  `providerOptions.speechmatics`.
