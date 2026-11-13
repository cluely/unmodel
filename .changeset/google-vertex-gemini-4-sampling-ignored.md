---
"unmodel": patch
---

google-vertex: `temperature` on Gemini 4 is a warning, not an error

The generated Vertex rows for `gemini-4-argon`, `gemini-4-carbon` and `gemini-4-hydrogen` carry `temperature: false`, so `chat` refused `generationConfig.temperature` with `unsupported_param`. The API accepts that request. Each Gemini 4 page says "Custom values for sampling parameters (temperature, top_p, and top_k) are ignored.", and Carbon and Hydrogen list "Temperature: 1.0 (fixed; custom values ignored) topP: 0.95 (fixed; custom values ignored) topK: 64 (fixed; custom values ignored)". So `temperature`, `topP` and `topK` on these three ids now pass, each with an `unsupported_param` warning (`meta.ignored: true`) that cites the page.

`gemini-nano-banana-2.1` is not part of this change. Its page says those parameters return an API error, so they stay refused.

Sources, retrieved 2026-11-12: docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/{4-argon, 4-carbon, 4-hydrogen, nano-banana-2-1}.
