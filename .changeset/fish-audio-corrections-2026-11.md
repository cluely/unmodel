---
"unmodel": patch
---

fish-audio: `s1` is deprecated, `s2-pro` has open weights, the TTS `language` and `pronunciation_dictionary` fields and the voice-clone `voice_design_signatures` field are accepted, `repetition_penalty` on `s2.1-pro` warns as a no-op, and the voice-clone visibility checks follow the private default

- `s1` now carries `status: "deprecated"`, so requests that use it get a
  `deprecated_model` warning. "S1 is deprecated and will be retired on December 31,
  2026. After that date, requests that specify `s1` are served by `s2.1-pro`"
  ([deprecations](https://docs.fish.audio/developer-guide/models-pricing/deprecations)).
  It is still served until that date, so it keeps validating and its
  single-speaker rule stays.
- `s2-pro` now has `openWeights: true`. models-overview lists it as
  "Open-source", and https://huggingface.co/fishaudio/s2-pro publishes the
  weights.
- `fish-audio.tts` accepts `language`, a BCP-47 tag of at most 35 letters,
  digits, `-` or `_`. Anything else is an error, since the docs say such
  values "are rejected with HTTP 400". Before this change the request type
  refused the field at compile time. Fish Audio uses it "only by text
  normalization … and by word-timestamp alignment", so the canonical
  `language` on `unmodel/tts` is still refused, and the refusal reason now
  says why.
- `fish-audio.tts` accepts `pronunciation_dictionary`: up to 3 references
  (`{ id, version }`) or up to 3 inline dictionaries (`{ items }`, each with at most
  5000 entries), never both in one request. The fields follow the
  `PronunciationDictionaryRef`, `PronunciationDictionaryInline` and
  `PronunciationItem` schemas. Fish Audio bills "the text actually synthesized, with alias replacements
  counted". A request that carries a reference or an inline `alias` entry
  therefore gets no cost estimate. Phoneme-only dictionaries keep the
  estimate.
- `fish-audio.voiceClone` accepts `voice_design_signatures` (a string or an
  array, sent as one form part per item). Fish Audio documents no way to get
  a signature: the voice-design candidates in the response have no signature field.
- `fish-audio.voiceClone` no longer warns when `visibility` is omitted. That
  warning said the default was "public". The POST /model schema now has
  `"default": "private"`, and "Public requests are downgraded to private; use
  the web publish flow to publish publicly"
  ([openapi.json](https://docs.fish.audio/api-reference/openapi.json)).
- `fish-audio.voiceClone` (and `unmodel/voice-clone` on `fish-audio/fast`)
  now warns that an explicit `visibility: "public"` is downgraded to private.
  The warning is `unsupported_param` at `visibility`, with `meta.applied:
  "private"`.
- `fish-audio.voiceClone` (and `unmodel/voice-clone` on `fish-audio/fast`)
  now warns, and no longer refuses, when `visibility: "public"` has no
  `cover_image`. Public requests are downgraded to private, and the docs do
  not say whether the server still requires one.
- `fish-audio.tts` warns that `repetition_penalty` is accepted but has no
  effect on `s2.1-pro`, including when the `model` header is omitted and the
  server falls back to `s2.1-pro`. The source is "`repetition_penalty` applies
  to S1 but has no effect on S2.1-Pro"
  ([migrate-from-s1](https://docs.fish.audio/developer-guide/models-pricing/migrate-from-s1)).
  On `unmodel/tts`, `fish-audio/s2.1-pro` no longer takes `repetition_penalty`
  as an extra, so the request is refused at compile time.
  `s2.1-pro-free`, `s2-pro`, `drama-3` and `s1` still take it, because the
  page names only S2.1-Pro.
- `pronunciation_dictionary` is now a typed extra on `unmodel/tts` for every
  `fish-audio/…` model, and `TTS_MODEL_PARAMS` in `unmodel/fish-audio/values`
  lists it. Before this change it was reachable only through `providerOptions`.
- The doc comments now give the JavaScript SDK's real package name, `fish-audio`
  (`fish-audio-sdk` is the Python package), and list the fields its
  0.1.0 types lack.
