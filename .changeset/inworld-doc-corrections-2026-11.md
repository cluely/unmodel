---
"unmodel": patch
---

inworld: corrections from the 2026-11-12 doc re-verification. Several requests the API serves were being refused.

False refusals fixed

- `inworld.tts` accepts a `script` (1–100 utterances, each with its own
  `text` and `voiceConfig.voiceId`) in place of `text` + `voiceId`, an inline
  `voiceDesign: { designPrompt }` (7–1,024 characters) in place of `voiceId`,
  and `outputMode` (`PER_UTTERANCE` requires `script`). `TtsVoiceBody` is now
  the union `TtsVoiceTextBody | TtsVoiceDesignBody | TtsVoiceScriptBody`, so
  the type rejects mixed shapes too. The character cap and the cost estimate
  count a script's utterance texts, and the estimate adds a design prompt,
  which "counts once per request" (docs.inworld.ai/portal/billing).
- `audioConfig.sampleRateHertz` takes any integer in [8000, 48000] on REST
  and on the TTS WebSocket. The reference now prints a range plus "Common
  sample rates include: …", not a closed list. `INWORLD_SAMPLE_RATES_HERTZ`
  is that common list.
- `deliveryMode` on the 1.x TTS generations is a warning
  (`unsupported_param`, `meta.ignored`), not an error: "The field is ignored
  on other models."
- `realtimeVoiceContext`: `bufferCharThreshold` takes 0–2000 ("Omission or 0
  selects 1000"), and `audioConfig.audioEncoding` takes
  `"AUDIO_ENCODING_UNSPECIFIED"`, which the socket's enum lists.
  `TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD` is 2000 and
  `TTS_STREAM_MAX_TEXT_CHARACTERS` is 2000 ("Maximum 2000 UTF-16 code units
  per message").
- STT: Voice Profile is no longer refused on third-party routes ("works with
  every STT model on the API — including third-party models"). The `groq`
  row of `STT_MODEL_PARAMS` gains `voiceProfileConfig`.
- STT: `includeWordTimestamps` / `enableSpeakerDiarization` on
  `inworld/inworld-stt-1` pass on the WebSocket and warn (ignored) on sync,
  instead of being refused on both.
- STT sync takes the `MP4`, `MXF` and `WEBM` container encodings. The
  WebSocket refuses them, with the reason ("Not supported for streaming
  transcription").
- `inworldSttV1Config.maxTurnSilence` (20–5000 ms, default 768) is typed and
  bounded.
- Voice cloning: the per-sample cap is 12MB, not 4MB
  (`VOICE_CLONE_MAX_SAMPLE_BYTES`, per docs.inworld.ai/tts/instant-voice-cloning).
  `langCode` is an open enum ("every supported locale has an enum name"), so
  any locale-shaped name such as `SV_SE` or `EN_GB` passes. Only values that
  cannot be enum names (e.g. a BCP-47 `en-US`) are refused.
- Voice design: `designPrompt` is capped at 1000 characters, not 250. Under 30
  is a warning, not an error ("descriptions under 30 rarely produce a useful
  voice"). `designPromptMode` (`DESIGN_PROMPT_MODE_ASSISTED` |
  `DESIGN_PROMPT_MODE_VERBATIM`) is typed.

Catalog and constants

- `inworld-tts-1.5-max` and `inworld-tts-1.5-mini` no longer carry `cost`, so
  estimates return `undefined`. inworld.ai/pricing lists only TTS-2 and TTS-2
  Flash.
- `inworld-tts-1` / `inworld-tts-1-max` are named "TTS 1" / "TTS 1 Max". The
  vendor says only that they are "automatically routed to newer models", so
  the names no longer claim a routing target. Both stay deprecated and
  resolvable.
- Removed: `TTS_STREAM_MAX_CONNECTIONS` (20) and
  `TTS_STREAM_MAX_CONTEXTS_PER_CONNECTION` (5). Neither is a documented
  constant any more. Connections and active contexts are plan-dependent
  (docs.inworld.ai/resources/concurrency-limits).
- The `realtimeTranscribeConfig` example sends the key as an `Authorization:
  Basic` header on the upgrade request. The docs say "Do not put tokens in URL
  query parameters".
