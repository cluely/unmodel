---
"unmodel": patch
---

deepgram: `nova-3-pharma`, and Flux TTS voices refused by name on `/v1/speak`

- `nova-3-pharma` joins the Deepgram catalog — Deepgram's Nova-3 model for
  pharmaceutical vocabulary, English only (`en`, `en-US`, `en-AU`, `en-CA`,
  `en-GB`, `en-IE`, `en-IN`, `en-NZ`), batch and streaming
  (https://developers.deepgram.com/changelog/2026/9/17). It validates on
  `deepgram.stt` and `deepgram.listenLive` without an `unknown_model` warning,
  takes `keyterm` like the other Nova-3 ids, and `deepgram/nova-3-pharma`
  resolves in `unmodel/stt` with the Nova-3 extras row. It carries no cost:
  deepgram.com/pricing publishes no rate for it, so estimates return
  `undefined`.
- `deepgram.tts` and `deepgram.speakLive` now refuse a Flux TTS voice
  (`flux-{voice}-{language}`, e.g. `flux-alexis-en`) with
  `unsupported_capability`, naming `/v2/speak` (batch REST and WebSocket) as
  the endpoint that serves it. Before, the id was unknown to the catalog and
  passed with only an `unknown_model` warning, although `/v1/speak` accepts
  the Aura and Aura-2 voices alone ("Flux TTS is served on the new `/v2/speak`
  endpoint … Aura and Aura-2 continue to be served on `/v1/speak`",
  https://developers.deepgram.com/changelog/2026/8/12). Other unknown ids keep
  the warning, so a new Aura voice is never refused.
