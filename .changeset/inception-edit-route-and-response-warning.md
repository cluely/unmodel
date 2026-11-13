---
"unmodel": patch
---

inception: `mercury-edit-2` warns on `inception.chat` and leaves the `unmodel/chat` refs, and `inception.checkChat` reports the response's `warning`

- `inception.chat` now warns `unsupported_capability` at `["model"]` for
  `mercury-edit-2`, naming POST /v1/fim/completions and POST
  /v1/edit/completions: Inception serves it only there, and POST
  /v1/chat/completions answers it 400 ("Model must be one of the following:
  mercury, mercury-2, mercury-2.5, mercury-3, …", checked 2026-11-13). The
  request still validates and is sent as written; unmodel validates neither
  route. Sources: https://docs.inceptionlabs.ai/get-started/models and
  https://api.inceptionlabs.ai/v1/edit/completions/models.
- The `unmodel/chat` ref `inception/mercury-edit-2` is withdrawn from
  `ChatModelRef` and `CHAT_MODEL_REFS`: it compiled to a body the chat
  endpoint refuses. Sending it anyway gets the substrate warning above.
- `inception.checkChat` reports a non-empty top-level `warning` string as an
  `invalid_shape` warning at `["warning"]` with `meta.kind:
  "provider_warning"`. The API fills it when it resets an out-of-range
  `temperature` (`ChatCompletionResponse.warning`,
  https://api.inceptionlabs.ai/openapi.json). `ChatCompletionLike` from
  `unmodel/inception` and `unmodel/inception/types` now declares
  `warning?: string | null`.
