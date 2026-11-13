---
"unmodel": patch
---

speechmatics: Oak 1 (`oak-1`), Speechmatics' multilingual medical model, validates, prices and compiles on `speechmatics.stt` and `unmodel/stt`

- `oak-1` joins the hand catalog, the `model` / `operating_point` literal
  unions, `STT_MODELS` and `STT_MODEL_PARAMS` (`unmodel/speechmatics/values`),
  so `stt({ model: "speechmatics/oak-1", … })` autocompletes and compiles.
  Batch list rate $0.30/hr (https://www.speechmatics.com/pricing.md:
  "| Pre-recorded | Oak 1 | 0.3 | — |"), so a declared duration now yields a
  `costUSD` estimate and `checkJob` prices finished jobs.
- Oak 1 carries Melia 1's Batch gates (https://docs.speechmatics.com/speech-to-text/models.md:
  "On Batch, Melia 1 and Oak 1 match the Enhanced and Standard models for core
  transcription features […] They do not yet support the following features"):
  `language` must be `"multi"` ("Oak 1 does not support the `auto` language
  value, which returns an error"); custom dictionary, find-and-replace, entity
  detection, audio filtering, speaker identification and the six
  speech-intelligence add-ons are refused with `unsupported_capability`, and
  every refusal names the model that drew it.
- `domain: "medical"` on `oak-1` is refused with a message that says Oak 1 is
  itself the multilingual medical model ("Oak 1 is a standalone model for
  healthcare audio. It is separate from the Enhanced Medical model").
