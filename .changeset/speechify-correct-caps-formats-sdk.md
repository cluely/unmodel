---
"unmodel": patch
---

speechify: spoken-character caps, the 160 kbps mp3 formats, `safety_identifier`, the legacy pair's rate and the stream SDK shape

Every fact below was read on 2026-11-12.

- **Character caps count spoken characters, in code points.** "Every limit counts the characters
  that are spoken, which are the characters the request is billed for. SSML tags do not count, an
  entity such as `&amp;` is one character, and a `<sub>` counts its `alias`." and "A character is
  one Unicode code point, so an emoji is one character even where JavaScript's `length` counts
  two." (https://docs.speechify.ai/build/guides/concepts/api-limits). `speechify.tts` and
  `speechify.ttsStream` used to count `input.length` with markup included, refusing SSML-heavy
  and emoji-heavy input the API accepts. The 2,000 / 20,000 spoken caps now apply to plain text,
  without its leading and trailing whitespace; input carrying SSML or an entity gets the ceiling
  on "The input as sent, markup included": 20,000 on `/v1/audio/speech`, 32,000 on
  `/v1/audio/stream`, exported as `SPEECH_MAX_SENT_CHARACTERS` / `STREAM_MAX_SENT_CHARACTERS`. The
  issue's `meta.counted` says which count fired (`"spoken"` or `"sent"`).
- **`mp3_22050_160` and `mp3_24000_160`** are accepted on both routes (OpenAPI `AudioOutputFormat`,
  "All 23 values, as the API accepts them." —
  https://docs.speechify.ai/build/guides/concepts/audio-formats), and `unmodel/tts` compiles a
  160 kbps mp3 request to them.
- **`safety_identifier`** joins `AudioSpeechBody` and `AudioStreamParams`. It was a compile error
  before. It is checked against the OpenAPI pattern `^[A-Za-z0-9._:|+/=-]{1,64}$` ("The value must
  be 1 to 64 characters of letters, digits and `. _ - : | + / =`." —
  https://docs.speechify.ai/build/guides/concepts/safety-identifiers), so an email address is an
  `invalid_shape` error.
- **`simba-english` and `simba-multilingual` price at $15 per 1M characters.** "A request naming
  either id is billed at the `simba-3.5` rate on your plan"
  (https://docs.speechify.ai/build/changelog/2026/11/10), and `simba-3.5` bills its $15 Starter
  list rate "From 22 November" (https://docs.speechify.ai/build/changelog/2026/11/9). They stay
  catalogued and deprecated: "Nothing breaks; the audio changes."
  (https://docs.speechify.ai/build/guides/concepts/models).
- **`ttsStream(...).toSdk("speechify")` returns `{ Accept?, body }`**, the `StreamAudioRequest`
  that `client.audio.stream()` takes in @speechify/api 4.0.0 (2026-08-19) through 5.0.0
  (`Accept?: Speechify.StreamAudioRequestAccept; body: Speechify.GetStreamRequest;`). It used to
  return the flat 3.x shape, and those SDKs send no body for that shape. `AudioStreamSdkParams`
  changes to match.
