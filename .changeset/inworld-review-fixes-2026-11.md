---
"unmodel": patch
---

inworld: review fixes for the 2026-11 wave. Two false refusals and two false accepts.

False refusals fixed

- `temperature: 0` passes on `inworld.tts` and `inworld.realtimeVoiceContext`.
  The range is now [0, 2]. Both references say "Accepts values between 0
  (exclusive) and 2 (inclusive)", and the same paragraph adds "If 0 is
  provided, the default value will be used." So the API serves a request with
  0, and treats it as asking for the default.
- `assemblyaiConfig.prompt` on `assemblyai/universal-3-5-pro` is a warning
  (`unsupported_param`, severity warning), not an error. Inworld's
  `assemblyaiConfig` table says "Universal-3 Pro Streaming only". The same
  page's Realtime AssemblyAI example sends a `prompt` to this model, and
  AssemblyAI documents Universal-3.5 Pro Realtime as promptable. `prompt` is
  still an error on the other AssemblyAI routes, and `meta.allowed` now names
  both Pro ids.
- The unified `stt` pack no longer refuses `timestamps: "word"` on an
  `inworld/…` id outside its table. Such an id already warns
  `unknown_model`. It now compiles to `includeWordTimestamps: true`, matching
  what `inworld.stt` accepts.

False accepts fixed

- `inworld.realtimeVoiceContext` refuses `audioConfig.audioEncoding: "FLAC"`.
  The WebSocket reference's enum is `AUDIO_ENCODING_UNSPECIFIED`, `LINEAR16`,
  `MP3`, `OGG_OPUS`, `ALAW`, `MULAW`, `PCM` and `WAV`, with no FLAC. The type
  `InworldVoiceContextAudioConfig.audioEncoding` drops FLAC to match.
- `inworld.stt` and `inworld.realtimeTranscribeConfig` refuse
  `audioEncoding: "AUDIO_ENCODING_UNSPECIFIED"` (`invalid_enum_value`).
  `meta.allowed` lists the encodings that work on that surface. Both
  references document the zero value as an error: "Will return
  [google.rpc.Code.INVALID_ARGUMENT]" (sync) and "Will return an error."
  (WebSocket).
