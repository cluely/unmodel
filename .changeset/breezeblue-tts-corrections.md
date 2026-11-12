---
"unmodel": patch
---

breezeblue: `breezeblue.tts` accepts the output profiles and voice settings the API serves, prices at $30 / 1M with CJK counted twice, and enforces the documented text limit

Checked against https://docs.breezeblue.ai/openapi.json, the docs and
`@breeze.blue/sdk` 0.23.0 on 2026-11-12.

- **Output profiles no longer refused.** `output_format` takes the fourteen
  values of the OpenAPI enum — the six bare encodings plus `mp3_24000_64`,
  `mp3_24000_96`, `mp3_24000_128`, `mp3_24000_160`, `wav_24000`,
  `pcm_24000`, `flac_24000` and `aac_24000_128` — where it used to report
  `invalid_enum_value` for every profile. `BreezeblueOutputFormat` widens to
  match. In `unmodel/tts`, `outputFormat` now compiles a bitrate (and a rate
  where a rate-only profile exists) into the profile — `{ format: "mp3",
  bitrate: 64000 }` → `mp3_24000_64` — and anything but 24 kHz, or a bitrate
  BreezeBlue does not publish, is refused at `outputFormat`
  (https://docs.breezeblue.ai/concepts/output-format: "A profile uses
  `codec_sample_rate_bitrate`, omitting the bitrate for WAV, PCM, and FLAC").
- **`voice_settings` takes all four members.** `speed` (0.5–2.0), `volume`
  (0.01–2.0) and `use_speaker_boost` join `guidance_scale` on the strict
  `TtsVoiceSettingsPayload` schema (they were refused as unknown keys), and
  `.toSdk("breezeblue")` forwards them as `speed`, `volume` and
  `useSpeakerBoost`. In `unmodel/tts`, `speed` is now supported — it compiles
  to `voice_settings.speed`, and an out-of-range value is reported at `speed`
  — and `volume` and `use_speaker_boost` are new extras. New exports:
  `SPEED_MIN`, `SPEED_MAX`, `VOLUME_MIN`, `VOLUME_MAX`.
- **Text limit.** Over 2,000 characters is now an `over_output_limit` error,
  and 1,001–2,000 a warning: "Up to 1000 characters by default; accounts with
  an approved higher limit may send up to their configured limit, at most
  2000 characters" (OpenAPI `TtsRequest.text`). Every catalog row carries
  `limit.characters: 2000`; new exports `TTS_MAX_CHARACTERS` and
  `TTS_DEFAULT_MAX_CHARACTERS`.
- **Price.** `TTS_COST_PER_MILLION_CHARACTERS_USD` is 30, not 40: every plan
  card on https://breezeblue.ai/pricing now reads "$30 / 1M characters". The
  estimate counts billable units — Han ideographs, kana and Hangul are two
  each, per https://docs.breezeblue.ai/concepts/pricing — so pure-CJK text is
  no longer under-priced by half. The counter is exported as
  `billableUnits(text)`.
- **`breeze-tts-2` is open-weight.** `openWeights` is now `true`: the weights
  were released on https://huggingface.co/BreezeBlue/Breeze-TTS-2 on
  2026-08-25 (for research and non-commercial use).
- Doc comments now carry the current `instructions` rule ("Write
  `instructions` in the same language as the input text and
  `language_code`") and the current metering wording.
