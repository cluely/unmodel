---
"unmodel": patch
---

speechmatics: five documented rejections are now refused, and two refusals no page backs are now warnings

New refusals in `speechmatics.stt` (and so in `unmodel/stt`):

- `transcription_config.output_locale` beside `language: "auto"`: "Output
  Locale is currently not supported in combination with using Automatic
  Language Identification. Jobs with this combination of features will be
  rejected." (https://docs.speechmatics.com/speech-to-text/batch/language-identification.md,
  2026-11-12). On `unmodel/stt` an omitted `language` compiles to `"auto"`, so
  `output_locale` now needs a `language`.
- `transcription_config.additional_vocab` above 20,000 entries (new
  `MAX_ADDITIONAL_VOCAB_ITEMS`): "If a job's custom dictionary
  (`additional_vocab`) contains more than 20,000 items, the job is rejected
  with an `HTTP 400 Bad Request`" (https://docs.speechmatics.com/speech-to-text/batch/limits.md).
- Redaction pairing, from https://docs.speechmatics.com/api-ref/batch/create-a-new-job.md:
  `enable_redaction: true` without `redaction_config.entity_classes` ("Must be
  set together with `redaction_config.entity_classes`"); `enable_redaction`
  with `enable_entities: true` but no `entities_config.detect_advanced_entities: true`
  ("If `enable_entities` is true, `entities_config.detect_advanced_entities`
  must also be true"); and a repeated `entity_classes` item ("unique items").
  `detect_advanced_entities` without `enable_entities: true` ("Must be set
  together with `enable_entities: true`") is a warning: no rejection is
  documented, and redaction "can be used on its own" without `enable_entities`.

Refusals relaxed to warnings on `melia-1` and `oak-1`:

- `enable_entities` is sent with a warning carrying `meta.contradictedBy`. The
  models page says Melia 1 and Oak 1 "do not yet support" entity detection, while
  https://www.speechmatics.com/pricing.md lists "| Entity detection |
  Pre-recorded | On request | Melia 1, Oak 1 |". `unmodel/stt` now offers
  `enable_entities` on both models.
- A single language code such as `language: "en"` is a warning. The docs say
  "Set `language` to `multi`" and name `auto` as the value that "returns an
  error" (https://docs.speechmatics.com/speech-to-text/models.md). The
  languages page lists what these models do not support as "the `auto` option,
  the bilingual and multi-language pack codes, or translation", so `auto` and
  the pack codes (`ar_en`, `en_ms`, `cmn_en`, `cmn_en_ms_ta`) are still
  refused.
