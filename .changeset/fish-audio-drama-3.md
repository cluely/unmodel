---
"unmodel": patch
---

fish-audio: `drama-3` joins `fish-audio.tts` and `unmodel/tts` (`fish-audio/drama-3`)

- `drama-3` (Fish Audio Drama 3, launched 2026-10-13) is a value of the
  `model` header enum on `POST /v1/tts`. It validates, compiles from
  `unmodel/tts` with the same codecs and extras as the S2 rows, and prices at
  the list rate of $50.00 / M UTF-8 bytes
  ([pricing](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits)).
  Fish Audio bills a launch price of $10.00 / M UTF-8 bytes through
  2026-11-30; the catalog carries the list price, so `maxCostUSD` budgets
  against the price you pay from 2026-12-01.
- Multi-speaker dialogue (a `reference_id` array or a nested `references`
  array) is accepted on `drama-3`. The TTSRequest schema reads "Multi-speaker
  dialogue synthesis is available with the S2 family (`s2-pro`, `s2.1-pro`,
  `s2.1-pro-free`) and `drama-3`, not `s1`". The new
  `MULTI_SPEAKER_MODEL_IDS` export lists those models, and the `s1` refusal
  names them in its message and in `meta.allowed`.
- The `prosody.normalize_loudness` no-op warning now fires only on `s1`, the
  one model the docs say it has no effect on. A `drama-3` request that sets it
  validates clean.
- `docs/providers.md` lists Fish Audio's speech-to-text (`POST /v1/asr`) and
  realtime transcription socket as still to do.
