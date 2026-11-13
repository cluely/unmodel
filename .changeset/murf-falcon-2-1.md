---
"unmodel": patch
---

murf: Falcon 2.1 on `murf.ttsStream`, and the stream fields it ships with

Murf released Falcon 2.1 on 2026-10-19 ("Send `model: "falcon-2.1"` to use it." —
https://murf.ai/api/docs/changelog/2026/10/19). It is now the only value of the Stream
Speech `model` enum and its default, and "The earlier identifiers falcon-2, falcon2 and
FALCON are still accepted and use Falcon 2.1"
(https://murf.ai/api/docs/api-reference/text-to-speech/stream, read 2026-11-12).

- `falcon-2.1` joins the Murf catalog at $10 per 1M characters ("Falcon 2.1 costs 1 cent
  per 1000 characters." — https://murf.ai/api/docs/text-to-speech-models/falcon-2-1) with
  the 3,000-character cap, and validates without `unknown_model`.
- `murf.ttsStream` accepts `falcon2` and `FALCON` and prices them as `falcon-2.1`.
  `STREAM_MODEL_IDS` lists all of them and is now a literal tuple; its union is exported
  as `MurfStreamModelId`, which `SpeechStreamBody.model` autocompletes from.
- `DEFAULT_STREAM_MODEL` is `"falcon-2.1"` ("`model` (enum, optional, default:
  falcon-2.1)"), with no regional exception.
- `SpeechStreamBody` gains `volumeOffset` (integer, -50 to 50, default 0; values outside
  the range "are clamped to the nearest limit", so they warn rather than fail),
  `pronunciationDictionary` (`Record<string, PronunciationDetail>`, `type` `"IPA"` or
  `"SAY_AS"`) and the deprecated `multiNativeLocale` (warns, as it does on `murf.tts`).
  New exports: `VOLUME_OFFSET_MIN`, `VOLUME_OFFSET_MAX`, `PRONUNCIATION_TYPES`,
  `FALCON_STYLE` and the `PronunciationDetail` / `PronunciationDetailType` types.
- On every Falcon spelling, a `style` other than `"Conversational"` warns ("Falcon 2.1
  voices speak in a single style, `Conversational`." —
  https://murf.ai/api/docs/text-to-speech/speech-customization), and the `variation`
  no-op warning now fires for `falcon-2.1`, `falcon2` and `FALCON` too, not only
  `falcon-2`.
- `unmodel/tts` serves `murf/falcon-2.1` on the stream route (bytes). Both Falcon refs
  take `volumeOffset` and `pronunciationDictionary` as extras.
