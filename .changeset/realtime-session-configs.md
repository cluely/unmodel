---
"unmodel": minor
---

Realtime session configs for the speech providers — the documented JSON config object
of each socket surface, never the socket lifecycle.

New request validators (all on existing subpaths — no new package exports):

- `unmodel/cartesia`: `ttsWebsocket` (+ `ttsWebsocketUrl`), `sttWebsocket`
  (+ `sttWebsocketUrl`, `sttWebsocketConstraints`).
- `unmodel/deepgram`: `listenLive`, `listenFlux` + its mid-stream `fluxConfigure`
  message, `speakLive` (+ `listenLiveUrl`, `listenFluxUrl`, `speakLiveUrl`).
- `unmodel/elevenlabs`: `textToSpeechStreamInput` (+ `textToSpeechStreamInputUrl`,
  `toInitializeConnectionMessage`), `speechToTextRealtime`
  (+ `speechToTextRealtimeUrl`).
- `unmodel/inworld`: `stt` (sync STT — base64 audio inline in the JSON body),
  `realtimeTranscribeConfig` and `realtimeVoiceContext` (the first frame of each
  bidirectional socket).
- `unmodel/soniox`: `realtimeTranscription` (the configuration message sent right
  after connecting).

These follow the `openai.realtimeSession` pattern: unmodel validates the config
object — a connection-URL query set, a first configuration frame, or a per-chunk
generation message — with the same catalog awareness, documented bounds and
per-model gates as any REST endpoint. Opening the connection, framing audio,
keepalives and every server event stay out of scope, as each module's header states
next to the doc URL it was verified against.

Where the socket address follows from the config, `.request` describes the socket
(`wss://` url, method `"GET"` — a handshake is an HTTP GET upgrade); the surfaces
whose address must be assembled from the params export a URL builder instead.

`unmodel validate` now covers these too and labels them `transport: websocket`
rather than mistaking a header-less socket config for a multipart body.
