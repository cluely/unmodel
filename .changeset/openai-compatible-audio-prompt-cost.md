---
"unmodel": patch
---

openai-compatible: `checkChat` prices `prompt_tokens_details.audio_tokens` at the audio rate

Chat Completions responses report the audio part of `prompt_tokens` in
`prompt_tokens_details.audio_tokens` (OpenAI, and OpenRouter for every routed
model), but the shared checker never passed it to `computeCostUSD`, so audio
prompt tokens were billed at the text rate. An OpenRouter
`google/gemini-3-flash-preview` response with 800k audio and 200k text prompt
tokens priced at $0.50 instead of $0.90. It now passes the count as
`audioInputTokens`, the same re-rating `google.checkChat` already does.
