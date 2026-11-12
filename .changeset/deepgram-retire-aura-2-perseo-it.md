---
"unmodel": patch
---

deepgram: retire `aura-2-perseo-it`

- Removed: `aura-2-perseo-it` (from `ttsModels`, `DeepgramTtsModelId`, the
  `unmodel/tts` ref union and `unmodel/deepgram/values`' `TTS_MODELS` /
  `TTS_MODEL_PARAMS`). Deepgram never served it — "The unsupported
  `aura-2-perseo-it` model is removed from Speak V1 model literals; the API
  never served that model" (https://developers.deepgram.com/changelog/2026/9/14),
  and the API answers it with 400 `No such model/version combination found`
  (deepgram-python-sdk changelog). The `/v1/speak` `model` enum now lists 102
  Aura voices.
- Replacement: none — pick one of the nine Italian Aura-2 voices that remain:
  `aura-2-cesare-it`, `aura-2-cinzia-it`, `aura-2-demetra-it`,
  `aura-2-dionisio-it`, `aura-2-elio-it`, `aura-2-flavio-it`,
  `aura-2-livia-it`, `aura-2-maia-it`, `aura-2-melia-it`. The id now
  validates with an `unknown_model` warning and no cost estimate.
