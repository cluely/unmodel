---
"unmodel": patch
---

cartesia: the docs and JSDoc now name `Authorization: Bearer` as the auth header, and the catalog's pricing and provenance notes are refreshed (sources read 2026-11-12)

- Auth: every `cartesia.*` JSDoc example and the `docs/tts.md` auth table now
  send `Authorization: Bearer <api_key>` instead of `X-API-Key`. Cartesia's API
  conventions page says "Include `Authorization: Bearer <api_key>` in the
  headers of your requests.", every OpenAPI security scheme is `type: http,
  scheme: bearer`, and `@cartesia/cartesia-js` 4.2.0 sends exactly that header.
  Docs only: unmodel still never touches the key.
- The catalog's pricing note adds the realtime `ink-whisper` rate (1 credit
  per second on `/stt/websocket` and `/stt/turns/websocket`) and records the
  overage rates cartesia.ai/pricing now publishes per tier ($65 / $45 / $38
  per 1M credits on Pro / Startup / Scale). There is still no rate that holds
  across plans, so Cartesia rows still carry no `cost` and estimates still
  return no `costUSD`.
- Provenance URLs point at the pages that serve the pinned schema: the
  `docs.cartesia.ai/2026-03-01/api-reference/...` references (the unversioned
  pages now render Cartesia-Version 2026-08-14), `tts-models/api-changes` for
  sunsets (the old deprecations URL redirects to a login), and
  `tts-models/{latest,older-models}` for the model tables.
