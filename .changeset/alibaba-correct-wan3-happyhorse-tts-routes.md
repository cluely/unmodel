---
"unmodel": patch
---

alibaba: wan3.0 takes 21:9 and is priced, HappyHorse 1.1 takes 480P, and the Qwen-Audio-TTS refusal names its HTTP route

Corrections read off Alibaba Cloud Model Studio's international docs on
2026-11-12:

- `wan3.0-video` and `wan3.0-video-prime` accept `parameters.ratio: "21:9"`
  (and `aspectRatio: "21:9"` through `unmodel/video`), which `alibaba.video`
  refused. The wan3 reference lists "adaptive (Default value) … 21:9 | 16:9 |
  4:3 | 1:1 | 3:4 | 9:16". `WAN3_RATIOS` is exported from
  `unmodel/alibaba/values` beside `WAN_RATIOS`.
- `wan3.0-video` now has a cost: the Singapore pricing table lists
  "480P | List price $0.05/second … 720P | List price $0.1/second … 1080P |
  List price $0.2/second". Estimates use the list price; the table's
  "(Limited-time 30% off)" promotion is not reflected, so they read high
  while it runs. `cost.perVideoSecond` is 0.2 (the 1080P default).
- `happyhorse-1.1-t2v`, `happyhorse-1.1-i2v` and `happyhorse-1.1-r2v` accept
  `resolution: "480P"` (`"480p"` through `unmodel/video`), which was refused:
  the references list "480P, 720P, and 1080P", and the pricing page prices
  480P at $0.07/second on all three. The 1.0 generation keeps 720P/1080P (the
  pricing page has no 480P row for it).
- `alibaba.tts` still refuses `qwen-audio-3.0-tts-plus` and
  `qwen-audio-3.0-tts-flash` (the multimodal-generation route cannot serve
  them), but the message now names the HTTP route that does — POST
  `/api/v1/services/audio/tts/SpeechSynthesizer` — besides the realtime
  WebSocket. `SPEECH_SYNTHESIZER_PATH` and `SPEECH_SYNTHESIZER_TTS_MODEL_IDS`
  are exported from `unmodel/alibaba`.

Sources: https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference,
https://www.alibabacloud.com/help/en/model-studio/model-pricing,
https://www.alibabacloud.com/help/en/model-studio/happyhorse-text-to-video-api-reference,
https://www.alibabacloud.com/help/en/model-studio/happyhorse-image-to-video-api-reference,
https://www.alibabacloud.com/help/en/model-studio/happyhorse-reference-to-video-api-reference,
https://www.alibabacloud.com/help/en/model-studio/qwen-audio-tts-http-api.
