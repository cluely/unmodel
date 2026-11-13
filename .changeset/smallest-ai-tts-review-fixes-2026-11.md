---
"unmodel": patch
---

smallest-ai: refuse whitespace-only `text`, flag off-checkpoint languages on `lightning_v3.1_pro_10_26`, warn on `word_timestamps` for every model

Facts read from the endpoint reference
(https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech)
and the Pro model card
(https://docs.smallest.ai/model-cards/text-to-speech/lightning-v-3-1-pro),
2026-11-12 and 2026-11-13.

- **`smallest-ai.tts` now refuses whitespace-only `text`.** The reference
  (sync and SSE) says "Max 8000 characters after trim; whitespace-only strings
  are rejected." Until now `"   "` validated and drew the API's 400. A `text`
  that is empty after `trim()` is now `invalid_shape` at `["text"]`. The body
  is still sent untrimmed.
- **A `language` other than `en`, `es` or `hi` on `lightning_v3.1_pro_10_26`
  draws an `invalid_enum_value` warning.** The reference says "On
  `lightning_v3.1_pro_10_26`, use `en` (English), `es` (...) or `hi` (...)",
  and the model card says "The other 28 languages and `auto` stay on their
  current checkpoints". `auto` warns too. No page documents a 400, so the
  request still validates. With `language` omitted, `number_pronunciation_language`
  is checked instead, because then it "also becomes the synthesis language".
  New export: `PREVIEW_CHECKPOINT_LANGUAGES` (`unmodel/smallest-ai` and
  `unmodel/smallest-ai/values`). The unified row for
  `tts({ model: "smallest-ai/lightning_v3.1_pro_10_26" })` now completes only
  these three languages. Others still compile, with the wire warning.
- **`word_timestamps` warns on uncatalogued models too**, such as the next
  dated checkpoint: "Accepted on this endpoint but ignored". Until now only an
  omitted `model` or one of the three catalogued ids got the warning.
