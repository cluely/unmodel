---
"unmodel": patch
---

elevenlabs: `elevenlabs.tts` bounds `stability` and `similarity_boost` to 0–1, and two more error links follow ElevenLabs' moved pages

- **New refusals**: `elevenlabs.tts` now refuses `voice_settings.stability` and `voice_settings.similarity_boost` outside 0–1 (`invalid_shape` at `["voice_settings", "<key>"]`). The text-to-speech request body on api.elevenlabs.io/openapi.json bounds both to `"maximum":1.0,"minimum":0.0` (read 2026-11-13), so such a request fails at the API anyway. `TTS_STABILITY_MIN` / `TTS_STABILITY_MAX` and `TTS_SIMILARITY_BOOST_MIN` / `TTS_SIMILARITY_BOOST_MAX` are exported from `unmodel/elevenlabs`. `style` stays unbounded, because no ElevenLabs source bounds it. `elevenlabs.sts` is unchanged: its body sends `voice_settings` as an untyped JSON string.
- **`.toApi("fal")`**: the out-of-range refusal for `stability` / `similarity_boost` now happens at the source validator instead of the fal mapping. The fal-side 0–1 refusal remains for `style` alone, the one setting fal bounds and ElevenLabs does not.
- **Catalog**: `eleven_multilingual_sts_v2` no longer carries `limit.characters: 10000`. The character-limit table on elevenlabs.io/docs/overview/models lists only `eleven_english_sts_v2` and `eleven_english_sts_v1`, so the figure had no source. No check reads it.
- **Links**: `elevenlabs.speechToTextRealtime`'s keyterm-cap issues cite `/docs/overview/capabilities/speech-to-text`, since `/docs/capabilities/speech-to-text` now redirects there. `elevenlabs.dubLanguage` issues cite `/docs/api-reference/dubbing/language-targets/create-language-target`, since the old `/dubbing/project/language/create` URL redirects to a sign-in page.
