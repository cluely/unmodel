---
"unmodel": patch
---

google-vertex, google: Google Search grounding on the image models, Gemini 4 long decode on Vertex, and a warning for partner models on `vertex.chat` (pages retrieved 2026-11-13)

- **Google Search grounding is no longer refused on models without function calling.** `vertex.chat` and `google.chat` refused every `tools` entry on a `toolCall: false` row, including `{ googleSearch: {} }`, which these models' pages list as supported:
  - Vertex `gemini-nano-banana-2.1`: "Grounding Google Search, Image search Supported".
  - Vertex `gemini-3-pro-image` and `gemini-3.1-flash-image`: "Grounding Google Search Supported".
  - The Gemini API pages for all three models list "Grounding with Google Search" as supported.

  `googleSearch` now passes on these three ids, image search included (`googleSearch.searchTypes.imageSearch`). Every other tool key is still refused, one issue per key at `["tools", i, key]`: `functionDeclarations` ("Function calling Not supported"), and `codeExecution` and `urlContext`. Every other `toolCall: false` row still refuses `tools` outright at `["tools"]`. That includes `gemini-2.5-flash-image`, whose pages say grounding is not supported. On `google.chat`, the per-model `tools` type arm follows the runtime check. The three ids accept only the `googleSearch` shape, where `gemini-3-pro-image` and `gemini-3.1-flash-image` took `never` before and `gemini-nano-banana-2.1` took the full tool array.
- **Gemini 4 `maxOutputTokens` on Vertex goes up to 1,048,576.** `vertex.chat` refused any `generationConfig.maxOutputTokens` above 65,536 on `gemini-4-argon`, `gemini-4-carbon` and `gemini-4-hydrogen`. Each model page lists "Maximum output tokens 1,048,576", and each developer guide says "setting `max_output_tokens` greater than `1,048,576` returns an HTTP `400` error". Carbon's guide also sends 131072 and 256000 in its samples. The `over_output_limit` error now fires only above 1,048,576 and cites the guide (`…/models/guides/<id>#long-decodes`). A value above 65,536 and at most 1,048,576 passes with an `over_output_limit` warning. The warning explains that long decode needs `continuation_token`, which "is supported only in the `v1beta1` API", but `.request.url` targets `/v1/`. For output past one segment, use `.toSdk("google-vertex")`, since the Gen AI SDK uses v1beta1 by default, or call a `/v1beta1/` REST path. `estimate()` and the catalog's `limit.output` are unchanged.
- **Partner and open models on `vertex.chat` now get a warning.** The google-vertex catalog includes Claude, Mistral, Grok and the `-maas` open models, and `vertex.chat` validated them with no warning into a `publishers/google/models/{model}:generateContent` URL, which Vertex does not document for them. They now pass with an `unsupported_capability` warning at `["model"]`. The warning names the route Vertex does serve them on, in `meta.route`, with the page in `meta.source`:
  - `-maas` and `xai/` ids: `endpoints/openapi/chat/completions`, the OpenAI-compatible route (…/models/maas/call-open-model-apis, …/partner-models/use-partner-models: "Grok models use the OpenAI-compatible chat completions and Responses APIs, so the request path uses `endpoints/openapi`").
  - Claude: `publishers/anthropic/models/{model}:rawPredict`.
  - `mistral-*` and `codestral-*`: `publishers/mistralai/models/{model}:rawPredict` (…/partner-models/mistral).

  The warning also says unmodel has no validator for those routes. The request is still built exactly as written. The families are the ones the availability data already records, and a test pins the two against each other.
