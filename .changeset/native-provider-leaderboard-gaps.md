---
"unmodel": minor
---

**Native provider wave: leaderboard-gap coverage across TTS, image, video and music.**

An audit of the current TTS / image / video / music leaderboards against the native catalogs,
then coverage for every gap a public developer API can reach.

Two new providers:

- **`unmodel/breezeblue`** — Breeze TTS 2 (`breezeblue.tts`), with a unified adapter, wire
  types and values entry.
- **`unmodel/mureka`** — song and instrumental generation (`mureka.music`,
  `mureka.instrumental`) on the async create-then-poll shape, mureka-7.6 through 9.5, with a
  unified `music` adapter.

New endpoints on providers that were already here:

- **stepfun** — StepAudio 2.5 TTS (`stepfun.tts`, `/v1/audio/speech`), a hand catalog
  mirroring the generated chat rows.
- **alibaba** — Qwen3-TTS on DashScope (`alibaba.tts`, unary HTTP; the realtime-WebSocket-only
  ids ship as catalog rows the unary validator rejects by name) and DashScope video synthesis
  (`alibaba.video`: Wan 3.0/2.7/2.6/2.5/2.2/2.1 plus HappyHorse 1.0/1.1, async
  create-then-poll). Chat moves to a dedicated leaf so `unmodel/chat` stops paying for the
  provider barrel.
- **xai** — Grok Imagine image (`xai.image`, `/v1/images/generations`) and video
  (`xai.video`, `xai.videoEdit`, `xai.videoExtend`), with the same chat-leaf split.
- **google** — Lyria 3 Pro / Clip music over the Gemini Interactions API (`google.music`),
  with a hand-mirrored catalog so `unmodel/music` stays free of the generated catalog.
- **azure** — the Microsoft Foundry MAI-Image-2.5 family (`/mai/v1/images/generations` plus
  multipart edits) under the deployment-name doctrine: wire validators only, no unified refs,
  the same rule azure chat already follows.

Catalog refreshes: cartesia (`sonic-preview` identified as the Sonic 3.6 beta, dated legacy
snapshots and sunset dates), elevenlabs (`eleven_v3_conversational` plus legacy v1 rows),
speechify (the simba retirement schedule).

Also recorded, so the gaps stay explained rather than looking like oversights: Suno, VUI Labs,
MAGI-2 and MiniMax Music are not addable (no public developer API, or closed to new users).
