---
"unmodel": patch
---

revai: the `low_cost` and `fusion` transcribers are deprecated and unpriced, `speaker_channels_count` is accepted for Spanish and French, and `revai.stt` accepts `null` wherever Rev AI's OpenAPI does

- `low_cost` (Reverb Turbo) and `fusion` (Whisper Fusion) now carry
  `status: "deprecated"`, so `revai.stt` warns `deprecated_model` on them.
  Rev AI deprecated them on 2026-07-28 and 2026-08-20 ("This option is being
  sunset and will be removed in a future release"), recommending the default
  `machine` transcriber instead
  (https://docs.rev.ai/api/asynchronous/changelog). Both are still served,
  so both still validate.
- `low_cost` and `fusion` lose their cost. https://www.rev.ai/pricing no
  longer lists "Reverb turbo transcription" or "Whisper Fusion Transcription"
  (checked 2026-11-12; the last published rates, $0.10/hr and $0.005/min, are
  on the 2026-08-23 Wayback snapshot). English-language estimates for them
  now return no `costUSD`. Non-English jobs still estimate at the $0.30/hr
  foreign-language rate, because Rev AI ignores `transcriber` for
  non-English audio.
- `speaker_channels_count` is no longer refused for `language: "es"` or
  `"fr"`. Its own field description reads "Only available for English,
  Spanish and French languages", and the 2023-05-15 changelog entry
  documents "valid languages (en, es, fr)". Every other non-English language
  is still refused, and the error now names the five codes that are accepted.
- `null` is accepted, and treated as unset, on every job option
  `SubmitJobMediaUrlOptions` marks `nullable: true` (`transcriber`,
  `language`, `metadata`, `source_config`, `notification_config`, the
  boolean flags, `summarization_config`, `translation_config` and their
  nested `model`/`type`, `auth_headers`, …). Before, these failed with
  `invalid_shape`. `JobsBody` gains `| null` on the same fields. `verbatim`,
  `custom_vocabularies`, `strict_custom_vocabulary` and `media_url` are not
  nullable in the OpenAPI, so they still refuse `null`
  (https://docs.rev.ai/_bundle/api/asynchronous/reference.yaml).
- The `revai.stt` docs now say which add-ons the estimate leaves out: forced
  alignment, summarization and translation, which Rev AI bills per minute,
  in addition to the human rush and verbatim add-ons.
