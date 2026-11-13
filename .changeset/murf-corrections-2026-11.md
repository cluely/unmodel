---
"unmodel": patch
---

murf: companded codecs warn instead of failing, `pronunciationDictionary` on `murf.tts`, and a re-verified catalog

Every source below was read on 2026-11-12.

- **ULAW / ALAW no longer refuse requests Murf fulfils.** A companded `format` with a
  `sampleRate` other than 8000 or a `channelType` other than `MONO` was an error on both
  routes; it is now an `invalid_enum_value` warning naming the value the API applies:
  "ULAW and ALAW formats only support mono channel type and a sample rate of 8000 Hz. If
  you specify a different channel type or sample rate, the API will default to the
  supported values." (https://murf.ai/api/docs/text-to-speech/overview)
- **`pronunciationDictionary` on `murf.tts`.** The Synthesize Speech body takes it too
  ("`pronunciationDictionary` (map from string to PronunciationDetail, optional) — Custom
  pronunciations for words in `text`." —
  https://murf.ai/api/docs/api-reference/text-to-speech/generate), so `SpeechGenerateBody`
  accepts it instead of a compile error and an `unknown_param` warning, and `murf/gen2`
  takes it as an extra in `unmodel/tts`.
- **The `falcon-2` row is Falcon 2.1 under its earlier id.** Its `name` is now
  `"Falcon 2.1 (earlier id falcon-2)"` and its rate cites "Falcon 2.1 costs 1 cent per 1000
  characters." (https://murf.ai/api/docs/text-to-speech-models/falcon-2-1) — still $10 per
  1M characters. It is not marked deprecated: Murf says "still accepted".
- The character-cap issue's `meta.source` is the FAQ (https://murf.ai/api/docs/resources/faq)
  that states the cap, not the TTS overview, which no longer does.
- JSDoc: `locale` is documented on both routes, not "Gen2 only"; pause tags in `text` are
  Gen2-only ("custom pause tags … are Synthesize (Gen 2) only" —
  https://murf.ai/api/docs/text-to-speech/synthesize).
- `docs/providers.md` records why Murf's Instant Voice Cloning is not covered: it "is
  available on the Enterprise plan only" and returns `403` until enabled per workspace.
