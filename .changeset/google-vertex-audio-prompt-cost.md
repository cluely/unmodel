---
"unmodel": patch
---

google-vertex: `checkChat` prices the audio part of a prompt at the audio rate

`google.checkChat` re-rates the AUDIO entry of `usageMetadata.promptTokensDetails`
at the model's `inputAudio` rate, but the Vertex checker, which recomputes
`costUSD` from google-vertex catalog rates, left that step out and billed every
prompt token at the text rate. A Vertex `gemini-2.5-flash` response with 800k
audio and 200k text prompt tokens priced at $0.30 instead of $0.86. It now
passes `audioPromptTokens(usageMetadata)` to `computeCostUSD` the same way.
