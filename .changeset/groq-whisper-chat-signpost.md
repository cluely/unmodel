---
"unmodel": patch
---

groq: the Whisper ids are named as speech-to-text models, not chat models

- `groq.chat` now warns `unsupported_capability` (path `["model"]`) on
  `whisper-large-v3` and `whisper-large-v3-turbo`, naming the route Groq does
  serve them on: POST https://api.groq.com/openai/v1/audio/transcriptions and
  /audio/translations for `whisper-large-v3`, transcriptions only for
  `whisper-large-v3-turbo` ("Translation Support | No",
  https://console.groq.com/docs/speech-to-text, read 2026-11-12). unmodel has no
  validator for those routes. It is a warning, and the request is still built
  as written. The 448-token Whisper limits still produce `over_context` /
  `over_output_limit` errors on long requests; the warning now sits beside
  them and gives the real cause.
- `unmodel/chat` drops the `"groq/whisper-large-v3"` and
  `"groq/whisper-large-v3-turbo"` refs (`ChatModelRef`, `CHAT_MODEL_REFS` and
  the chat profiles). Both compiled to a Chat Completions request that Groq
  serves on no chat route.
