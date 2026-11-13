---
"unmodel": patch
---

soniox: `RealtimeTranscriptionConfig.api_key` now has a `@deprecated` tag

The JSDoc on `api_key` now starts with `@deprecated`, so editors strike the
field through and TypeScript reports it as deprecated, like the repo's other
deprecated wire fields. Soniox's WebSocket reference says "Send the API key
with the connection instead". From 15 January 2027 it refuses a connection
whose key is sent only in that field
(https://docs.soniox.com/api-reference/stt/websocket-api). The field still
validates and is passed through untouched, with the same `unsupported_param`
warning (`meta.refusedFrom: "2027-01-15"`).
